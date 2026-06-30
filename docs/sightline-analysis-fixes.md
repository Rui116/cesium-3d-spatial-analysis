# 视线分析 — 问题诊断与修复总结

## 架构概述

```
观察点选择（贴地 + AGL） ──┐
目标点选择（贴地 + AGL） ──┤
                          ▼
              地表路径插值（lerp 贴地位置）
                          │
                          ▼
              sampleTerrainMostDetailed（批量地形采样）
                          │
                          ▼
              累计地表距离计算（大圆距离累加）
                          │
                          ▼
              GIS 标准最大斜率 LOS 分析
                          │
                          ▼
              可视 → 分段渲染（绿/红/首遮挡标记/稀疏黄点）
```

---

## 问题 1：同步 `globe.pick` 冻结 UI + 算法根本缺陷

**现象**：视线判定对每条射线调用同步 `globe.pick()`，最多 500 次同步 GPU 读回，主线程完全冻结。且算法逻辑本身有问题——`globe.pick` 从地表点发射射线，原点在地形表面会造成自相交误判。

**根因**：
- `isVisible()` 中 `for` 循环无 `await`/`setTimeout`，500 次 `globe.pick` 同步执行
- 射线原点在 `p1`（地形表面），`globe.pick` 可能返回原点自身，造成近点误判

**修复**：
- 彻底移除 `globe.pick` 逐点检测
- 改用 LOS 高度对比：`sampleTerrainMostDetailed` 已返回地形高度，纯 CPU 对比即可
- 添加 `BATCH_SIZE=50` 分批 + `await setTimeout(0)` 让出主线程

---

## 问题 2：可见度恒为 100%（第一次）

**现象**：所有采样点均判定为"可见"，可见度始终 100%。

**根因**：`sampleTerrainMostDetailed` 返回 `Cartesian3[]`（ECEF 坐标），属性是 `.x` `.y` `.z`。代码直接读 `sampledPositions[j].height` 获取椭球高度——但 `Cartesian3` **没有 `.height` 属性**，结果为 `undefined`。
```
startH = undefined, endH = undefined
losH   = undefined + frac * (undefined - undefined) = NaN
terrainH > NaN → 永远 false → 全部"可见"
```
只有 `Cartographic` 才有 `.height`（椭球高度）。

**修复**：先用 `Cesium.Cartographic.fromCartesian(p)` 转换为 `Cartographic`，再读 `.height`。

---

## 问题 3：可见度恒为 100%（第二次）

**现象**：转为 `Cartographic` 后仍然 100%。

**根因**：`sampleTerrainMostDetailed` 内部调用链：
```
positionToTileXY → Rectangle.contains(rect, position) → position.longitude
interpolateAndAssignHeight → interpolateHeight(rect, position.longitude, position.latitude)
```
传入的 `Cartesian3` 没有 `.longitude` / `.latitude` → `undefined` → 所有位置被静默跳过 → 地形高度从未写入。之后 `Cartographic.fromCartesian()` 作用在未修改的弦点（穿过地球内部）上，得到负高度 → `负数 > NaN` → 全部判定为可见。

**修复**：在调用 `sampleTerrainMostDetailed` **之前**，将 `Cartesian3[]` 转为 `Cartographic[]`（有 `.longitude` / `.latitude`）。与 `ViewshedAnalysis.vue` 一致。

---

## 问题 4：Cesium 地形可用性树崩溃

**现象**：
```
TypeError: Cannot read properties of undefined (reading 'rectangles')
    at findMaxLevelFromNode (cesium.js:248783)
    at TileAvailability.computeMaximumLevelAtPosition
```

**根因**：传入有效 `Cartographic`（有正确 lat/lon）后，Cesium **真正去查询地形可用性四叉树**。某些区域（无地形覆盖的海域等）可用性节点为 `null`，访问 `rectangles` 属性时报错。旧代码传入 `Cartesian3`（lat/lon = undefined）时所有位置被跳过，所以从未触发此问题。

**修复**：将 `sampleTerrainMostDetailed` 包装在专用 try/catch 中，失败时降级为椭球面模式（所有高度 = 0），不影响分析流程。

---

## 问题 5：可视化跨遮挡区连线

**现象**：可见性分段（可见→遮挡→可见→遮挡）时，所有可见点被合为一条 polyline，所有遮挡点合为另一条。不同区段的点被直接连线，产生跨遮挡区的虚假线条。

**修复**：
- `analyzeVisibilityBatched` 返回 `visibilityMask: boolean[]` 标记每个采样点
- `visualizeResults` 按 mask 扫描，将连续同状态点分组为独立段，逐段渲染
- 可见段：绿色发光粗线；遮挡段：红色虚线

---

## 问题 6：遮挡点标记过密（视觉噪声）

**现象**：500 个采样点中假设 300 个被遮挡，全部绘制黄色圆点 → 300 个点密集堆叠，完全无法辨认。

