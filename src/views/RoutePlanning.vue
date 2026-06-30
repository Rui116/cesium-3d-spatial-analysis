<template>
  <div class="analysis-view">
    <div class="glass-panel analysis-panel" :class="{ collapsed: panelCollapsed }">
      <div class="panel-header"><span class="panel-icon">⌘</span><span>路径规划分析</span><button class="collapse-btn" @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '+' : '−' }}</button></div>
      <div class="panel-body">
        <el-button-group style="width:100%">
          <el-button size="small" :type="activeTab==='start'?'primary':'default'" @click="activeTab='start'" style="flex:1">起点设置</el-button>
          <el-button size="small" :type="activeTab==='end'?'primary':'default'" @click="activeTab='end'" style="flex:1">终点设置</el-button>
        </el-button-group>

        <div v-show="activeTab==='start'" class="field-group">
          <label class="hud-label">起点坐标</label>
          <div style="display:flex;gap:6px"><el-input v-model="startLng" placeholder="经度" size="small" type="number" /><el-input v-model="startLat" placeholder="纬度" size="small" type="number" /></div>
          <el-button size="small" type="primary" @click="setMapMode('start')" style="margin-top:4px">在地图上选点</el-button>
          <el-button size="small" @click="setFromInput('start')" style="margin-top:2px">输入坐标</el-button>
          <el-alert v-if="startPoint" type="info" :closable="false" show-icon style="font-size:11px;font-family:var(--font-mono)">
            <template #title>起点：{{ startPoint[0].toFixed(6) }}, {{ startPoint[1].toFixed(6) }}</template>
          </el-alert>
        </div>

        <div v-show="activeTab==='end'" class="field-group">
          <label class="hud-label">终点坐标</label>
          <div style="display:flex;gap:6px"><el-input v-model="endLng" placeholder="经度" size="small" type="number" /><el-input v-model="endLat" placeholder="纬度" size="small" type="number" /></div>
          <el-button size="small" type="primary" @click="setMapMode('end')" style="margin-top:4px">在地图上选点</el-button>
          <el-button size="small" @click="setFromInput('end')" style="margin-top:2px">输入坐标</el-button>
          <el-alert v-if="endPoint" type="info" :closable="false" show-icon style="font-size:11px;font-family:var(--font-mono)">
            <template #title>终点：{{ endPoint[0].toFixed(6) }}, {{ endPoint[1].toFixed(6) }}</template>
          </el-alert>
        </div>

        <el-button type="success" size="small" :disabled="!startPoint||!endPoint||computing" :loading="computing" @click="calculateRoute">
          {{ computing ? '计算中…' : '计算路径' }}
        </el-button>
        <el-button type="danger" size="small" @click="clearAll" style="margin-top:4px">清除</el-button>

        <div v-if="routeResult" class="stat-card-custom" style="margin-top:4px">
          <div class="stat-value">{{ (routeResult.distance/1000).toFixed(1) }}<span style="font-size:12px;color:#62758a"> 公里</span></div>
          <div class="stat-label">约 {{ Math.ceil(routeResult.duration/60) }} 分钟 · {{ routeResult.trafficLightCount || 0 }} 红绿灯</div>
        </div>

        <el-alert v-if="statusText" :type="statusType" :title="statusText" :closable="false" show-icon style="margin-top:4px" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import * as Cesium from 'cesium'
import { useViewer } from '@composables/useCesium'
import { RouteService } from '@services/routeService'
import { cesiumHelpers } from '@utils/cesiumHelpers'

const { viewer } = useViewer()
const routeService = new RouteService()

const panelCollapsed = ref(false)
const activeTab = ref('start')
const startLng = ref(''); const startLat = ref('')
const endLng = ref(''); const endLat = ref('')
const startPoint = ref(null); const endPoint = ref(null)
const statusText = ref(''); const statusType = ref('info')
const routeResult = ref(null)
const computing = ref(false)

let markers = []
let routeEntity = null
let pickHandler = null     // 独立 handler，不再用 viewer 默认的

function setStatus(m, t = 'info') { statusText.value = m; statusType.value = t }

function destroyPickHandler() {
  if (pickHandler && !pickHandler.isDestroyed()) pickHandler.destroy()
  pickHandler = null
}

