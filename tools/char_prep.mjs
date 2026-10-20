#!/usr/bin/env node
// Character prep: Sketchfab / Mixamo-rigged GLB -> game-ready LOD0 + LOD1 (crowd) GLBs in assets/processed/chars/.
//  - joints renamed to bare Mixamo names ("mixamorig:LeftArm_011" -> "LeftArm"), animations stripped
//  - meshopt simplification to a triangle budget (LOD0 ~24k, LOD1 ~6k), welded + pruned
//  - textures resized and re-encoded as WebP (LOD0 1024, LOD1 512)
//  - manifest assets/processed/chars/cast.json: height, tris, materials, source uid
// Usage: node tools/char_prep.mjs <id> <source.glb> [--lod0 24000] [--lod1 6000] [--sex m|f] [--uid UID]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, metalRough, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/processed/chars');
const a = process.argv.slice(2); const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const [id, src] = a; if (!id || !src) { console.error('usage: char_prep.mjs <id> <source.glb>'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bare = (n) => n.replace(/_\d+$/, '').replace(/^.*mixamorig\d*[:_]?/i, '').replace(/^.*:/, '');
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return t | 0; };

// Bounds of the skinned bind pose (glTF ignores a skinned mesh node's own transform): each vertex through its
// strongest joint's world matrix x inverse bind matrix. Node-based bounds are wrong for many Sketchfab exports.
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function skinnedBounds(r) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const n of r.listNodes()) { const m = n.getMesh(), sk = n.getSkin(); if (!m) continue;
    const joints = sk ? sk.listJoints() : []; const ibm = sk?.getInverseBindMatrices();
    const mats = sk ? joints.map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, new Array(16)) : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])) : null;
    for (const p of m.listPrimitives()) { const P = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); const v = [0, 0, 0], jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
      for (let i = 0; i < P.getCount(); i += 3) { P.getElement(i, v); let M = n.getWorldMatrix();
        if (mats && J && W) { J.getElement(i, jj); W.getElement(i, ww); let b = 0; for (let k = 1; k < 4; k++) if (ww[k] > ww[b]) b = k; M = mats[jj[b]]; }
        const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
        const w = [x, y, z]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } } } }
  return { min: mn, max: mx };
}

// Drop triangles that bridge the two legs (a vertex driven by one lower leg and another by the other leg): they stretch
// into a visible thread between the knees in every stride. Returns the number removed.
function dropCrossLegTris(r) {
  let removed = 0;
  for (const n of r.listNodes()) { const m = n.getMesh(), sk = n.getSkin(); if (!m || !sk) continue; const names = sk.listJoints().map((j) => j.getName());
    const side = names.map((nm) => (/^Left(Leg|Foot|ToeBase|Toe_End)$/.test(nm) ? 'L' : /^Right(Leg|Foot|ToeBase|Toe_End)$/.test(nm) ? 'R' : /^LeftUpLeg$/.test(nm) ? 'l' : /^RightUpLeg$/.test(nm) ? 'r' : ''));
    for (const p of m.listPrimitives()) { const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'), I = p.getIndices(); if (!J || !W || !I) continue;
      const dom = (v) => { const j = J.getElement(v, [0, 0, 0, 0]), w = W.getElement(v, [0, 0, 0, 0]); let b = 0; for (let k = 1; k < 4; k++) if (w[k] > w[b]) b = k; return side[j[b]]; };
      const idx = I.getArray(); const keep = [];
      for (let t = 0; t < idx.length; t += 3) { const s3 = [dom(idx[t]), dom(idx[t + 1]), dom(idx[t + 2])];
        const bad = (s3.includes('L') && (s3.includes('R') || s3.includes('r'))) || (s3.includes('R') && s3.includes('l'));
        if (bad) removed++; else keep.push(idx[t], idx[t + 1], idx[t + 2]); }
      if (keep.length !== idx.length) I.setArray(new (idx.constructor)(keep)); } }
  return removed;
}

async function build(target, texSize, suffix) {
  const doc = await io.read(src); const r = doc.getRoot();
  for (const an of r.listAnimations()) an.dispose();
  for (const s of r.listSkins()) for (const j of s.listJoints()) j.setName(bare(j.getName()));
  // drop eye/teeth helper meshes with no skin? keep all; drop hidden LOD duplicates by name
  for (const n of r.listNodes()) if (/_LOD[1-9]|lod[1-9]/i.test(n.getName()) && n.getMesh()) { n.getMesh().dispose(); n.dispose(); }
  // normalise scale: top node scaled so the character stands at a real height in metres (source units are cm-ish)
  const top = r.listScenes()[0].listChildren(); const b0 = skinnedBounds(r); const h0 = b0.max[1] - b0.min[1];
  // source units vary (cm, m, arbitrary): stand everyone at a plausible adult height (shoes + hair), jittered per id
  let hsh = 0; for (const ch of id) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0; const jit = ((hsh % 1000) / 1000 - 0.5) * 0.08;
  const H = +opt('--height', 0) || (opt('--sex', 'm') === 'f' ? 1.67 : 1.80) + jit;
  for (const n of top) { n.setScale(n.getScale().map((v) => (v * H) / h0)); n.setTranslation(n.getTranslation().map((v, k) => (k === 1 ? v - (b0.min[1] * H) / h0 : v * H / h0))); } // feet on y=0
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) for (const t of p.listTargets()) { p.removeTarget(t); t.dispose(); } // no facial blendshapes in game
  for (const m of r.listMeshes()) m.setWeights([]);
  await doc.transform(metalRough(), dedup(), weld()); const cut = dropCrossLegTris(r); if (cut) console.log(`  ${suffix || 'lod0'}: dropped ${cut} cross-leg triangles`);
  await MeshoptSimplifier.ready;
  const t0 = tris(doc); const ratio = Math.min(1, target / t0);
  if (ratio < 0.98) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: suffix ? 0.02 : 0.004, lockBorder: !suffix }));
  if (tris(doc) > target * 1.15) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / tris(doc), error: suffix ? 0.04 : 0.01, lockBorder: false })); // many-piece meshes: unlock borders
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }), prune());
  const b = skinnedBounds(r); const t1 = tris(doc);
  await MeshoptEncoder.ready; await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' })); // quantised + EXT_meshopt_compression
  const file = path.join(OUT, `${id}${suffix}.glb`); await io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder }).write(file, doc);
  return { tris: t1, src: t0, bytes: fs.statSync(file).size, height: +(b.max[1] - b.min[1]).toFixed(3), mats: r.listMaterials().length, joints: r.listSkins()[0]?.listJoints().length ?? 0 };
}

fs.mkdirSync(OUT, { recursive: true });
const l0 = await build(+opt('--lod0', 24000), 1024, '');
const l1 = await build(+opt('--lod1', 6000), 512, '_lod1');
const manPath = path.join(OUT, 'cast.json'); const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
man[id] = { ...(man[id] ?? {}), sex: opt('--sex', '?'), uid: opt('--uid', ''), height: l0.height, lod0: { tris: l0.tris, kb: l0.bytes >> 10 }, lod1: { tris: l1.tris, kb: l1.bytes >> 10 }, mats: l0.mats, joints: l0.joints };
fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
console.log(id, `src=${l0.src} lod0=${l0.tris} (${l0.bytes >> 10}KB) lod1=${l1.tris} (${l1.bytes >> 10}KB) h=${l0.height} mats=${l0.mats} joints=${l0.joints}`);
