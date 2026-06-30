# 交通态势可视化 — 问题与解决方案

## 架构概述

```
用户交互 (Cesium WGS-84)
  │
  ├─ 视野模式：Camera.computeViewRectangle() → bbox
  ├─ 绘制模式：ScreenSpaceEventHandler 两点 → bbox
  └─ 道路名模式：Input Tips + Place Search 三阶段联想
       │
       ▼
  TrafficService
       │
       ├─ bbox 校验（合法范围、对角线 ≤ 10 km）
       ├─ 超限拆分（#splitBBox，沿长边二分，最多 4 块）
       ├─ WGS-84 → GCJ-02（CoordinateConverter.wgs84ToGcj02）
       ├─ URL 构建（URLSearchParams，; 和 , 百分号编码）
       ├─ 请求高德 REST API
       │    ├─ v3/traffic/status/rectangle（矩形区域）
       │    └─ v3/traffic/status/road（道路名）
       ├─ 响应解析 + 去重
       ├─ GCJ-02 → WGS-84（或保留 GCJ-02，取决于影像源）
       └─ 返回道路数据
            │
            ▼
  Cesium CustomDataSource → 彩色 polylines
```

---

## 问题 1：`INVALID_PARAMS / 20000`

**现象**：矩形查询返回 `{"status":"0","info":"INVALID_PARAMS","infocode":"20000"}`

**根因**：高德交通态势 API 要求矩形对角线 ≤ **10 公里**。用户绘制的矩形约 98 km，远超限制。

**排查过程**：

| 尝试 | 假设 | 结论 |
|------|------|------|
| WGS-84 bbox 未转 GCJ-02 | 坐标系不匹配 | 必要修复，但非根因 |
| URLSearchParams 编码 `;` 为 `%3B` | 服务端不识别编码后的分隔符 | `;` 在 HTTP 中是合法的参数分隔符，必须编码 |
| URLSearchParams 编码 `,` 为 `%2C` | 同上 | 逗号也必须编码，与分号一致 |
| 纯字符串拼接不编码 | `;` 被服务端当作参数分隔符截断 | 分号不编码会被错误解析 |
| **最终结论** | **矩形对角线超过 10 km** | ✅ 根因 |

**解决方案**：
- 添加 `#diagonal()` 计算对角线距离
- `#validateBBox()` 中校验 ≤ 10 km
- `#splitBBox()` 自动拆分：超限矩形沿长边二分，最多 4 块并发
- Vue 组件实时显示对角线距离，超限黄色警告

## 问题 2：坐标系转换（WGS-84 ↔ GCJ-02）

**问题**：Cesium 使用 WGS-84，高德 API 使用 GCJ-02（火星坐标系）。

**解决方案**：
- `CoordinateConverter.wgs84ToGcj02()` — 请求前转换 bbox 四角坐标
- `CoordinateConverter.gcj02ToWgs84()` — 解析后转换道路坐标
- `CoordinateConverter.isOutOfChina()` — 校验坐标在中国境内
- 文件：`src/composables/useCoordinate.js`

## 问题 3：影像底图偏移

**现象**：路况线与高德/腾讯卫星影像不对齐，偏移 300-500m。

**根因**：高德/腾讯瓦片是 GCJ-02 坐标系，被当作 WGS-84 直接贴在 Cesium 地球上，影像本身偏移。路况线的 WGS-84 转换是正确的，反而和偏移的影像对不上。

**解决方案**：`keepGcj02` 选项

```javascript
// 检测当前影像图层 URL
function isGcj02Imagery() {
  for (const layer of viewer.imageryLayers) {
    const url = layer.imageryProvider?.url || ''
    if (url.includes('autonavi') || url.includes('gtimg')) return true
  }
  return false
}
// 传入 trafficService，路况线保留 GCJ-02，与影像一起偏移，彼此对齐
trafficService.fetchTrafficByBBox(bbox, { keepGcj02: true })
```

## 问题 4：道路名查询 API 参数错误

**现象**：`name=中关村大街` 返回 `INVALID_PARAMS`。

**根因**：
1. 参数名是 `name`，不是 `road`
2. `city` 或 `adcode` 必传其一（两个都不传会报错）
3. 错误地认为 `level` 对 road 端点无效（实际有效）
4. `level=1` 意味着**仅高速**（包含关系：选 6 才返回 1~6 全等级）

