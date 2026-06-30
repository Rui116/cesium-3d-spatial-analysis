<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">◎</span><span>可视域分析</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">

        <!-- 地形检查 -->
        <el-alert v-if="!hasTerrain" type="warning" :closable="false" show-icon
          title="当前未启用地形数据，可视域分析仅基于椭球面计算。请在基础场景中切换为 Cesium 或 ArcGIS 地形。" style="margin-bottom:8px" />

        <div class="field-group">
          <label class="hud-label">分析半径<span class="label-value">{{ radius }} 米</span></label>
          <el-slider v-model="radius" :min="100" :max="5000" :step="50" @input="onRadiusInput" size="small" show-input :show-input-controls="false" />
        </div>

        <el-button type="primary" size="small" :loading="pickMode" @click="togglePickMode">
          {{ pickMode ? '点选模式已激活（点击地图选择观察点）' : '在地图上选择观察点' }}
        </el-button>
        <el-button v-if="pickMode" type="warning" size="small" @click="togglePickMode" style="margin-top:4px">
          取消点选
        </el-button>

        <div class="field-group">
          <label class="hud-label">手动输入坐标</label>
          <div style="display:flex;gap:6px">
            <el-input v-model="inputLon" placeholder="经度" size="small" type="number" />
            <el-input v-model="inputLat" placeholder="纬度" size="small" type="number" />
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
            <span style="font-size:11px;color:#889;white-space:nowrap">离地</span>
            <el-input v-model="inputHeight" placeholder="离地高度" size="small" type="number" style="flex:1" />
            <span style="font-size:11px;color:#889;white-space:nowrap">米</span>
          </div>
          <el-button size="small" :loading="settingPoint" @click="setFromInput" style="margin-top:4px">设置观察点</el-button>
        </div>

        <div v-if="computing" style="text-align:center;padding:8px;color:var(--hud-cyan)">
          <span>⌛ 正在计算可视域…</span>
        </div>

        <el-alert v-if="currentPos" type="info" :closable="false" show-icon style="font-family:var(--font-mono);font-size:11px">
          <template #title>
            <div>经度 {{ currentPos.lon.toFixed(6) }}°</div>
            <div>纬度 {{ currentPos.lat.toFixed(6) }}°</div>
            <div>海拔高度 {{ currentPos.height.toFixed(2) }} 米</div>
            <div>离地高度 {{ (currentPos.agl ?? currentPos.height).toFixed(1) }} 米{{ currentPos.agl === 0 ? '（点选模式，贴在地表）' : '' }}</div>
          </template>
        </el-alert>

        <div v-if="analysisResult" class="field-group">
          <label class="hud-label">分析结果</label>
          <div style="display:flex;gap:8px">
            <div class="stat-card-custom" style="flex:1"><div class="stat-value">{{ analysisResult.visibleArea }}</div><div class="stat-label">可见面积</div></div>
            <div class="stat-card-custom" style="flex:1"><div class="stat-value">{{ analysisResult.visiblePercent }}</div><div class="stat-label">可见比例</div></div>
          </div>
          <div class="btn-row-equal" style="margin-top:4px">
            <el-button size="small" @click="exportJSON">导出 JSON</el-button>
            <el-button size="small" @click="exportGeoJSON">导出 GeoJSON</el-button>
          </div>
          <div class="btn-row-equal" style="margin-top:4px">
            <el-button size="small" @click="importData">加载 JSON</el-button>
            <el-button size="small" @click="captureScene">保存截图</el-button>
          </div>
          <input ref="fileInput" type="file" accept=".json" style="display:none" @change="onFileSelected" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import * as Cesium from 'cesium'
import { useViewer } from '@composables/useCesium'
import { cesiumHelpers } from '@utils/cesiumHelpers'

const { viewer } = useViewer()

const panelCollapsed = ref(false)
const radius = ref(1000)
const inputLon = ref('')
const inputLat = ref('')
const inputHeight = ref(100)
const currentPos = ref(null)
const analysisResult = ref(null)
const computing = ref(false)
const pickMode = ref(false)
const settingPoint = ref(false)
const fileInput = ref(null)

let entities = []
let currentPosition = null
let lastGrid = null           // 缓存最近一次计算结果（供导出）
let pickHandler = null
let radiusTimer = null
let cancelled = false

// 地形是否启用
const hasTerrain = computed(() => {
  const v = viewer.value
  if (!v) return true
  return !(v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)
})

