<template>
  <div class="home-view">
    <div class="glass-panel home-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">⚙</span><span>基础三维场景</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">

        <div class="field-group">
          <label class="hud-label">影像图层<span class="label-value">{{ imageryType.toUpperCase() }}</span></label>
          <el-select v-model="imageryType" @change="onImageryChange" size="small" style="width:100%">
            <el-option label="Cesium 全球影像" value="cesium" />
            <el-option label="高德卫星影像" value="gaode" />
            <el-option label="腾讯卫星影像" value="tencent" />
          </el-select>
        </div>

        <div class="field-group">
          <label class="hud-label">地形数据<span class="label-value">{{ terrainLabel }}</span></label>
          <el-select v-model="terrainType" @change="onTerrainChange" :loading="terrainLoading" size="small" style="width:100%">
            <el-option label="扁平（无地形）" value="none" />
            <el-option label="Cesium 全球地形" value="cesium" />
            <el-option label="ArcGIS 地形" value="arcgis" />
          </el-select>
        </div>

        <div class="field-group">
          <label class="hud-label">视角切换</label>
          <el-button-group style="width:100%">
            <el-button size="small" :type="currentView === 'top' ? 'primary' : 'default'" @click="switchView('top')" style="flex:1">俯视</el-button>
            <el-button size="small" :type="currentView === 'oblique' ? 'primary' : 'default'" @click="switchView('oblique')" style="flex:1">45°斜视</el-button>
            <el-button size="small" :type="currentView === 'shallow' ? 'primary' : 'default'" @click="switchView('shallow')" style="flex:1">平视</el-button>
          </el-button-group>
          <el-button size="small" @click="resetView" style="margin-top:4px">↺ 复位全局视角</el-button>
        </div>

        <div class="field-group">
          <label class="hud-label">视场角度<span class="label-value">{{ fov }}°</span><button class="fov-reset-btn" @click="resetFov" title="恢复默认 60°">↺</button></label>
          <el-slider v-model="fov" :min="30" :max="90" @input="onFovChange" size="small" show-input :show-input-controls="false" />
          <div class="fov-range-labels"><span>30° 望远</span><span>90° 广角</span></div>
        </div>

        <div class="section-divider"></div>

        <div class="field-group">
          <label class="hud-label">数据加载</label>
          <el-button size="small" :type="gltfLoaded ? 'danger' : 'primary'" :loading="loadingAsset === 'gltf' && gltfProgress < 100" @click="toggleGltf">
            {{ gltfBtnText }}
          </el-button>
          <div v-if="loadingAsset === 'gltf' && gltfProgress > 0 && gltfProgress < 100" class="progress-hint">
            {{ gltfProgress === -1 ? '解析模型中…' : `下载模型 ${gltfProgress}%` }}
          </div>
          <el-button size="small" :type="tilesLoaded ? 'danger' : 'primary'" :loading="loadingAsset === 'tiles'" @click="toggle3DTiles" style="margin-top:4px">
            {{ tilesLoaded ? '⌂ 移除三维瓦片' : '⌂ 三维瓦片 (3D Tiles)' }}
          </el-button>
          <el-button size="small" :type="geoJsonLoaded ? 'danger' : 'primary'" :loading="loadingAsset === 'geojson'" @click="toggleGeoJson" style="margin-top:4px">
            {{ geoJsonLoaded ? '◈ 移除行政区划' : '◈ 武汉市行政区划 (GeoJSON)' }}
          </el-button>
        </div>

        <div class="field-group">
          <label class="hud-label">GeoJSON 应用</label>
          <el-button size="small" :type="colorRenderActive ? 'warning' : 'default'" :loading="processing === 'color'" @click="toggleColorRender">
            ▣ 分色渲染 + 注记
          </el-button>
          <el-button size="small" :type="heightVisualActive ? 'warning' : 'default'" :loading="processing === 'height'" @click="toggleHeightVisual" style="margin-top:4px">
            ▨ 高度可视化
          </el-button>
          <div v-if="colorLegend.length" class="legend-card">
            <div v-for="item in colorLegend" :key="item.name" class="legend-item">
              <span class="legend-swatch" :style="{ background: item.color }"></span>
              <span>{{ item.name }}</span>
            </div>
          </div>
          <div v-if="progressLabel" class="progress-hint">{{ progressLabel }}</div>
          <div v-if="heightStats" class="stats-card">
            <div class="stats-row"><span>最低</span><span>{{ heightStats.min.toFixed(0) }} m</span></div>
            <div class="stats-row"><span>最高</span><span>{{ heightStats.max.toFixed(0) }} m</span></div>
            <div class="stats-row"><span>平均</span><span>{{ heightStats.avg.toFixed(0) }} m</span></div>
            <div class="stats-row"><span>区域</span><span>{{ heightStats.count }} 个</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="coord-overlay" v-if="coords">
      <div class="coord-item"><span class="coord-label">笛卡尔</span><span class="coord-value">X:{{ coords.cartesian.x?.toFixed(1) }} Y:{{ coords.cartesian.y?.toFixed(1) }} Z:{{ coords.cartesian.z?.toFixed(1) }}</span></div>
      <div class="coord-item"><span class="coord-label">经纬度</span><span class="coord-value">{{ coords.lon.toFixed(6) }}° / {{ coords.lat.toFixed(6) }}°</span></div>
      <div class="coord-item"><span class="coord-label">度分秒</span><span class="coord-value">{{ coords.dms }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import * as Cesium from 'cesium'
import { useViewer } from '@composables/useCesium'
import { useImagery, useTerrain } from '@composables/useImagery'
import { useCoordinate } from '@composables/useCoordinate'
import { cesiumHelpers } from '@utils/cesiumHelpers'
import { useViewerStore } from '@stores/viewer'
import { storeToRefs } from 'pinia'

const { viewer, isReady } = useViewer()
const { switchImagery } = useImagery()
const { switchTerrain } = useTerrain()
const { toDMS, pickPosition } = useCoordinate()
const viewerStore = useViewerStore()

// 影像/地形类型从 store 读取，路由切换后保持状态
const { imageryType, terrainType } = storeToRefs(viewerStore)

const panelCollapsed = ref(false)
const currentView = ref('oblique')
const terrainLoading = ref(false)
const fov = ref(60)
const coords = ref(null)
const colorRenderActive = ref(false)
const heightVisualActive = ref(false)
const loadingAsset = ref(null)
const processing = ref(null)
const gltfLoaded = ref(false)
const gltfProgress = ref(0)     // 下载进度：0-100，-1=解析中
let gltfPrimitive = null        // viewer.entities 中的模型 entity 引用
const tilesLoaded = ref(false)  // 3D Tiles 是否已加载
let tilesetPrimitive = null     // scene.primitives 中的 tileset 引用
const terrainLabel = ref('无')

const gltfBtnText = computed(() => {
  if (loadingAsset.value === 'gltf') {
    if (gltfProgress.value === -1) return '解析模型中…'
    if (gltfProgress.value > 0 && gltfProgress.value < 100) return `下载中 ${gltfProgress.value}%`
    return '加载中…'
  }
  return gltfLoaded.value ? '✈ 移除飞机模型' : '✈ 飞机模型 (glTF)'
})

let screenHandler = null
let cachedGeoJsonDS = null
let baseOverlayEntities = [] // TERRAIN 分类的基础图层实体
let colorEntities = []
let heightEntities = []
let viewTarget = null
let cachedSampleProvider = null
let cachedDistrictHeights = null

const geoJsonLoaded = ref(false)
const heightStats = ref(null)
const progressLabel = ref('')
const colorLegend = ref([])

const COLOR_PALETTE = [
  '#4ECDC4', '#FF6B6B', '#FFE66D', '#45B7D1', '#F8B195',
  '#C06C84', '#6C5B7B', '#355C7D', '#99B898', '#FECEAB',
  '#E84A5F', '#2A363B', '#A8E6CF',
].map(c => Cesium.Color.fromCssColorString(c))

function stableColor(adcode) {
  let hash = 0
  for (const ch of String(adcode || 0)) hash = ((hash << 5) - hash) + ch.charCodeAt(0)
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length].clone()
}

