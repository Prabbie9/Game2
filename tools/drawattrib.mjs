#!/usr/bin/env node
// Exact draw-call attribution: wraps renderer.renderBufferDirect for one frame and counts every draw by pass (main camera
// vs shadow camera) and by owner (top-level scene child, its hlCat tag or type, plus the mesh kind).
// Usage: node tools/drawattrib.mjs <shot> <tier> [stress]   (stress = 20 combatants + 5 explosions, as in the tier pass)
import { execFileSync } from 'node:child_process'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [shot = 'm8_harbour', tier = 'lite', stress] = process.argv.slice(2);
const COUNT = `const R=D.R,r=R.renderer;const owner=o=>{let p=o;while(p.parent&&p.parent!==R.scene)p=p.parent;let sk=0;p.traverse(x=>{if(x.isSkinnedMesh)sk++});let mc=0;p.traverse(x=>{if(x.isMesh)mc++});return (p.userData.hlCat||(sk?'character':p.isInstancedMesh?'instanced':p.isSprite?'sprite':p.type+'('+(p.name||p.children[0]?.name||'')+' '+mc+'m)'))+(o.isInstancedMesh?'/inst':o.isSkinnedMesh?'/skin':o.isSprite?'/sprite':'')};
  const tally={};let n=0;const orig=r.renderBufferDirect.bind(r);r.renderBufferDirect=function(cam,scene,geo,mat,obj,grp){const pass=cam===R.camera?'main':cam.isOrthographicCamera?'shadow':cam.isPerspectiveCamera?'other-persp':'other';const k=pass+' '+owner(obj);tally[k]=(tally[k]||0)+1;n++;return orig(cam,scene,geo,mat,obj,grp)};
  const f=D.frames;while(D.frames-f<2)await w(100);r.renderBufferDirect=orig;return JSON.stringify({draws:R.stats.drawCalls,counted:n,tally:Object.entries(tally).sort((a,b)=>b[1]-a[1])})`;
const ev = `(async()=>{const D=HARBOURLINE_DEBUG;const w=(ms)=>new Promise(r=>setTimeout(r,ms));${stress ? `D.god=true;D.spawnHostiles(20,22);const t0=Date.now();while(Date.now()-t0<400000&&!(D.pending()===0&&D.hostiles().length>=20))await w(2000);
  const p=D.player.position;for(let i=0;i<5;i++){const a=i*1.2566;D.explode(p.x+Math.cos(a)*16,p.y+0.5,p.z+Math.sin(a)*16,6);}{const f=D.frames;while(D.frames-f<8)await w(300);}` : ''}${COUNT}})()`;
const job = [{ url: `index.html?shot=${shot}&tier=${tier}${stress ? '&stress' : ''}`, w: 1280, h: 720, timeout: 900000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready', eval: ev, evalMax: 8000 }];
const r = execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: process.env, encoding: 'utf8', timeout: 1500000 });
const m = r.match(/"(\{.*\})"/); const v = m ? JSON.parse(JSON.parse('"' + m[1] + '"')) : null; if (!v) { console.log(r.slice(0, 500)); process.exit(1); }
console.log(`${shot} ${tier}${stress ? ' stress' : ''}: draws ${v.draws} (counted ${v.counted} in the measured frame)`); for (const [k, c] of v.tally) console.log(String(c).padStart(5), k);
