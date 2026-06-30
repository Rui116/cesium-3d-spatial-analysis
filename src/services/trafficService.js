import { CoordinateConverter } from '@composables/useCoordinate'

/* ---- 配置 ---- */
const TRAFFIC_API      = 'https://restapi.amap.com/v3/traffic/status/rectangle'
const TRAFFIC_ROAD_API = 'https://restapi.amap.com/v3/traffic/status/road'
const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || 'c8a477afca7961ba820499ccc193d2ad'
const AMAP_JSCode = import.meta.env.VITE_AMAP_JSCode || ''
const MAX_DIAGONAL_M = 10_000   // 高德限制：矩形对角线 ≤ 10 km
const MAX_RETRY = 2
const CACHE_TTL = 300_000       // 5 min

/* ---- 错误码映射 ---- */
const ERR_MSG = {
  INVALID_USER_KEY:        'API Key 无效或未开通 Web 服务权限',
  INVALID_USER_IP:         '当前 IP 不在白名单中',
  INVALID_PARAMS:          '请求参数不合法（坐标范围或格式有误）',
  INSUFFICIENT_PRIVILEGES: 'Key 未开通交通态势服务',
  OVER_DAILY_LIMIT:        '今日调用配额已用完',
  OVER_QPS_LIMIT:          '调用频率过高，请稍后重试',
}

class TrafficAPIError extends Error {
  constructor(message, status = null, code = null) {
    super(message)
    this.name = 'TrafficAPIError'
    this.status = status
    this.code = code
  }
}

export class TrafficService {
  #controller = null
  #cache = new Map()

  constructor(opts = {}) {
    this.apiKey = opts.apiKey || AMAP_KEY
    this.jscode = opts.jscode || AMAP_JSCode
  }

