import { onMounted, onUnmounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { useViewerStore } from '@stores/viewer'
import { storeToRefs } from 'pinia'

const CESIUM_TOKEN = 'REPLACED_CESIUM_TOKEN''

/** Cesium Viewer 默认配置（关闭不需要的 UI 控件） */
const DEFAULT_VIEWER_OPTS = {
  timeline: false,
  animation: false,
  baseLayerPicker: false,
  sceneModePicker: true,
  navigationHelpButton: false,
  homeButton: true,
  geocoder: false,
  fullscreenButton: true,
  infoBox: false,
  selectionIndicator: false,
  shouldAnimate: true,
  sceneMode: Cesium.SceneMode.SCENE3D,
}

/**
 * Cesium Viewer 初始化组合式函数。
 * 挂载时创建 Viewer 实例并注入 Pinia Store，卸载时销毁并清理。
 */
export function useCesium(containerRef) {
  const viewerStore = useViewerStore()
  const isInitialized = ref(false)
  const initError = ref(null)

  onMounted(() => {
    const container = containerRef.value
    if (!container) {
      initError.value = 'Cesium container not found'
      console.error(initError.value)
      return
    }

    try {
      Cesium.Ion.defaultAccessToken = CESIUM_TOKEN

      const viewer = new Cesium.Viewer(container, DEFAULT_VIEWER_OPTS)

      viewer.scene.globe.enableLighting = true
      viewer.scene.globe.depthTestAgainstTerrain = true
      viewer.scene.globe.maximumScreenSpaceError = 2
      viewer.scene.fog.enabled = true

      if (viewer.cesiumWidget?.creditContainer) {
        viewer.cesiumWidget.creditContainer.style.display = 'none'
      }

      viewerStore.setViewer(viewer)
      isInitialized.value = true
      console.log('[Cesium] Viewer initialized — type:', typeof viewer,
        'imageryLayers:', viewer.imageryLayers?.length,
        'isDestroyed:', viewer.isDestroyed?.())
    } catch (err) {
      initError.value = err.message
      console.error('[Cesium] Init failed:', err)
      viewerStore.setError(err.message)
    }
  })

  onUnmounted(() => {
    viewerStore._trackedDataSources.forEach(ds => {
      try { viewerStore.viewer?.dataSources?.remove(ds, true) } catch (_) { /* ok */ }
    })
    viewerStore._trackedDataSources.clear()
    viewerStore.viewer?.destroy()
    viewerStore.$reset()
  })

  return { isInitialized, initError }
}

/**
 * 从 Pinia Store 获取响应式 Viewer 引用。
 * 使用 storeToRefs 保持响应式（否则 Pinia 会自动解包 ref）。
 */
export function useViewer() {
  const viewerStore = useViewerStore()
  const { viewer, isReady, isLoading, error } = storeToRefs(viewerStore)
  return { viewer, isReady, isLoading, error }
}