function setMapMode(type) {
  const v = viewer.value
  if (!v) return
  destroyPickHandler()

  setStatus(`在地图上点击选择${type === 'start' ? '起点' : '终点'}`, 'info')
  pickHandler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)
  pickHandler.setInputAction((e) => {
    // pickPosition 可穿越模型/瓦片直达地表
    let pos = v.scene.pickPosition(e.position)
    if (!Cesium.defined(pos)) {
      const ray = v.camera.getPickRay(e.position)
      pos = v.scene.globe.pick(ray, v.scene)
    }
    if (!Cesium.defined(pos)) { setStatus('无效位置，请重试', 'error'); return }

    const c = Cesium.Cartographic.fromCartesian(pos)
    const lng = Cesium.Math.toDegrees(c.longitude)
    const lat = Cesium.Math.toDegrees(c.latitude)

    if (type === 'start') {
      setStartPt(lng, lat)
      startLng.value = lng.toFixed(6); startLat.value = lat.toFixed(6)
    } else {
      setEndPt(lng, lat)
      endLng.value = lng.toFixed(6); endLat.value = lat.toFixed(6)
    }
    destroyPickHandler()
    setStatus(`${type === 'start' ? '起点' : '终点'}已设置`, 'success')
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function setFromInput(type) {
  const lng = parseFloat(type === 'start' ? startLng.value : endLng.value)
  const lat = parseFloat(type === 'start' ? startLat.value : endLat.value)
  if (isNaN(lng) || isNaN(lat)) { setStatus('坐标无效', 'error'); return }
  if (type === 'start') setStartPt(lng, lat); else setEndPt(lng, lat)
  setStatus(`${type === 'start' ? '起点' : '终点'}已设置`, 'success')
}

function setStartPt(lng, lat) {
  startPoint.value = [lng, lat]
  updateMarker('start', [lng, lat], '起点', cesiumHelpers.COLORS.CYAN)
}
function setEndPt(lng, lat) {
  endPoint.value = [lng, lat]
  updateMarker('end', [lng, lat], '终点', cesiumHelpers.COLORS.AMBER)
}

function updateMarker(type, coord, label, color) {
  const v = viewer.value; if (!v) return
  const ex = markers.find(m => m.type === type)
  if (ex) { v.entities.remove(ex.entity); markers = markers.filter(m => m !== ex) }
  const entity = v.entities.add(
    cesiumHelpers.createPointEntity(Cesium.Cartesian3.fromDegrees(coord[0], coord[1]), label, color, { pixelSize: 16 }),
  )
  markers.push({ type, entity })
}

async function calculateRoute() {
  const v = viewer.value
  if (!v || !startPoint.value || !endPoint.value || computing.value) return

  computing.value = true
  setStatus('正在计算路径…', 'warning')
  try {
    // 路线始终转为 WGS-84，与 marker 同一坐标系，确保相连
    const route = await routeService.fetchDrivingRoute(startPoint.value, endPoint.value)
    routeResult.value = route

    if (routeEntity) v.entities.remove(routeEntity)

    // 渲染路径线
    const allPos = route.steps.flatMap(s =>
      s.polyline.map(([lng, lat]) => Cesium.Cartesian3.fromDegrees(lng, lat)),
    )
    if (!allPos.length) { setStatus('路径数据为空', 'error'); return }

    const labelPos = allPos[Math.floor(allPos.length / 2)]
    routeEntity = v.entities.add({
      polyline: {
        positions: allPos,
        width: 7,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: cesiumHelpers.COLORS.CYAN }),
        clampToGround: true,
      },
      ...(labelPos ? {
        label: {
          text: `${(route.distance / 1000).toFixed(1)} 公里`,
          font: '14px sans-serif',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: new Cesium.Color(0.06, 0.11, 0.20, 0.85),
          pixelOffset: new Cesium.Cartesian2(0, 18),
          position: labelPos,
        },
      } : {}),
    })

    v.flyTo(routeEntity)
    setStatus('路径计算完成', 'success')
    ElMessage.success(`${(route.distance / 1000).toFixed(1)} 公里，约 ${Math.ceil(route.duration / 60)} 分钟`)
  } catch (err) {
    if (err.name === 'AbortError') return
    setStatus(err.message, 'error')
  } finally {
    computing.value = false
  }
}

function clearAll() {
  const v = viewer.value
  if (v) {
    markers.forEach(m => { try { v.entities.remove(m.entity) } catch (_) {} })
    if (routeEntity) { try { v.entities.remove(routeEntity) } catch (_) {} }
  }
  markers = []
  routeEntity = null
  startPoint.value = null; endPoint.value = null
  routeResult.value = null
  startLng.value = ''; startLat.value = ''; endLng.value = ''; endLat.value = ''
  destroyPickHandler()
  setStatus('')
}

onUnmounted(() => { routeService.cancel(); clearAll() })
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
  font-size: 11px;
  color: #62758a;
  margin-top: 4px;
}
</style>
