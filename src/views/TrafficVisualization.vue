<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header">
        <span class="panel-icon">⏣</span>
        <span>交通态势可视化</span>
        <span v-if="roads.length" class="badge">{{ roads.length }}</span>
        <button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">
          {{ panelCollapsed ? '+' : '−' }}
        </button>
      </div>

      <div class="panel-body">
        <!-- ====== 查询方式 ====== -->
        <div class="section-label">查询方式</div>
        <div class="mode-tabs">
          <button class="mode-tab" :class="{ active: mode === 'viewport' }" @click="mode = 'viewport'">视野查询</button>
          <button class="mode-tab" :class="{ active: mode === 'draw' }"     @click="mode = 'draw'">绘制矩形</button>
          <button class="mode-tab" :class="{ active: mode === 'road' }"     @click="mode = 'road'">道路名查询</button>
        </div>

        <!-- 视野模式 -->
        <template v-if="mode === 'viewport'">
          <div class="hint-text">缩放到目标区域后点击查询（视野对角线 ≤ 10 km）</div>
          <div v-if="viewportDiagonal" class="diagonal-info" :class="{ over: viewportDiagonal > 10_000 }">
            视野范围：{{ (viewportDiagonal / 1000).toFixed(2) }} km
            <span v-if="viewportDiagonal > 10_000" class="warn">— 将自动拆分查询</span>
          </div>
          <el-button type="primary" size="small" :loading="fetching" :disabled="!viewportBBox" @click="fetchViewport" style="margin-top:6px">
            {{ fetching ? '查询中…' : '查询当前视野' }}
          </el-button>
        </template>

        <!-- 绘制模式 -->
        <template v-else-if="mode === 'draw'">
          <div class="hint-text">在地图上点击两个角点绘制矩形，范围建议 1-5 km</div>
          <div v-if="drawSize" class="diagonal-info" :class="{ over: drawSize > 10_000 }">
            矩形对角线：{{ (drawSize / 1000).toFixed(2) }} km
          </div>
          <div class="btn-row">
            <el-button type="primary" size="small" :loading="isDrawing" :disabled="fetching" @click="startDrawing">
              {{ isDrawing ? '绘制中…' : '绘制查询区域' }}
            </el-button>
            <el-button type="success" size="small" :disabled="!drawBBox || fetching" :loading="fetching" @click="fetchDraw">
              {{ fetching ? '查询中…' : '查询路况' }}
            </el-button>
          </div>
        </template>

        <!-- 道路名模式 -->
        <template v-else>
          <div class="hint-text">输入道路名，从列表中选择对应城市的道路</div>
          <div class="road-input-row suggest-wrapper">
            <input
              v-model="roadName"
              class="road-input"
              placeholder="道路名（如：中关村大街）"
              @input="onRoadNameInput"
              @keydown="onRoadNameKeydown"
              @blur="hideSuggestions"
              autocomplete="off"
            />
            <!-- 无道路联想提示 -->
            <div v-if="roadName.trim() && !showSuggestions" class="no-suggest-hint">
              未找到匹配道路，请尝试输入完整路名（如：中关村大街）
            </div>

            <!-- 联想下拉 — 每条显示道路名 + 所属城市 -->
            <ul v-if="showSuggestions" class="suggest-list">
              <li
                v-for="(s, i) in suggestions"
                :key="s.name"
                class="suggest-item"
                :class="{ active: i === suggestionIdx, 'conf-high': s.confidence === 'high', 'conf-medium': s.confidence === 'medium' }"
                @mousedown.prevent="selectSuggestion(s)"
              >
                <span class="suggest-name">{{ s.name }}</span>
                <span class="suggest-tag">
                  <span v-if="s.confidence === 'high'" class="tag-conf tag-h">● 主干</span>
                  <span v-else-if="s.confidence === 'medium'" class="tag-conf tag-m">● 道路</span>
                  <span v-if="s.city" class="suggest-city">{{ s.city }}</span>
                  <span v-if="s.district && s.district !== s.city" class="suggest-district">{{ s.district }}</span>
                </span>
              </li>
            </ul>
          </div>
          <div class="road-input-row">
            <input
              v-model="roadCity"
              class="road-input"
              placeholder="城市（如：北京）"
              @keyup.enter="fetchRoad"
            />
          </div>
          <el-button type="primary" size="small" :disabled="!roadName.trim() || !roadCity.trim() || fetching" :loading="fetching" @click="fetchRoad" style="margin-top:4px">
            {{ fetching ? '查询中…' : '查询道路' }}
          </el-button>
          <div v-if="roads.length && mode === 'road'" class="hint-text" style="margin-top:6px;color:#52c41a">
            找到 {{ roads.length }} 条匹配道路
          </div>
        </template>

        <!-- ====== 操作 ====== -->
        <div style="margin-top:8px">
          <el-button type="warning" size="small" :disabled="!roads.length && !fetching" @click="clearAll">
            清除路况
          </el-button>
        </div>

        <!-- ====== 状态 ====== -->
        <el-alert
          v-if="statusText"
          :type="statusType"
          :title="statusText"
          :closable="false"
          show-icon
          style="margin-top:8px"
        />

        <!-- ====== 统计 ====== -->
        <div v-if="roads.length" class="section-label" style="margin-top:12px">路况统计</div>
        <div v-if="roads.length" class="stats-row">
          <div class="stat-item">
            <span class="stat-dot" style="background:#52c41a"></span>
            畅通 <strong>{{ stats.smooth }}</strong>
          </div>
          <div class="stat-item">
            <span class="stat-dot" style="background:#faad14"></span>
            缓行 <strong>{{ stats.slow }}</strong>
          </div>
          <div class="stat-item">
            <span class="stat-dot" style="background:#f5222d"></span>
            拥堵 <strong>{{ stats.jam }}</strong>
          </div>
          <div class="stat-item">
            <span class="stat-dot" style="background:#820014"></span>
            严重 <strong>{{ stats.severe }}</strong>
          </div>
        </div>

        <div v-if="lastFetch" class="freshness">更新于 {{ lastFetch }}</div>

        <!-- ====== 图例 ====== -->
        <div class="legend-row">
          <span class="legend-dot" style="background:#52c41a"></span>畅通
          <span class="legend-dot" style="background:#faad14"></span>缓行
          <span class="legend-dot" style="background:#f5222d"></span>拥堵
          <span class="legend-dot" style="background:#820014"></span>严重拥堵
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import * as Cesium from 'cesium'
import { useViewer } from '@composables/useCesium'
import { TrafficService } from '@services/trafficService'
import { cesiumHelpers } from '@utils/cesiumHelpers'

