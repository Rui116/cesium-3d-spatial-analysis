<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">⊡</span><span>缓冲区分析</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">
        <div class="field-group">
          <label class="hud-label">缓冲类型</label>
          <el-button-group style="width:100%">
            <el-button size="small" :type="bufferType==='point'?'primary':'default'" @click="startPointBuffer" style="flex:1">{{ bufferType === 'point' ? '⊗ 点缓冲' : '点缓冲' }}</el-button>
            <el-button size="small" :type="bufferType==='line'?'primary':'default'" @click="startLineBuffer" style="flex:1">{{ bufferType === 'line' ? '⊗ 线缓冲' : '线缓冲' }}</el-button>
          </el-button-group>
        </div>
        <div class="field-group">
          <label class="hud-label">缓冲距离<span class="label-value">{{ bufferRadius }} 米</span></label>
          <el-input-number v-model="bufferRadius" :min="10" :step="10" size="small" style="width:100%" />
        </div>
        <div v-if="bufferType === 'line' && drawingPts.length" class="hint-text">
          已选 {{ drawingPts.length }} 个端点 · 按 <kbd>Enter</kbd> 完成
        </div>
        <el-button type="danger" size="small" @click="resetAll">清除全部</el-button>
        <el-alert v-if="statusText" :type="statusType" :title="statusText" :closable="false" show-icon style="margin-top:6px" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import * as Cesium from 'cesium'
import { useViewer } from '@composables/useCesium'
import { cesiumHelpers } from '@utils/cesiumHelpers'
import { lineString } from '@turf/helpers'
import { buffer as turfBuffer } from '@turf/buffer'

const { viewer } = useViewer()

const panelCollapsed = ref(false)
const bufferType = ref(null)
const bufferRadius = ref(1000)
const statusText = ref('请选择分析类型')
const statusType = ref('info')
const drawingPts = ref(0)

let activeHandler = null
let lineEntity = null             // 单一线实体，每次更新而非新建
let bDS = null
let trackedEntities = []          // viewer 上的实体引用，精确清理
let lineKeydownHandler = null

function getDS() {
  if (!bDS) {
    bDS = new Cesium.CustomDataSource('bufferLayer')
  }
  const v = viewer.value
  if (v && !v.dataSources.contains(bDS)) v.dataSources.add(bDS)
  return bDS
}

function setStatus(m, t = 'info') { statusText.value = m; statusType.value = t }

function resetState() {
  cesiumHelpers.destroyHandler(activeHandler)
  activeHandler = null

  // 精确清理 viewer 实体（不影响其他功能的实体）
  trackedEntities.forEach(e => {
    try { viewer.value?.entities.remove(e) } catch (_) { /* ok */ }
  })
  trackedEntities = []

  // 清理 DataSource
  if (bDS) {
    bDS.entities.removeAll()
    try { viewer.value?.dataSources.remove(bDS, true) } catch (_) { /* ok */ }
    bDS = null
  }

  // 清理线实体引用
  if (lineEntity) {
    try { viewer.value?.entities.remove(lineEntity) } catch (_) { /* ok */ }
    lineEntity = null
  }

  // 清理键盘监听
  if (lineKeydownHandler) {
    document.removeEventListener('keydown', lineKeydownHandler)
    lineKeydownHandler = null
  }

  drawingPts.value = 0
}

function resetAll() {
  resetState()
  bufferType.value = null
  setStatus('请选择分析类型', 'info')
}

/* ---- 点缓冲 ---- */

function startPointBuffer() {
  const v = viewer.value; if (!v) return
  if (bufferType.value === 'point') {
    resetState()
    bufferType.value = null
    setStatus('请选择分析类型', 'info')
    return
  }
  resetState()
  bufferType.value = 'point'
  setStatus('在地图上点击选择位置', 'info')

  activeHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  activeHandler.setInputAction((e) => {
    const ray = v.camera.getPickRay(e.position)
    const pos = v.scene.globe.pick(ray, v.scene)
    if (!Cesium.defined(pos)) { setStatus('无效位置，请重试', 'error'); return }

    const r = bufferRadius.value
    if (isNaN(r) || r <= 0) { setStatus('缓冲距离无效', 'error'); return }

    createPtBuf(pos, r)
    cesiumHelpers.destroyHandler(activeHandler)
    activeHandler = null

    setStatus(`点缓冲区 · 半径 ${r} 米`, 'success')
    ElMessage.success('点缓冲区已创建')
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function createPtBuf(position, radius) {
  const v = viewer.value; if (!v) return

  const ds = getDS()
  ds.entities.removeAll()

  const c = Cesium.Cartographic.fromCartesian(position)
  const lon = Cesium.Math.toDegrees(c.longitude)
  const lat = Cesium.Math.toDegrees(c.latitude)
  const cosLat = Math.cos(Cesium.Math.toRadians(lat)) || 0.001

  const coords = []
  const segs = 72
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    coords.push(lon + (radius * Math.cos(a)) / (111_320 * cosLat))
    coords.push(lat + (radius * Math.sin(a)) / 111_320)
  }

  ds.entities.add({
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.35),
      classificationType: Cesium.ClassificationType.TERRAIN,
    },
  })

  // 边界线（TERRAIN polygon 不支持 outline）
  ds.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(coords),
      material: Cesium.Color.fromCssColorString('#00e5ff'),
      width: 2,
      clampToGround: true,
    },
  })

  // 中心点单独加到 viewer 主实体集合
  const ptEntity = v.entities.add(
    cesiumHelpers.createPointEntity(position, '中心点', cesiumHelpers.COLORS.CYAN, { pixelSize: 12 }),
  )
  trackedEntities.push(ptEntity)

  v.zoomTo(ds)
}

