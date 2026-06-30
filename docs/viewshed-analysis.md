# 可视域分析 — 问题与解决方案

## 架构概述

```
观察点设置
  ├─ 点选模式：ScreenSpaceEventHandler → globe.pick → 地形表面
  └─ 手动输入：坐标 + 离地高度 → sampleTerrainMostDetailed（地形高程）→ 绝对高度
       │
       ▼
  可视域计算（calculateVisibility）
       │
       ├─ 生成 360 方向 × 10 步/方向 = 3600 个球面采样点
       ├─ sampleTerrainMostDetailed（一次批量异步采样）
       ├─ 逐射线 LOS 判断（视线从观察点到目标点地形，是否被中间地形遮挡）
       └─ 返回网格数据 + 可见方向数
            │
            ▼
  可视化（visualizeResults）→ polygon + 观察点 marker
  统计（updateStatistics）  → 可见面积 km² + 可见比例 %
  导出  → JSON（完整网格）/ GeoJSON（GIS 兼容）/ 截图
  导入  → 加载 JSON 恢复分析
```

---

## 问题 1：ScreenSpaceEventHandler 泄漏

**现象**：切换到其他页面后，点击地图仍触发可视域分析，与 Home.vue 的坐标拾取冲突。

**根因**：
- 使用 `viewer.screenSpaceEventHandler`（全局默认 handler）而非独立实例
- `onUnmounted` 只清除 entities，不销毁 handler

**修复**：
- 新建独立的 `Cesium.ScreenSpaceEventHandler` 实例（`pickHandler`）
- `destroyPickHandler()` 彻底销毁
- `onUnmounted` → `clearAll()` → `destroyPickHandler()`
- 点选按钮改为 toggle（可取消），防止误触后无法退出

## 问题 2：半径滑块无防抖

**现象**：拖动滑块每 50m 步长触发一次完整计算，98 次拖动 = 35,000+ 次射线检测。

**修复**：`onRadiusInput()` 加 300ms 防抖，滑块停下后才触发 `updateAnalysis()`。

## 问题 3：`calcRayTarget` 坐标计算不准确

**现象**：用等角平面投影近似球面距离，高纬度地区误差急剧放大。

**修复**：重写为 `geodesicTargetFast()`，使用球面坐标 + 极地 clamp。

## 问题 4：LOS 公式忽略目标点地形

**现象**：视线公式 `obsHeight + frac * (0 - obsHeight)` 假设目标在椭球面。若目标点地形高 50m，实际视线应到 50m，但公式到 0m → 误判为遮挡。

**修复**：取每条射线终点地形高度 `targetH`，改为 `obsHeight + frac * (targetH - obsHeight)`。

## 问题 5：`globe.pick` 逐射线调用性能差

**现象**：360 次同步 `globe.pick` 调用，每次等待 GPU 读回地形数据。

**修复**：改用 `Cesium.sampleTerrainMostDetailed` 批量异步采样。

```
旧：360 次 globe.pick（同步，阻塞主线程）
新：1 次 sampleTerrainMostDetailed（3600 个点，异步）
```

## 问题 6：手动输入高度语义冲突

**现象**：`inputHeight=100` 被当作绝对椭球高度，可能放到地下（当地形高 > 100m）。

**修复**：
- `inputHeight` 改为「离地高度」（AGL）
- `setFromInput` 先采样该点地形高程，再叠加用户输入的离地高度
- 信息面板同时显示「海拔高度」和「离地高度」
- 点选模式明确标注「贴在地表」

## 问题 7：除零风险

**现象**：计算被取消返回空数组时，`updateStatistics` 中 `grid.length === 0`，除法产生 `NaN`。

**修复**：添加 `if (!grid.length)` 提前返回 `0 km² / 0%`。

## 问题 8：导出数据不完整

**现象**：只导出汇总统计，无法复现分析结果或用于外部工具。

**修复**：
- **JSON**：汇总 + 360 射线网格数据（angle/distance/visible）
- **GeoJSON**：可视域 Polygon，可直接在 QGIS/Leaflet 中加载
- **加载 JSON**：恢复观察点、半径、网格、统计结果，重新渲染
- **截图**：`requestAnimationFrame` 确保渲染完成后再导出

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/views/ViewshedAnalysis.vue` | 三模式观察点设置、批量地形采样、LOS 计算、可视化、导入导出 |
| `src/composables/useCesium.js` | Cesium Viewer 初始化（共享） |
| `src/utils/cesiumHelpers.js` | `createPointEntity`、`removeEntities` 工具函数 |
