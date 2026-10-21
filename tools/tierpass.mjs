#!/usr/bin/env node
// Tier pass: renders fixed views on each tier and logs draw calls, triangles, estimated texture memory and JS heap.
// Views: Downtown golden hour (shot m3_golden) and Harbour (m8_harbour), each plain and under the stress load
// (?stress: 40 traffic cars + 100 pedestrians, plus 20 combatants and 5 simultaneous explosions spawned in-page).
// Triangles are reported two ways:
//   mainTris  = triangles of meshes inside the main camera frustum, counted once (three.js per-object frustum culling)
//   loadMB    = bytes fetched by the page so far (resource timing; local server, uncompressed)
//   passTris  = renderer.info total for the frame (main pass + every shadow cascade + depth/normal pre-passes)
// SwiftShader raster: counts and memory are real, frame times are not measured here. Output: tools/out/tierpass.json
// Usage: node tools/tierpass.mjs [tiers=lite,low,medium,high] [views=downtown,harbour,downtown_stress,harbour_stress]
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TARGET_DRAWS = { lite: 800, low: 1200, medium: 1800, high: 2500, ultra: 4500 };
const BUDGET = { lite: { texMB: 512, heapMB: 600 }, low: { texMB: 1024, heapMB: 700 }, medium: { texMB: 2048, heapMB: 900 }, high: { texMB: 4096, heapMB: 1200 }, ultra: { texMB: 8192, heapMB: 1600 } };
const VIEWS = { downtown: 'm3_golden', harbour: 'm8_harbour', downtown_stress: 'm3_golden', harbour_stress: 'm8_harbour' };
const tiers = (process.argv[2] ?? 'lite,low,medium,high').split(','); const views = (process.argv[3] ?? Object.keys(VIEWS).join(',')).split(',');
const MEASURE = `const R=D.R;const seen=new Set();let bytes=0;R.scene.traverse(o=>{const ms=o.material?[o.material].flat():[];for(const m of ms)for(const k in m){const t=m[k];if(t&&t.isTexture&&!seen.has(t)){seen.add(t);if(t.isCompressedTexture&&t.mipmaps)bytes+=t.mipmaps.reduce((a,x)=>a+(x.data?.byteLength||0),0);else if(t.image&&t.image.width)bytes+=t.image.width*t.image.height*4*1.33;}}});
  const cam=R.camera;cam.updateMatrixWorld();const fr=new D.THREE.Frustum().setFromProjectionMatrix(new D.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse));let mainTris=0,mainMeshes=0;
  R.scene.traverseVisible(o=>{if(!o.isMesh&&!o.isInstancedMesh)return;if(o.frustumCulled!==false){if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();const sp=o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);if(!fr.intersectsSphere(sp))return;}
    const g=o.geometry;const n=(g.index?g.index.count:g.attributes.position.count)/3;mainTris+=n*(o.isInstancedMesh?o.count:1);mainMeshes++;});
  const s=D.stats();const loadMB=Math.round(performance.getEntriesByType('resource').reduce((a,e)=>a+(e.transferSize||e.encodedBodySize||0),0)/1e6);return JSON.stringify({tier:s.tier,loadMB,draws:R.stats.drawCalls,passTris:R.stats.triangles,mainTris:Math.round(mainTris),mainMeshes,texMB:Math.round(bytes/1e6),heapMB:s.heapMB,cars:D.traffic?D.traffic().active:null,hostiles:D.hostiles().length})`;
const out = {};
for (const tier of tiers) for (const view of views) {
  const stress = view.endsWith('_stress');
  const ev = stress
    ? `(async()=>{const D=HARBOURLINE_DEBUG;const w=(ms)=>new Promise(r=>setTimeout(r,ms));D.god=true;D.spawnHostiles(20,22);const t0=Date.now();while(Date.now()-t0<400000&&!(D.pending()===0&&D.hostiles().length>=20))await w(2000);
        const p=D.player.position;for(let i=0;i<5;i++){const a=i*1.2566;D.explode(p.x+Math.cos(a)*16,p.y+0.5,p.z+Math.sin(a)*16,6);}const f=D.frames;while(D.frames-f<8)await w(300);${MEASURE}})()`
    : `(()=>{const D=HARBOURLINE_DEBUG;${MEASURE}})()`;
  const job = [{ url: `index.html?shot=${VIEWS[view]}&tier=${tier}${stress ? '&stress' : ''}`, w: 1280, h: 720, timeout: 900000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready', eval: ev, evalMax: 2000 }];
  let v;
  try { const r = execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: process.env, encoding: 'utf8', timeout: 1500000 }); const m = r.match(/"(\{.*\})"/); v = m ? JSON.parse(JSON.parse('"' + m[1] + '"')) : { error: r.slice(0, 300) }; }
  catch (e) { v = { error: String(e.stdout || e.message).slice(0, 300) }; }
  if (!v.error) v.within = { draws: v.draws <= TARGET_DRAWS[tier], texMB: v.texMB <= BUDGET[tier].texMB, heapMB: (v.heapMB ?? 0) <= BUDGET[tier].heapMB };
  (out[tier] ??= {})[view] = v; console.log(tier, view, JSON.stringify(v));
}
fs.mkdirSync(path.join(ROOT, 'tools/out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools/out/tierpass.json'), JSON.stringify({ targets: TARGET_DRAWS, budgets: BUDGET, results: out, when: new Date().toISOString() }, null, 1));