const { viewer } = useViewer()
const trafficService = new TrafficService()

/* ---- 模式 ---- */
const mode = ref('viewport')   // 'viewport' | 'draw' | 'road'

/* ---- 道路名查询 ---- */
const roadName = ref('')
const roadCity = ref('')

// 道路名联想
const suggestions = ref([])        // { name, district, city, confidence }[]
const suggestionIdx = ref(-1)
const showSuggestions = ref(false)
let suggestTimer = null

/** 从高德地址字段中提取城市名（如 "北京市海淀区" → "北京"） */
function extractCity(address, district) {
  if (!address && !district) return ''
  const src = address || district || ''
  const m = src.match(/^(.+?)[市省]/)
  return m ? m[1] : ''
}

/* ---- 道路名识别 & 置信度 ---- */
// 非道路模式（交叉口、路口等）
const NOT_ROAD_RE = /(?:交叉口|路口|与|和|转盘|环岛)/
// high: 几乎确定有交通数据覆盖的道路类型
const ROAD_HIGH_RE = /(?:高速|快速[路道]|国道|省道|环路|环线|主干[路道]|大街|大道)/
// medium: 城市道路通常有数据覆盖
const ROAD_MID_RE  = /(?:[路街环线]$|公路|辅路|立交|大桥|支路)/
// low: 极小概率有数据
const ROAD_LOW_RE  = /(?:[道巷弄]$|隧道|胡同|县道|乡道)/

function roadConfidence(name) {
  if (NOT_ROAD_RE.test(name)) return ''  // 交叉口/路口 → 不是道路
  if (ROAD_HIGH_RE.test(name)) return 'high'
  if (ROAD_MID_RE.test(name))  return 'medium'
  if (ROAD_LOW_RE.test(name))  return 'low'
  return ''
}

