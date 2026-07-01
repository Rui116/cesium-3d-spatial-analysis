<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">◉</span><span>视线分析</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">
        <div class="field-group">
          <label class="hud-label">采样密度<span class="label-value">{{ sampleCount }} 点</span></label>
          <el-slider v-model="sampleCount" :min="50" :max="500" size="small" />
        </div>

        <div class="field-group" style="margin-top:8px">
          <label class="hud-label">观察点离地高度<span class="label-value">{{ observerAGL }} m</span></label>
          <el-slider v-model="observerAGL" :min="0" :max="500" :step="1" size="small" />
        </div>

        <div class="field-group">
          <label class="hud-label">目标点离地高度<span class="label-value">{{ targetAGL }} m</span></label>
          <el-slider v-model="targetAGL" :min="0" :max="500" :step="1" size="small" />
        </div>

        <el-button size="small" :type="isAnalyzing?'warning':'primary'" @click="toggleAnalysis">
          {{ isAnalyzing ? (state === 'analyzing' ? '取消分析' : '取消选点') : '开始分析' }}
        </el-button>
        <el-button v-if="state === 'selectingTarget'" size="small" type="info" @click="resetObserver" style="margin-top:4px">
          ↺ 重新选择观察点
        </el-button>
        <el-button type="danger" size="small" @click="resetAll" style="margin-top:4px">清除</el-button>
        <el-progress v-if="progress>0" :percentage="progress" :show-text="false" :stroke-width="4" style="margin-top:6px" />
        <el-alert v-if="statusText" :type="statusType" :title="statusText" :closable="false" show-icon />
        <el-alert v-if="obsCoord" type="info" :closable="false" show-icon style="font-family:var(--font-mono);font-size:10px">
          <template #title>
            <div style="color:#00e5ff">观察点：{{ obsCoord }}</div>
            <div v-if="tgtCoord" style="color:#ffab00">目标点：{{ tgtCoord }}</div>
            <div v-if="resultText" style="color:#00e676;margin-top:2px">结果：{{ resultText }}</div>
          </template>
        </el-alert>
        <div style="border-top:1px solid rgba(0,229,255,0.08);padding-top:8px;display:flex;gap:10px;font-size:10px;font-family:var(--font-mono);color:#62758a;flex-wrap:wrap">
          <span>● 观察点</span><span>◆ 目标点</span><span style="color:#00e676">━ 可见</span><span style="color:#ff5252">┅ 遮挡</span><span style="color:#ff0000">▴ 首遮挡</span>
        </div>
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
const sampleCount = ref(200)
const observerAGL = ref(1.7)
const targetAGL = ref(0)
const isAnalyzing = ref(false)
const progress = ref(0)
const statusText = ref('设置离地高度后，点击「开始分析」选择观察点和目标点')
const statusType = ref('info')
const obsCoord = ref('')
const tgtCoord = ref('')
const resultText = ref('')

const state = ref('idle') // idle | selectingObserver | selectingTarget | analyzing

let obsTerrainPt = null   // 观察点贴地位置
let obsHeight = 0         // 观察点绝对高度 = 地形高 + AGL
let tgtTerrainPt = null   // 目标点贴地位置
let tgtHeight = 0         // 目标点绝对高度 = 地形高 + AGL
let entities = []
let cancelFlag = false
let computeId = 0
let pickHandler = null

/* ================================================================
   工具函数
   ================================================================ */

function setStatus(m, t = 'info') { statusText.value = m; statusType.value = t }

function destroyPickHandler() {
  if (pickHandler && !pickHandler.isDestroyed()) pickHandler.destroy()
  pickHandler = null
}

function pointToCoordString(cartesian, agl) {
  const c = Cesium.Cartographic.fromCartesian(cartesian)
  const lon = Cesium.Math.toDegrees(c.longitude).toFixed(6)
  const lat = Cesium.Math.toDegrees(c.latitude).toFixed(6)
  const th = c.height.toFixed(2)
  return `经 ${lon}° 纬 ${lat}°  地表 ${th}m  +离地 ${agl}m  =${(c.height + agl).toFixed(2)}m`
}

