#!/usr/bin/env node
// Headless capture + smoke harness. Serves dist/ with a tiny static server, opens each URL in Chromium
// (SwiftShader WebGL2), waits for `readyExpr` to be truthy, screenshots, and records console errors.
// Usage: node tools/shoot.mjs <jobs.json | inline-json>   job: {url, out?, w?, h?, ready?, timeout?, wait?, eval?}
// Prints one line per job; exits 1 if any job had console errors or timed out.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST || path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.ogg': 'audio/ogg', '.hdr': 'application/octet-stream', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;
const arg = process.argv[2];
const jobs = arg.trim().startsWith('[') || arg.trim().startsWith('{') ? JSON.parse(arg) : JSON.parse(fs.readFileSync(arg, 'utf8'));
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
let bad = 0;
for (const job of [].concat(jobs)) {
  const page = await browser.newPage({ viewport: { width: job.w || 1280, height: job.h || 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 300)));
  const t0 = Date.now(); let status = 'ok', info = '';
  try {
    await page.goto(base + job.url, { timeout: 60000 });
    if (job.ready) await page.waitForFunction(job.ready, null, { timeout: job.timeout || 180000, polling: 500 });
    if (job.wait) await page.waitForTimeout(job.wait);
    if (job.eval) info = JSON.stringify(await page.evaluate(job.eval)).slice(0, job.evalMax || 600);
    if (job.out) { fs.mkdirSync(path.dirname(path.join(ROOT, job.out)), { recursive: true }); await page.screenshot({ path: path.join(ROOT, job.out), timeout: 180000 }); }
  } catch (e) { status = 'FAIL ' + String(e.message).split('\n')[0].slice(0, 160); }
  if (errors.length || status !== 'ok') bad++;
  console.log(`${status} ${job.url} ${((Date.now() - t0) / 1000).toFixed(1)}s errors=${errors.length}${errors.length ? ' [' + errors.slice(0, 3).join(' | ') + ']' : ''} ${info}`);
  await page.close();
}
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
