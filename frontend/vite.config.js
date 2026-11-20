import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ช่วง dev: หน้าเว็บที่ http://localhost:5173 และส่งต่อ /api ไปยัง backend ที่พอร์ต 8000
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: { output: { manualChunks: { echarts: ['echarts', 'echarts-for-react'], antd: ['antd', '@ant-design/icons'] } } },
  },
})
