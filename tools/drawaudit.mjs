#!/usr/bin/env node
// Draw-call audit: for one view, groups visible meshes by category (chunk batches, traffic/player cars, parked cars,
// characters, crowd instances, harbour, other) and estimates draws as meshes * (1 + shadow cascades if castShadow).
// Usage: node tools/drawaudit.mjs <shot> <tier>   (uses dist/, or DIST=...)
import { execFileSync } from 'node:child_process'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const [shot = 'm3_golden', tier = 'low'] = process.argv.slice(2);
const ev = `(()=>{const D=HARBOURLINE_DEBUG,R=D.R;const casc=(R.tier&&R.tier.cascades)||2;const cats={};const add=(k,m)=>{const c=cats[k]??={meshes:0,shadow:0,est:0};c.meshes++;if(m.castShadow){c.shadow++;}c.est+=1+(m.castShadow?casc:0)};
  const carRoots=new Set();(D.trafficSys?.cars||[]).forEach(c=>carRoots.add(c.vis.root));
  const cat=(o)=>{for(let p=o;p;p=p.parent){if(carRoots.has(p))return 'traffic car';if(p.userData&&p.userData.hlCat)return p.userData.hlCat;if(p.isSkinnedMesh)return 'character';if(p.isInstancedMesh)return 'instanced';if(p.name&&/^chunk|^c-?\\d/.test(p.name))return 'chunk';}return null};
  R.scene.traverseVisible(o=>{if(!o.isMesh)return;let k=cat(o);if(!k){let p=o;while(p.parent&&p.parent!==R.scene)p=p.parent;k='top:'+(p.name||p.type)+(p.children?'('+p.children.length+')':'');}add(k,o)});
  const rows=Object.entries(cats).sort((a,b)=>b[1].est-a[1].est).slice(0,22);return JSON.stringify({tier:D.stats().tier,draws:R.stats.drawCalls,cascades:casc,rows})})()`;
const job = [{ url: `index.html?shot=${shot}&tier=${tier}`, w: 1280, h: 720, timeout: 600000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready', eval: ev, evalMax: 4000 }];
const r = execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: process.env, encoding: 'utf8', timeout: 900000 });
const m = r.match(/"(\{.*\})"/); const v = JSON.parse(JSON.parse('"' + m[1] + '"')); console.log(shot, v.tier, 'draws', v.draws, 'cascades', v.cascades);
for (const [k, c] of v.rows) console.log(String(c.est).padStart(6), String(c.meshes).padStart(5), 'meshes', String(c.shadow).padStart(5), 'cast', ' ', k);
