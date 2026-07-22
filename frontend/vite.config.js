import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 仅 Vite 工程化：不改 Vue/Pinia。
 * - 开发：npm run dev → http://127.0.0.1:5174 （/api 代理到传感器网关 5173）
 * - 构建：npm run build → dist/，可由网关 staticDir 指向 dist
 */
export default defineConfig({
  root: __dirname,
  publicDir: 'public',
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      // 传感器网关（MQTT/HTTP 推送汇聚）
      '/api': {
        target: 'http://127.0.0.1:5173',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5173',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
