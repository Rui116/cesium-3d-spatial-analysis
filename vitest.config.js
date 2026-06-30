import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // jsdom 模拟浏览器环境，部分测试（CoordinateConverter）不需要 DOM，
    // 但 trafficService 等模块顶层 import 会间接触发 cesium，统一用 jsdom
    environment: 'jsdom',
    globals: true,
    include: ['src/__tests__/**/*.test.js'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@views': path.resolve(__dirname, 'src/views'),
      '@composables': path.resolve(__dirname, 'src/composables'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@stores': path.resolve(__dirname, 'src/stores'),
      '@assets': path.resolve(__dirname, 'src/assets'),
    },
  },
})
