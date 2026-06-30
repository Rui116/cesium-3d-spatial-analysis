# GeoJSON 加载与应用 — 问题与解决方案

## 涉及文件

`src/views/Home.vue`、`public/GeoJson/武汉市.geojson`

---

## 一、GeoJSON 数据文件

### 问题 1：UTF-8 BOM 头

**现象**：文件以 `﻿`（0xFEFF）开头，不符合 JSON 规范（RFC 8259 禁止 BOM）。

**修复**：移除 BOM 字节，`node -e "fs.writeFileSync(path, fs.readFileSync(path).slice(3))"`

### 数据概况

- 13 个行政区（江岸、江汉、硚口、汉阳、武昌、青山、洪山、东西湖、汉南、蔡甸、江夏、黄陂、新洲）
- 全部为 MultiPolygon 几何类型
- 多岛区域：汉南 (5 环)、蔡甸 (5 环)、新洲 (3 环)、武昌 (2 环)、江夏 (2 环)
- 顶点数：51（江汉）~ 468（新洲）
- Properties 包含：adcode、name、center（区政府坐标）、centroid 等

---

## 二、加载架构

### 问题 1：三次重复加载同一文件

**现象**：`loadGeoJson`、`toggleColorRender`、`toggleHeightVisual` 各自调用 `GeoJsonDataSource.load()`，内存中 3 份相同数据 + 3 套重叠渲染。

**根因**：三个功能独立管理 datasource，无共享机制。

**修复**：`ensureGeoJsonLoaded()` 单例模式。

```js
let cachedGeoJsonDS = null

async function ensureGeoJsonLoaded() {
  if (cachedGeoJsonDS) return cachedGeoJsonDS
  cachedGeoJsonDS = await Cesium.GeoJsonDataSource.load('./GeoJson/武汉市.geojson')
  return cachedGeoJsonDS
}
```

所有功能通过 `ensureGeoJsonLoaded()` 获取同一 datasource 引用。

---

### 问题 2：无法卸载基础图层

**现象**：加载 GeoJSON 后无法移除，只能刷新页面。

**修复**：按钮改为加载/移除切换。

```js
const geoJsonLoaded = ref(false)

async function toggleGeoJson() {
  if (geoJsonLoaded.value) {
    removeBaseOverlay()
    v.dataSources.remove(cachedGeoJsonDS, true)
    geoJsonLoaded.value = false
    return
  }
  // 加载...
  geoJsonLoaded.value = true
}
```

卸载时自动清除关联的分色渲染和高度可视化。

---

### 问题 3：zoomTo 定位失败

**现象**：加载 GeoJSON 后相机不定位到武汉区域。

**根因**：entity 设为 `show=false` 后调用 `v.zoomTo(ds)`，Cesium 无法计算隐藏 entity 的包围球范围。

**修复**：调整执行顺序——先定位，再隐藏。

```js
// 正确顺序
addBaseOverlay()
await v.zoomTo(ds)                               // entity 可见 → 精确定位
ds.entities.values.forEach(e => { e.show = false })  // 定位完成后再隐藏
```

---

## 三、基础图层渲染

### 问题 4：基础图层被影像遮挡

**现象**：GeoJsonDataSource 创建的 entity 渲染在卫星影像图层之下，行政区边界不可见。

**根因**：DataSource entity 创建时无 `classificationType` 属性，默认渲染在 terrain/imagery 下方。

**修复**：双层架构——datasource 仅作数据容器和定位，可见边界由独立 entity 提供。

```
datasource（数据容器）
  ├─ entities.show = false        ← 原始 entity 隐藏
  └─ v.dataSources 中注册          ← zoomTo / flyTo 可用

baseOverlayEntities（可见层）
  ├─ v.entities.add() 创建
  ├─ classificationType: TERRAIN  ← 渲染在影像之上
  ├─ 青色边框 (3px, 80% 透明)
  └─ 淡青色填充 (12% 透明)
```

