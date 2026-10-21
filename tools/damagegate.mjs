#!/usr/bin/env node
// Vehicle-damage gate. (1) No phantom damage: the player car drives the highway route (bot) for 450 frames, then idles
// for 300, while street/highway traffic drives and idles at lights. This runs at a normal frame rate (?report = fixed
// 1/30 s) and at artificially low ones (?fdt=0.1 = 10 fps; ?fdt=0.1&fdtj = uneven 3-17 fps). No car may log a collision
// impact or lose health without a real contact. (2) Real damage still works: ram the player car into a city block
// at 80 km/h (impact logged, health lost, dents), then fire real rifle rounds through the combat ray path until it
// smokes (<45%), burns (<20%) and explodes into a charred wreck.
// Output: tools/out/damagegate.json. Each check passes or fails on its own; nothing is retried.
import { chromium } from 'playwright'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIST = process.env.DIST || path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const only = process.argv[2]; const results = {};
const SESSIONS = {
  phantom_normal: 'index.html?shot=m3_highway&frames=30&traffic=10',
  phantom_10fps: 'index.html?shot=m3_highway&frames=30&traffic=10&fdt=0.1',
  phantom_uneven: 'index.html?shot=m3_highway&frames=30&traffic=10&fdt=0.1&fdtj',
  real_impacts: 'index.html?report&traffic=0&crowd=20',
};
for (const [name, url] of Object.entries(SESSIONS)) { if (only && only !== name) continue;
  const page = await browser.newPage({ viewport: { width: 400, height: 225 } }); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.text().startsWith('[gate]')) console.log(name, m.text().slice(0, 400)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/${url}`, { timeout: 60000 });
  await page.waitForFunction('window.HARBOURLINE_DEBUG && HARBOURLINE_DEBUG.ready', null, { timeout: 900000, polling: 1000 });
  const r = await page.evaluate(async (name) => {
    const D = window.HARBOURLINE_DEBUG; const sleep = (ms) => new Promise((x) => setTimeout(x, ms)); const frames = async (n) => { const f = D.frames; while (D.frames - f < n) await sleep(200); };
    const out = { steps: [] }; const step = (n, ok, info) => { out.steps.push({ name: n, ok, ...info }); console.log('[gate] ' + n + ' ' + (ok ? 'ok' : 'FAIL') + ' ' + JSON.stringify(info).slice(0, 300)); return ok; };
    D.god = true;
    if (name.startsWith('phantom')) {
      const kmhMax = { v: 0 }; const watch = setInterval(() => { const c = D.cars().find((x) => x.id === 1); if (c) kmhMax.v = Math.max(kmhMax.v, c.kmh); }, 300);
      await frames(450); D.bot(''); await frames(300); clearInterval(watch);
      const cars = D.cars(); const damaged = cars.filter((c) => c.hp < 1000 || c.impacts.length || c.wrecked);
      step('player car actually drove', kmhMax.v > 40, { maxKmh: kmhMax.v });
      step('no car damaged or exploded without contact', damaged.length === 0, { carsWatched: cars.length, damaged: damaged.map((c) => ({ id: c.id, hp: c.hp, wrecked: c.wrecked, impacts: c.impacts.slice(0, 4) })) });
      out.traffic = D.traffic()?.active;
    } else {
      const P = 1; const before = D.cars().find((c) => c.id === P);
      D.teleport(6, 1.0, -140, Math.PI / 2); await frames(20); D.setVelocity(80); await frames(120);
      const rammed = D.cars().find((c) => c.id === P); step('wall ram at 80 km/h registers an impact', rammed.impacts.length > 0 && rammed.hp < before.hp, { hpBefore: before.hp, hpAfter: rammed.hp, impacts: rammed.impacts.slice(0, 3), dents: rammed.dents, glass: rammed.glass });
      step('ram dents the body', rammed.dents > 0, { dents: rammed.dents });
      D.teleport(-4.2, 1.0, -150, 0); await frames(30); const seen = { smoke: 0, fire: false, smokeAtHp: null, fireAtHp: null };
      for (let i = 0; i < 40; i++) { const hits = D.shootCar(P, 3); await frames(6); const c = D.cars().find((x) => x.id === P); const fx = D.fxAlive();
        if (c.hp < 450 && seen.smokeAtHp === null && fx.smoke > 0) { seen.smokeAtHp = c.hp; seen.smoke = fx.smoke; }
        if (c.burnT > 0 && !seen.fire) { seen.fire = true; seen.fireAtHp = c.hp; }
        if (c.wrecked) { await frames(30); break; } if (i === 0) step('rifle rounds hit the car', hits > 0, { hits }); }
      const end = D.cars().find((x) => x.id === P);
      step('smoke below 45% health', seen.smokeAtHp !== null, { smokeAtHp: seen.smokeAtHp, smokeParticles: seen.smoke });
      step('fire below 20% health', seen.fire, { fireAtHp: seen.fireAtHp });
      step('explodes and leaves a charred wreck', end.wrecked && end.charred, { wrecked: end.wrecked, charred: end.charred, hp: end.hp });
    }
    return out;
  }, name);
  r.errors = errors; r.pass = r.steps.every((s) => s.ok) && !errors.length; results[name] = r; console.log(name, r.pass ? 'PASS' : 'FAIL');
  await page.screenshot({ path: path.join(ROOT, `shots/m10/damage_${name}.png`) }); await page.close();
}
fs.writeFileSync(path.join(ROOT, 'tools/out/damagegate.json'), JSON.stringify(results, null, 1)); await browser.close(); server.close();