function _checkViewer() {
  if (!viewer.value) { ElMessage.warning('三维场景正在初始化，请稍候…'); return false }
  return true
}

/* ---- 影像 / 地形 ---- */
async function onImageryChange() {
  const ok = await switchImagery(imageryType.value)
  if (ok) ElMessage.success('影像已切换')
  else ElMessage.error('影像切换失败')
}

async function onTerrainChange() {
  terrainLoading.value = true
  const ok = await switchTerrain(terrainType.value)
  terrainLoading.value = false
  cachedDistrictHeights = null // 地形切换后缓存失效
  if (ok) {
    const labels = { none:'无', cesium:'全球', arcgis:'ArcGIS' }
    terrainLabel.value = labels[terrainType.value] || terrainType.value
    ElMessage.success('地形已切换')
  } else {
    ElMessage.error('地形切换失败')
  }
}

/* ---- 视角切换 ---- */
function switchView(type) {
  if (!_checkViewer()) return
  const v = viewer.value
  const camera = v.camera
  const center = new Cesium.Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2)
  const ray = camera.getPickRay(center)
  const lookAt = v.scene.globe.pick(ray, v.scene)
  if (lookAt) {
    if (!viewTarget || Cesium.Cartesian3.distance(lookAt, viewTarget) > 50) viewTarget = lookAt.clone()
  }
  if (!viewTarget) viewTarget = camera.position.clone()
  let distance = Cesium.Cartesian3.distance(camera.position, viewTarget)
  distance = Cesium.Math.clamp(distance, 500, 50000)
  const views = {
    top:     { pitch: Cesium.Math.toRadians(-90), heading: camera.heading },
    oblique: { pitch: Cesium.Math.toRadians(-45), heading: camera.heading },
    shallow: { pitch: Cesium.Math.toRadians(-10), heading: camera.heading },
  }
  const { pitch, heading } = views[type]
  const enuOffset = new Cesium.Cartesian3(
    -distance * Math.cos(pitch) * Math.sin(heading),
    -distance * Math.cos(pitch) * Math.cos(heading),
    -distance * Math.sin(pitch)
  )
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(viewTarget)
  const cameraPos = Cesium.Matrix4.multiplyByPoint(transform, enuOffset, new Cesium.Cartesian3())
  currentView.value = type
  camera.flyTo({ destination: cameraPos, orientation: { heading, pitch, roll: 0 }, duration: 1.2 })
}

