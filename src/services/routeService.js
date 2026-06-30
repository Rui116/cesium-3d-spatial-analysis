import { CoordinateConverter } from '@composables/useCoordinate'

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY
const ROUTE_API = 'https://restapi.amap.com/v3/direction/driving'

/* ---- 错误码映射 ---- */
const ERR_MSG = {
  INVALID_USER_KEY: 'API Key 无效或未开通 Web 服务权限',
  INVALID_USER_IP:  '当前 IP 不在白名单中',
  INVALID_PARAMS:   '请求参数不合法',
  INSUFFICIENT_PRIVILEGES: 'Key 未开通路径规划服务',
  OVER_DAILY_LIMIT: '今日调用配额已用完',
  OVER_QPS_LIMIT:   '调用频率过高，请稍后重试',
}

class RouteAPIError extends Error {
  constructor(message, code = null) {
    super(message)
    this.name = 'RouteAPIError'
    this.code = code
  }
}

export class RouteService {
  #controller = null

  constructor(apiKey = AMAP_KEY) {
    this.apiKey = apiKey
    this.timeout = 15_000
    this.maxRetry = 2
  }

  cancel() { this.#controller?.abort(); this.#controller = null }

  /**
   * 获取驾车路径（含重试）。
   * @param {number[]} origin - WGS-84 [lng, lat]
   * @param {number[]} destination - WGS-84 [lng, lat]
   * @param {{ strategy?: string, waypoints?: number[][], keepGcj02?: boolean }} [opts]
   */
  async fetchDrivingRoute(origin, destination, opts = {}) {
    this.cancel()

    // WGS-84 → GCJ-02（高德 API 要求 GCJ-02）
    const [oGcjLng, oGcjLat] = CoordinateConverter.wgs84ToGcj02(origin[0], origin[1])
    const [dGcjLng, dGcjLat] = CoordinateConverter.wgs84ToGcj02(destination[0], destination[1])

    // 手动构建 URL
    let url = `${ROUTE_API}?key=${encodeURIComponent(this.apiKey)}`
    url += `&origin=${oGcjLng.toFixed(6)},${oGcjLat.toFixed(6)}`
    url += `&destination=${dGcjLng.toFixed(6)},${dGcjLat.toFixed(6)}`
    url += `&strategy=${opts.strategy ?? '0'}`
    url += `&extensions=all&output=JSON`

    if (opts.waypoints?.length) {
      const wp = opts.waypoints.map(w => {
        const [wLng, wLat] = CoordinateConverter.wgs84ToGcj02(w[0], w[1])
        return `${wLng.toFixed(6)},${wLat.toFixed(6)}`
      }).join(';')
      url += `&waypoints=${wp}`
    }

    let lastErr
    for (let attempt = 0; attempt <= this.maxRetry; attempt++) {
      this.#controller = new AbortController()
      const tid = setTimeout(() => this.#controller.abort(), this.timeout)

      try {
        const res = await fetch(url, { signal: this.#controller.signal })
        clearTimeout(tid)

        if (!res.ok) throw new RouteAPIError(`HTTP ${res.status}`, res.status)

        const data = await res.json()
        if (data.status !== '1') {
          const msg = ERR_MSG[data.info] || data.info || '未知错误'
          throw new RouteAPIError(`${msg}（${data.info || ''} / ${data.infocode || ''}）`, data.info)
        }
        if (!data.route?.paths?.length) throw new RouteAPIError('未找到可行路径，请调整起终点后重试')

        return this.#normalizeRoute(data.route.paths[0], opts.keepGcj02)
      } catch (err) {
        clearTimeout(tid)
        lastErr = err
        if (err.name === 'AbortError') throw new RouteAPIError('请求已取消')
        if (err instanceof RouteAPIError && err.status && err.status >= 400 && err.status < 500) throw err
        if (attempt === this.maxRetry) break
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
    throw lastErr || new RouteAPIError('网络异常，请检查网络后重试')
  }

  /* ---- 私有方法 ---- */

  /** 标准化路径数据格式，默认将 GCJ-02 坐标转回 WGS-84 */
  #normalizeRoute(route, keepGcj02 = false) {
    const convert = !keepGcj02
    return {
      distance: parseFloat(route.distance) || 0,
      duration: parseFloat(route.duration) || 0,
      strategy: route.strategy,
      tolls: parseFloat(route.tolls) || 0,
      trafficLightCount: parseInt(route.traffic_lights) || 0,
      steps: (route.steps || []).map(step => ({
        instruction: step.instruction || '',
        road: step.road || '',
        distance: parseFloat(step.distance) || 0,
        duration: parseFloat(step.duration) || 0,
        polyline: (step.polyline || '').split(';').map(p => {
          const [lng, lat] = p.split(',').map(Number)
          if (isNaN(lng) || isNaN(lat)) return [0, 0]
          if (convert) {
            const [wgsLng, wgsLat] = CoordinateConverter.gcj02ToWgs84(lng, lat)
            return [wgsLng, wgsLat]
          }
          return [lng, lat]
        }),
      })),
    }
  }
}
