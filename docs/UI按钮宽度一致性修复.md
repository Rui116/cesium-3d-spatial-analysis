# UI 按钮宽度一致性修复

## 问题描述

部分并排按钮出现宽度不一致的情况，主要发生在以下场景：

### 场景 1：`el-button-group` 中文字长度差异大

**位置**: `src/views/Home.vue` — 视角切换按钮组

```
[ 俯视 ]  [ 45°斜视 ]  [ 自由 ]
 2字符      5字符         2字符
```

虽然每个按钮都设了 `style="flex:1"`，但 CSS 的 `flex:1`（即 `flex: 1 1 0%`）受制于浏览器的 **最小内容宽度 (min-content)** 约束。"45°斜视" 包含数字和度符号，其 min-content 远大于 "俯视" 和 "自由"，导致 flex 无法将其缩到与其他按钮等宽，产生视觉上的不协调。

**同类位置**:
- `src/views/BufferAnalysis.vue` — "点缓冲" / "线缓冲" 按钮组
- `src/views/RoutePlanning.vue` — "起点设置" / "终点设置" 按钮组

### 场景 2：并排按钮未设置 `flex:1`

**位置**: `src/views/ViewshedAnalysis.vue` — 导出数据 / 保存截图

```html
<div style="display:flex;gap:6px">
  <el-button>导出数据</el-button>   <!-- 缺少 flex:1，按内容撑开 -->
  <el-button>保存截图</el-button>   <!-- 缺少 flex:1，按内容撑开 -->
</div>
```

### 场景 3：纵向堆叠按钮未撑满容器宽度

**位置**: `src/views/Home.vue` — 数据加载按钮、GeoJSON 应用按钮

```html
<div class="field-group">
  <el-button>✈ 飞机模型 (glTF)</el-button>           <!-- 12字符 -->
  <el-button>⌂ 三维瓦片 (3D Tiles)</el-button>       <!-- 14字符 -->
  <el-button>◈ 武汉市行政区划 (GeoJSON)</el-button>   <!-- 14字符 -->
</div>
```

`.field-group` 是 `display: flex; flex-direction: column`，默认 `align-items: stretch` 应撑满子元素。但 Element Plus 的 `el-button` 默认 `display: inline-flex`，宽度由内容文字长度决定，不会自动填满父容器。12 字符和 14 字符的按钮呈现不同宽度。

**同类位置**：所有 6 个视图的纵向堆叠按钮均受影响。

### 场景 4：按钮缺少 `size="small"` 导致高度不一致

部分按钮使用 Element Plus 默认 medium 尺寸 (32px)，其他使用 `size="small"` (24px)，同一面板内高度参差不齐。

**受影响位置**:
- `src/views/TrafficVisualization.vue` — "绘制查询区域"、"获取路况"、"清除" (共 3 处)
- `src/views/RoutePlanning.vue` — "计算路径" (1 处)
- `src/views/SightlineAnalysis.vue` — "开始分析 / 取消分析" (1 处)

---

## 解决方案

### 1. 全局 CSS 修复 (`src/styles/main.css`)

#### a) 强制 `el-button-group` 内按钮等宽

```css
/* 强制 flex:1 真正等分，忽略 min-content */
.glass-panel .el-button-group .el-button {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**原理**: `min-width: 0` 移除了 flex 子元素的默认最小宽度约束，使得 `flex-basis: 0%` + `flex-grow: 1` 能够真正将容器宽度等分给每个按钮。`overflow: hidden` + `text-overflow: ellipsis` 确保文字过长时以省略号截断。

#### b) 添加 `.btn-row-equal` 工具类

```css
.glass-panel .btn-row-equal {
  display: flex; gap: 6px;
}
.glass-panel .btn-row-equal .el-button {
  flex: 1;
  min-width: 0;
}
```

供非 `el-button-group` 场景复用，确保任意并排按钮等宽。

#### c) 纵向堆叠按钮撑满宽度

```css
/* 独立按钮撑满面板宽度（解决文字长度不同导致的宽度不一致） */
.glass-panel .panel-body > .el-button,
.field-group > .el-button {
  width: 100%;
}

/* button-group 内按钮恢复 auto 宽度（由 flex:1 控制） */
.glass-panel .el-button-group .el-button {
  width: auto;
  /* ...min-width:0 等其他规则保持不变 */
}
```

**关键点**: 用 `width: auto` 覆盖 button-group 内按钮的 `width: 100%`，确保两种场景互不冲突：
- 独立堆叠按钮 → `width: 100%` → 统一撑满
- button-group 内按钮 → `width: auto` + `flex: 1` → 等分

#### d) 全局按钮字号统一

```css
.glass-panel .el-button { font-size: 12px; }
```

作为兜底规则，防止未来新增按钮遗漏 `size="small"`。

### 2. 视图文件显式修复

| 文件 | 修改内容 |
|------|----------|
| `src/views/TrafficVisualization.vue` | 3 个按钮添加 `size="small"` |
| `src/views/RoutePlanning.vue` | "计算路径" 添加 `size="small"` |
| `src/views/SightlineAnalysis.vue` | "开始分析" 添加 `size="small"` |
| `src/views/ViewshedAnalysis.vue` | 导出/截图按钮容器改用 `class="btn-row-equal"` |

---

## 验证方法

1. `npm run dev` 启动开发服务器
2. 切换到 **基础三维场景** 页面：
   - 视角切换按钮组 — "俯视"/"45°斜视"/"自由" 严格等宽
   - 数据加载区三个按钮 — 均撑满面板宽度，等宽
   - GeoJSON 应用两个按钮 — 均撑满面板宽度，等宽
3. 切换到 **缓冲区分析** 页面，观察 "点缓冲" / "线缓冲" 等宽
4. 切换到 **路径规划分析**，观察 "起点设置" / "终点设置" 等宽
5. 切换到 **可视域分析**，观察 "导出数据" / "保存截图" 等宽
6. 所有页面的按钮高度应统一为 `size="small"` (24px)
7. 遍历全部 6 个页面，纵向堆叠的独立按钮均应填满面板宽度

---

## 关键技术点

| 问题 | 根因 | 解决方案 |
|------|------|----------|
| flex:1 按钮不等宽 | CSS min-content 约束 | `min-width: 0` |
| 文字超长溢出 | 无 overflow 处理 | `overflow: hidden; text-overflow: ellipsis` |
| 按钮高度不一 | 缺少 `size="small"` | 显式添加 + CSS 全局兜底 |
| 非 group 并排按钮 | 无 flex 等分 | `.btn-row-equal` 工具类 |
| 纵向堆叠按钮宽度不一 | el-button inline-flex 不撑满 | `display: flex` + `width: 100%` |