function resetView() { if (!_checkViewer()) return; viewer.value.camera.flyHome(2.0) }

/* ---- 视场角 ---- */
function onFovChange(val) { if (viewer.value) viewer.value.camera.frustum.fov = Cesium.Math.toRadians(val) }
const FOV_DEFAULT = 60
function resetFov() { fov.value = FOV_DEFAULT; onFovChange(FOV_DEFAULT) }

/* ---- glTF 模型 ---- */

/** 移除 glTF 模型并清理相关资源 */
function removeGltf() {
  const v = viewer.value
  if (gltfPrimitive) {
    try { v?.entities?.remove(gltfPrimitive) } catch (_) { /* ok */ }
    gltfPrimitive = null
  }
  gltfLoaded.value = false
  gltfProgress.value = 0
}

/**
 * glTF 模型加载（优化版）。
 *
 * 相比原始版本的改进：
 *   1. 地形感知高度 — 采样放置点地形高度，避免模型沉入地下
 *   2. 离地高度自适应 — 地形越高，模型离地越远（max(300, 地形高×5%)）
 *   3. 加载进度反馈 — 按钮文字实时显示加载状态
 *   4. 失败自动重试 — 首次失败后等待 1.5s 重试一次
 *   5. 优雅降级   — 地形采样失败 → 退化为固定高度；全部失败 → 友好报错
 */
