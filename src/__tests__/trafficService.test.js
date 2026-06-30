/**
 * 交通服务 — 静态工具方法单元测试
 *
 * 覆盖：
 *   • TrafficService.diagonalMeters — 矩形对角线长度计算
 *
 * 被测文件：src/services/trafficService.js
 */

import { describe, test, expect, vi } from 'vitest'

// 模块顶层 import 会触发的依赖 mock
vi.mock('cesium', () => ({}))
vi.mock('@composables/useCesium', () => ({
  useViewer: () => ({ viewer: { value: null } }),
}))

import { TrafficService } from '@services/trafficService'

// ===========================================================================
//  diagonalMeters — 计算 bbox 对角线长度（米）
// ===========================================================================

describe('TrafficService.diagonalMeters', () => {
  test('赤道附近：1° × 1° 矩形 ≈ 157 km 对角线', () => {
    // 赤道 1° ≈ 111.32 km
    const bbox = [0, 0, 1, 1]
    const d = TrafficService.diagonalMeters(bbox)
    // 期望：sqrt((111320)^2 + (111320)^2) ≈ 157,400
    expect(d).toBeGreaterThan(150_000)
    expect(d).toBeLessThan(165_000)
  })

  test('中纬度（~39°N）：约 0.09° × 0.09° 矩形 ≈ 10km 级别', () => {
    // cos(39°) ≈ 0.777, 所以 1°经度 ≈ 111.32km * 0.777 ≈ 86.5km
    const bbox = [116.35, 39.9, 116.45, 40.0]
    const d = TrafficService.diagonalMeters(bbox)
    expect(d).toBeGreaterThan(8_000)
    expect(d).toBeLessThan(18_000)
  })

  test('高纬度（~60°N）：经度方向被压缩', () => {
    // cos(60°) = 0.5
    const bbox = [10, 60, 11, 61]
    const d = TrafficService.diagonalMeters(bbox)
    // cos(60.5°中点) ≈ 0.492, dx ≈ 54800, dy ≈ 111320 → diag ≈ 124100
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(140_000)
  })

  test('零面积矩形（点退化为矩形）', () => {
    const d = TrafficService.diagonalMeters([116.4, 39.9, 116.4, 39.9])
    expect(d).toBe(0)
  })

  test('非常小的矩形（10 米级）', () => {
    // 0.0001° ≈ 11m 在赤道
    const d = TrafficService.diagonalMeters([0, 0, 0.0001, 0.0001])
    expect(d).toBeGreaterThan(10)
    expect(d).toBeLessThan(25)
  })

  test('南半球也能正确计算', () => {
    const bbox = [150, -34, 151, -33]
    const d = TrafficService.diagonalMeters(bbox)
    // cos(-33.5°) ≈ 0.834
    expect(d).toBeGreaterThan(120_000)
    expect(d).toBeLessThan(150_000)
  })
})
