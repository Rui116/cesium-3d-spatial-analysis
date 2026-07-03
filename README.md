# 三维空间分析

> 基于 **Vite + Vue 3 + CesiumJS** 构建的 GIS 空间分析平台。

[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)](https://vitejs.dev/)
[![Cesium](https://img.shields.io/badge/Cesium-1.142-6CABDF?logo=cesium)](https://cesium.com/)

---

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 基础三维场景 | `/` | 影像/地形切换、视角控制、glTF/3DTiles/GeoJSON 加载、分色渲染、高度可视化、GCJ-02 ↔ WGS-84 坐标转换 |
| 交通态势可视化 | `/traffic` | 高德实时路况、区域绘制、状态色渲染、定时刷新 |
| 可视域分析 | `/viewshed` | 360° 射线采样、地形 LOS 计算、可见面积统计、JSON/GeoJSON/截图导出 |
| 缓冲区分析 | `/buffer` | 点/线缓冲区生成、几何凸包计算、多边形可视化 |
| 路径规划分析 | `/route-planning` | 起终点设置、高德驾车路径查询、3D 发光路径渲染 |
| 视线分析 | `/sightline` | 观察点→目标点有向分析、GIS 标准最大斜率 LOS 算法、分段可视化 |

---

## 快速开始

```bash
npm install
npm run dev      # → http://localhost:3000
npm run build    # 生产构建
```

**环境要求**：Node.js ≥ 18

---

## AI 辅助开发

本项目使用 **Claude Code** 辅助开发，覆盖以下环节：

- 架构设计与技术方案评审
- 空间分析算法验证与调试（Max-Slope 通视分析、360° 射线采样）
- 代码审查与性能优化建议
- 文档自动生成

> 所有 AI 生成代码均经过人工 Review，确保逻辑正确性和代码风格一致性。

---

## 技术架构

```
App.vue ── Cesium Viewer（单例，Pinia Store 共享）
  ├── Sidebar（路由导航）
  └── <router-view>（6 个功能模块，懒加载）
        ├── Home.vue
        ├── TrafficVisualization.vue
        ├── ViewshedAnalysis.vue
        ├── BufferAnalysis.vue
        ├── RoutePlanning.vue
        └── SightlineAnalysis.vue
```

| 类别 | 技术 |
|------|------|
| 构建 | Vite 6 |
| 框架 | Vue 3 Composition API |
| 路由 | Vue Router 4（Hash 模式） |
| 状态 | Pinia |
| 三维引擎 | CesiumJS（npm + vite-plugin-cesium） |
| 地图服务 | 高德 API（交通态势 + 路径规划） |
| GIS 运算 | Turf.js（缓冲区几何计算） |
| UI | Element Plus + 暗色主题 |
| 测试 | Vitest + jsdom |

---

## 项目结构

```
src/
├── main.js
├── App.vue                        # 根组件（Cesium 容器 + 侧边栏）
├── router/index.js                # 路由定义
├── stores/viewer.js               # 全局 Viewer 实例（Pinia）
├── composables/
│   ├── useCesium.js               # Viewer 初始化
│   ├── useImagery.js              # 影像/地形图层管理
│   └── useCoordinate.js           # 坐标转换
├── services/
│   ├── trafficService.js          # 高德交通态势 API
│   └── routeService.js            # 高德路径规划 API
├── utils/
│   └── cesiumHelpers.js           # Entity 工厂函数
├── styles/
│   └── main.css                   # 全局样式系统
└── views/
    ├── Home.vue
    ├── TrafficVisualization.vue
    ├── ViewshedAnalysis.vue
    ├── BufferAnalysis.vue
    ├── RoutePlanning.vue
    └── SightlineAnalysis.vue
```

---

## API 配置

### API Key 配置

复制 `.env.example` 为 `.env`，填入你的 API Key：

```bash
cp .env.example .env
```

```env
# Cesium Ion Token — 前往 https://ion.cesium.com/tokens 创建
VITE_CESIUM_TOKEN=your-cesium-ion-token

# 高德地图 Web 服务 API Key — 前往 https://console.amap.com/ 申请
VITE_AMAP_KEY=your-amap-web-service-key
VITE_AMAP_JSCode=your-amap-js-code
```

> `.env` 已在 `.gitignore` 中，不会提交到仓库。

---

## 部署

项目通过 **GitHub Actions** 自动部署到 GitHub Pages：

[👉 在线演示](https://Rui116.github.io/cesium-3d-spatial-analysis/)

- 推送 `main` 分支自动触发构建与部署
- 静态资源通过 `peaceiris/actions-gh-pages` 发布到 `gh-pages` 分支
- API Key 通过 GitHub Secrets 注入，不暴露在源码中

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/项目文件说明.md](docs/项目文件说明.md) | 📘 各文件用途、数据流、组件树完整说明 |
| [docs/关键代码与技术说明.md](docs/关键代码与技术说明.md) | 📙 架构设计、关键算法、坐标系处理、性能优化等深度解析 |
| [docs/viewshed-analysis.md](docs/viewshed-analysis.md) | 可视域分析问题诊断与修复 |
| [docs/sightline-analysis-fixes.md](docs/sightline-analysis-fixes.md) | 视线分析开发过程中发现并修复的问题 |
| [docs/buffer-analysis.md](docs/buffer-analysis.md) | 缓冲区分析实现说明 |
| [docs/route-planning.md](docs/route-planning.md) | 路径规划分析实现说明 |
| [docs/traffic-visualization.md](docs/traffic-visualization.md) | 交通态势可视化实现说明 |

---

## License

MIT