/** 地面两点间的大圆距离（米），忽略高度 */
function groundDistance(cartoA, cartoB) {
  return Cesium.Cartesian3.distance(
    Cesium.Cartesian3.fromRadians(cartoA.longitude, cartoA.latitude, 0),
    Cesium.Cartesian3.fromRadians(cartoB.longitude, cartoB.latitude, 0),
  )
}

/* ================================================================
   选择流程
   ================================================================ */

function toggleAnalysis() {
  isAnalyzing.value ? cancel() : start()
}

function start() {
  const v = viewer.value
  if (!v) return

  resetAll()
  state.value = 'selectingObserver'
  isAnalyzing.value = true
  setStatus('🖱 在地图上点击选择观察点', 'info')

  pickHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  pickHandler.setInputAction((click) => {
    const ray = v.camera.getPickRay(click.position)
    const p = v.scene.globe.pick(ray, v.scene)
    if (!Cesium.defined(p)) return

    if (state.value === 'selectingObserver') {
      obsTerrainPt = p
      const carto = Cesium.Cartographic.fromCartesian(p)
      obsHeight = carto.height + observerAGL.value
      entities.push(v.entities.add(
        cesiumHelpers.createPointEntity(p, '观察点', cesiumHelpers.COLORS.CYAN, { pixelSize: 13 }),
      ))
      state.value = 'selectingTarget'
      obsCoord.value = pointToCoordString(p, observerAGL.value)
      setStatus('🖱 在地图上点击选择目标点', 'info')
    } else if (state.value === 'selectingTarget') {
      tgtTerrainPt = p
      const carto = Cesium.Cartographic.fromCartesian(p)
      tgtHeight = carto.height + targetAGL.value
      entities.push(v.entities.add(
        cesiumHelpers.createPointEntity(p, '目标点', cesiumHelpers.COLORS.AMBER, { pixelSize: 13 }),
      ))
      tgtCoord.value = pointToCoordString(p, targetAGL.value)
      destroyPickHandler()
      runAnalysis().catch(err => {
        console.error('[视线分析] runAnalysis 异常:', err)
        setStatus(`分析出错：${err.message || '未知错误'}`, 'error')
        state.value = 'idle'
        isAnalyzing.value = false
      })
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function resetObserver() {
  const v = viewer.value
  if (!v || state.value !== 'selectingTarget') return
  tgtTerrainPt = null
  tgtHeight = 0
  tgtCoord.value = ''
  cesiumHelpers.removeEntities(viewer.value, entities)
  entities = []
  if (obsTerrainPt) {
    entities.push(v.entities.add(
      cesiumHelpers.createPointEntity(obsTerrainPt, '观察点', cesiumHelpers.COLORS.CYAN, { pixelSize: 13 }),
    ))
  }
  state.value = 'selectingObserver'
  setStatus('🖱 在地图上重新选择观察点', 'info')
}

/* ================================================================
   视线计算 — 标准 GIS 最大斜率算法 (Max-Slope LOS)

   原理（与 ArcGIS / QGIS / GRASS 一致）：
     从观察者出发，沿路径逐点计算"该点到观察者的斜率"。
     维护当前最大斜率 maxSlope。若某点的斜率 > maxSlope，
     则该点可见（它高于之前所有遮挡物），并更新 maxSlope。
     否则该点被之前的地形遮挡。

   斜率定义：slope = (terrainH - observerH) / groundDistance
   ================================================================ */

async function runAnalysis() {
  const v = viewer.value
  if (!v || !obsTerrainPt || !tgtTerrainPt) return

  state.value = 'analyzing'
  cancelFlag = false
  const id = ++computeId
  setStatus('正在计算视线…', 'warning')
  progress.value = 10

  const N = sampleCount.value

  // ---- 1. 沿地表路径插值（贴地，非抬高） ----
  const path3D = []
  for (let i = 0; i <= N; i++) {
    path3D.push(Cesium.Cartesian3.lerp(obsTerrainPt, tgtTerrainPt, i / N, new Cesium.Cartesian3()))
  }

  if (id !== computeId) return
  progress.value = 25

  try {
    // ---- 2. 转 Cartographic，批量地形采样 ----
    const cartos = path3D.map(p => Cesium.Cartographic.fromCartesian(p))
    let sampledCartos
    const hasTerrain = !(v.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)
    if (hasTerrain) {
      try {
        sampledCartos = await Cesium.sampleTerrainMostDetailed(v.terrainProvider, cartos)
      } catch (terrainErr) {
        console.warn('[视线分析] 地形采样失败，降级为椭球面:', terrainErr.message)
        sampledCartos = null
      }
    }
    if (!sampledCartos) {
      sampledCartos = cartos.map(c => new Cesium.Cartographic(c.longitude, c.latitude, 0))
    }
    if (id !== computeId) return
    progress.value = 50

    // ---- 3. 计算累计地表距离 ----
    const distances = new Array(sampledCartos.length)
    distances[0] = 0
    for (let i = 1; i < sampledCartos.length; i++) {
      distances[i] = distances[i - 1] + groundDistance(sampledCartos[i - 1], sampledCartos[i])
    }

    // ---- 4. 最大斜率 LOS 分析 ----
    if (cancelFlag || id !== computeId) return
    const result = analyzeMaxSlope(sampledCartos, distances, obsHeight, id)
    if (cancelFlag || id !== computeId) return
    progress.value = 85

    // ---- 5. 可视化 ----
    const toCartesian3 = (c) => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height)
    const sampled3D = sampledCartos.map(toCartesian3)
    visualizeResults(sampled3D, result.visibilityMask)
    progress.value = 100

    resultText.value = `可见度 ${result.vp}%`
    setStatus(`分析完成：可见度 ${result.vp}%`, 'success')
    ElMessage.success(`视线分析完成：可见度 ${result.vp}%`)
    flyTo(sampled3D)
  } catch (err) {
    console.error('[视线分析]', err)
    if (id === computeId) setStatus(`分析失败：${err.message || '未知错误'}`, 'error')
  }

  if (id === computeId) {
    state.value = 'idle'
    isAnalyzing.value = false
  }
}

/**
 * GIS 标准最大斜率 LOS 算法。
 *
 *   slope_j = (terrainH[j] - observerH) / distance[j]
 *   若 slope_j > maxSlope_sofar → 可见，更新 maxSlope
 *   否则 → 被前方地形遮挡
 *
 * @param {Cartographic[]} sampledCartos — 地形高度（height=地形椭球高）
 * @param {number[]} distances          — 累计地表距离（米），[0] = 0
 * @param {number} observerH            — 观察者绝对高度（椭球高，=地形高+AGL）
 * @param {number} runId                — 分析 ID
 */
function analyzeMaxSlope(sampledCartos, distances, observerH, runId) {
  const N = sampledCartos.length
  const visibilityMask = new Array(N).fill(false)
  let visibleCount = 0

  // 观察者自身总是可见
  visibilityMask[0] = true
  visibleCount++

  let maxSlope = -Infinity

  // 从观察者出发，逐点判定
  for (let j = 1; j < N; j++) {
    if (cancelFlag || runId !== computeId) break

    const terrainH = sampledCartos[j].height
    const dist = distances[j]
    if (dist <= 0) {
      visibilityMask[j] = true
      visibleCount++
      continue
    }

    // 斜率 = (该点地形高 - 观察者眼高) / 到观察者的地表距离
    const slope = (terrainH - observerH) / dist

    if (slope > maxSlope) {
      visibilityMask[j] = true
      visibleCount++
      maxSlope = slope
    }
    // else: 被之前更高的地形遮挡 → visibilityMask[j] 保持 false
  }

  // 目标点单独判定（用目标实际高度而非地形高）
  if (visibilityMask[N - 1] === false && N > 1) {
    // 如果地形判定目标被遮挡，但目标有离地高度，重新检查
    const tgtTerrainH = sampledCartos[N - 1].height
    const tgtDist = distances[N - 1]
    const tgtSlope = (tgtHeight - observerH) / tgtDist  // tgtHeight 已含 AGL
    if (tgtSlope > maxSlope) {
      visibilityMask[N - 1] = true
      visibleCount++
    }
  }

  const vp = N > 0 ? ((visibleCount / N) * 100).toFixed(1) : '0.0'
  return { visibilityMask, vp }
}

/* ================================================================
   可视化
   ================================================================ */

function visualizeResults(sampledPositions, visibilityMask) {
  const v = viewer.value
  if (!v) return

  // 底层参考线
  entities.push(v.entities.add({
    polyline: {
      positions: sampledPositions,
      width: 1,
      material: new Cesium.PolylineOutlineMaterialProperty({
        color: Cesium.Color.WHITE.withAlpha(0.15),
        outlineWidth: 1,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.2),
      }),
      clampToGround: true,
    },
  }))

  // 分段渲染
  let segStart = 0
  while (segStart < sampledPositions.length) {
    const segVisible = visibilityMask[segStart]
    let segEnd = segStart + 1
    while (segEnd < sampledPositions.length && visibilityMask[segEnd] === segVisible) {
      segEnd++
    }
    const segment = sampledPositions.slice(segStart, segEnd)

    if (segVisible && segment.length > 1) {
      entities.push(v.entities.add(
        cesiumHelpers.createLineEntity(segment, '', cesiumHelpers.COLORS.GREEN, { width: 4, glow: true }),
      ))
    } else if (!segVisible && segment.length > 0) {
      entities.push(v.entities.add(
        cesiumHelpers.createLineEntity(segment, '', cesiumHelpers.COLORS.RED, { width: 2, dash: true }),
      ))
    }
    segStart = segEnd
  }

  // 首个遮挡点标记
  const firstBlockedIdx = visibilityMask.indexOf(false)
  if (firstBlockedIdx > 0 && firstBlockedIdx < sampledPositions.length - 1) {
    entities.push(v.entities.add({
      position: sampledPositions[firstBlockedIdx],
      point: { pixelSize: 13, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: {
        text: '▴ 首遮挡',
        font: '11px "Noto Sans SC", sans-serif',
        fillColor: Cesium.Color.RED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
      },
    }))
  }

  // 遮挡点稀疏标记
  const blockedIndices = []
  for (let i = 0; i < visibilityMask.length; i++) {
    if (!visibilityMask[i]) blockedIndices.push(i)
  }
  const STRIDE = Math.max(1, Math.ceil(blockedIndices.length / 15))
  for (let k = 0; k < blockedIndices.length; k += STRIDE) {
    const idx = blockedIndices[k]
    if (idx === firstBlockedIdx) continue
    entities.push(v.entities.add({
      position: sampledPositions[idx],
      point: { pixelSize: 4, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
    }))
  }
}

/* ================================================================
   相机 & 清理
   ================================================================ */

function flyTo(positions) {
  const v = viewer.value
  if (!v || !positions.length) return
  const bs = Cesium.BoundingSphere.fromPoints(positions)
  v.camera.flyToBoundingSphere(bs, {
    offset: new Cesium.HeadingPitchRange(0, -0.5, bs.radius * 2),
    duration: 1.5,
  })
}

function cancel() {
  cancelFlag = true
  computeId++
  state.value = 'idle'
  isAnalyzing.value = false
  setStatus('设置离地高度后，点击「开始分析」选择观察点和目标点', 'info')
  destroyPickHandler()
}

function resetAll() {
  computeId++
  cancelFlag = true
  destroyPickHandler()
  cesiumHelpers.removeEntities(viewer.value, entities)
  entities = []
  obsTerrainPt = null
  obsHeight = 0
  tgtTerrainPt = null
  tgtHeight = 0
  obsCoord.value = ''
  tgtCoord.value = ''
  resultText.value = ''
  progress.value = 0
  state.value = 'idle'
  isAnalyzing.value = false
  setStatus('设置离地高度后，点击「开始分析」选择观察点和目标点', 'info')
}

onUnmounted(() => {
  computeId = -1
  cancelFlag = true
  destroyPickHandler()
  cesiumHelpers.removeEntities(viewer.value, entities)
})
</script>

<style scoped>
.analysis-view { position: relative; width: 100%; height: 100%; }
.analysis-panel { position: absolute; top: 14px; left: 0; width: 290px; max-height: calc(100vh - 28px); overflow-y: auto; animation: fade-in-up 0.4s ease; }
.field-group { display: flex; flex-direction: column; }
</style>
