import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000,
    rollupOptions: { input: {
      main: resolve(__dirname, 'index.html'),
      delivery: resolve(__dirname, 'tests/delivery/index.html'),
      proto: resolve(__dirname, 'tests/proto/index.html'),
    } },
  },
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