/**
 * 道路名联想搜索 — 三阶段策略：
 *  1. Input Tips API（快速，主流）
 *  2. Place Search Text API（对道路名匹配更好）
 *  3. 关键词不含道路后缀时 → 并行搜索带后缀的关键词（如 "中关村大街"）
 */
async function fetchSuggestions(keyword) {
  const kw = (keyword || '').trim()
  if (!kw) {
    suggestions.value = []
    showSuggestions.value = false
    return
  }

  const roads = []
  const seen = new Set()

  function addResult(name, district, city) {
    if (!name || name === kw || seen.has(name)) return
    const conf = roadConfidence(name)
    if (conf === 'high' || conf === 'medium') {
      seen.add(name)
      roads.push({ name, district: district || '', city: city || '', confidence: conf })
    }
  }

  function collect(arr, cityOverride) {
    for (const t of arr) {
      if (!t.name) continue
      addResult(t.name, t.district || '', cityOverride || extractCity(t.address, t.district))
    }
  }

  // ---- 源 1：Input Tips ----
  try {
    const qs = new URLSearchParams({ key: trafficService.apiKey, keywords: kw, output: 'JSON' })
    if (roadCity.value) qs.append('city', roadCity.value)
    const res = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?${qs}`)
    const d = await res.json()
    if (d.status === '1' && d.tips) collect(d.tips, '')
  } catch { /* ok */ }

  // ---- 源 2：Place Search ----
  if (roads.length < 5 && roadCity.value) {
    try {
      const qs = new URLSearchParams({ key: trafficService.apiKey, keywords: kw, city: roadCity.value, offset: '10', output: 'JSON' })
      const res = await fetch(`https://restapi.amap.com/v3/place/text?${qs}`)
      const d = await res.json()
      if (d.status === '1' && d.pois) collect(d.pois, roadCity.value)
    } catch { /* ok */ }
  }

  // ---- 源 3：后缀并行搜索（关键词不含道路后缀时） ----
  if (roads.length < 3 && !roadConfidence(kw) && roadCity.value) {
    const suffixes = ['大街', '大道', '路', '街', '高速', '环路']
    const fetches = suffixes.map(suffix => {
      const qs = new URLSearchParams({ key: trafficService.apiKey, keywords: kw + suffix, city: roadCity.value, offset: '5', output: 'JSON' })
      return fetch(`https://restapi.amap.com/v3/place/text?${qs}`)
        .then(r => r.json())
        .then(d => (d.status === '1' && d.pois) ? d.pois : [])
        .catch(() => [])
    })
    const results = await Promise.allSettled(fetches)
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        collect(r.value, roadCity.value)
      }
    }
  }

  // ---- 组装 ----
  const order = { high: 0, medium: 1 }
  roads.sort((a, b) => (order[a.confidence] || 2) - (order[b.confidence] || 2))
  suggestions.value = roads.slice(0, 8)
  showSuggestions.value = roads.length > 0

  if (import.meta.env.DEV) {
    console.log(`[Traffic] 联想: "${kw}" → 道路 ${roads.length} 条`,
      roads.map(s => `${s.name}(${s.confidence})`).join(', '))
  }
}

function onRoadNameInput() {
  clearTimeout(suggestTimer)
  suggestionIdx.value = -1
  suggestTimer = setTimeout(() => fetchSuggestions(roadName.value), 250)
}

function selectSuggestion(s) {
  roadName.value = s.name
  // 同步填入城市，确保道路与城市匹配
  if (s.city && s.city !== roadCity.value) {
    roadCity.value = s.city
  }
  showSuggestions.value = false
  suggestions.value = []
  suggestionIdx.value = -1
}

function onRoadNameKeydown(e) {
  if (e.key === 'Escape') {
    showSuggestions.value = false
    return
  }
  if (e.key === 'Enter') {
    if (showSuggestions.value && suggestionIdx.value >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions.value[suggestionIdx.value])
    } else {
      showSuggestions.value = false
      fetchRoad()
    }
    return
  }
  if (!showSuggestions.value || !suggestions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    suggestionIdx.value = Math.min(suggestionIdx.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    suggestionIdx.value = Math.max(suggestionIdx.value - 1, 0)
  }
}

