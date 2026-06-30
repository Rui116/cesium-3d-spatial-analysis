import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@views/Home.vue'),
    meta: { title: '基础三维场景', icon: '🌍' },
  },
  {
    path: '/traffic',
    name: 'TrafficVisualization',
    component: () => import('@views/TrafficVisualization.vue'),
    meta: { title: '交通态势可视化', icon: '🚦' },
  },
  {
    path: '/viewshed',
    name: 'ViewshedAnalysis',
    component: () => import('@views/ViewshedAnalysis.vue'),
    meta: { title: '可视域分析', icon: '🔭' },
  },
  {
    path: '/buffer',
    name: 'BufferAnalysis',
    component: () => import('@views/BufferAnalysis.vue'),
    meta: { title: '缓冲区分析', icon: '🎯' },
  },
  {
    path: '/route-planning',
    name: 'RoutePlanning',
    component: () => import('@views/RoutePlanning.vue'),
    meta: { title: '路径规划分析', icon: '📍' },
  },
  {
    path: '/sightline',
    name: 'SightlineAnalysis',
    component: () => import('@views/SightlineAnalysis.vue'),
    meta: { title: '视线分析', icon: '👁️' },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
