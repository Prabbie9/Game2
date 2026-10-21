#!/usr/bin/env node
// M7 stress test: ~40 traffic cars, 100 pedestrians (VAT crowd + cast peds), 20 combatants and 5 simultaneous
// explosions in the streamed city. Plays the real (rendered) loop in headless Chromium (SwiftShader: CPU raster, so
// frame times are NOT real fps; the ratio between phases is the useful number) and records per-frame dt, physics step
// time, draw calls, live cars and live combatants for three phases. Output: tools/out/stresstest.json + shots/m7/stress_*.png
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIST = path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.ktx2': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } }); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?stress`, { timeout: 60000 });
await page.waitForFunction('window.HARBOURLINE_DEBUG && HARBOURLINE_DEBUG.ready', null, { timeout: 300000, polling: 500 });
const D = 'HARBOURLINE_DEBUG';
const record = async (n) => { await page.evaluate(`${D}.rec = []`); await page.waitForFunction(`${D}.rec.length >= ${n}`, null, { timeout: 900000, polling: 1000 }); return page.evaluate(`${D}.rec.slice()`); };
const stat = (rows, i) => { const v = rows.map((r) => r[i]).sort((a, b) => a - b); const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v[v.length - 1], mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) }; };
const sum = (rows) => ({ frames: rows.length, frameMs: stat(rows, 0), physicsMs: stat(rows, 1), draws: stat(rows, 2).mean, cars: stat(rows, 3).max, combatants: stat(rows, 4).max });
await page.evaluate(`${D}.god = true; ${D}.setTraffic(12)`); await page.waitForTimeout(4000);
const A = await record(90); await page.screenshot({ path: path.join(ROOT, 'shots/m7/stress_a.png') });
await page.evaluate(`${D}.setTraffic(40); ${D}.spawnHostiles(20, 22)`);
await page.waitForFunction(`${D}.traffic().active >= 34 && ${D}.pending() === 0 && ${D}.hostiles().length >= 20`, null, { timeout: 600000, polling: 1000 }).catch(() => console.log('warn: load wait timed out'));
const B = await record(150); await page.screenshot({ path: path.join(ROOT, 'shots/m7/stress_b.png') });
await page.evaluate(`{ const p = ${D}.player.position; for (let i = 0; i < 5; i++) { const a = i * 1.2566; ${D}.explode(p.x + Math.cos(a) * 16, p.y + 0.5, p.z + Math.sin(a) * 16, 6); } }`);
const C = await record(90); await page.screenshot({ path: path.join(ROOT, 'shots/m7/stress_c.png') });
const out = { note: 'SwiftShader (CPU) frame times: compare phases, not absolute fps', viewport: '640x360', tier: await page.evaluate(`${D}.stats().tier`), baseline: sum(A), loaded: sum(B), explosions: sum(C), errors };
out.degradation = { loadedVsBaseline_p50: +(out.loaded.frameMs.p50 / out.baseline.frameMs.p50).toFixed(2), loadedVsBaseline_p99: +(out.loaded.frameMs.p99 / out.baseline.frameMs.p99).toFixed(2), explosionsVsLoaded_p99: +(out.explosions.frameMs.p99 / out.loaded.frameMs.p99).toFixed(2) };
fs.mkdirSync(path.join(ROOT, 'tools/out'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'tools/out/stresstest.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out)); await browser.close(); server.close();