function hideSuggestions() {
  // 延迟隐藏以允许点击联想条目
  setTimeout(() => { showSuggestions.value = false }, 150)
}

const fetching = ref(false)
const roads = ref([])
const statusText = ref('')
const statusType = ref('info')
const lastFetch = ref('')
const panelCollapsed = ref(false)

// 路况数据源
let trafficDS = null

/* ---- 视口模式 ---- */
const viewportBBox = ref(null)
const viewportDiagonal = ref(0)

function updateViewport() {
  const v = viewer.value
  if (!v || v.isDestroyed?.()) return
  try {
    // computeViewRectangle returns undefined if the camera isn't looking
    // at the globe (e.g. tilted toward the horizon or looking at space).
    const rect = v.camera.computeViewRectangle()
    if (!rect) {
      // 保留上次已知 bbox 而非清空 — 用户可能只是短暂倾斜视角
      if (!viewportBBox.value) {
        viewportDiagonal.value = 0
      }
      return
    }
    const bbox = [
      Cesium.Math.toDegrees(rect.west),
      Cesium.Math.toDegrees(rect.south),
      Cesium.Math.toDegrees(rect.east),
      Cesium.Math.toDegrees(rect.north),
    ]
    viewportBBox.value = bbox
    viewportDiagonal.value = TrafficService.diagonalMeters(bbox)
  } catch {
    // 降级模式 — 保留上次 bbox
  }
}

// 监听相机移动，更新视野范围
let cameraMoveRemover = null

function bindViewportListener(v) {
  if (!v) return
  if (cameraMoveRemover) cameraMoveRemover()

  // 优先使用 moveEnd；旧版 Cesium 降级为 changed
  const camEvent = v.camera.moveEnd || v.camera.changed
  cameraMoveRemover = camEvent.addEventListener(updateViewport)
  updateViewport()
}

// immediate:true — viewer 可能已在组件挂载前初始化
watch(() => viewer.value, bindViewportListener, { immediate: true })

/* ---- 绘制模式 ---- */
const isDrawing = ref(false)
const drawBBox = ref(null)
const drawSize = ref(0)
let drawingHandler = null
let drawingPts = []