/* ---- 观察点选择 ---- */

function togglePickMode() {
  const v = viewer.value
  if (!v) return

  if (pickMode.value) {
    // 取消点选模式
    destroyPickHandler()
    pickMode.value = false
    return
  }

  pickMode.value = true
  ElMessage.info('请在地图上点击选择观察点（再次点击按钮取消）')
  pickHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  pickHandler.setInputAction((click) => {
    const ray = v.camera.getPickRay(click.position)
    const globePos = v.scene.globe.pick(ray, v.scene)
    if (!Cesium.defined(globePos)) return

    const c = Cesium.Cartographic.fromCartesian(globePos)
    // 点选模式：观察点紧贴地表，离地高度 = 0
    setObservationPoint(
      Cesium.Math.toDegrees(c.longitude),
      Cesium.Math.toDegrees(c.latitude),
      c.height,
      0,
    )
    destroyPickHandler()
    pickMode.value = false
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function destroyPickHandler() {
  if (pickHandler && !pickHandler.isDestroyed()) {
    pickHandler.destroy()
  }
  pickHandler = null
}

async function setFromInput() {
  const v = viewer.value
  if (!v || settingPoint.value) return
  const lon = parseFloat(inputLon.value)
  const lat = parseFloat(inputLat.value)
  const agl = parseFloat(inputHeight.value) || 0
  if (isNaN(lon) || isNaN(lat)) { ElMessage.warning('请输入有效的经纬度'); return }

  settingPoint.value = true
  // 采样该坐标的地形高度，离地高度 = 地形高 + 用户输入
  let terrainH = 0
  if (!(v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(v.terrainProvider, [
        new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 0),
      ])
      terrainH = sampled[0]?.height || 0
    } catch { /* 降级 */ }
  }
  settingPoint.value = false
  const absoluteHeight = terrainH + agl
  setObservationPoint(lon, lat, absoluteHeight, agl)
}

function setObservationPoint(lon, lat, height, aglOverride) {
  const v = viewer.value
  if (!v) return
  currentPosition = Cesium.Cartesian3.fromDegrees(lon, lat, height)
  currentPos.value = { lon, lat, height, agl: aglOverride ?? height }
  v.camera.flyTo({
    destination: currentPosition,
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
  })
  scheduleAnalysis()
  ElMessage.success('观察点已设置')
}

/* ---- 可视域计算 ---- */

const SAMPLES = 360           // 方向采样数
const STEPS_PER_RAY = 10      // 每条射线上的插值步数

function onRadiusInput() {
  clearTimeout(radiusTimer)
  radiusTimer = setTimeout(() => {
    if (currentPosition) updateAnalysis()
  }, 300)
}

function scheduleAnalysis() {
  clearTimeout(radiusTimer)
  radiusTimer = setTimeout(() => updateAnalysis(), 100)
}

async function updateAnalysis() {
  const v = viewer.value
  if (!v || !currentPosition) return

  clearResults()
  computing.value = true
  cancelled = false

  await new Promise(r => requestAnimationFrame(r))

  const grid = await calculateVisibility(currentPosition, radius.value)
  if (cancelled) { computing.value = false; return }

  lastGrid = grid  // 缓存供导出
  visualizeResults(currentPosition, grid)
  updateStatistics(grid, radius.value)
  computing.value = false
}

/**
 * 批量地形采样视图域计算。
 * 核心优化：用一次 sampleTerrainMostDetailed 替代 SAMPLES 次同步 globe.pick。
 */
async function calculateVisibility(position, r) {
  const v = viewer.value
  if (!v) return []

  const ellipsoid = v.scene.globe.ellipsoid
  const tp = v.terrainProvider
  const obsCarto = ellipsoid.cartesianToCartographic(position)
  const obsHeight = obsCarto.height

  // ---- 1. 生成所有采样点（每条射线 STEPS_PER_RAY 个插值点） ----
  const allPositions = []   // Cartographic[]
  const rayMeta = []        // { startIdx, count } 每条射线在 allPositions 中的区间

  for (let i = 0; i < SAMPLES; i++) {
    if (cancelled) break
    const angle = (i / SAMPLES) * Math.PI * 2
    rayMeta.push({ startIdx: allPositions.length, count: STEPS_PER_RAY, angle })

    for (let s = 1; s <= STEPS_PER_RAY; s++) {
      const dist = (s / STEPS_PER_RAY) * r
      const target = geodesicTargetFast(ellipsoid, obsCarto, angle, dist)
      if (target) {
        allPositions.push(new Cesium.Cartographic(target.lon, target.lat, 0))
      } else {
        allPositions.push(new Cesium.Cartographic(obsCarto.longitude, obsCarto.latitude, 0))
      }
    }
  }

  if (cancelled) return []

  // ---- 2. 批量采样地形高度（一次异步调用替代 SAMPLES × STEPS_PER_RAY 次 globe.pick） ----
  let sampled = allPositions
  if (allPositions.length > 0 && !(tp instanceof Cesium.EllipsoidTerrainProvider)) {
    try {
      sampled = await Cesium.sampleTerrainMostDetailed(tp, allPositions)
    } catch {
      // 降级：地形采样失败则使用原始位置
    }
  }

  if (cancelled) return []

  // ---- 3. 逐射线判断可见性 ----
  const results = []
  for (const meta of rayMeta) {
    if (cancelled) break
    const { angle, startIdx, count } = meta

    // 目标点地形高度（射线终点 = 最外层采样点）
    const targetH = sampled[startIdx + count - 1]?.height || 0

    let blocked = false
    let blockDist = r

    for (let s = 0; s < count; s++) {
      const sp = sampled[startIdx + s]
      if (!sp) continue
      const frac = (s + 1) / count
      const dist = frac * r
      const terrainH = sp.height || 0
      // LOS 从观察点高度线性渐变到目标点地形高度
      const losH = obsHeight + frac * (targetH - obsHeight)

      if (terrainH > losH + 0.5) {
        blocked = true
        blockDist = dist
        break
      }
    }

    results.push({ angle, distance: blocked ? blockDist : r, visible: !blocked })
  }

  results._vc = results.filter(p => p.visible).length
  return results
}

/** 球面目标点快速计算（轻量版，仅输出经纬度） */
function geodesicTargetFast(ellipsoid, obsCarto, angle, distance) {
  try {
    const R = ellipsoid.maximumRadius
    const cosLat = Math.cos(obsCarto.latitude) || 0.001
    const lon = obsCarto.longitude + (distance * Math.cos(angle)) / (R * cosLat)
    const lat = obsCarto.latitude + (distance * Math.sin(angle)) / R
    return {
      lon: Cesium.Math.negativePiToPi(lon),
      lat: Cesium.Math.clamp(lat, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001),
    }
  } catch {
    return null
  }
}

/* ---- 可视化 ---- */

function visualizeResults(position, grid) {
  const v = viewer.value
  if (!v) return

  const ellipsoid = v.scene.globe.ellipsoid
  const obsCarto = ellipsoid.cartesianToCartographic(position)
  const positions = grid
    .map(p => {
      const t = geodesicTargetFast(ellipsoid, obsCarto, p.angle, p.distance)
      if (!t) return null
      return Cesium.Cartesian3.fromRadians(t.lon, t.lat, 0)
    })
    .filter(Boolean)

  if (!positions.length) return

  entities.push(v.entities.add({
    polygon: {
      hierarchy: positions,
      material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.45),
      perPositionHeight: false,
    },
  }))

  entities.push(v.entities.add(
    cesiumHelpers.createPointEntity(position, '观察点', cesiumHelpers.COLORS.CYAN, { pixelSize: 18 }),
  ))
}

function updateStatistics(grid, r) {
  if (!grid.length) {
    analysisResult.value = { visibleArea: '0 km²', visiblePercent: '0%' }
    return
  }
  const totalArea = Math.PI * r * r
  const visibleCount = grid._vc || 0
  analysisResult.value = {
    visibleArea: `${((visibleCount / grid.length) * totalArea / 1e6).toFixed(3)} km²`,
    visiblePercent: `${((visibleCount / grid.length) * 100).toFixed(1)}%`,
  }
}

/* ---- 清理 ---- */

function clearResults() {
  cesiumHelpers.removeEntities(viewer.value, entities)
  entities = []
}

function clearAll() {
  cancelled = true
  clearTimeout(radiusTimer)
  destroyPickHandler()
  pickMode.value = false
  clearResults()
  computing.value = false
}

/* ---- 导出 / 导入 ---- */

/** 导出完整 JSON：汇总统计 + 360 射线网格 + 观察点参数 */
function exportJSON() {
  if (!currentPos.value || !analysisResult.value) return
  const data = {
    type: 'viewshed',
    version: '1.0',
    position: currentPos.value,
    radius: radius.value,
    summary: analysisResult.value,
    grid: lastGrid?.map(p => ({
      angle: Cesium.Math.toDegrees(p.angle).toFixed(2),
      distance: p.distance.toFixed(1),
      visible: p.visible,
    })) || [],
    timestamp: new Date().toISOString(),
  }
  downloadFile(JSON.stringify(data, null, 2), `可视域分析_${Date.now()}.json`, 'application/json')
  ElMessage.success('JSON 已导出（含射线网格数据）')
}

/** 导出 GeoJSON：可视域多边形，可在 QGIS / Leaflet 等工具中加载 */
function exportGeoJSON() {
  if (!currentPos.value || !lastGrid?.length) return

  const v = viewer.value
  if (!v) return
  const ellipsoid = v.scene.globe.ellipsoid
  const obsCarto = ellipsoid.cartesianToCartographic(currentPosition)

  const coords = lastGrid
    .map(p => {
      const t = geodesicTargetFast(ellipsoid, obsCarto, p.angle, p.distance)
      if (!t) return null
      return [Cesium.Math.toDegrees(t.lon), Cesium.Math.toDegrees(t.lat)]
    })
    .filter(Boolean)
  // 闭合环
  if (coords.length) coords.push(coords[0])

  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: '可视域',
        radius: radius.value,
        visiblePercent: analysisResult.value?.visiblePercent,
        observerLon: currentPos.value.lon.toFixed(6),
        observerLat: currentPos.value.lat.toFixed(6),
        observerHeight: currentPos.value.height.toFixed(1),
      },
      geometry: { type: 'Polygon', coordinates: [coords] },
    }],
  }
  downloadFile(JSON.stringify(geojson), `可视域_GeoJSON_${Date.now()}.geojson`, 'application/geo+json')
  ElMessage.success('GeoJSON 已导出（可在 QGIS 中加载）')
}