  cancel() { this.#controller?.abort(); this.#controller = null }
  clearCache() { this.#cache.clear() }

  /**
   * 获取矩形区域交通态势。若对角线超过 10 km 则自动拆分并发查询。
   * @param {number[]} bbox - WGS-84 [west, south, east, north]
   * @param {{ keepGcj02?: boolean }} [opts]
   *   keepGcj02 — 保留 GCJ-02 坐标不转 WGS-84（用于高德/腾讯影像底图）
   * @returns {Promise<Array>} 道路数据数组
   */
  async fetchTrafficByBBox(bbox, opts = {}) {
    this.#validateBBox(bbox)
    this.cancel()

    // 拆分超限矩形
    const subs = this.#splitBBox(bbox)
    const results = await this.#batchFetch(subs, bbox, opts)
    return results
  }

  /* ---- 道路名查询 ---- */

  /**
   * 指定道路名称查询交通态势。
   * @param {string} roadName - 道路名称（如 "中关村大街"）
   * @param {string} [city] - 城市名称（如 "北京"），可选但建议传
   * @param {{ keepGcj02?: boolean }} [opts]
   * @returns {Promise<Array>}
   */
  async fetchTrafficByRoad(roadName, city = '', opts = {}) {
    if (!roadName || !roadName.trim()) {
      throw new TrafficAPIError('道路名称不能为空')
    }
    if (!city || !city.trim()) {
      throw new TrafficAPIError('道路名查询必须提供城市名称（如：北京），用于缩小搜索范围')
    }
    this.cancel()

    const qs = new URLSearchParams()
    qs.append('key', this.apiKey)
    qs.append('name', roadName.trim())          // 参数名是 name，不是 road
    qs.append('city', city.trim())              // city 必传（与 adcode 二选一）
    qs.append('extensions', 'all')
    qs.append('output', 'JSON')
    qs.append('level', '6')                     // road 端点支持 level
    if (this.jscode) qs.append('jscode', this.jscode)

    const url = `${TRAFFIC_ROAD_API}?${qs.toString()}`

    let lastErr
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      this.#controller = new AbortController()
      const tid = setTimeout(() => this.#controller.abort(), 12_000)
      try {
        const res = await fetch(url, { signal: this.#controller.signal })
        clearTimeout(tid)
        if (!res.ok) throw new TrafficAPIError(`HTTP ${res.status}`, res.status)

        const data = await res.json()
        if (data.status !== '1') {
          const msg = ERR_MSG[data.info] || data.info || '未知错误'
          throw new TrafficAPIError(`${msg}（${data.info || ''} / ${data.infocode || ''}）`, null, data.info)
        }

        return this.#parse(data, opts)
      } catch (err) {
        clearTimeout(tid)
        if (err.name === 'AbortError') throw new TrafficAPIError('请求已取消')
        if (err instanceof TrafficAPIError && err.status && err.status >= 400 && err.status < 500) throw err
        lastErr = err
        if (attempt < MAX_RETRY) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
    }
    throw lastErr || new TrafficAPIError('请求失败')
  }

  /** 计算 bbox 对角线长度（米），供 UI 层实时展示 */
  static diagonalMeters(bbox) {
    const [w, s, e, n] = bbox
    const midLat = (s + n) / 2
    const degToM = 111_320 * Math.cos((midLat * Math.PI) / 180)
    const dx = Math.abs(e - w) * degToM
    const dy = Math.abs(n - s) * 111_320
    return Math.sqrt(dx * dx + dy * dy)
  }

  /* ================================================================
   *  Private — 请求
   * ================================================================ */

  /** 批次并发查询（带缓存、重试、取消） */
  async #batchFetch(bboxes, originalBBox, opts = {}) {
    const cacheKey = this.#cacheKey(originalBBox || bboxes[0]) + (opts.keepGcj02 ? ':gcj' : '')
    const cached = this.#cache.get(cacheKey)
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data

    // 并发请求（限制 4 路）
    const results = []
    for (let i = 0; i < bboxes.length; i += 4) {
      const batch = bboxes.slice(i, i + 4)
      const batchResults = await Promise.allSettled(
        batch.map(b => this.#requestSingle(b, opts)),
      )
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(...r.value)
      }
    }

    // 去重（按 road.id）
    const seen = new Set()
    const deduped = results.filter(r => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })

    this.#cache.set(cacheKey, { data: deduped, time: Date.now() })
    return deduped
  }

  /** 单次 API 请求（含重试） */
  async #requestSingle(bbox, opts = {}) {
    const [w, s, e, n] = bbox
    const [gcjW, gcjS] = CoordinateConverter.wgs84ToGcj02(w, s)
    const [gcjE, gcjN] = CoordinateConverter.wgs84ToGcj02(e, n)

    const qs = new URLSearchParams()
    qs.append('key', this.apiKey)
    qs.append('rectangle', `${gcjW.toFixed(6)},${gcjS.toFixed(6)};${gcjE.toFixed(6)},${gcjN.toFixed(6)}`)
    qs.append('extensions', 'all')
    qs.append('output', 'JSON')
    // level 为包含关系：选 6 返回 1~6 全部等级（含无名道路）
    qs.append('level', '6')
    if (this.jscode) qs.append('jscode', this.jscode)
    const url = `${TRAFFIC_API}?${qs.toString()}`

    let lastErr
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      this.#controller = new AbortController()
      const tid = setTimeout(() => this.#controller.abort(), 12_000)
      try {
        const res = await fetch(url, { signal: this.#controller.signal })
        clearTimeout(tid)
        if (!res.ok) throw new TrafficAPIError(`HTTP ${res.status}`, res.status)

        const data = await res.json()
        if (data.status !== '1') {
          const msg = ERR_MSG[data.info] || data.info || '未知错误'
          throw new TrafficAPIError(`${msg}（${data.info || ''} / ${data.infocode || ''}）`, null, data.info)
        }

        return this.#parse(data, opts)
      } catch (err) {
        clearTimeout(tid)
        if (err.name === 'AbortError') throw new TrafficAPIError('请求已取消')
        if (err instanceof TrafficAPIError && err.status && err.status >= 400 && err.status < 500) throw err
        lastErr = err
        if (attempt < MAX_RETRY) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
    }
    throw lastErr || new TrafficAPIError('请求失败')
  }

  /* ================================================================
   *  Private — 数据解析
   * ================================================================ */

  #parse(data, opts = {}) {
    if (!data?.trafficinfo?.roads) return []
    const convert = !opts.keepGcj02  // 使用 GCJ-02 影像底图时跳过坐标转换
    return data.trafficinfo.roads
      .map(r => {
        const coords = (r.polyline || '').split(';')
          .map(p => {
            const [lon, lat] = p.split(',').map(Number)
            if (isNaN(lon) || isNaN(lat)) return null
            if (convert) {
              const [wgsLon, wgsLat] = CoordinateConverter.gcj02ToWgs84(lon, lat)
              return [wgsLon, wgsLat]
            }
            return [lon, lat]  // keep GCJ-02
          })
          .filter(Boolean)
        if (!coords.length) return null
        return {
          id: r.id || '',
          name: r.name || '未知道路',
          status: STATUS_MAP[r.status] || '未知',
          speed: parseFloat(r.speed) || 0,
          direction: r.direction || '',
          coordinates: coords,
        }
      })
      .filter(Boolean)
  }

  /* ================================================================
   *  Private — 校验 & 拆分
   * ================================================================ */

  #validateBBox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      throw new TrafficAPIError('参数格式无效')
    }
    const [w, s, e, n] = bbox
    if ([w, s, e, n].some(v => v == null || isNaN(v))) {
      throw new TrafficAPIError('坐标包含无效值')
    }
    if (w < -180 || w > 180 || e < -180 || e > 180 || s < -90 || s > 90 || n < -90 || n > 90) {
      throw new TrafficAPIError('坐标超出有效范围')
    }
    if (w >= e || s >= n) {
      throw new TrafficAPIError('坐标顺序错误（west ≥ east 或 south ≥ north）')
    }
  }

  /**
   * 将超大矩形沿长边方向二等分，直到所有子矩形对角线 ≤ 10 km。
   * 最多拆分 2 层（4 块），超出仍会报错。
   */
  #splitBBox(bbox) {
    const queue = [bbox]
    const result = []
    const maxDepth = 2  // 最多拆到 4 块
    let depth = 0

    while (queue.length && result.length < 1 << maxDepth) {
      const [w, s, e, n] = queue.shift()
      const d = this.#diagonal(w, s, e, n)
      if (d <= MAX_DIAGONAL_M) {
        result.push([w, s, e, n])
        continue
      }
      if (depth >= maxDepth) {
        throw new TrafficAPIError(
          `查询范围过大（对角线约 ${(d / 1000).toFixed(1)} km），请缩小到 10 km 以内`,
        )
      }
      // 沿较长边二分
      const dx = Math.abs(e - w)
      const dy = Math.abs(n - s)
      if (dx >= dy) {
        const mid = (w + e) / 2
        queue.push([w, s, mid, n], [mid, s, e, n])
      } else {
        const mid = (s + n) / 2
        queue.push([w, s, e, mid], [w, mid, e, n])
      }
      depth++
    }
    return result
  }

  #diagonal(w, s, e, n) {
    const midLat = (s + n) / 2
    const degToM = 111_320 * Math.cos((midLat * Math.PI) / 180)
    const dx = Math.abs(e - w) * degToM
    const dy = Math.abs(n - s) * 111_320
    return Math.sqrt(dx * dx + dy * dy)
  }

  #cacheKey(bbox) {
    return bbox.map(v => +v.toFixed(4)).join(',')
  }
}

// 高德交通态势状态码映射：0=未知 1=畅通 2=缓行 3=拥堵 4=严重拥堵
const STATUS_MAP = { '0': '未知', '1': '畅通', '2': '缓行', '3': '拥堵', '4': '严重拥堵' }