function startDrawing() {
  const v = viewer.value
  if (!v) return
  clearRoads()
  drawingPts = []
  drawBBox.value = null
  drawSize.value = 0
  isDrawing.value = true
  setStatus('在地图上点击矩形的第一个角点', 'info')

  drawingHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  drawingHandler.setInputAction((click) => {
    const cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid)
    if (!cart) return
    const c = Cesium.Cartographic.fromCartesian(cart)
    drawingPts.push([Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)])

    if (drawingPts.length === 2) {
      cesiumHelpers.destroyHandler(drawingHandler)
      drawingHandler = null
      isDrawing.value = false

      const [p1, p2] = drawingPts
      const bbox = [
        Math.min(p1[0], p2[0]),
        Math.min(p1[1], p2[1]),
        Math.max(p1[0], p2[0]),
        Math.max(p1[1], p2[1]),
      ]
      drawBBox.value = bbox
      drawSize.value = TrafficService.diagonalMeters(bbox)

      // 绘制预览矩形
      v.entities.add(cesiumHelpers.createRectangleEntity(bbox, '查询区域', cesiumHelpers.COLORS.CYAN))
      v.zoomTo(v.entities)

      const km = (drawSize.value / 1000).toFixed(2)
      if (drawSize.value > 10_000) {
        setStatus(`矩形对角线 ${km} km，超出 10 km 限制，将自动拆分查询`, 'warning')
      } else {
        setStatus(`矩形已确定（${km} km），点击「查询路况」`, 'success')
      }
      ElMessage.success('区域绘制完成')
    } else {
      setStatus('点击第二个角点完成绘制', 'info')
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

/* ---- 查询 ---- */
async function fetchViewport() {
  if (!viewportBBox.value) return
  await doFetch(viewportBBox.value.slice())
}

async function fetchDraw() {
  if (!drawBBox.value) return
  await doFetch(drawBBox.value.slice())
}

async function fetchRoad() {
  if (!roadName.value.trim() || fetching.value) return
  const v = viewer.value
  if (!v) return

  fetching.value = true
  const name = roadName.value.trim()
  const city = roadCity.value.trim()
  const keepGcj02 = isGcj02Imagery()

  // 查询（带城市）
  let data = []
  try {
    data = await trafficService.fetchTrafficByRoad(name, city, { keepGcj02 })
  } catch (err) {
    if (err.name === 'AbortError') { fetching.value = false; return }
    console.error('[Traffic]', err)
    setStatus(`查询失败：${err.message}`, 'error')
    fetching.value = false
    return
  }

  // 自动重试：有城市但无结果 → 去掉城市约束重查
  if (!data.length && city) {
    setStatus(`"${name}" 在 ${city} 中未找到，尝试全国范围匹配…`, 'warning')
    try {
      data = await trafficService.fetchTrafficByRoad(name, '', { keepGcj02 })
    } catch {
      // 重试失败，保持 data = []
    }
  }

  roads.value = data
  clearRoads()
  if (data.length) {
    renderRoads(data, v)
    const allPos = data.flatMap(r => r.coordinates)
    if (allPos.length) {
      const center = allPos[Math.floor(allPos.length / 2)]
      v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], 2000), duration: 1.5 })
    }
  }

  const dt = new Date()
  lastFetch.value = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`
  if (data.length === 0) {
    const cityInfo = city ? `（城市：${city}）` : ''
    setStatus(`未找到"${name}"${cityInfo}的交通态势数据，请尝试输入更完整的道路名（如：XX大街）`, 'warning')
    ElMessage.warning(`"${name}"${cityInfo}暂无交通数据`)
  } else {
    setStatus(`"${name}" 共 ${data.length} 条道路`, 'success')
    ElMessage.success(`获取到 ${data.length} 条道路数据`)
  }
  fetching.value = false
}

/** 检测当前影像图层是否为 GCJ-02 坐标系（高德/腾讯） */
function isGcj02Imagery() {
  const v = viewer.value
  if (!v) return false
  try {
    for (let i = 0; i < v.imageryLayers.length; i++) {
      const url = v.imageryLayers.get(i)?.imageryProvider?.url || ''
      if (url.includes('autonavi') || url.includes('gtimg')) {
        return true // 高德 or 腾讯 → GCJ-02
      }
    }
  } catch { /* ignore */ }
  return false
}

async function doFetch(bbox) {
  const v = viewer.value
  if (!v || fetching.value) return

  // 使用 GCJ-02 影像底图（高德/腾讯）时保留 GCJ-02 坐标，使路况线与偏移底图对齐
  const keepGcj02 = isGcj02Imagery()

  fetching.value = true
  setStatus('正在获取交通态势数据…', 'warning')
  try {
    const data = await trafficService.fetchTrafficByBBox(bbox, { keepGcj02 })
    roads.value = data
    clearRoads()
    if (data.length) renderRoads(data, v)
    const dt = new Date()
    lastFetch.value = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`

    if (data.length === 0) {
      setStatus('该区域暂无交通态势数据（乡镇/偏远地区可能无覆盖，请尝试城市中心或高速公路区域）', 'warning')
      ElMessage.warning('该区域暂无交通态势数据')
    } else {
      setStatus(`获取成功，共 ${data.length} 条道路`, 'success')
      ElMessage.success(`获取到 ${data.length} 条道路数据`)
    }
  } catch (err) {
    if (err.name === 'AbortError') return
    console.error('[Traffic]', err)
    setStatus(`获取失败：${err.message}`, 'error')
  } finally {
    fetching.value = false
  }
}

/* ---- 渲染 ---- */
function renderRoads(data, v) {
  clearRoads()
  trafficDS = new Cesium.CustomDataSource('traffic')
  data.forEach(road => {
    const positions = Cesium.Cartesian3.fromDegreesArray(road.coordinates.flat())
    const color = cesiumHelpers.trafficColors[road.status] || Cesium.Color.GREEN
    const base = { '畅通': 8, '缓行': 10, '拥堵': 12, '严重拥堵': 14 }[road.status] || 8
    trafficDS.entities.add({
      name: `${road.name} | ${road.status}`,
      polyline: {
        positions,
        width: Math.min(base + road.speed / 5, 20),
        material: color.withAlpha(0.85),
        clampToGround: true,
      },
    })
  })
  v.dataSources.add(trafficDS)
}

