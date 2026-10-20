import { defineConfig } from 'vite';
import { resolve, join, extname } from 'node:path';
import fs from 'node:fs';
// Serves assets/processed at /data in dev and copies it (+ the Basis transcoder) into dist/data at build.
const DATA = resolve(__dirname, 'assets/processed');
function dataPlugin() {
  const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) { const s = join(a, f), d = join(b, f); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } };
  return {
    name: 'harbourline-data',
    configureServer(server) { server.middlewares.use('/data', (req, res, next) => { const f = join(DATA, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(DATA) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return next(); res.setHeader('Content-Type', extname(f) === '.json' ? 'application/json' : 'application/octet-stream'); fs.createReadStream(f).pipe(res); }); },
    closeBundle() { copyDir(DATA, resolve(__dirname, 'dist/data')); copyDir(resolve(__dirname, 'node_modules/three/examples/jsm/libs/basis'), resolve(__dirname, 'dist/data/basis')); },
  };
}
export default defineConfig({
  base: './',
  plugins: [dataPlugin()],
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