/* ---- 线缓冲 ---- */

function startLineBuffer() {
  const v = viewer.value; if (!v) return
  if (bufferType.value === 'line') {
    resetState()
    bufferType.value = null
    setStatus('请选择分析类型', 'info')
    return
  }
  resetState()
  bufferType.value = 'line'
  setStatus('点击地图添加端点，按 Enter 完成绘制', 'info')

  const ds = getDS()
  const pts = []   // Cartesian3[]

  activeHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  activeHandler.setInputAction((e) => {
    const ray = v.camera.getPickRay(e.position)
    const pos = v.scene.globe.pick(ray, v.scene)
    if (!Cesium.defined(pos)) { setStatus('无效位置，请重试', 'error'); return }
    pts.push(pos)
    drawingPts.value = pts.length

    // 更新线实体（替换而非追加）
    if (lineEntity) {
      try { v.entities.remove(lineEntity) } catch (_) { /* ok */ }
    }
    if (pts.length > 1) {
      lineEntity = v.entities.add(
        cesiumHelpers.createLineEntity(pts.slice(), '', cesiumHelpers.COLORS.CYAN, { width: 3, clampToGround: true }),
      )
    }

    setStatus(`已添加 ${pts.length} 个端点（按 Enter 完成）`, 'info')
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // 键盘监听
  lineKeydownHandler = function handler(e) {
    if (e.key === 'Enter' && pts.length >= 2) {
      document.removeEventListener('keydown', handler)
      lineKeydownHandler = null
      finishLineFromPts(pts)
    }
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handler)
      lineKeydownHandler = null
      resetState()
      setStatus('取消绘制', 'info')
    }
  }
  document.addEventListener('keydown', lineKeydownHandler)
}

function finishLineFromPts(pts) {
  const r = bufferRadius.value
  if (isNaN(r) || r <= 0) { setStatus('缓冲距离无效', 'error'); return }

  createLineBuf(pts, r)
  cesiumHelpers.destroyHandler(activeHandler)
  activeHandler = null

  // 清理线实体
  if (lineEntity) {
    try { viewer.value?.entities.remove(lineEntity) } catch (_) { /* ok */ }
    lineEntity = null
  }

  setStatus(`线缓冲区 · ${pts.length} 顶点 · 半径 ${r} 米`, 'success')
  ElMessage.success('线缓冲区已创建')
  drawingPts.value = 0
}

function createLineBuf(positions, radius) {
  const v = viewer.value; if (!v) return

  const ds = getDS()
  ds.entities.removeAll()

  // 顶点 → GeoJSON 坐标
  const coords = positions.map(p => {
    const c = Cesium.Cartographic.fromCartesian(p)
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]
  })
  if (coords.length < 2) return

  // Turf.js 标准 GIS 缓冲（round join + round cap，单位米）
  const line = lineString(coords)
  const buffered = turfBuffer(line, radius, { units: 'meters' })

  // GeoJSON 多边形坐标 → Cesium Cartesian3 数组
  const ring = buffered.geometry.coordinates[0]
  const positions3D = Cesium.Cartesian3.fromDegreesArray(ring.flat())

  // 缓冲面
  ds.entities.add({
    polygon: {
      hierarchy: positions3D,
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.30),
      classificationType: Cesium.ClassificationType.TERRAIN,
    },
  })

  // 边界线
  const outline3D = Cesium.Cartesian3.fromDegreesArray([...ring.flat(), ring[0][0], ring[0][1]])
  ds.entities.add({
    polyline: {
      positions: outline3D,
      material: Cesium.Color.fromCssColorString('#00e5ff'),
      width: 2,
      clampToGround: true,
    },
  })

  // 原始线段
  const srcLine = v.entities.add(
    cesiumHelpers.createLineEntity(positions, '原始线段', cesiumHelpers.COLORS.AMBER, { width: 3, clampToGround: true }),
  )
  trackedEntities.push(srcLine)

  v.zoomTo(ds)
}

onUnmounted(() => { resetState() })
</script>

<style scoped>
.analysis-view { position: relative; width: 100%; height: 100%; }
.analysis-panel { position: absolute; top: 14px; left: 0; width: 290px; max-height: calc(100vh - 28px); overflow-y: auto; animation: fade-in-up 0.4s ease; }
.field-group { display: flex; flex-direction: column; }

.hint-text {
  font-size: 11px;
  color: #00e5ff;
  margin-top: 6px;
  text-align: center;
}

.hint-text kbd {
  background: rgba(0, 229, 255, 0.12);
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 3px;
  padding: 0 4px;
  font-family: monospace;
  font-size: 10px;
}
</style>
