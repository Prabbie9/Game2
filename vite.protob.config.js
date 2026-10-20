// Separate build for the WebGPU/TSL prototype: TSL addons expect `three` to resolve to the WebGPU build.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './', root: resolve(__dirname, 'tests/protob'),
  resolve: { alias: [{ find: /^three$/, replacement: resolve(__dirname, 'node_modules/three/build/three.webgpu.js') }] },
  build: { target: 'es2022', outDir: resolve(__dirname, 'dist/protob'), emptyOutDir: true },
});