**解决方案**：
- `road` → `name`
- `city` 改为必填
- 矩形查询：`level=6`（全等级）
- 道路名查询：`level=6`（全等级）
- 状态码映射修正：`0=未知, 1=畅通, 2=缓行, 3=拥堵, 4=严重拥堵`

## 问题 5：道路名联想为空

**现象**：输入"中关村"，联想列表无结果或全是楼名。

**根因**：
1. Input Tips API 天然偏向 POI/地名，道路名占比极低
2. 字符串匹配不加后缀时，"中关村"被当作地名而非道路前缀
3. Place Search Text API 同样偏向地名
4. "交叉口/路口"类结果被误判为道路

**解决方案（三阶段搜索）**：

```
输入 "中关村"（不含道路后缀）
  │
  ├─ 源 1：Input Tips API（快速）
  ├─ 源 2：Place Search Text API（道路不足时）
  └─ 源 3：6 路并行搜索带后缀的关键词
       ├─ "中关村大街" → ✅ 中关村大街
       ├─ "中关村路"   → ✅ 中关村路
       ├─ "中关村大道" → ...
       └─ ...
       → 合并去重，只保留道路名
```

**道路名识别正则**：

| 置信度 | 匹配规则 | 示例 |
|--------|----------|------|
| high | 高速/快速路/国道/省道/环路/环线/大街/大道 | 京藏高速、长安大街 |
| medium | 路/街/环/线/公路/辅路/立交/大桥 | 中关村路、北四环 |
| low（丢弃） | 道/巷/弄/隧道/胡同/县道 | 不展示 |
| 排除 | 交叉口/路口/与/转盘/环岛 | 不展示 |

**关键文件**：`src/views/TrafficVisualization.vue` — `fetchSuggestions()`

## 问题 6：其他 UI 修复

| 问题 | 修复 |
|------|------|
| `v.camera.zoomTo is not a function` | `v.camera.zoomTo()` → `v.zoomTo()` |
| Entity outlines unsupported on terrain | `outline: false` |
| Rectangle hidden by imagery with `height: 0` | 撤掉 `height: 0`，贴地渲染 |
| 视野查询按钮始终 disabled | `watch` 添加 `{ immediate: true }`，`computeViewRectangle` 返回 undefined 时保留上次 bbox |
| 乡镇返回 0 条道路 | 0 条时黄色警告 + 引导提示 |
| 路由切换后影像/地形状态丢失 | Pinia store 持久化 `imageryType`/`terrainType` |
| RoutePlanning 泄露高德影像图层 | 追踪并清理 `addedImageryLayer` |

## API 参数规范（高德交通态势）

### 矩形区域查询

```
GET https://restapi.amap.com/v3/traffic/status/rectangle
  ?key=xxx
  &rectangle=左下经,左下纬;右上经,右上纬   ← 对角线 ≤ 10 km
  &extensions=all
  &output=JSON
  &level=6                                  ← 1~6 全等级
```

### 道路名查询

```
GET https://restapi.amap.com/v3/traffic/status/road
  ?key=xxx
  &name=中关村大街     ← 参数名是 name，不是 road
  &city=北京           ← 必填（与 adcode 二选一）
  &extensions=all
  &output=JSON
  &level=6
```

### URL 编码原则

`rectangle` 参数中的 `,` 和 `;` 必须百分号编码（`%2C` 和 `%3B`），否则服务端会将 `;` 误认为 HTTP 参数分隔符。使用 `URLSearchParams` 天然会处理编码。

### 状态码

| 码 | 含义 |
|----|------|
| 0 | 未知 |
| 1 | 畅通 |
| 2 | 缓行 |
| 3 | 拥堵 |
| 4 | 严重拥堵 |

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/services/trafficService.js` | API 调用、坐标系转换、超限拆分、缓存、重试、去重 |
| `src/views/TrafficVisualization.vue` | 三模式 UI（视野/绘制/道路名）、影像检测、道路名联想、渲染 |
| `src/composables/useCoordinate.js` | WGS-84 ↔ GCJ-02 双向转换 + 中国范围校验 |
| `src/utils/cesiumHelpers.js` | 矩形实体、颜色常量、trafficColors 映射 |
| `src/stores/viewer.js` | 影像/地形类型持久化 |
| `.env` | `VITE_AMAP_KEY` / `VITE_AMAP_JSCode` 环境变量 |