**修复**：稀疏采样，最多 ~15 个均匀分布的黄色标记（`STRIDE = blockCount / 15`）。首遮挡点用更大红色标记单独绘制。

---

## 问题 7：地球曲率被忽略

**现象**：LOS 高度使用线性插值 `startH + frac * (endH - startH)`，完全忽略地球曲率。10 km 路径弦中点低于椭球面约 2m，但算法判定为"可见"。

**根因**：线性插值假设地面是平的。实际上弦穿过地球内部，其椭球高度随曲率下降。`Cartographic.fromCartesian(lerpPoint).height` 能给出含曲率的真实高度，但之前没有保存。

**验证**：
```
d² / (8R)  ≈  2m   (10 km)
             ≈ 49m   (50 km)
             ≈ 196m  (100 km)
```

**修复**：在 `sampleTerrainMostDetailed` 覆盖高度前，保存 `cartos.map(c => c.height)` 作为弦的实际椭球高度。与地形高度对比即可得到含曲率的正确判定。

---

## 问题 8：算法不符合 GIS 标准定义

**现象**：使用"弦高法"——将每个点的高度与 Observer→Target 的 3D 弦比较。中间点的可见性受 Target 高度影响（例如 Target 在山顶 → 弦被抬高 → 大量误判为可见），这不符合 GIS 标准。

**GIS 标准定义**（ArcGIS / QGIS / GRASS）：

视线分析的中间点可见性**仅由观察者高度 + 地形剖面决定**，与目标点高度无关。目标点高度仅用于判定目标自身是否可见。

**标准算法 — 最大斜率法**：
```
maxSlope = -∞
for each point j along the path (from observer outward):
    slopeⱼ = (terrainHⱼ - observerH) / distanceⱼ
    if slopeⱼ > maxSlope:
        visible[j] = true
        maxSlope = slopeⱼ
    else:
        visible[j] = false  // 被前面更高地形遮挡
```

**修复**：
- 路径用贴地位置插值（`lerp(obsTerrain, tgtTerrain)`），不抬高
- 计算累计地表距离（大圆距离累加）
- 逐点计算斜率，维护 `maxSlope`
- 目标点单独用其实际高度（含 AGL）判定是否可见
- 时间复杂度从 O(n) + 坐标转换降为 O(n) 纯数值

---

## 问题 9：概念命名不准确

**现象**："通视分析" 暗示双向互视（intervisibility），但实现是单向观察者→目标（line-of-sight）。

**修复**：
- `通视分析` → `视线分析`（router、sidebar、面板标题、日志、README）
- 区分 `观察点`（observer）和 `目标点`（target）
- 分别设置观察点离地高度（默认 1.7m）和目标点离地高度（默认 0m）

---

## 问题 10：ScreenSpaceEventHandler 泄漏

**现象**：使用 `viewer.screenSpaceEventHandler`（全局默认 handler），组件卸载时可能与其他组件冲突。

**修复**：创建独立 `Cesium.ScreenSpaceEventHandler` 实例（`pickHandler`），`destroyPickHandler()` 彻底销毁。

---

## 问题 11：取消操作不完整

**现象**：`cancel()` 设置 `cancelFlag=true` 但不递增 `computeId`。异步 `runAnalysis` 中只能靠 `cancelFlag` 退出循环，但循环外的代码仍会执行（可视化不完整结果、显示"分析完成"）。

**修复**：`cancel()` 中 `computeId++`，`runAnalysis` 在各异步阶段检查 `id !== computeId` 提前返回。

---

## 最终数据流

```
obsTerrainPt (贴地 Cartesian3)  + observerAGL → obsHeight (数值)
tgtTerrainPt (贴地 Cartesian3)  + targetAGL   → tgtHeight (数值)

lerp(obsTerrainPt, tgtTerrainPt, j/N) → 地表路径点 (Cartesian3[])
  ↓ Cartographic.fromCartesian → Cartographic[] (lat/lon/height)
  ↓ sampleTerrainMostDetailed  → Cartographic[] (height = 地形椭球高)
  ↓ 累计大圆距离               → distances[] (米)
  ↓ analyzeMaxSlope            → visibilityMask[] (true=可见)
  ↓ Cartesian3.fromRadians     → Cartesian3[] (用于 Entity)
  ↓ visualizeResults           → 分段 polyline + 首遮挡标记 + 稀疏黄点
```

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/views/SightlineAnalysis.vue` | 观察点/目标点选择、地形采样、最大斜率 LOS、分段可视化 |
| `src/views/ViewshedAnalysis.vue` | 360° 可视域分析（独立功能，不受本次修改影响） |
| `src/utils/cesiumHelpers.js` | `createPointEntity`、`createLineEntity`、`removeEntities` 工具函数 |
| `src/composables/useCesium.js` | Cesium Viewer 初始化（共享） |
| `docs/viewshed-analysis.md` | 可视域分析问题文档 |
| `docs/sightline-analysis-fixes.md` | 本文档 |
