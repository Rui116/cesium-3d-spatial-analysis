import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useViewerStore = defineStore('viewer', () => {
  /* ---- 状态 ---- */
  const viewer = ref(null)
  const isReady = ref(false)
  const isLoading = ref(false)
  const error = ref(null)
  const activeTool = ref('')
  const statusMessage = ref('SYS READY')
  const statusType = ref('info')

  // 影像 / 地形选择持久化（跨路由保持）
  const imageryType = ref('cesium')
  const terrainType = ref('none')

  /* ---- 内部追踪（用于清理） ---- */
  /** @type {Map<string, import('cesium').DataSource>} 已跟踪的 DataSource 映射 */
  const _trackedDataSources = new Map()

  /* ---- 操作方法 ---- */
  function setViewer(v) {
    viewer.value = v
    isReady.value = true
  }

  function setActiveTool(tool) {
    activeTool.value = tool
  }

  function setStatus(message, type = 'info') {
    statusMessage.value = message
    statusType.value = type
  }

  function setLoading(val) {
    isLoading.value = val
  }

  function setError(msg) {
    error.value = msg
    setStatus(msg, 'error')
  }

  function clearError() {
    error.value = null
  }

  return {
    viewer, isReady, isLoading, error,
    activeTool, statusMessage, statusType,
    imageryType, terrainType,
    // 内部追踪（useCesium 清理时直接访问）
    _trackedDataSources,
    // 操作方法
    setViewer, setActiveTool, setStatus, setLoading, setError, clearError,
  }
})
