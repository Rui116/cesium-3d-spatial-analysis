import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  // GitHub Pages 部署时通过环境变量 BASE 指定子路径，默认 '/' 用于本地开发
  base: process.env.BASE || '/',
  plugins: [
    vue(),
    cesium(),
    // 为 3D Tiles 二进制文件设置正确的 MIME 类型
    {
      name: '3d-tiles-mime',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || ''
          if (url.endsWith('.b3dm')) {
            res.setHeader('Content-Type', 'application/octet-stream')
          } else if (url.endsWith('.i3dm')) {
            res.setHeader('Content-Type', 'application/octet-stream')
          } else if (url.endsWith('.pnts')) {
            res.setHeader('Content-Type', 'application/octet-stream')
          } else if (url.endsWith('.cmpt')) {
            res.setHeader('Content-Type', 'application/octet-stream')
          } else if (url.endsWith('.glb')) {
            res.setHeader('Content-Type', 'model/gltf-binary')
          }
          next()
        })
      },
    },
  ],
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      '@': '/src',
      '@components': '/src/components',
      '@views': '/src/views',
      '@composables': '/src/composables',
      '@services': '/src/services',
      '@utils': '/src/utils',
      '@stores': '/src/stores',
      '@assets': '/src/assets',
    },
  },
})
