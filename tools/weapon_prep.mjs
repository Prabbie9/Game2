#!/usr/bin/env node
// Weapon prep: Sketchfab weapon GLB -> assets/processed/weapons/<id>.glb + weapons.json sockets.
// Convention: +Z = forward (barrel / blade tip), +Y = up, origin = primary grip (where the palm closes), metres.
// Orientation is found from the geometry: longest axis = forward axis; the narrower end is the muzzle (guns) or the
// handle (melee); the taller remaining axis is up, signed so the bore line sits above most of the mass (grip/magazine
// hang below). Sockets: grip (rear-low mass), support (under the barrel ahead of the grip), muzzle, ejection port,
// magazine well, sight line height. Per-weapon overrides in OVR for anything the heuristics get wrong.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, flatten, textureCompress, simplify, metalRough, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/processed/weapons'); fs.mkdirSync(OUT, { recursive: true });
// id: [source, real length (m), kind, in-game name, max tris]
const W = {
  pistol: ['w_pistol', 0.2, 'gun', 'Service Pistol', 6000], smg: ['w_smg', 0.55, 'gun', 'Compact SMG', 8000], rifle: ['w_rifle', 0.88, 'gun', 'Carbine', 10000],
  shotgun: ['w_shotgun', 1.0, 'gun', 'Pump Shotgun', 10000], sniper: ['w_sniper', 1.15, 'gun', 'Marksman Rifle', 10000], rpg: ['w_rpg', 0.95, 'gun', 'Launcher', 6000],
  bat: ['w_bat', 0.84, 'melee', 'Bat', 3000], crowbar: ['w_crowbar', 0.6, 'melee', 'Crowbar', 2000], knife: ['w_knife', 0.26, 'melee', 'Knife', 3000],
  grenade: ['w_grenade', 0.11, 'throw', 'Frag Grenade', 3000], molotov: ['w_molotov', 0.27, 'throw', 'Molotov', 3000],
};
const OVR = JSON.parse(fs.existsSync(path.join(ROOT, 'tools/weapon_overrides.json')) ? fs.readFileSync(path.join(ROOT, 'tools/weapon_overrides.json'), 'utf8') : '{}');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const meta = {};
for (const [id, [src, len, kind, name, maxTris]] of Object.entries(W)) {
  if (process.argv[2] && process.argv[2] !== id) { const prev = fs.existsSync(path.join(OUT, 'weapons.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'weapons.json'), 'utf8')) : {}; if (prev[id]) meta[id] = prev[id]; continue; }
  const doc = await io.read(path.join(ROOT, 'assets/sources/sketchfab', src + '.glb')); const r = doc.getRoot();
  for (const a of r.listAnimations()) a.dispose(); for (const s of r.listSkins()) s.dispose();
  await doc.transform(metalRough(), dedup(), flatten(), weld());
  // world-space vertex cloud
  const pts = [];
  for (const n of r.listNodes()) { const m = n.getMesh(); if (!m) continue; const M = n.getWorldMatrix();
    for (const p of m.listPrimitives()) { const P = p.getAttribute('POSITION'); const v = [0, 0, 0]; for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); pts.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]); } } }
  const mn = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), mx = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))); const ext = mx.map((v, k) => v - mn[k]);
  const o = OVR[id] ?? {};
  let fa = o.fwdAxis ?? ext.indexOf(Math.max(...ext)); const others = [0, 1, 2].filter((k) => k !== fa); let ua = o.upAxis ?? (ext[others[0]] >= ext[others[1]] ? others[0] : others[1]); const sa = [0, 1, 2].find((k) => k !== fa && k !== ua);
  // forward sign: narrow end = muzzle (guns) / handle (melee: the handle is the grip, the far end leads)
  const endArea = (sgn) => { const sel = pts.filter((p) => (sgn > 0 ? p[fa] > mx[fa] - ext[fa] * 0.06 : p[fa] < mn[fa] + ext[fa] * 0.06)); const a = (k) => Math.max(...sel.map((p) => p[k])) - Math.min(...sel.map((p) => p[k])); return a(ua) * a(sa); };
  let fs_ = o.fwdSign ?? (endArea(1) < endArea(-1) ? 1 : -1); if (kind === 'melee' && o.fwdSign === undefined) fs_ = -fs_;
  // up sign: bore line (muzzle-end centre) sits high in the up extent
  const muz = pts.filter((p) => (fs_ > 0 ? p[fa] > mx[fa] - ext[fa] * 0.06 : p[fa] < mn[fa] + ext[fa] * 0.06)); const muzU = muz.reduce((s, p) => s + p[ua], 0) / muz.length;
  let us = o.upSign ?? (kind === 'gun' ? (muzU - mn[ua] > mx[ua] - muzU ? 1 : -1) : 1);
  // local frame: z = fa*fs, y = ua*us, x = cross(y,z)
  const toLocal = (p) => { const z = (p[fa] - (fs_ > 0 ? mn[fa] : mx[fa])) * fs_, y = (p[ua] - mn[ua]) * us - (us < 0 ? -ext[ua] : 0), x = p[sa]; return [x, y, z]; };
  const L = pts.map(toLocal); const lmn = [0, 1, 2].map((k) => Math.min(...L.map((p) => p[k]))), lmx = [0, 1, 2].map((k) => Math.max(...L.map((p) => p[k])));
  const scale = len / (lmx[2] - lmn[2]); const S = L.map((p) => p.map((v, k) => (v - (k === 0 ? (lmn[0] + lmx[0]) / 2 : lmn[k])) * scale)); // x centred, y and z from 0
  const H = (lmx[1] - lmn[1]) * scale, Z = len;
  // sockets (before re-centring on the grip)
  let grip, support, muzzle, sight, eject, mag;
  if (kind === 'gun') {
    const bore = S.filter((p) => p[2] > Z * 0.94).reduce((s, p, _, a) => s + p[1] / a.length, 0); muzzle = [0, bore, Z];
    const low = S.filter((p) => p[1] < bore - H * 0.35); const rearLow = low.filter((p) => p[2] < (id === 'pistol' ? Z * 0.55 : Z * 0.5));
    const g = (rearLow.length ? rearLow : low).reduce((s, p, _, a) => [s[0], s[1] + p[1] / a.length, s[2] + p[2] / a.length], [0, 0, 0]); grip = [0, Math.min(bore - 0.035, g[1] + H * 0.12), g[2]];
    support = id === 'pistol' ? [0, grip[1] - 0.01, grip[2] + 0.01] : [0, bore - Math.min(0.045, H * 0.18), Math.min(Z * 0.78, grip[2] + Z * 0.33)];
    sight = [0, Math.max(...S.filter((p) => p[2] > grip[2] - 0.05 && p[2] < grip[2] + 0.25).map((p) => p[1])) + 0.01, grip[2]];
    eject = [0.03, bore + 0.01, grip[2] + Math.min(0.12, Z * 0.18)]; mag = [0, grip[1] - 0.06, grip[2] + Math.min(0.09, Z * 0.12)];
  } else { grip = [0, H / 2, Math.min(0.09, Z * 0.18)]; support = [0, H / 2, Math.min(0.22, Z * 0.4)]; muzzle = [0, H / 2, Z]; sight = muzzle; eject = muzzle; mag = grip; }
  if (kind === 'throw') { grip = [0, H * 0.45, Z * 0.5]; }
  Object.assign(o.sockets ?? {}, {}); if (o.grip) grip = o.grip; if (o.support) support = o.support;
  // final transform node: rotate source frame -> local frame, scale, then translate so the grip is the origin
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; R[0][sa] = 1; R[1][ua] = us; R[2][fa] = fs_; // rows = local axes in source coords (x row may need flipping for handedness)
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]); if (det < 0) R[0] = R[0].map((v) => -v);
  const c0 = [lmn[0] + (lmx[0] - lmn[0]) / 2, lmn[1], lmn[2]]; const sub = (a, b) => a.map((v, k) => v - b[k]);
  const T = [(fs_ > 0 ? mn[fa] : mx[fa]), us > 0 ? mn[ua] : mx[ua]];
  // matrix M: local = scale * (R * (src - originSrc)) - c0*scale - grip ; build column-major 4x4
  const originSrc = [0, 0, 0]; originSrc[fa] = T[0]; originSrc[ua] = T[1]; originSrc[sa] = 0;
  const Mx = new Array(16).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Mx[j * 4 + i] = R[i][j] * scale; Mx[15] = 1;
  const t0 = [0, 1, 2].map((i) => -scale * (R[i][0] * originSrc[0] + R[i][1] * originSrc[1] + R[i][2] * originSrc[2]));
  const centreX = (lmn[0] + lmx[0]) / 2 * scale; const tr = [t0[0] - centreX * (det < 0 ? -1 : 1) - grip[0], t0[1] - grip[1] - lmn[1] * scale * 0, t0[2] - grip[2]];
  Mx[12] = tr[0]; Mx[13] = tr[1]; Mx[14] = tr[2];
  const wrapN = doc.createNode('weapon').setMatrix(Mx); const scene = r.listScenes()[0]; for (const c of scene.listChildren()) { scene.removeChild(c); wrapN.addChild(c); } scene.addChild(wrapN);
  await doc.transform(flatten());
  await MeshoptSimplifier.ready; let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  if (tris > maxTris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / tris, error: 0.002 }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(path.join(OUT, id + '.glb'), doc);
  const rel = (p) => sub(p, grip).map((v) => +v.toFixed(4));
  meta[id] = { name, kind, length: len, sockets: { grip: [0, 0, 0], support: rel(support), muzzle: rel(muzzle), sight: rel(sight), eject: rel(eject), mag: rel(mag) }, axes: { fa, ua, fs: fs_, us }, kb: fs.statSync(path.join(OUT, id + '.glb')).size >> 10 };
  console.log(id, JSON.stringify(meta[id].sockets), meta[id].kb + 'KB');
}
fs.writeFileSync(path.join(OUT, 'weapons.json'), JSON.stringify(meta, null, 1));
