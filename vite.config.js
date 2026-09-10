import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api/v1': {
        target: process.env.ESSERSALES_DEV_API || 'http://192.168.0.245:8080',
        changeOrigin: true,
      },
    },
  },
  // Phase 4 — excel parse worker (code-split 시 iife 불가 → es)
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          if (id.includes('node_modules/exceljs')) return 'exceljs'
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/vue-chartjs')) {
            return 'charts'
          }
        },
      },
    },
  },
})
