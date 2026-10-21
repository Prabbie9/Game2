// Generic prop prep: assets/sources/sketchfab/<src>.glb -> assets/processed/props/<id>.glb
//   - wraps the scene in a root node that lays the longest horizontal axis along +Z (optionally flipped), scales it to
//     --length metres and puts the bottom centre at the origin
//   - meshopt simplify to --tris, WebP textures (--tex px), meshopt compression
// Usage: node tools/prop_prep.mjs <src> <id> --length 7.5 [--tris 20000] [--tex 1024] [--flip] [--drop <node-name regex>]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, meshopt, flatten, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [src, id] = process.argv.slice(2); const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; }; const flag = (k) => process.argv.includes('--' + k);
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(ROOT, 'assets/sources/sketchfab', src + '.glb'));
const drop = opt('drop', null); if (drop) { const re = new RegExp(drop); for (const n of doc.getRoot().listNodes()) if (n.getMesh() && re.test(n.getName())) n.setMesh(null); }
await doc.transform(prune(), dedup(), flatten(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 1, error: 0.0005 }));
// triangle budget
const tris = () => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const target = +opt('tris', 20000); const t0 = tris(); if (t0 > target) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / t0, error: 0.01 }));
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
let b = getBounds(scene); const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2];
const wrap = doc.createNode('prop_root'); for (const n of scene.listChildren()) { scene.removeChild(n); wrap.addChild(n); } scene.addChild(wrap);
let yaw = sx > sz ? Math.PI / 2 : 0; if (flag('flip')) yaw += Math.PI;
wrap.setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
b = getBounds(scene); const len = b.max[2] - b.min[2]; const s = +opt('length', len) / len; wrap.setScale([s, s, s]);
b = getBounds(scene); wrap.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
const tex = +opt('tex', 1024); await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
b = getBounds(scene); fs.mkdirSync(path.join(ROOT, 'assets/processed/props'), { recursive: true }); const out = path.join(ROOT, 'assets/processed/props', id + '.glb'); await io.write(out, doc);
console.log(id, 'tris', t0, '->', tris(), 'size', b.max.map((v, i) => +(v - b.min[i]).toFixed(2)), (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
