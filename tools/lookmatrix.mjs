#!/usr/bin/env node
// Look matrix for Phase 2: fixed cameras in Downtown (m3_golden camera) and Harbour (m8_harbour camera) x day / night /
// rain, per tier, into shots/look/<label>/<tier>_<view>_<light>.png plus a contact sheet per tier.
// Iteration runs: Low + Medium at 960x540. The full matrix (all tiers, 1280x720) runs once at the end of the phase.
// One screenshot job at a time; a job with no output for 40 minutes is killed and reported. A near-black frame (mean
// luminance < 15) is reported as BLACK so a broken capture is never mistaken for a result.
// Usage: node tools/lookmatrix.mjs <label> [tiers=low,medium] [w=960] [h=540]
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [label = 'base', tierArg = 'low,medium', W = '960', H = '540'] = process.argv.slice(2); const dir = path.join('shots/look', label); fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
const VIEWS = { downtown: 'm3_golden', harbour: 'm8_harbour' }; const LIGHT = { day: 't=14&w=clear', night: 't=22.5&w=clear', rain: 't=16&w=rain' };
const LIMIT_MS = 40 * 60 * 1000; let failed = false;
for (const tier of tierArg.split(',')) { const outs = [];
  for (const [v, shot] of Object.entries(VIEWS)) for (const [l, q] of Object.entries(LIGHT)) {
    const out = `${dir}/${tier}_${v}_${l}.png`; const job = [{ url: `index.html?shot=${shot}&tier=${tier}&${q}`, out, w: +W, h: +H, timeout: LIMIT_MS, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready' }];
    // Medium/High captures intermittently come out black in this container (open issue, see PLAYTEST M10): a black
    // capture is retried up to twice and every retry is reported; it never counts as a result.
    let black = true, lum = '0', tries = 0, t0 = Date.now(), dead = false;
    while (black && tries < 3) { tries++; t0 = Date.now();
      try { execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: process.env, encoding: 'utf8', timeout: LIMIT_MS, killSignal: 'SIGKILL', cwd: ROOT }); }
      catch (e) { console.log(`TIMEOUT/ERROR ${out} after ${((Date.now() - t0) / 60000).toFixed(1)} min: ${String(e.message).slice(0, 160)}`); failed = dead = true; break; }
      lum = execFileSync('python3', ['-W', 'ignore', '-c', `from PIL import Image\nim=Image.open('${out}').convert('L').resize((96,54))\nprint(round(sum(im.getdata())/(96*54),1))`], { encoding: 'utf8', cwd: ROOT }).trim();
      black = +lum < 15; if (black) console.log(`black capture ${out} (try ${tries})`); }
    if (dead) continue; if (black) failed = true; outs.push(out); console.log(`${black ? 'BLACK' : 'ok'} ${out} lum ${lum} tries ${tries} ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  if (outs.length) console.log(execFileSync('python3', [path.join(ROOT, 'tools/sheet.py'), `${dir}/${tier}_sheet.jpg`, '3', '640', ...outs], { encoding: 'utf8', cwd: ROOT }).trim());
}
console.log(failed ? 'LOOKMATRIX INCOMPLETE' : 'LOOKMATRIX DONE');
