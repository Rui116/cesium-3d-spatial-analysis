import * as Cesium from 'cesium'

/* ================================================================== */
/*  Cesium Entity 工厂函数 + 通用工具                                 */
/* ================================================================== */

// 预分配可复用对象，减少 GC 压力
const _scratchHPR = new Cesium.HeadingPitchRange()

export const cesiumHelpers = {
  /* ---- 颜色常量 ---- */
  COLORS: {
    CYAN:    Cesium.Color.fromCssColorString('#00e5ff'),
    GREEN:   Cesium.Color.fromCssColorString('#00e676'),
    AMBER:   Cesium.Color.fromCssColorString('#ffab00'),
    RED:     Cesium.Color.fromCssColorString('#ff5252'),
    BLUE:    Cesium.Color.fromCssColorString('#448aff'),
    WHITE:   Cesium.Color.WHITE,
    BLACK:   Cesium.Color.BLACK,
  },

  /* ---- 交通态势颜色映射 ---- */
  trafficColors: {
    '畅通':  Cesium.Color.fromCssColorString('#52c41a'),
    '缓行':  Cesium.Color.fromCssColorString('#faad14'),
    '拥堵':  Cesium.Color.fromCssColorString('#f5222d'),
    '严重拥堵': Cesium.Color.fromCssColorString('#820014'),
  },

  /**
   * 创建点标记 Entity。
   */
  createPointEntity(position, name, color, opts = {}) {
    const { pixelSize = 14, clampToGround = true } = opts
    const hRef = clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE
    return {
      name,
      position,
      point: { pixelSize, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: hRef },
      label: {
        text: name,
        font: '13px "Noto Sans SC", sans-serif',
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        fillColor: Cesium.Color.WHITE,
        heightReference: hRef,
      },
    }
  },

  /**
   * 创建折线 Entity。
   */
  createLineEntity(positions, name, color, opts = {}) {
    const { width = 3, dash = false, glow = false, clampToGround = true } = opts
    let material
    if (glow) {
      material = new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color })
    } else if (dash) {
      material = new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.7), dashLength: 10 })
    } else {
      material = new Cesium.ColorMaterialProperty(color)
    }
    return { name, polyline: { positions, width, material, clampToGround } }
  },

  /**
   * 创建多边形 Entity。
   */
  createPolygonEntity(positions, name, color, opts = {}) {
    const { alpha = 0.35, outline = true, outlineColor } = opts
    return {
      name,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color.withAlpha(alpha),
        outline,
        outlineColor: outlineColor || color,
        outlineWidth: 1.5,
        clampToGround: true,
      },
    }
  },

  /**
   * 从 bbox 创建矩形 Entity。
   */
  createRectangleEntity(bbox, name, color, opts = {}) {
    const { alpha = 0.15 } = opts
    return {
      name,
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(...bbox),
        material: color.withAlpha(alpha),
        outline: false,           // outlines unsupported on terrain-clamped geometry
      },
    }
  },

  /**
   * 安全地移除 Viewer 中的 Entity。
   * 接受单个 Entity 或数组。
   */
  removeEntities(viewer, entities) {
    if (!viewer || !entities) return
    const list = Array.isArray(entities) ? entities : [entities]
    list.forEach(e => { try { viewer.entities.remove(e) } catch (_) { /* 忽略 */ } })
  },

  /**
   * 将相机飞到由位置或 Entity 计算的包围球。
   */
  flyTo(viewer, target, scale = 2) {
    if (!viewer) return
    let bs
    if (Array.isArray(target) && target.length) {
      bs = Cesium.BoundingSphere.fromPoints(target)
    } else if (target) {
      viewer.flyTo(target, { duration: 1.5 })
      return
    }
    if (bs) {
      _scratchHPR.heading = 0
      _scratchHPR.pitch = -0.5
      _scratchHPR.range = bs.radius * scale
      viewer.camera.flyToBoundingSphere(bs, { offset: _scratchHPR, duration: 1.5 })
    }
  },

  /**
   * 创建并注册一个 CustomDataSource，返回该 dataSource。
   */
  createDataSource(viewer, name) {
    if (!viewer) return null
    const ds = new Cesium.CustomDataSource(name)
    viewer.dataSources.add(ds)
    return ds
  },

  /**
   * 安全销毁 ScreenSpaceEventHandler。
   */
  destroyHandler(handler) {
    if (handler && !handler.isDestroyed()) {
      try { handler.destroy() } catch (_) { /* 忽略 */ }
    }
  },
}