/** 加载之前导出的 JSON 文件，重新可视化 */
function importData() { fileInput.value?.click() }

function onFileSelected(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result)
      if (data.type !== 'viewshed') { ElMessage.warning('文件格式不正确'); return }
      if (!data.position || !data.grid?.length) { ElMessage.warning('数据不完整'); return }

      // 恢复观察点
      const { lon, lat, height, agl } = data.position
      currentPosition = Cesium.Cartesian3.fromDegrees(lon, lat, height)
      currentPos.value = { lon, lat, height, agl }
      radius.value = data.radius

      // 重建网格
      const grid = data.grid.map(p => ({
        angle: Cesium.Math.toRadians(parseFloat(p.angle)),
        distance: parseFloat(p.distance),
        visible: p.visible,
      }))
      grid._vc = grid.filter(p => p.visible).length
      lastGrid = grid

      // 重新可视化
      clearResults()
      visualizeResults(currentPosition, grid)
      updateStatistics(grid, data.radius)
      ElMessage.success(`已加载分析：${grid._vc} / ${grid.length} 个方向可见`)
    } catch { ElMessage.error('JSON 解析失败') }
  }
  reader.readAsText(file)
  // 重置 input 以便重复选择同一文件
  e.target.value = ''
}

function captureScene() {
  const v = viewer.value
  if (!v) return
  v.scene.requestRender()
  requestAnimationFrame(() => {
    const a = document.createElement('a')
    a.href = v.scene.canvas.toDataURL('image/png')
    a.download = `可视域截图_${Date.now()}.png`
    a.click()
    ElMessage.success('截图已保存')
  })
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}

onUnmounted(() => { clearAll() })
</script>

<style scoped>
.analysis-view { position: relative; width: 100%; height: 100%; }
.analysis-panel { position: absolute; top: 14px; left: 0; width: 290px; max-height: calc(100vh - 28px); overflow-y: auto; animation: fade-in-up 0.4s ease; }
.field-group { display: flex; flex-direction: column; }

.stat-card-custom {
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(0,229,255,0.10);
  border-radius: 6px;
  padding: 10px;
  text-align: center;
}
.stat-card-custom .stat-value {
  font-family: var(--font-mono, monospace);
  font-size: 16px;
  font-weight: 700;
  color: var(--hud-cyan, #00e5ff);
}
.stat-card-custom .stat-label {
  font-size: 10px;
  color: #556878;
  margin-top: 2px;
}
.btn-row-equal {
  display: flex;
  gap: 6px;
}
.btn-row-equal .el-button {
  flex: 1;
}
</style>