async function toggleGltf() {
  if (!_checkViewer() || loadingAsset.value) return

  // 已加载 → 移除
  if (gltfLoaded.value) {
    removeGltf()
    ElMessage.info('飞机模型已移除')
    return
  }

  loadingAsset.value = 'gltf'
  gltfProgress.value = 0

  const MODEL_URL = './CesiumAir/Cesium_Air.glb'
  const MAX_RETRIES = 1

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const v = viewer.value

      // ---- 1. 计算放置位置 ----
      const center = new Cesium.Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2)
      const ray = v.camera.getPickRay(center)
      const lookAt = v.scene.globe.pick(ray, v.scene)
      const carto = lookAt
        ? Cesium.Cartographic.fromCartesian(lookAt)
        : v.camera.positionCartographic

      // ---- 2. 地形感知：采样放置点地形高度 ----
      gltfProgress.value = 10
      let terrainH = 0
      const tp = v.terrainProvider
      if (!(tp instanceof Cesium.EllipsoidTerrainProvider)) {
        try {
          const [sampled] = await Cesium.sampleTerrainMostDetailed(tp, [
            new Cesium.Cartographic(carto.longitude, carto.latitude, 0),
          ])
          terrainH = sampled?.height || 0
        } catch { /* 降级：采样失败使用椭球面高度 */ }
      }

      // 相机相对地形的高度（用于离地偏移 + 动态缩放计算）
      const camCarto = v.camera.positionCartographic
      const camAltitude = Math.max(0, (camCarto?.height || 0) - (terrainH || carto.height || 0))

      // 离地高度 = 相机高度的 3%，确保从当前视角清晰可见
      // 下限 300m（低空看山），上限 20000m（太空视角）
      const aboveGround = Cesium.Math.clamp(camAltitude * 0.03, 300, 20000)
      const modelHeight = Math.max(terrainH, carto.height || 0) + aboveGround

      // ---- 3. 创建模型 Entity ----
      gltfProgress.value = 50
      const modelPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, modelHeight)

      // 动态缩放：用开方曲线替代线性增长，低空不炸、高空可见
      //  500m → scale 20   2km → scale 40   10km → scale 89   50km → scale 200
      const dynamicScale = Cesium.Math.clamp(
        20.0 * Math.sqrt(Math.max(1, camAltitude / 500)),
        20,   // 最低缩放（贴地视角）
        200,  // 最高缩放（太空视角）
      )

      gltfPrimitive = v.entities.add({
        name: 'Cesium 飞机',
        position: modelPos,
        model: {
          uri: MODEL_URL,
          scale: dynamicScale,
          minimumPixelSize: 64,            // 高视角下保底至少 64px，不会小到看不见
          maximumScale: 250,               // 近距离最大 250 倍
          incrementallyLoadTextures: true,  // 渐进纹理（低清→高清）
          shadows: Cesium.ShadowMode.ENABLED,
        },
      })

      gltfProgress.value = 80
      gltfLoaded.value = true

      // ---- 4. 飞向模型（始终飞到近处，不受起始视角影响） ----
      const camDist = Cesium.Cartesian3.distance(v.camera.position, modelPos)
      // 目标观看距离：始终在 200~800m 内，高空视角也强制拉近
      const targetDist = Cesium.Math.clamp(camAltitude * 0.05, 200, 800)
      v.flyTo(gltfPrimitive, {
        duration: Cesium.Math.clamp(camDist / 8000, 0.8, 3.5),
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), targetDist),
      })

      gltfProgress.value = 100
      ElMessage.success(`飞机模型已加载 · 离地 ${aboveGround.toFixed(0)}m`)
      loadingAsset.value = null
      return // 成功

    } catch (err) {
      console.error(`[glTF] 尝试 ${attempt + 1}/${MAX_RETRIES + 1}:`, err)
      if (attempt < MAX_RETRIES) {
        gltfProgress.value = 0
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      // 最终失败
      ElMessage.error('模型加载失败：' + (err.message || '未知错误'))
      removeGltf()
    }
  }

  loadingAsset.value = null
  gltfProgress.value = 0
}

/* ---- 3D Tiles ---- */

/** 移除三维瓦片（从 scene.primitives 中安全移除并销毁） */
function remove3DTiles() {
  if (tilesetPrimitive) {
    try {
      viewer.value?.scene?.primitives?.remove(tilesetPrimitive)
    } catch (_) { /* ok */ }
    tilesetPrimitive = null
  }
  tilesLoaded.value = false
}

