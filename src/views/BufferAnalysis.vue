<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">⊡</span><span>缓冲区分析</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">
        <div class="field-group">
          <label class="hud-label">缓冲类型</label>
          <el-button-group style="width:100%">
            <el-button size="small" :type="bufferType==='point'?'primary':'default'" @click="startPointBuffer" style="flex:1">点缓冲</el-button>
            <el-button size="small" :type="bufferType==='line'?'primary':'default'" @click="startLineBuffer" style="flex:1">线缓冲</el-button>
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

const { viewer } = useViewer()

const panelCollapsed = ref(false)
const bufferType = ref('point')
const bufferRadius = ref(1000)
const statusText = ref('请选择分析类型')
const statusType = ref('info')
const drawingPts = ref(0)

let activeHandler = null
let lineEntity = null             // 单一线实体，每次更新而非新建
let bDS = null
let trackedEntities = []          // viewer 上的实体引用，精确清理
let keydownBound = false

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
  lineEntity = null

  // 清理键盘监听
  if (keydownBound) {
    document.removeEventListener('keydown', finishLine)
    keydownBound = false
  }

  drawingPts.value = 0
}

function resetAll() {
  resetState()
  setStatus('请选择分析类型', 'info')
}

/* ---- 点缓冲 ---- */

function startPointBuffer() {
  const v = viewer.value; if (!v) return
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
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.45),
      classificationType: Cesium.ClassificationType.TERRAIN,
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
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Enter' && pts.length >= 2) {
      document.removeEventListener('keydown', handler)
      keydownBound = false
      finishLineFromPts(pts)
    }
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', handler)
      keydownBound = false
      resetState()
      setStatus('取消绘制', 'info')
    }
  })
  keydownBound = true
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

  // 将所有顶点转为经纬度
  const pts = positions.map(p => {
    const c = Cesium.Cartographic.fromCartesian(p)
    return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) }
  })

  // 标准 GIS 线缓冲算法：线段平移 + 拐角斜接 + 端头圆帽
  const left = []   // 左侧偏移线（沿行进方向左转 90°）
  const right = []  // 右侧偏移线

  for (let i = 0; i < pts.length; i++) {
    const { lon, lat } = pts[i]
    const cosLat = Math.cos(Cesium.Math.toRadians(lat)) || 0.001
    const dxM = 1 / (111_320 * cosLat)  // 1m 对应多少经度
    const dyM = 1 / 111_320              // 1m 对应多少纬度

    // 该顶点处的方向角（取前一段或后一段的方向）
    let angle
    if (i === 0 && pts.length > 1) {
      // 起点：使用第一段的方向
      angle = Math.atan2(pts[1].lat - lat, (pts[1].lon - lon) * cosLat)
    } else if (i === pts.length - 1 && i > 0) {
      // 终点：使用最后一段的方向
      angle = Math.atan2(lat - pts[i - 1].lat, (lon - pts[i - 1].lon) * cosLat)
    } else {
      // 中间点：使用前后段方向的平均值
      const a1 = Math.atan2(lat - pts[i - 1].lat, (lon - pts[i - 1].lon) * cosLat)
      const a2 = Math.atan2(pts[i + 1].lat - lat, (pts[i + 1].lon - lon) * cosLat)
      let da = a2 - a1
      if (da > Math.PI) da -= 2 * Math.PI
      if (da < -Math.PI) da += 2 * Math.PI
      angle = a1 + da / 2
    }

    // 左/右垂直方向
    const la = angle + Math.PI / 2  // 左侧
    const ra = angle - Math.PI / 2  // 右侧

    left.push({
      lon: lon + (radius * Math.cos(la)) * dxM,
      lat: lat + (radius * Math.sin(la)) * dyM,
    })
    right.push({
      lon: lon + (radius * Math.cos(ra)) * dxM,
      lat: lat + (radius * Math.sin(ra)) * dyM,
    })
  }

  // 起点圆帽（半圆，连接 left[0] 和 right[0]）
  const capStart = []
  if (pts.length > 1) {
    const a0 = Math.atan2(pts[1].lat - pts[0].lat, (pts[1].lon - pts[0].lon) * Math.cos(Cesium.Math.toRadians(pts[0].lat)))
    const cosLat0 = Math.cos(Cesium.Math.toRadians(pts[0].lat)) || 0.001
    const dxM0 = 1 / (111_320 * cosLat0)
    const dyM0 = 1 / 111_320
    const capSegs = 16
    for (let j = 0; j <= capSegs; j++) {
      const a = a0 + Math.PI / 2 + (j / capSegs) * Math.PI
      capStart.push({
        lon: pts[0].lon + (radius * Math.cos(a)) * dxM0,
        lat: pts[0].lat + (radius * Math.sin(a)) * dyM0,
      })
    }
  }

  // 终点圆帽（半圆，连接 right 末 → left 末）
  const capEnd = []
  if (pts.length > 1) {
    const n = pts.length - 1
    const aN = Math.atan2(pts[n].lat - pts[n - 1].lat, (pts[n].lon - pts[n - 1].lon) * Math.cos(Cesium.Math.toRadians(pts[n].lat)))
    const cosLatN = Math.cos(Cesium.Math.toRadians(pts[n].lat)) || 0.001
    const dxMN = 1 / (111_320 * cosLatN)
    const dyMN = 1 / 111_320
    const capSegs = 16
    for (let j = 0; j <= capSegs; j++) {
      const a = aN - Math.PI / 2 + (j / capSegs) * Math.PI
      capEnd.push({
        lon: pts[n].lon + (radius * Math.cos(a)) * dxMN,
        lat: pts[n].lat + (radius * Math.sin(a)) * dyMN,
      })
    }
  }

  // 组装多边形：起点帽 → 左侧 → 终点帽 → 右侧（逆序）
  const polyPts = [...capStart, ...left, ...capEnd, ...right.reverse()]
  const coords = polyPts.flatMap(p => [p.lon, p.lat])

  ds.entities.add({
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.35),
      classificationType: Cesium.ClassificationType.TERRAIN,
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
