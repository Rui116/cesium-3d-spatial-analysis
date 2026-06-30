# Cesium 3D Tiles 加载失败 — 问题排查与修复报告

**日期**: 2026-06-10  
**项目**: 三维空间可视化系统 (Vite + Vue 3 + CesiumJS)  
**问题**: 点击"三维瓦片 (3D Tiles)"按钮后加载失败，提示 `瓦片加载失败`

---

## 1. 根因

`package.json` 声明的依赖为 `"cesium": "^1.123.0"`，由于使用了 `^` 语义化版本范围，实际安装的版本为 **Cesium 1.142.0**（相差约 19 个 minor 版本）。Cesium 在此期间引入了多项不兼容的 API 变更，导致 `load3DTiles()` 函数完全失效。

## 2. 具体问题（共 3 个）

### 问题 ①：构造函数不再接受 `url` 选项

**文件**: `src/views/Home.vue` → `load3DTiles()`

| 项目 | 内容 |
|------|------|
| **旧代码** | `new Cesium.Cesium3DTileset({ url: './Tileset/tileset.json' })` |
| **行为** | Cesium 1.142 的 `Cesium3DTileset` 构造函数选项中**没有** `url` 字段，该参数被静默忽略 |
| **后果** | `tileset._url` 和 `tileset._resource` 始终为 `undefined`，无法加载任何瓦片 |
| **修复** | 改用静态工厂方法 `await Cesium.Cesium3DTileset.fromUrl('./Tileset/tileset.json')` |

```js
// ❌ 旧代码（Cesium 1.123 可用，1.142 失效）
const tileset = v.scene.primitives.add(
  new Cesium.Cesium3DTileset({ url: './Tileset/tileset.json' })
)

// ✅ 新代码（Cesium 1.124+）
const tileset = await Cesium.Cesium3DTileset.fromUrl('./Tileset/tileset.json')
v.scene.primitives.add(tileset)
```

### 问题 ②：`readyPromise` 属性已删除

**文件**: `src/views/Home.vue` → `load3DTiles()`

| 项目 | 内容 |
|------|------|
| **旧代码** | `await tileset.readyPromise` |
| **行为** | Cesium 1.142 的 `Cesium3DTileset` 不再提供 `readyPromise` 属性 |
| **后果** | `await undefined` 立即返回，不等待瓦片加载完成 |
| **修复** | 删除该行（`fromUrl` 返回时 provider 已就绪） |

### 问题 ③：`initialTilesLoaded` 从 Promise 变为 Event

**文件**: `src/views/Home.vue` → `load3DTiles()`

| 项目 | 内容 |
|------|------|
| **旧代码** | `await tileset.initialTilesLoaded` |
| **行为** | Cesium 1.124+ 中 `initialTilesLoaded` 变成了 `Event` 对象，不再是 `Promise` |
| **后果** | `await` 一个 Event 对象不会等待，代码立即继续执行 |
| **修复** | 使用 Event 监听模式等待 |

```js
// ❌ 旧代码（Promise 模式，Cesium ≤1.123）
await tileset.initialTilesLoaded

// ✅ 新代码（Event 模式，Cesium ≥1.124）
if (!tileset._initialTilesLoaded) {
  await new Promise((resolve) => {
    tileset.initialTilesLoaded.addEventListener(resolve)
  })
}
```

### 附带问题 ④：地形 Provider 的 `readyPromise` 同样已移除

**文件**: `src/views/Home.vue` → `toggleHeightVisual()`

| 项目 | 内容 |
|------|------|
| **旧代码** | `await cesiumTerrain.readyPromise` |
| **行为** | `CesiumTerrainProvider` 的 `readyPromise` 在 1.142 中已移除 |
| **修复** | 删除该行；`createWorldTerrainAsync()` 返回时 provider 已初始化完毕 |

## 3. 修改汇总

| 文件 | 修改位置 | 修改内容 |
|------|---------|---------|
| `src/views/Home.vue` | `load3DTiles()` | 构造函数 → `fromUrl()`，移除 `readyPromise`，修正 `initialTilesLoaded` 等待方式 |
| `src/views/Home.vue` | `toggleHeightVisual()` | 移除 `await cesiumTerrain.readyPromise` |
| `package.json` | `dependencies` | `"cesium": "^1.123.0"` → `"cesium": "1.142.0"`（锁定精确版本） |

## 4. 经验教训

1. **不要对 Cesium 使用 `^` 版本范围**：Cesium 的 minor 版本（如 1.123 → 1.142）包含了大量 API 重构，不遵循严格的语义化版本向后兼容承诺。建议锁定精确版本或使用 `~` 范围。

2. **优先查阅源码而非文档**：`Cesium3DTileset.ConstructorOptions` 的 JSDoc（Options 列表 v1.142）不含 `url` 字段，源码中 `options.url` 无任何引用。文档页面标注 `"This object is normally not instantiated directly, use fromUrl"` — 这是排查的关键线索。

3. **`await obj.property` 对 `undefined`/`Event` 不报错**：JavaScript 的 `await` 对非 Promise 值静默通过，使得这类 API 变更不会抛出异常，而是以"功能不工作"的方式体现，排查难度较大。

## 5. 验证

- ✅ `vite build` 构建成功（35s，无错误）
- ✅ 静态资源可通过 HTTP 正确访问（tileset.json、b3dm 文件 MIME 类型正确）
- ✅ 除 `Cesium3DTileset` 外，项目中其他 Cesium 对象（Viewer、Cartesian3 等）的构造函数在 1.142 中均保持兼容
