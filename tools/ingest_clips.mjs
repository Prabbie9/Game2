#!/usr/bin/env node
// Ingest pipeline for Mixamo animation clips.
// FBX (assets/sources/clips) -> GLB via FBX2glTF (cached in /tmp/hl_glb) -> compact quantised bundles
// in assets/processed/anim/<bundle>.json + .bin, plus assets/catalog/clipmeta.json.
// Bone names are normalised to the bare Mixamo name ("mixamorig12:Hips" -> "Hips").
// Locomotion loops have their linear XZ root drift removed (in-place) and the velocity recorded.
import { NodeIO } from '@gltf-transform/core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets/sources/clips');
const OUT = path.join(ROOT, 'assets/processed/anim');
const CACHE = '/tmp/hl_glb';
const FBX2GLTF = process.env.FBX2GLTF || '/opt/tools/FBX2glTF';
const BLENDER = process.env.BLENDER || '/opt/tools/blender-4.2.3-linux-x64/blender';
const blenderFixed = [];
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/catalog/clips.json'), 'utf8'));
const byName = new Map(catalog.map((c) => [c.name, c]));
const waves = fs.readdirSync(path.join(ROOT, 'tools/waves')).filter((f) => f.endsWith('.json'));
const chosen = new Map();
for (const w of waves) for (const c of JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/waves', w), 'utf8'))) chosen.set(c.name, c);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const bare = (n) => n.replace(/^.*:/, '');
// Bundle routing: weapon stance first, then broad groups. Keeps the first load small.
function bundleOf(name, cat) {
  const n = name.toLowerCase();
  if (/pistol|firing a gun/.test(n)) return 'pistol';
  if (/rifle|shooting|gun/.test(n)) return 'rifle';
  if (['vehicle'].includes(cat) || /seat|driv/.test(n)) return 'vehicle';
  if (['hit', 'death', 'getup', 'panic'].includes(cat)) return 'react';
  if (['melee', 'throw'].includes(cat)) return 'melee';
  if (['civil', 'misc'].includes(cat)) return 'civil';
  return 'core';
}
const LOOP_HINT = /idle|walk|run|sprint|strafe|driv|drive|crouch(ed)? (walk|idle)|crouching idle|falling idle/i;
const ONESHOT_HINT = /stop|start|turn|jump|land|transition|to |pulled|standing up|grabbing|reload|shooting a pistol from|kneeling/i;

const io = new NodeIO();
const bundles = {};
const meta = {};
let converted = 0, cached = 0, failed = [];
for (const [name, info] of chosen) {
  const fbx = path.join(SRC, name + '.fbx');
  if (!fs.existsSync(fbx)) { failed.push(name + ' (no source)'); continue; }
  const glb = path.join(CACHE, slug(name) + '.glb');
  if (!fs.existsSync(glb)) {
    try { execFileSync(FBX2GLTF, ['--binary', '--anim-framerate', 'bake30', '-i', fbx, '-o', glb.replace(/\.glb$/, '')], { stdio: 'pipe' }); converted++; }
    catch (e) { failed.push(name + ' (convert)'); continue; }
  } else cached++;
  let doc = await io.read(glb);
  // FBX2glTF trusts the FBX take span, which is wrong in a few Mixamo exports; fall back to Blender when suspiciously short.
  const t0 = doc.getRoot().listAnimations()[0]?.listChannels()[0]?.getSampler().getInput().getArray();
  if (t0 && t0.length <= 15 && !glb.endsWith('.bl.glb')) {
    const bl = glb.replace(/\.glb$/, '.bl.glb');
    try {
      if (!fs.existsSync(bl)) execFileSync(BLENDER, ['-b', '-P', path.join(ROOT, 'tools/blender_fbx2glb.py'), '--', fbx, bl], { stdio: 'pipe' });
      const d2 = await io.read(bl); const t2 = d2.getRoot().listAnimations()[0]?.listChannels()[0]?.getSampler().getInput().getArray();
      if (t2 && t2.length > t0.length) { doc = d2; blenderFixed.push(name); }
    } catch (e) { failed.push(name + ' (blender)'); }
  }
  const root = doc.getRoot();
  const anim = root.listAnimations()[0];
  if (!anim) { failed.push(name + ' (no anim)'); continue; }
  const nodes = root.listNodes();
  const prefix = (nodes.find((n) => /Hips$/.test(n.getName()))?.getName() || '').replace(/Hips$/, '');
  const hipsNode = nodes.find((n) => bare(n.getName()) === 'Hips');
  const restHipsY = hipsNode.getTranslation()[1];
  const skinned = root.listMeshes().length > 0;
  // gather tracks
  let frames = 0; const rot = new Map(); let pos = null;
  for (const ch of anim.listChannels()) {
    const bn = bare(ch.getTargetNode().getName());
    const out = ch.getSampler().getOutput().getArray();
    const inp = ch.getSampler().getInput().getArray();
    if (ch.getTargetPath() === 'rotation') { rot.set(bn, { t: inp, v: out }); frames = Math.max(frames, inp.length); }
    else if (ch.getTargetPath() === 'translation' && bn === 'Hips') pos = { t: inp, v: out };
  }
  const fps = 30;
  const dur = (frames - 1) / fps;
  // sample a track at frame i (inputs are baked at 30fps but some channels are constant/short)
  const sampleIdx = (t, i) => Math.min(t.length - 1, Math.round((i / fps) / Math.max(1e-6, t[t.length - 1] || 1e-6) * (t.length - 1)) || 0);
  const bName = bundleOf(name, info.category || byName.get(name)?.category || 'misc');
  const B = (bundles[bName] ||= { bones: [], boneIdx: new Map(), clips: [], chunks: [], bytes: 0 });
  const boneList = [...rot.keys()];
  for (const b of boneList) if (!B.boneIdx.has(b)) { B.boneIdx.set(b, B.bones.length); B.bones.push(b); }
  // root motion
  const hp = new Float32Array(frames * 3);
  for (let i = 0; i < frames; i++) {
    const k = pos ? sampleIdx(pos.t, i) : 0;
    hp[i * 3] = pos ? pos.v[k * 3] : 0; hp[i * 3 + 1] = pos ? pos.v[k * 3 + 1] : restHipsY; hp[i * 3 + 2] = pos ? pos.v[k * 3 + 2] : 0;
  }
  const dx = hp[(frames - 1) * 3] - hp[0], dz = hp[(frames - 1) * 3 + 2] - hp[2];
  const dist = Math.hypot(dx, dz);
  const loop = LOOP_HINT.test(name) && !ONESHOT_HINT.test(name.replace(/^Running|^Walking/, ''));
  // yaw change of hips (for turn clips)
  const hr = rot.get('Hips');
  const yawOf = (k) => { const q = hr.v.slice(k * 4, k * 4 + 4); const [x, y, z, w] = q; return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)); };
  const yaw = hr ? yawOf(hr.t.length - 1) - yawOf(0) : 0;
  const inPlace = loop && dist > 0.15;
  if (inPlace) for (let i = 0; i < frames; i++) { const f = i / (frames - 1); hp[i * 3] -= dx * f; hp[i * 3 + 2] -= dz * f; }
  // pose difference first/last for loop sanity
  let loopErr = 0;
  for (const [, tr] of rot) { const a = tr.v, n = tr.t.length - 1; let d = 0; for (let c = 0; c < 4; c++) d += a[c] * a[n * 4 + c]; loopErr = Math.max(loopErr, 1 - Math.abs(d)); }
  // quantise: rotations int16 per bone per frame (frames x bones x 4), hips pos float32 normalised by rest hips height
  const q = new Int16Array(frames * boneList.length * 4);
  boneList.forEach((b, j) => {
    const tr = rot.get(b);
    for (let i = 0; i < frames; i++) {
      const k = sampleIdx(tr.t, i);
      let x = tr.v[k * 4], y = tr.v[k * 4 + 1], z = tr.v[k * 4 + 2], w = tr.v[k * 4 + 3];
      if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
      const o = (i * boneList.length + j) * 4;
      q[o] = Math.round(x * 32767); q[o + 1] = Math.round(y * 32767); q[o + 2] = Math.round(z * 32767); q[o + 3] = Math.round(w * 32767);
    }
  });
  for (let i = 0; i < hp.length; i++) hp[i] /= restHipsY;
  const qBuf = Buffer.from(q.buffer), pBuf = Buffer.from(hp.buffer);
  const pad = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  const clip = {
    key: slug(name), name, frames, fps, duration: +dur.toFixed(3), loop, inPlace,
    speed: +(dist / Math.max(dur, 1e-3)).toFixed(3), dir: dist > 0.05 ? [+(dx / dist).toFixed(3), +(dz / dist).toFixed(3)] : [0, 0],
    rootDist: +dist.toFixed(3), yaw: +yaw.toFixed(3), loopErr: +loopErr.toFixed(4),
    bones: boneList.map((b) => B.boneIdx.get(b)), rotOffset: B.bytes, posOffset: B.bytes + pad(qBuf).length,
  };
  B.chunks.push(pad(qBuf), pad(pBuf)); B.bytes += pad(qBuf).length + pad(pBuf).length;
  B.clips.push(clip);
  meta[info.id] = { key: clip.key, bundle: bName, duration: clip.duration, fps, frames, skinned, inPlace: dist < 0.15 || inPlace, rootMotion: +dist.toFixed(3), prefix, restHipsY: +restHipsY.toFixed(4) };
}
let total = 0;
for (const [b, B] of Object.entries(bundles)) {
  const bin = Buffer.concat(B.chunks); total += bin.length;
  fs.writeFileSync(path.join(OUT, b + '.bin'), bin);
  fs.writeFileSync(path.join(OUT, b + '.json'), JSON.stringify({ bundle: b, bones: B.bones, clips: B.clips }));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(Object.fromEntries(Object.entries(bundles).map(([b, B]) => [b, B.clips.map((c) => c.key)]))));
fs.writeFileSync(path.join(ROOT, 'assets/catalog/clipmeta.json'), JSON.stringify(meta));
const prefixes = [...new Set(Object.values(meta).map((m) => m.prefix))];
console.log('blender-fixed', blenderFixed.join('; '));
console.log(`clips ${Object.keys(meta).length} converted ${converted} cached ${cached} failed ${failed.length} ${failed.slice(0, 5).join('; ')}`);
console.log('bundles', Object.fromEntries(Object.entries(bundles).map(([b, B]) => [b, B.clips.length])), 'MB', (total / 1e6).toFixed(2), 'prefixes', prefixes.join(','));
