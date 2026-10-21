import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端开发服务器默认 5173，通过 proxy 把 /api 与 /socket.io 转发到后端 3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
