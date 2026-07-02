import * as Cesium from 'cesium'
import { useViewerStore } from '@stores/viewer'

/**
 * 影像图层管理 — 基于 Cesium 1.142 API
 * 支持 Cesium 全球影像、高德卫星影像、腾讯卫星影像三种底图
 */
export function useImagery() {
  const store = useViewerStore()

  /** 安全获取 Viewer 实例，未就绪时返回 null */
  function _viewer() {
    const v = store.viewer
    if (!v) { console.warn('[影像] Viewer 未就绪'); return null }
    return v
  }

  /** 替换所有影像图层，成功返回 true，失败返回 false */
  async function switchImagery(type) {
    console.log(`[影像] 请求切换: "${type}"`)
    const v = _viewer()
    if (!v) return false

    try {
      let provider
      switch (type) {
        case 'cesium':
          // Cesium 1.142: createWorldImagery 已移除，使用 createWorldImageryAsync
          console.log('[影像] 创建 Cesium 全球影像')
          provider = await Cesium.createWorldImageryAsync({
            style: Cesium.IonWorldImageryStyle.AERIAL,
          })
          break
        case 'gaode':
          // 高德卫星影像（URL 模板，无需 token）
          console.log('[影像] 创建高德卫星影像')
          provider = new Cesium.UrlTemplateImageryProvider({
            url: 'https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
            minimumLevel: 3,
            maximumLevel: 18,
          })
          break
        case 'tencent':
          // 腾讯卫星影像（URL 模板，含自定义 tags）
          console.log('[影像] 创建腾讯卫星影像')
          provider = new Cesium.UrlTemplateImageryProvider({
            url: 'https://p2.map.gtimg.com/sateTiles/{z}/{sx}/{sy}/{x}_{reverseY}.jpg?version=400',
            customTags: {
              sx: (_, x) => x >> 4,
              sy: (_, __, y, level) => ((1 << level) - y) >> 4,
            },
          })
          break
        default:
          console.warn(`[影像] 未知类型: "${type}"`)
          return false
      }

      if (!provider) { console.error('[影像] provider 创建失败'); return false }

      const before = v.imageryLayers.length
      v.imageryLayers.removeAll()
      console.log(`[影像] 已移除 ${before} 个图层`)

      v.imageryLayers.addImageryProvider(provider)
      console.log(`[影像] 切换 "${type}" 完成，当前图层数: ${v.imageryLayers.length}`)
      return true
    } catch (err) {
      console.error(`[影像] 切换 "${type}" 异常:`, err)
      return false
    }
  }

  return { switchImagery }
}

/**
 * 地形管理 — 基于 Cesium 1.142 API
 * 支持 Cesium 全球地形、ArcGIS 高程服务、扁平地球三种模式
 */
export function useTerrain() {
  const store = useViewerStore()

  /** 安全获取 Viewer 实例，未就绪时返回 null */
  function _viewer() {
    const v = store.viewer
    if (!v) { console.warn('[地形] Viewer 未就绪'); return null }
    return v
  }

  /** 切换地形数据源，成功返回 true，失败返回 false */
  async function switchTerrain(type) {
    console.log(`[地形] 请求切换: "${type}"`)
    const v = _viewer()
    if (!v) return false

    try {
      let provider
      switch (type) {
        case 'cesium':
          // Cesium 1.142: createWorldTerrain 已移除，使用 createWorldTerrainAsync
          console.log('[地形] 创建 Cesium 全球地形')
          provider = await Cesium.createWorldTerrainAsync({
            requestVertexNormals: true,
            requestWaterMask: true,
          })
          break
        case 'arcgis':
          // ArcGIS 全球高程服务（无需 Cesium Ion Token）
          console.log('[地形] 创建 ArcGIS 地形')
          provider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
          )
          break
        case 'none':
          // 扁平地球（无地形起伏）
          console.log('[地形] 创建扁平地球')
          provider = new Cesium.EllipsoidTerrainProvider()
          break
        default:
          console.warn(`[地形] 未知类型: "${type}"`)
          return false
      }

      if (!provider) { console.error('[地形] provider 创建失败'); return false }

      // ---- 防御：地形热切换时暂停 globe 渲染，避免 TileAvailability 空指针 ----
      v.scene.globe.show = false
      v.terrainProvider = provider
      // 等待一帧让内部状态重建
      await new Promise(r => requestAnimationFrame(r))
      v.scene.globe.show = true

      console.log(`[地形] 切换 "${type}" 完成`)
      return true
    } catch (err) {
      console.error(`[地形] 切换 "${type}" 异常:`, err)
      return false
    }
  }

  return { switchTerrain }
}
