/**
 * 坐标相关单元测试
 *
 * 覆盖：
 *   1. CoordinateConverter — WGS-84 ↔ GCJ-02 转换
 *   2. toDMS — 十进制度 → 度分秒格式化
 *
 * 被测文件：src/composables/useCoordinate.js
 */

import { describe, test, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Cesium 是 src/composables/useCoordinate.js 顶层的同步 import，
// CoordinateConverter 本身不依赖它，但文件加载时会执行 import。
// 提供一个最小 mock 即可。
// ---------------------------------------------------------------------------
vi.mock('cesium', () => ({}))

// useCesium composable — toDMS 所在函数通过 useViewer() 获取 viewer，
// toDMS 本身不使用 viewer，但调用 useCoordinate() 会触发 useViewer()。
vi.mock('@composables/useCesium', () => ({
  useViewer: () => ({ viewer: { value: null } }),
}))

// ---- 被测模块 --------------------------------------------------------------
import { CoordinateConverter, useCoordinate } from '@composables/useCoordinate'

// ===========================================================================
//  CoordinateConverter 测试
// ===========================================================================

describe('CoordinateConverter', () => {
  // ---- isOutOfChina -------------------------------------------------------
  describe('isOutOfChina', () => {
    test('北京（116.397°E, 39.909°N）在中国境内', () => {
      expect(CoordinateConverter.isOutOfChina(116.397428, 39.90923)).toBe(false)
    })

    test('上海（121.473°E, 31.230°N）在中国境内', () => {
      expect(CoordinateConverter.isOutOfChina(121.473701, 31.230416)).toBe(false)
    })

    test('乌鲁木齐（87.617°E, 43.793°N）在中国境内', () => {
      expect(CoordinateConverter.isOutOfChina(87.617733, 43.792818)).toBe(false)
    })

    test('漠河（122.373°E, 53.480°N）在中国境内（靠近北边界）', () => {
      expect(CoordinateConverter.isOutOfChina(122.373, 53.48)).toBe(false)
    })

    test('东京（139.692°E, 35.690°N）在中国境外', () => {
      expect(CoordinateConverter.isOutOfChina(139.6917, 35.6895)).toBe(true)
    })

    test('纽约（-74.006°W, 40.714°N）在中国境外', () => {
      expect(CoordinateConverter.isOutOfChina(-74.006, 40.714)).toBe(true)
    })

    test('经度略低于 72.004 边界 → 境外', () => {
      expect(CoordinateConverter.isOutOfChina(72.003, 39)).toBe(true)
    })

    test('经度略高于 137.8347 边界 → 境外', () => {
      expect(CoordinateConverter.isOutOfChina(137.835, 39)).toBe(true)
    })

    test('纬度略低于 0.8293 边界 → 境外', () => {
      expect(CoordinateConverter.isOutOfChina(110, 0.829)).toBe(true)
    })

    test('纬度略高于 55.8271 边界 → 境外', () => {
      expect(CoordinateConverter.isOutOfChina(110, 55.828)).toBe(true)
    })
  })

  // ---- wgs84ToGcj02 -------------------------------------------------------
  describe('wgs84ToGcj02', () => {
    test('北京坐标转换后产生偏移（GCJ-02 在国内有约 100-700m 偏移）', () => {
      const [lng, lat] = CoordinateConverter.wgs84ToGcj02(116.397428, 39.90923)

      // 偏移量大约在 0.003-0.015 度之间
      const dlng = Math.abs(lng - 116.397428)
      const dlat = Math.abs(lat - 39.90923)

      expect(dlng).toBeGreaterThan(0.003)
      expect(dlng).toBeLessThan(0.02)
      expect(dlat).toBeGreaterThan(0.0005)
      expect(dlat).toBeLessThan(0.015)
    })

    test('上海坐标转换后产生偏移', () => {
      const [lng, lat] = CoordinateConverter.wgs84ToGcj02(121.473701, 31.230416)

      // GCJ-02 偏移通常在 0.003°–0.015° 级别
      const dlng = Math.abs(lng - 121.473701)
      const dlat = Math.abs(lat - 31.230416)
      expect(dlng).toBeGreaterThan(0.003)
      expect(dlat).toBeGreaterThan(0.0005)
    })

    test('境外坐标（东京）转换后原样返回', () => {
      const [lng, lat] = CoordinateConverter.wgs84ToGcj02(139.6917, 35.6895)
      expect(lng).toBe(139.6917)
      expect(lat).toBe(35.6895)
    })

    test('境外坐标（纽约）转换后原样返回', () => {
      const [lng, lat] = CoordinateConverter.wgs84ToGcj02(-74.006, 40.714)
      expect(lng).toBe(-74.006)
      expect(lat).toBe(40.714)
    })

    test('零坐标（0°,0°）在境外，原样返回', () => {
      const [lng, lat] = CoordinateConverter.wgs84ToGcj02(0, 0)
      expect(lng).toBe(0)
      expect(lat).toBe(0)
    })
  })

  // ---- gcj02ToWgs84 -------------------------------------------------------
  describe('gcj02ToWgs84', () => {
    test('WGS-84 → GCJ-02 → WGS-84 往返精度在 1 米以内（北京）', () => {
      const wgs = [116.397428, 39.90923]
      const gcj = CoordinateConverter.wgs84ToGcj02(...wgs)
      const back = CoordinateConverter.gcj02ToWgs84(...gcj)

      // 往返精度 ≤ 0.00001° ≈ 1 米
      expect(back[0]).toBeCloseTo(wgs[0], 4)
      expect(back[1]).toBeCloseTo(wgs[1], 4)
    })

    test('WGS-84 → GCJ-02 → WGS-84 往返精度在 1 米以内（上海）', () => {
      const wgs = [121.473701, 31.230416]
      const gcj = CoordinateConverter.wgs84ToGcj02(...wgs)
      const back = CoordinateConverter.gcj02ToWgs84(...gcj)

      expect(back[0]).toBeCloseTo(wgs[0], 4)
      expect(back[1]).toBeCloseTo(wgs[1], 4)
    })

    test('WGS-84 → GCJ-02 → WGS-84 往返精度在 1 米以内（乌鲁木齐）', () => {
      const wgs = [87.617733, 43.792818]
      const gcj = CoordinateConverter.wgs84ToGcj02(...wgs)
      const back = CoordinateConverter.gcj02ToWgs84(...gcj)

      expect(back[0]).toBeCloseTo(wgs[0], 4)
      expect(back[1]).toBeCloseTo(wgs[1], 4)
    })

    test('境外坐标反向转换也原样返回', () => {
      const [lng, lat] = CoordinateConverter.gcj02ToWgs84(139.6917, 35.6895)
      expect(lng).toBe(139.6917)
      expect(lat).toBe(35.6895)
    })
  })
})

// ===========================================================================
//  toDMS 测试
// ===========================================================================

describe('toDMS', () => {
  // toDMS 是 useCoordinate() 返回的内部函数，需实例化 composable
  const { toDMS } = useCoordinate()

  describe('十进制度 → 度分秒字符串', () => {
    test('正整数经度 → East', () => {
      const result = toDMS(116.397428, true)
      expect(result).toContain('116°')
      expect(result).toContain('E')
      expect(result).not.toContain('W')
    })

    test('负经度 → West', () => {
      const result = toDMS(-74.006, true)
      expect(result).toContain('W')
      expect(result).not.toContain('E')
    })

    test('正纬度 → North', () => {
      const result = toDMS(39.90923, false)
      expect(result).toContain('39°')
      expect(result).toContain('N')
      expect(result).not.toContain('S')
    })

    test('负纬度 → South', () => {
      const result = toDMS(-33.8688, false)
      expect(result).toContain('S')
      expect(result).not.toContain('N')
    })

    test('输出格式包含分和秒', () => {
      const result = toDMS(116.5, true)
      // 116.5° = 116°30'0.00"
      expect(result).toMatch(/^\d+°\d+'\d+\.\d{2}"/)
    })

    test('null 返回占位符', () => {
      expect(toDMS(null, true)).toBe('--')
    })

    test('NaN 返回占位符', () => {
      expect(toDMS(NaN, true)).toBe('--')
    })
  })
})