async function toggle3DTiles() {
  if (!_checkViewer() || loadingAsset.value) return

  // 已加载 → 移除
  if (tilesLoaded.value) {
    remove3DTiles()
    ElMessage.info('三维瓦片已移除')
    return
  }

  loadingAsset.value = 'tiles'
  try {
    const v = viewer.value

    // ---- 1. 快速读取 metadata 获取目标位置（tileset.json 很小，几乎无延迟） ----
    const resp = await fetch('./Tileset/tileset.json')
    const meta = await resp.json()
    const region = meta.root?.boundingVolume?.region
    if (!region || region.length !== 6) { ElMessage.error('tileset.json 缺少有效的包围盒'); return }
    const [west, south, east, north, , maxH] = region
    const centerLon = (west + east) / 2
    const centerLat = (south + north) / 2

    // ---- 2. 立即飞向目标区域（飞行过程约 1.5s，遮盖瓦片下载等待） ----
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(centerLon, centerLat, Math.max(maxH + 500, 200)),
      orientation: { heading: Cesium.Math.toRadians(15), pitch: Cesium.Math.toRadians(-50), roll: 0 },
      duration: 1.5,
    })

    // ---- 3. 飞行期间并行加载瓦片数据 ----
    tilesetPrimitive = await Cesium.Cesium3DTileset.fromUrl('./Tileset/tileset.json')
    tilesetPrimitive.tileFailed.addEventListener((err) => { console.error('[3DTiles] fail:', err) })

    v.scene.primitives.add(tilesetPrimitive)
    tilesLoaded.value = true

    // ---- 4. 等首帧就绪 ----
    await new Promise(r => {
      if (tilesetPrimitive.ready) return setTimeout(r, 100)
      tilesetPrimitive.initialTilesLoaded.addEventListener(r, { once: true })
      setTimeout(r, 8000)
    })

    // ---- 5. 精确聚焦 boundingSphere ----
    const bs = tilesetPrimitive.boundingSphere
    if (bs) {
      v.camera.flyToBoundingSphere(bs, {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(15),
          Cesium.Math.toRadians(-35),
          Math.max(bs.radius * 1.8, 50),
        ),
        duration: 1.0,
      })
    }

    ElMessage.success('三维瓦片已加载')
  } catch (err) {
    console.error('[3DTiles]', err)
    ElMessage.error('瓦片加载失败：' + (err.message || '未知错误'))
    remove3DTiles()
  } finally { loadingAsset.value = null }
}

/* ---- GeoJSON ---- */
async function ensureGeoJsonLoaded() {
  if (cachedGeoJsonDS) return cachedGeoJsonDS
  cachedGeoJsonDS = await Cesium.GeoJsonDataSource.load('./GeoJson/武汉市.geojson')
  return cachedGeoJsonDS
}

/** 创建 TERRAIN 分类的基础图层实体（在影像之上） */
function addBaseOverlay() {
  const v = viewer.value
  if (!v || !cachedGeoJsonDS) return
  removeBaseOverlay()
  cachedGeoJsonDS.entities.values.forEach(entity => {
    if (!entity.polygon) return
    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now())
    if (!hierarchy) return
    const positions = hierarchy.hierarchy ? hierarchy.hierarchy.positions : hierarchy.positions
    if (!positions || !positions.length) return
    const e = v.entities.add({
      name: (entity.name || '未知') + ' (基础)',
      polygon: { hierarchy: positions, classificationType: Cesium.ClassificationType.TERRAIN, material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.12), outline: true, outlineColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.8), outlineWidth: 3 },
    })
    baseOverlayEntities.push(e)
  })
}

function removeBaseOverlay() {
  const v = viewer.value
  if (!v) return
  baseOverlayEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
  baseOverlayEntities = []
}

function removeGeoJson() {
  const v = viewer.value
  if (!v) return
  removeBaseOverlay()
  if (cachedGeoJsonDS) {
    // 先清空 DataSource 内的所有 entity，再移除 DataSource
    cachedGeoJsonDS.entities.removeAll()
    try { v.dataSources.remove(cachedGeoJsonDS, true) } catch (_) { /* ok */ }
  }
  cachedGeoJsonDS = null
  geoJsonLoaded.value = false
}

