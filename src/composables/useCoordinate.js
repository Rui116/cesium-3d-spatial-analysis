import * as Cesium from 'cesium'
import { useViewer } from './useCesium'

/* ================================================================== */
/*  坐标组合式函数 — 拾取、转换、格式化                                */
/* ================================================================== */

export function useCoordinate() {
  const { viewer } = useViewer()

  /** 十进制度数 → 度分秒字符串 */
  function toDMS(degree, isLon) {
    if (degree == null || isNaN(degree)) return '--'
    const dir = isLon ? (degree >= 0 ? 'E' : 'W') : (degree >= 0 ? 'N' : 'S')
    const abs = Math.abs(degree)
    const d = Math.floor(abs)
    const m = Math.floor((abs - d) * 60)
    const s = ((abs - d - m / 60) * 3600).toFixed(2)
    return `${d}°${m}'${s}"${dir}`
  }

  /**
   * 从屏幕坐标拾取地理坐标。
   * 返回 { cartesian, longitude, latitude, height } 或 null。
   */
  function pickPosition(screenPosition) {
    const v = viewer.value
    if (!v || !screenPosition) return null
    try {
      const ray = v.camera.getPickRay(screenPosition)
      if (!ray) return null
      const cartesian = v.scene.globe.pick(ray, v.scene)
      if (!Cesium.defined(cartesian)) return null
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      return {
        cartesian,
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height,
      }
    } catch (_) {
      return null
    }
  }

  /** 经纬度 → Cartesian3 */
  function fromDegrees(lon, lat, height = 0) {
    return Cesium.Cartesian3.fromDegrees(lon, lat, height)
  }

  /** [lon,lat] 对数组 → Cartesian3 数组 */
  function fromDegreesArray(coords) {
    return Cesium.Cartesian3.fromDegreesArray(coords.flat())
  }

  /** [west,south,east,north] → 矩形包围盒 */
  function toRectangle(bbox) {
    return Cesium.Rectangle.fromDegrees(...bbox)
  }

  return { toDMS, pickPosition, fromDegrees, fromDegreesArray, toRectangle }
}

/* ================================================================== */
/*  CoordinateConverter — GCJ-02 ↔ WGS-84 坐标转换（静态工具类）      */
/* ================================================================== */

export class CoordinateConverter {
  static #PI = Math.PI
  static #A = 6378245.0
  static #EE = 0.00669342162296594323

  static #transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
    ret += (20.0 * Math.sin(6.0 * x * this.#PI) + 20.0 * Math.sin(2.0 * x * this.#PI)) * 2.0 / 3.0
    ret += (20.0 * Math.sin(y * this.#PI) + 40.0 * Math.sin(y / 3.0 * this.#PI)) * 2.0 / 3.0
    ret += (160.0 * Math.sin(y / 12.0 * this.#PI) + 320 * Math.sin(y * this.#PI / 30.0)) * 2.0 / 3.0
    return ret
  }

  static #transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
    ret += (20.0 * Math.sin(6.0 * x * this.#PI) + 20.0 * Math.sin(2.0 * x * this.#PI)) * 2.0 / 3.0
    ret += (20.0 * Math.sin(x * this.#PI) + 40.0 * Math.sin(x / 3.0 * this.#PI)) * 2.0 / 3.0
    ret += (150.0 * Math.sin(x / 12.0 * this.#PI) + 300.0 * Math.sin(x / 30.0 * this.#PI)) * 2.0 / 3.0
    return ret
  }

  static #outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
  }

  /** 公开方法 — 检查 (lng, lat) 是否在中国境外 */
  static isOutOfChina(lng, lat) {
    return CoordinateConverter.#outOfChina(lng, lat)
  }

  /** WGS-84 → GCJ-02 正向转换，返回 [lng, lat] */
  static wgs84ToGcj02(lng, lat) {
    if (this.#outOfChina(lng, lat)) return [lng, lat]
    const dLat = this.#transformLat(lng - 105.0, lat - 35.0)
    const dLng = this.#transformLng(lng - 105.0, lat - 35.0)
    const radLat = lat / 180.0 * this.#PI
    const magic = Math.sin(radLat)
    const sqrtMagic = Math.sqrt(1 - this.#EE * magic * magic)
    const newLat = lat + (dLat * 180.0) / (this.#A * (1 - this.#EE) / (magic * sqrtMagic) * this.#PI)
    const newLng = lng + (dLng * 180.0) / (this.#A / sqrtMagic * Math.cos(radLat) * this.#PI)
    return [newLng, newLat]
  }

  /** GCJ-02 → WGS-84 逆向转换（迭代相减法），返回 [lng, lat] */
  static gcj02ToWgs84(lng, lat) {
    if (this.#outOfChina(lng, lat)) return [lng, lat]
    const dLat = this.#transformLat(lng - 105.0, lat - 35.0)
    const dLng = this.#transformLng(lng - 105.0, lat - 35.0)
    const radLat = lat / 180.0 * this.#PI
    const magic = Math.sin(radLat)
    const sqrtMagic = Math.sqrt(1 - this.#EE * magic * magic)
    const newLat = lat + (dLat * 180.0) / (this.#A * (1 - this.#EE) / (magic * sqrtMagic) * this.#PI)
    const newLng = lng + (dLng * 180.0) / (this.#A / sqrtMagic * Math.cos(radLat) * this.#PI)
    return [lng * 2 - newLng, lat * 2 - newLat]
  }
}
