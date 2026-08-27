import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/planlog/',
  build: {
    outDir: 'dist',
    // 把所有小于这个阈值的资源直接内联进 HTML/JS（干掉 plugin-vue_export-helper 那种小文件外链）
    assetsInlineLimit: 100000000,
    // 合并所有 chunks 到一个文件
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true
      }
    }
  }
})