async function toggleGeoJson() {
  if (!_checkViewer() || loadingAsset.value) return
  if (geoJsonLoaded.value) {
    // 清除所有 GeoJSON 相关的可视化
    if (colorRenderActive.value) {
      colorEntities.forEach(e => { try { viewer.value.entities.remove(e) } catch (_) {} })
      colorEntities = []
      colorRenderActive.value = false
      colorLegend.value = []
    }
    if (heightVisualActive.value) {
      heightEntities.forEach(e => { try { viewer.value.entities.remove(e) } catch (_) {} })
      heightEntities = []
      heightStats.value = null
      heightVisualActive.value = false
    }
    removeGeoJson()
    ElMessage.info('行政区划已移除')
    return
  }
  loadingAsset.value = 'geojson'
  try {
    const v = viewer.value
    const ds = await ensureGeoJsonLoaded()
    if (!v.dataSources.contains(ds)) v.dataSources.add(ds)
    addBaseOverlay()
    geoJsonLoaded.value = true
    await v.zoomTo(ds)  // entity 可见时定位准确
    ds.entities.values.forEach(e => { e.show = false })
    ElMessage.success('GeoJSON 已加载')
  } catch (err) {
    ElMessage.error('GeoJSON 加载失败：' + (err.message || '未知错误'))
  } finally { loadingAsset.value = null }
}