```js
function addBaseOverlay() {
  removeBaseOverlay()  // 先清除旧的
  cachedGeoJsonDS.entities.values.forEach(entity => {
    if (!entity.polygon) return
    const positions = extractPositions(entity)
    const e = v.entities.add({
      polygon: {
        hierarchy: positions,
        classificationType: Cesium.ClassificationType.TERRAIN,
        material: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.12),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.8),
        outlineWidth: 3,
      },
    })
    baseOverlayEntities.push(e)
  })
}
```

**切换逻辑**：

```
基础图层 ON:  ds + addBaseOverlay()
分色渲染 ON:  removeBaseOverlay() + 分色 entity
分色 OFF:     分色 entity 移除 + addBaseOverlay()（需 geoJsonLoaded）
高度可视 ON:  removeBaseOverlay() + 高度 entity
高度 OFF:     高度 entity 移除 + addBaseOverlay()（需 geoJsonLoaded）
```

**关键保护**：`addBaseOverlay()` 仅在 `geoJsonLoaded.value === true` 时调用，防止未加载基础图层就错误添加。

---

## 四、分色渲染 + 注记

### 问题 5：颜色随机不稳定

**现象**：每次 toggle 产生不同随机颜色，无法对照。

**修复**：定性色板 + adcode 哈希取色。

```js
const COLOR_PALETTE = [
  '#4ECDC4', '#FF6B6B', '#FFE66D', '#45B7D1', '#F8B195',
  '#C06C84', '#6C5B7B', '#355C7D', '#99B898', '#FECEAB',
  '#E84A5F', '#2A363B', '#A8E6CF',
].map(c => Cesium.Color.fromCssColorString(c))

function stableColor(adcode) {
  let hash = 0
  for (const ch of String(adcode || 0)) hash = ((hash << 5) - hash) + ch.charCodeAt(0)
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length].clone()
}
```

同一行政区每次渲染颜色一致，分色与高度可视化共用色板。

---

### 问题 6：注记位置偏移

**现象**：用包围球中心作为注记位置，不规则形状（狭长的洪山区）注记落在区域外部。

**修复**：优先使用 GeoJSON `properties.center`（区政府坐标点）。

```js
const centerProp = entity.properties?.center?.getValue()
const labelPos = centerProp
  ? Cesium.Cartesian3.fromDegrees(centerProp[0], centerProp[1], 0)
  : fallbackToBoundingSphere(positions)
```

---

### 问题 7：分色渲染被影像遮挡

**现象**：同基础图层，entity 无 `classificationType` 时被影像盖住。

**修复**：创建 entity 时显式设置。

```js
polygon: {
  hierarchy: positions,
  classificationType: Cesium.ClassificationType.TERRAIN,
  material: stableColor(adcode).withAlpha(0.7),
  outline: true,
  outlineColor: Cesium.Color.WHITE.withAlpha(0.3),
}
```

---

### 问题 8：色卡图例

**优化**：分色渲染后面板显示颜色-区名对照。

```html
<div v-if="colorLegend.length" class="legend-card">
  <div v-for="item in colorLegend" class="legend-item">
    <span class="legend-swatch" :style="{ background: item.color }"></span>
    <span>{{ item.name }}</span>
  </div>
</div>
```

---

### 问题 9：加载进度反馈

**优化**：处理过程中显示实时进度。

```
分色渲染 5/13
```

---

## 五、高度可视化

（详见 `docs/问题修复与优化总结.md` 第四节）

---

## 六、架构总结

```
ensureGeoJsonLoaded()          ← 单例加载，所有功能共享

addBaseOverlay()               ← 创建 TERRAIN 分类基础层
removeBaseOverlay()            ← 移除基础层

toggleGeoJson()                ← 加载/卸载切换
toggleColorRender()            ← 分色渲染 开关
toggleHeightVisual()           ← 高度可视化 开关

数据流：
  GeoJSON 文件 → cachedGeoJsonDS (内存缓存)
    ├─ baseOverlayEntities (TERRAIN 可见层)
    ├─ colorEntities (分色 entity，TERRAIN)
    └─ heightEntities (挤出 entity)

可见性管理：
  基础层 ←→ 分色层 ←→ 高度层  三者互斥
  切换时自动恢复基础层（需 geoJsonLoaded 为 true）
```
