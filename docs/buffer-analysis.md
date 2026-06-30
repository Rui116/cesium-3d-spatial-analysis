# 缓冲区分析 — 问题与解决方案

## 架构概述

```
选择缓冲类型（点 / 线）
  │
  ├─ 点缓冲：点击地图选点 → 画圆（72 段弧） → 多边形
  └─ 线缓冲：点击添加端点 → Enter 完成 → 线段平移 + 拐角斜接 + 圆帽 → 多边形
       │
       ▼
  Cesium CustomDataSource → polygon + 原始线实体
```

---

## 问题 1：`v.camera.zoomTo()` 不是函数

**现象**：`v.camera.zoomTo(bDS.entities)` 报错。

**根因**：`zoomTo` 是 `Viewer` 的方法，不在 `Camera` 上。

**修复**：`v.camera.zoomTo()` → `v.zoomTo()`

## 问题 2：线实体重复创建

**现象**：每次点击添加端点时创建新线实体，旧实体未移除，画面中累积多条重叠线。

**修复**：改为**单一线实体**模式 — 用 `lineEntity` 变量追踪，每次点击时先 `remove` 旧实体再 `add` 新实体。

## 问题 3：`removeAll()` 误清其他功能的实体

**现象**：`viewer.entities.removeAll()` 会清空其他功能页面的实体，切换页面时互相影响。

**修复**：改为 `trackedEntities` 数组**精确追踪**本页面创建的实体，`resetState()` 只移除追踪列表中的实体。

## 问题 4：线缓冲区算法错误（凸包）

**现象**：线段拐弯处的内侧凹角被凸包算法填平，缓冲区比实际大很多。

**旧算法**：每个顶点画圆 + 线段中点插值画圆 → 所有点取凸包。

**新算法（标准 GIS 线缓冲）**：
1. 对每个顶点计算行进方向角，偏移 ±90° 得到左/右侧点
2. 拐角处取前后段方向平均值（斜接 join）
3. 起点、终点各画半圆弧（圆帽 cap）
4. 组装路径：起点帽 → 左侧偏移线 → 终点帽 → 右侧偏移线（逆序）→ 闭合

| | 旧（凸包） | 新（线段平移） |
|------|----------|----------|
| 凹角 | 被凸包填平 | 正确保留 |
| 端点 | 无帽 | 半圆弧圆帽 |
| 中间段 | 每段插 N 个完整圆 | 只做线段平移 |
| 计算量 | O(N×48×M) | O(N) |

## 问题 5：多边形 `height: 1` 导致不可见

**现象**：把 `classificationType: TERRAIN` 改为 `height: 1` 后，缓冲区在多山地区完全不可见。

**根因**：`height` 是椭球以上高度。`height: 1` 表示椭球面以上 1m。当地形高度 > 1m 时，多边形在地面以下。

**修复**：恢复 `classificationType: TERRAIN`（贴地形渲染），提透明度到 0.35~0.45。

## 问题 6：重复的状态消息

**现象**：`setStatus` 和 `analysisResult` 两条 alert 内容几乎一样。

**修复**：移除 `analysisResult` ref 和对应的 alert，保留 `setStatus` 作为唯一状态显示。

## 问题 7：Enter 键监听污染

**现象**：`document.addEventListener('keydown', finishLine)` 全局监听，输入框回车也会触发。

**修复**：改为**闭包 handler** + `Escape` 取消键。`resetState()` 中通过 `keydownBound` 标记精确移除监听。

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/views/BufferAnalysis.vue` | 点/线缓冲交互、线段平移算法、实体管理 |
| `src/utils/cesiumHelpers.js` | `createPointEntity`、`createLineEntity`、`destroyHandler` 工具函数 |