/* ---- 分色渲染 ---- */
async function toggleColorRender() {
  if (!_checkViewer() || processing.value) return
  const v = viewer.value
  if (colorRenderActive.value) {
    colorEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
    colorEntities = []
    colorLegend.value = []
    colorRenderActive.value = false
    if (!heightVisualActive.value && geoJsonLoaded.value) addBaseOverlay()
    ElMessage.info('分色渲染已清除')
    return
  }
  processing.value = 'color'
  try {
    const ds = await ensureGeoJsonLoaded()
    if (!v.dataSources.contains(ds)) v.dataSources.add(ds)
    removeBaseOverlay()
    const polyEntities = ds.entities.values.filter(e => e.polygon)
    const total = polyEntities.length
    polyEntities.forEach((entity, idx) => {
      progressLabel.value = `分色渲染 ${idx + 1}/${total}`
      const adcode = entity.properties?.adcode?.getValue()
      const name = entity.name || '未知'
      const color = stableColor(adcode).withAlpha(0.7)
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now())
      if (!hierarchy) return
      const positions = hierarchy.hierarchy ? hierarchy.hierarchy.positions : hierarchy.positions
      if (!positions || !positions.length) return
      const centerProp = entity.properties?.center?.getValue()
      const labelPos = centerProp
        ? Cesium.Cartesian3.fromDegrees(centerProp[0], centerProp[1], 0)
        : Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(Cesium.BoundingSphere.fromPoints(positions).center)
      const colorEntity = v.entities.add({
        name: name + ' (分色)',
        polygon: { hierarchy: positions, classificationType: Cesium.ClassificationType.TERRAIN, material: color, outline: true, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
        position: labelPos,
        label: { text: name, font: '14px "Noto Sans SC", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.CENTER },
      })
      colorEntities.push(colorEntity)
    })
    progressLabel.value = ''
    // 构建色卡图例
    const seen = new Set()
    colorLegend.value = polyEntities
      .map(e => ({ name: e.name || '未知', adcode: e.properties?.adcode?.getValue() }))
      .filter(item => !seen.has(item.name) && seen.add(item.name))
      .map(item => ({ name: item.name, color: stableColor(item.adcode).withAlpha(0.7).toCssColorString() }))
    geoJsonLoaded.value = true
    v.flyTo(ds)
    colorRenderActive.value = true
    ElMessage.success(`分色渲染完成，共 ${total} 个区域`)
  } catch (err) {
    ElMessage.error('分色渲染失败：' + (err.message || '未知错误'))
  } finally { processing.value = null }
}

/* ---- 高度可视化 ---- */
async function toggleHeightVisual() {
  if (!_checkViewer() || processing.value) return
  const v = viewer.value
  if (heightVisualActive.value) {
    heightEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
    heightEntities = []
    heightStats.value = null
    heightVisualActive.value = false
    if (!colorRenderActive.value && geoJsonLoaded.value) addBaseOverlay()
    ElMessage.info('高度可视化已清除')
    return
  }
  processing.value = 'height'
  try {
    // 预检：地形必须已加载
    const tp = v.terrainProvider
    if (tp instanceof Cesium.EllipsoidTerrainProvider) {
      ElMessage.warning('请先在「地形数据」中切换为 ArcGIS 或 Cesium 地形，再进行高度可视化')
      processing.value = null
      return
    }

    const ds = await ensureGeoJsonLoaded()
    if (!v.dataSources.contains(ds)) v.dataSources.add(ds)
    removeBaseOverlay()

    const polyEntities = ds.entities.values.filter(e => e.polygon)
    const total = polyEntities.length

    // 阶段 1：收集采样点（每区 25 点）
    progressLabel.value = '收集采样点…'
    const allPoints = []
    const districts = []
    for (const entity of polyEntities) {
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now())
      if (!hierarchy) continue
      const positions = hierarchy.hierarchy ? hierarchy.hierarchy.positions : hierarchy.positions
      if (!positions || !positions.length) continue
      const step = Math.max(1, Math.ceil(positions.length / 10))
      for (let i = 0; i < positions.length; i += step) {
        const c = Cesium.Cartographic.fromCartesian(positions[i])
        allPoints.push({ lon: c.longitude, lat: c.latitude, idx: districts.length })
      }
      districts.push({ name: entity.name || '未知', positions, heights: [], adcode: entity.properties?.adcode?.getValue() })
    }

    // 阶段 2：获取高程（缓存 → 快速读 → ArcGIS 专用采样）
    if (cachedDistrictHeights) {
      progressLabel.value = '使用缓存高程…'
      for (const d of districts) {
        d.heights = [cachedDistrictHeights[d.name] ?? NaN]
      }
    } else {
      progressLabel.value = `正在读取 ${allPoints.length} 个高程点…`
      const globe = v.scene.globe
      for (const pt of allPoints) {
        const h = globe.getHeight(Cesium.Cartographic.fromRadians(pt.lon, pt.lat))
        districts[pt.idx].heights.push(h ?? NaN)
      }
      const hitRate = districts.filter(d => d.heights.some(h => !isNaN(h))).length / districts.length
      if (hitRate < 0.8) {
        // ArcGIS：viewer terrain 的 sampleTerrainMostDetailed 会卡死 → 用独立 provider
        progressLabel.value = 'ArcGIS 地形采样中（首次较慢）…'
        if (!cachedSampleProvider) {
          cachedSampleProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
          )
        }
        const cartoPoints = allPoints.map(p => new Cesium.Cartographic(p.lon, p.lat, 0))
        const sampled = await Cesium.sampleTerrainMostDetailed(cachedSampleProvider, cartoPoints)
        for (let i = 0; i < allPoints.length; i++) {
          districts[allPoints[i].idx].heights = [sampled[i].height]
        }
      }
    }

    // 阶段 3：创建实体
    let minH = Infinity, maxH = -Infinity, sumH = 0, validCount = 0, skipped = 0
    for (let idx = 0; idx < districts.length; idx++) {
      const d = districts[idx]
      progressLabel.value = `生成模型 ${idx + 1}/${districts.length}`
      const validHeights = d.heights.filter(h => !isNaN(h))
      if (validHeights.length === 0) { skipped++; continue }
      const avgHeight = validHeights.reduce((a, b) => a + b, 0) / validHeights.length
      if (!isFinite(avgHeight) || avgHeight < -1000 || avgHeight > 10000) { skipped++; continue }
      if (avgHeight < minH) minH = avgHeight
      if (avgHeight > maxH) maxH = avgHeight
      sumH += avgHeight; validCount++
      const hEntity = v.entities.add({
        name: d.name + ' (高度)',
        polygon: { hierarchy: d.positions, height: avgHeight, extrudedHeight: avgHeight + Math.max(avgHeight * 2, 100), material: stableColor(d.adcode).withAlpha(0.6), outline: true, outlineColor: Cesium.Color.WHITE.withAlpha(0.4) },
        label: { text: `${avgHeight.toFixed(0)} 米`, font: '14px "Noto Sans SC", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -10) },
      })
      const center = Cesium.BoundingSphere.fromPoints(d.positions).center
      hEntity.position = new Cesium.ConstantPositionProperty(center)
      heightEntities.push(hEntity)
    }
    progressLabel.value = ''
    if (validCount === 0) {
      heightEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
      heightEntities = []
      if (geoJsonLoaded.value) addBaseOverlay()
      ElMessage.error('高度可视化失败：所有区域采样数据异常，请重试')
      processing.value = null
      return
    }
    // 缓存高程结果，下次直接复用
    if (validCount > 0) {
      cachedDistrictHeights = {}
      for (const d of districts) {
        const vh = d.heights.filter(h => !isNaN(h))
        if (vh.length > 0) cachedDistrictHeights[d.name] = vh.reduce((a, b) => a + b, 0) / vh.length
      }
    }
    heightStats.value = { min: minH, max: maxH, avg: sumH / validCount, count: validCount, skipped }
    geoJsonLoaded.value = true
    heightVisualActive.value = true
    ElMessage.success(`最低 ${minH.toFixed(0)}m · 最高 ${maxH.toFixed(0)}m · 平均 ${(sumH/validCount).toFixed(0)}m (${validCount}区)`)
    if (skipped > 0) ElMessage.warning(`${skipped} 个区域因数据异常跳过`)
  } catch (err) {
    console.error('[高度可视化]', err)
    ElMessage.error('高度可视化失败：' + (err.message || '未知错误'))
  } finally { processing.value = null }
}

