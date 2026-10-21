#!/usr/bin/env node
// M9 laptop tier pass: renders the same Downtown golden-hour view (shot m3_golden) and the Harbour view on every tier
// and logs draw calls, triangles, estimated texture memory and JS heap against the tier budgets below.
// SwiftShader raster: counts and memory are real, frame times are not. Output: tools/out/tierpass.json
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BUDGET = { low: { draws: 1200, tris: 1.0e6, texMB: 1024, heapMB: 700 }, medium: { draws: 2000, tris: 2.5e6, texMB: 2048, heapMB: 900 }, high: { draws: 3000, tris: 5e6, texMB: 4096, heapMB: 1200 }, ultra: { draws: 4500, tris: 8e6, texMB: 8192, heapMB: 1600 } };
const EVAL = `(()=>{const D=HARBOURLINE_DEBUG,R=D.R;const seen=new Set();let bytes=0;R.scene.traverse(o=>{const ms=o.material?[o.material].flat():[];for(const m of ms)for(const k in m){const t=m[k];if(t&&t.isTexture&&!seen.has(t)){seen.add(t);if(t.isCompressedTexture&&t.mipmaps)bytes+=t.mipmaps.reduce((a,x)=>a+(x.data?.byteLength||0),0);else if(t.image&&t.image.width)bytes+=t.image.width*t.image.height*4*1.33;}}});
  const s=D.stats();return JSON.stringify({tier:s.tier,draws:R.stats.drawCalls,tris:R.stats.triangles,textures:seen.size,texMB:Math.round(bytes/1e6),heapMB:s.heapMB,geometries:R.renderer.info.memory.geometries})})()`;
const out = {};
for (const tier of Object.keys(BUDGET)) for (const view of ['m3_golden', 'm8_harbour']) {
  const job = [{ url: `index.html?shot=${view}&tier=${tier}`, w: 1280, h: 720, timeout: 600000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready', eval: EVAL, evalMax: 2000 }];
  const r = execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: { ...process.env }, encoding: 'utf8', timeout: 900000 });
  const m = r.match(/"(\{.*\})"/); const v = m ? JSON.parse(JSON.parse('"' + m[1] + '"')) : { error: r.slice(0, 200) }; const b = BUDGET[tier];
  v.within = v.error ? null : { draws: v.draws <= b.draws, tris: v.tris <= b.tris, texMB: v.texMB <= b.texMB, heapMB: (v.heapMB ?? 0) <= b.heapMB };
  (out[tier] ??= {})[view] = v; console.log(tier, view, JSON.stringify(v));
}
fs.writeFileSync(path.join(ROOT, 'tools/out/tierpass.json'), JSON.stringify({ budgets: BUDGET, results: out }, null, 1));
