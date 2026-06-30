# 路径规划分析 — 问题与解决方案

## 架构概述

```
起终点设置
  ├─ 地图选点：ScreenSpaceEventHandler → pickPosition / globe.pick → WGS-84
  └─ 手动输入：解析输入框经纬度
       │
       ▼
  RouteService.fetchDrivingRoute(origin, destination)
       │
       ├─ WGS-84 → GCJ-02（origin / destination）
       ├─ 手动拼接 URL（逗号不编码）
       ├─ 请求高德驾车路径 API（v3/direction/driving）
       ├─ 重试 + 指数退避（maxRetry=2）
       └─ GCJ-02 → WGS-84（polyline 坐标转换）
            │
            ▼
  Cesium 渲染：PolylineGlowMaterialProperty 路线 + 起终点 Marker
```

---

## 问题 1：起终点坐标系未转换

**现象**：WGS-84 坐标直接发给高德 API → 路径偏移 300-500m。

**修复**：`fetchDrivingRoute` 中 `CoordinateConverter.wgs84ToGcj02()` 转换 origin/destination。

## 问题 2：路径坐标未转回

**现象**：高德返回的 polyline 是 GCJ-02，直接给 Cesium（WGS-84）→ 在 Cesium/Bing 影像上偏移。

**修复**：`#normalizeRoute` 中 `CoordinateConverter.gcj02ToWgs84()` 转换，`keepGcj02=false` 始终转 WGS-84。

## 问题 3：URL 参数逗号被编码

**现象**：`URLSearchParams` 把 `origin=116.3%2C39.9` 发给高德 → INVALID_PARAMS。

**修复**：手动拼接 URL，逗号原样保留。

## 问题 4：API Key 硬编码 + 无错误映射

**修复**：`import.meta.env.VITE_AMAP_KEY` + 中文 `ERR_MSG` 错误码映射。

## 问题 5：缺少重试机制

**修复**：对齐 `trafficService` 模式 — `maxRetry=2` + 指数退避 + 4xx 不重试 + abort 直接抛出。

## 问题 6：ScreenSpaceEventHandler 冲突

**现象**：使用 `viewer.screenSpaceEventHandler`（默认 handler），多次调用堆叠，不清理。

**修复**：独立 `pickHandler` 实例 + `destroyPickHandler()` + `onUnmounted` 完整清理。

## 问题 7：Marker-路线-影像 坐标系冲突

**现象**：高德/腾讯影像（GCJ-02 贴在 WGS-84 地球上 → 偏移 300-500m）下，marker、路线、影像三者无法同时对齐。

**根因**：这是一个三选二困境：
- Marker 在 WGS-84（精确点击位置）
- 路线在 WGS-84（正确地理定位）
- 影像在 GCJ-02（偏移渲染）

| 组合 | marker 精确 | marker↔路线相连 | 路线↔影像对齐 |
|------|-----------|---------------|-------------|
| 全 WGS-84 | ✅ | ✅ | ❌（高德影像上偏移） |
| 全 GCJ-02 | ❌（偏离点击） | ✅ | ✅ |
| marker WGS-84 + 路线 GCJ-02 | ✅ | ❌ | ✅ |

**决策**：优先级 = marker 精确 > marker↔路线相连 > 影像对齐。统一用 WGS-84。

## 问题 8：边界情况

| 问题 | 修复 |
|------|------|
| `allPos` 为空时标签位置 `undefined` | 前置 `if (!allPos.length)` 检查 + label 条件渲染 |
| `pickPosition` 可能返回 `undefined`（点击模型/瓦片） | `globe.pick` 降级 fallback |

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/views/RoutePlanning.vue` | 起终点设置、地图选点、路径渲染、实体管理 |
| `src/services/routeService.js` | WGS-84↔GCJ-02 转换、API 调用、重试、坐标转换 |
| `src/composables/useCoordinate.js` | CoordinateConverter 双向转换 |