/* ---- 生命周期 ---- */

// 挂载时恢复上次的影像/地形设置
onMounted(async () => {
  if (!viewer.value) return
  if (imageryType.value !== 'cesium') {
    await switchImagery(imageryType.value)
  }
  if (terrainType.value !== 'none') {
    terrainLoading.value = true
    await switchTerrain(terrainType.value)
    terrainLoading.value = false
  }
})

const stopWatch = watch(isReady, (ready) => {
  if (!ready || !viewer.value) return
  screenHandler = new Cesium.ScreenSpaceEventHandler(viewer.value.scene.canvas)
  screenHandler.setInputAction((movement) => {
    const result = pickPosition(movement.position)
    if (result) {
      coords.value = { cartesian: result.cartesian, lon: result.longitude, lat: result.latitude,
        dms: `(${toDMS(result.latitude, false)}, ${toDMS(result.longitude, true)})` }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}, { immediate: true })

onUnmounted(() => {
  stopWatch()
  cesiumHelpers.destroyHandler(screenHandler)
  removeGltf()
  remove3DTiles()
  removeGeoJson()
  const v = viewer.value
  if (v) {
    colorEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
    heightEntities.forEach(e => { try { v.entities.remove(e) } catch (_) {} })
  }
})
</script>

<style scoped>
.home-view { position: relative; width: 100%; height: 100%; }
.home-panel { position: absolute; top: 14px; left: 0; width: 280px; max-height: calc(100vh - 28px); overflow-y: auto; animation: fade-in-up 0.4s ease; }
.field-group { display: flex; flex-direction: column; }
.fov-reset-btn { background: none; border: none; color: #556878; font-size: 12px; cursor: pointer; padding: 0; margin-left: 6px; line-height: 1; transition: color 0.2s; }
.fov-reset-btn:hover { color: var(--hud-cyan); }
.fov-range-labels { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: #4a5a6a; margin-top: 2px; }
.progress-hint { font-family: var(--font-mono); font-size: 10px; color: var(--hud-cyan); padding: 4px 0; }
.stats-card { background: rgba(0,0,0,0.25); border: 1px solid rgba(0,229,255,0.10); border-radius: var(--radius-sm); padding: 8px 10px; }
.stats-row { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: #8899aa; padding: 2px 0; }
.stats-row span:last-child { color: var(--hud-cyan); font-weight: 600; }
.legend-card { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 6px 0; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8899aa; }
.legend-swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
</style>