/* ---- 清除 ---- */
function clearRoads() {
  const v = viewer.value
  if (v && trafficDS) {
    v.dataSources.remove(trafficDS, true)
  }
  trafficDS = null
}

function clearAll() {
  trafficService.cancel()
  clearRoads()
  const v = viewer.value
  if (v) v.entities.removeAll()
  roads.value = []
  statusText.value = ''
  lastFetch.value = ''
}

/* ---- 工具 ---- */
function setStatus(msg, type = 'info') {
  statusText.value = msg
  statusType.value = type
}

const stats = computed(() => {
  const c = { smooth: 0, slow: 0, jam: 0, severe: 0 }
  roads.value.forEach(r => {
    if (r.status === '畅通') c.smooth++
    else if (r.status === '缓行') c.slow++
    else if (r.status === '拥堵') c.jam++
    else if (r.status === '严重拥堵') c.severe++
  })
  return c
})

/* ---- 清理 ---- */
onUnmounted(() => {
  if (cameraMoveRemover) cameraMoveRemover()
  clearAll()
  trafficService.cancel()
})
</script>

<style scoped>
.analysis-view {
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.analysis-panel {
  position: absolute;
  top: 14px;
  left: 0;
  width: 300px;
  max-height: calc(100vh - 28px);
  overflow-y: auto;
  pointer-events: auto;
  animation: fade-in-up 0.4s ease;
}

.panel-header .badge {
  background: #00e5ff;
  color: #000;
  border-radius: 10px;
  padding: 0 7px;
  font-size: 11px;
  margin-left: auto;
  margin-right: 6px;
}

/* 模式切换 */
.section-label {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.mode-tab {
  flex: 1;
  padding: 5px 0;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,.12);
  background: transparent;
  color: #aaa;
  border-radius: 4px;
  cursor: pointer;
  transition: all .2s;
}

.mode-tab.active {
  background: rgba(0,229,255,.12);
  border-color: #00e5ff;
  color: #00e5ff;
}

.hint-text {
  font-size: 11px;
  color: #777;
  margin-bottom: 4px;
}

.diagonal-info {
  font-size: 12px;
  color: #52c41a;
  margin-bottom: 2px;
}

.diagonal-info.over {
  color: #faad14;
}

.diagonal-info .warn {
  color: #f5222d;
  font-weight: 600;
}

.btn-row {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.btn-row .el-button {
  flex: 1;
}

/* 道路名输入 */
.road-input-row {
  margin-top: 4px;
}

.road-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  color: #e0eaf6;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.road-input:focus {
  border-color: #00e5ff;
}

.road-input::placeholder {
  color: #4a5a6a;
}

/* 无道路联想提示 */
.no-suggest-hint {
  font-size: 11px;
  color: #667788;
  margin-top: 4px;
  padding: 4px 0;
}

/* 道路名联想下拉 */
.suggest-wrapper {
  position: relative;
}

.suggest-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1100;
  background: rgba(10, 18, 30, 0.97);
  border: 1px solid rgba(0, 229, 255, 0.15);
  border-radius: 0 0 4px 4px;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
}

.suggest-item {
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background 0.15s;
}

.suggest-item:hover,
.suggest-item.active {
  background: rgba(0, 229, 255, 0.12);
}

.suggest-name {
  color: #e0eaf6;
}

.suggest-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.tag-conf {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
}

.tag-h { background: rgba(82, 196, 26, 0.15); color: #52c41a; border: 1px solid rgba(82, 196, 26, 0.25); }
.tag-m { background: rgba(0, 229, 255, 0.10); color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.20); }
.suggest-city {
  color: #00e5ff;
  font-size: 11px;
  font-weight: 500;
}

.suggest-district {
  color: #556878;
  font-size: 11px;
}

/* 统计 */
.stats-row {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.stat-item {
  font-size: 12px;
  background: rgba(255,255,255,.04);
  border-radius: 4px;
  padding: 3px 8px;
  color: #ccc;
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-item strong {
  color: #fff;
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.freshness {
  font-size: 11px;
  color: #666;
  text-align: right;
  margin-top: 4px;
}

/* 图例 */
.legend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 11px;
  color: #aaa;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
