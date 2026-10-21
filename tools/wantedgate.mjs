#!/usr/bin/env node
// M7 wanted-system gate: WASTED (death -> banner -> respawn, stars cleared), LOSE POLICE (no line of sight for
// 8 s + 3 s/star -> stars clear) and BUSTED (1 star, player standing still on foot near an officer for 1.6 s).
// Runs the real game loop in ?report mode (fixed 1/30 s per frame, so timings are in simulated seconds).
// Each test passes or fails on its own; nothing is retried. Output: tools/out/wantedgate.json
import { chromium } from 'playwright'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIST = process.env.DIST || path.join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const only = process.argv[2]; const results = {};
for (const test of ['wasted', 'lose_police', 'busted']) { if (only && only !== test) continue;
  const page = await browser.newPage({ viewport: { width: 400, height: 225 } }); const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.text().startsWith('[gate]')) console.log(test, m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?report&traffic=6&crowd=30`, { timeout: 60000 });
  await page.waitForFunction('window.HARBOURLINE_DEBUG && HARBOURLINE_DEBUG.ready', null, { timeout: 600000, polling: 1000 });
  const r = await page.evaluate(async (test) => {
    const D = window.HARBOURLINE_DEBUG; const sleep = (ms) => new Promise((x) => setTimeout(x, ms)); const f0 = () => D.frames; const simS = (from) => (D.frames - from) / 30;
    const until = async (pred, maxSim, label) => { const s = f0(); let n = 0; while (simS(s) < maxSim) { const v = pred(); if (v) return { ok: true, at: +simS(s).toFixed(1) }; if (++n % 20 === 0) console.log('[gate] waiting ' + label + ' sim ' + simS(s).toFixed(1) + ' ' + JSON.stringify({ g: D.gameState(), w: D.wanted() && { stars: D.wanted().stars, unseen: D.wanted().unseen, units: D.wanted().units, officers: D.wanted().officers } })); await sleep(300); } return { ok: false, at: +simS(s).toFixed(1), last: { g: D.gameState(), w: D.wanted() } }; };
    const out = { steps: [] }; const step = (name, res) => { out.steps.push({ name, ...res }); console.log('[gate] ' + name + ' ' + JSON.stringify(res).slice(0, 300)); return res.ok; };
    if (test === 'wasted') {
      D.crime('shot'); const start = D.gameState().pos; D.playerDamage(250);
      if (!step('banner WASTED shown', await until(() => D.gameState().banner === 'WASTED', 2, 'wasted banner'))) return out;
      step('respawned (banner cleared, health 200, on foot)', await until(() => { const g = D.gameState(); return g.banner === '' && g.health === 200 && g.pstate === 'foot'; }, 8, 'respawn'));
      step('stars cleared', { ok: D.wanted().stars === 0, stars: D.wanted().stars }); out.start = start; out.end = D.gameState().pos;
    }
    if (test === 'lose_police') {
      D.god = true; D.crime('hitPed'); step('2 stars set', { ok: D.wanted().stars === 2, stars: D.wanted().stars });
      step('a cruiser dispatched', await until(() => D.wanted().units >= 1, 15, 'dispatch'));
      D.place('harbour'); // 1.2 km away: no unit can see the player
      const r = await until(() => D.wanted().stars === 0, 30, 'evade'); r.expected = '8 + 3*2 = 14 s unseen'; step('stars cleared after losing line of sight', r);
      out.evaded = D.wanted().stats.evaded;
    }
    if (test === 'busted') {
      D.god = true; D.crime('shot'); step('1 star set', { ok: D.wanted().stars === 1, stars: D.wanted().stars });
      step('officers deployed', await until(() => D.wanted().officers >= 1, 60, 'officers'));
      step('BUSTED (officer within 2.4 m of a still player for 1.6 s)', await until(() => D.gameState().banner === 'BUSTED', 60, 'busted'));
      out.nearestCop = D.gameState().nearestCop;
    }
    return out;
  }, test);
  r.errors = errors; r.pass = r.steps.every((s) => s.ok) && !errors.length; results[test] = r; console.log(test, r.pass ? 'PASS' : 'FAIL');
  await page.screenshot({ path: path.join(ROOT, `shots/m7/gate_${test}.png`) }); await page.close();
}
fs.writeFileSync(path.join(ROOT, 'tools/out/wantedgate.json'), JSON.stringify(results, null, 1)); await browser.close(); server.close();
