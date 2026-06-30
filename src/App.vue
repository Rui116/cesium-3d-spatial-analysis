<template>
  <div class="mcs-shell">
    <!-- Cesium 三维场景容器 -->
    <div id="cesiumContainer" ref="cesiumContainer"></div>

    <!-- 侧边导航栏 -->
    <nav class="mcs-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <!-- 品牌区 -->
      <div class="sidebar-brand">
        <div class="brand-mark">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="12" stroke="#00e5ff" stroke-width="1.2" opacity="0.35"/>
            <circle cx="14" cy="14" r="6" stroke="#00e5ff" stroke-width="1.5" opacity="0.7"/>
            <circle cx="14" cy="14" r="2" fill="#00e5ff"/>
            <line x1="14" y1="2" x2="14" y2="8" stroke="#00e5ff" stroke-width="1" opacity="0.6"/>
            <line x1="14" y1="20" x2="14" y2="26" stroke="#00e5ff" stroke-width="1" opacity="0.6"/>
            <line x1="2" y1="14" x2="8" y2="14" stroke="#00e5ff" stroke-width="1" opacity="0.6"/>
            <line x1="20" y1="14" x2="26" y2="14" stroke="#00e5ff" stroke-width="1" opacity="0.6"/>
          </svg>
        </div>
        <div class="brand-text" v-show="!sidebarCollapsed">
          <div class="brand-title">三维空间分析</div>

        </div>
        <button class="sidebar-ctrl" @click="sidebarCollapsed = !sidebarCollapsed">
          <span v-if="sidebarCollapsed">▶</span>
          <span v-else>◀</span>
        </button>
      </div>

      <!-- 导航菜单 -->
      <el-menu
        :default-active="currentRoute"
        :collapse="sidebarCollapsed"
        :router="true"
        background-color="transparent"
        class="sidebar-menu"
      >
        <el-menu-item index="/">
          <span class="nav-icon">🌍</span>
          <template #title>基础三维场景</template>
        </el-menu-item>
        <el-menu-item index="/traffic">
          <span class="nav-icon">🚦</span>
          <template #title>交通态势可视化</template>
        </el-menu-item>
        <el-menu-item index="/viewshed">
          <span class="nav-icon">🔭</span>
          <template #title>可视域分析</template>
        </el-menu-item>
        <el-menu-item index="/buffer">
          <span class="nav-icon">🎯</span>
          <template #title>缓冲区分析</template>
        </el-menu-item>
        <el-menu-item index="/route-planning">
          <span class="nav-icon">📍</span>
          <template #title>路径规划分析</template>
        </el-menu-item>
        <el-menu-item index="/sightline">
          <span class="nav-icon">👁️</span>
          <template #title>视线分析</template>
        </el-menu-item>
      </el-menu>

      <!-- 底部状态 -->
      <div class="sidebar-footer" v-show="!sidebarCollapsed">
        <div class="footer-status">
          <span class="status-dot online"></span>
          <span>系统运行中</span>
        </div>
        <div class="footer-time">{{ currentTime }}</div>
      </div>
    </nav>

    <!-- 页面面板区域 -->
    <div class="mcs-panel-zone" :class="{ 'sidebar-open': !sidebarCollapsed }">
      <router-view v-slot="{ Component }">
        <transition name="panel-trans" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useCesium } from '@composables/useCesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

const route = useRoute()
const currentRoute = computed(() => route.path)

const sidebarCollapsed = ref(false)
const cesiumContainer = ref(null)

// Cesium 初始化
useCesium(cesiumContainer)

// 时钟
const currentTime = ref('')
let clockTimer = null
onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
})
onUnmounted(() => clearInterval(clockTimer))
</script>

<style scoped>
/* ============================================================
   App Shell — 三维空间分析布局
   ============================================================ */

.mcs-shell {
  width: 100vw; height: 100vh;
  position: relative; overflow: hidden;
}

#cesiumContainer {
  position: absolute; inset: 0;
}

/* ---- Sidebar -------------------------------------------- */
.mcs-sidebar {
  position: absolute; top: 14px; left: 14px; bottom: 14px;
  z-index: 1000;
  width: 230px;
  background: rgba(8, 14, 26, 0.94);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(0, 229, 255, 0.08);
  border-radius: 14px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.60),
    inset 0 1px 0 rgba(0, 229, 255, 0.03);
  display: flex; flex-direction: column;
  transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.mcs-sidebar.collapsed {
  width: 70px;
}

/* 品牌区 */
.sidebar-brand {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 14px 12px;
}

.brand-mark svg { display: block; flex-shrink: 0; }

.brand-text { overflow: hidden; white-space: nowrap; }
.brand-title {
  font-family: var(--font-display); font-size: 16px; font-weight: 700;
  letter-spacing: 2px; color: #e0eaf6; line-height: 1.1;
}
.brand-subtitle {
  font-family: var(--font-body); font-size: 10px; font-weight: 500;
  letter-spacing: 1px; color: #62758a; line-height: 1.2;
}

.sidebar-ctrl {
  margin-left: auto; flex-shrink: 0;
  width: 26px; height: 26px; border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px; background: transparent;
  color: #556878; font-size: 10px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.sidebar-ctrl:hover {
  border-color: rgba(0, 229, 255, 0.35);
  color: var(--hud-cyan);
}

/* 菜单 */
.sidebar-menu {
  flex: 1; padding: 6px 6px; overflow-y: auto; overflow-x: hidden;
  background: transparent !important;
}
.sidebar-menu .el-menu-item {
  margin: 1px 0;
}
.nav-icon {
  font-size: 17px; width: 24px; text-align: center; flex-shrink: 0;
  margin-right: 4px;
}

/* 底部状态 */
.sidebar-footer {
  padding: 12px 14px; border-top: 1px solid rgba(0, 229, 255, 0.06);
}
.footer-status {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 10px; color: #556878;
  letter-spacing: 1px;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #3d5a70; }
.status-dot.online {
  background: var(--hud-green);
  box-shadow: 0 0 6px rgba(0, 230, 118, 0.50);
  animation: pulse-glow 2s ease-in-out infinite;
}
.footer-time {
  font-family: var(--font-mono); font-size: 10px; color: #3d5a70;
  letter-spacing: 0.5px; margin-top: 4px;
}

/* ---- Panel Zone ----------------------------------------- */
.mcs-panel-zone {
  position: absolute; top: 0; left: 258px; right: 0; bottom: 0;
  pointer-events: none; transition: left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.mcs-sidebar.collapsed ~ .mcs-panel-zone { left: 98px; }
.mcs-panel-zone > * { pointer-events: none; }

/* 面板过渡动画 */
.panel-trans-enter-active,
.panel-trans-leave-active { transition: all 0.25s ease; }
.panel-trans-enter-from { opacity: 0; transform: translateY(6px); }
.panel-trans-leave-to   { opacity: 0; transform: translateY(-6px); }
</style>
