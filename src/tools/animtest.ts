// Realism / animation gate harness (tests/anim). A cast body walks along +Z over an analytic surface (?surf=flat|slope|
// stairs|kerb) at a commanded speed profile through every gait (?speeds=0,1.4,3.6,5.8), with the foot IK layer on.
// Per frame it logs foot-to-surface distance (planted feet), penetration, planted-foot slide and pelvis continuity, and
// renders a frame strip (?strip=N frames side by side via ?frame=k). Results land in HARBOURLINE_DEBUG.result.
import * as THREE from 'three';
import { Renderer } from '../renderer/renderer';
import { Environment } from '../lighting/environment';
import { initKTX2, pendingLoads } from '../core/assets';
import { pbr, setTextureRes } from '../materials/pbr';
import { Character } from '../character/character';
import { Animator } from '../animation/animator';
import { FootIK } from '../ik/footik';

const p = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app')!, 'high'); initKTX2(R.renderer); setTextureRes('1k');
const env = new Environment(R); env.setTime(+(p.get('t') ?? 15)); env.setWeather('clear', true);
const surf = p.get('surf') ?? 'flat';
// analytic surfaces along z: slope 10deg from z=2; stairs 0.17 rise / 0.30 run from z=2; kerb 0.15 step up at z=3, down at z=7
export function surface(x: number, z: number): { y: number; n: THREE.Vector3 } {
  void x; const up = new THREE.Vector3(0, 1, 0);
  if (surf === 'slope') { const a = (10 * Math.PI) / 180; return z < 2 ? { y: 0, n: up } : { y: (z - 2) * Math.tan(a), n: new THREE.Vector3(0, Math.cos(a), -Math.sin(a)) }; }
  if (surf === 'stairs') return { y: z < 2 ? 0 : Math.min(12, Math.floor((z - 2) / 0.3) + 1) * 0.17, n: up };
  if (surf === 'kerb') return { y: z >= 3 && z < 7 ? 0.15 : 0, n: up };
  return { y: 0, n: up };
}
// visual surface
const mat = R.setupMaterial(pbr('concrete', { grime: 0.4, tint: 0xc8c3ba }, 'struct'));
const geo = new THREE.BufferGeometry(); { const pos: number[] = []; const N = 400; for (let i = 0; i < N; i++) { const z0 = -4 + (i * 30) / N, z1 = -4 + ((i + 1) * 30) / N; const y0 = surface(0, z0 + 1e-4).y, y1 = surface(0, z1 - 1e-4).y, ys = surface(0, z1 + 1e-4).y;
  pos.push(-3, y0, z0, 3, y0, z0, 3, y1, z1, -3, y0, z0, 3, y1, z1, -3, y1, z1); if (Math.abs(ys - y1) > 1e-3) pos.push(-3, y1, z1, 3, y1, z1, 3, ys, z1, -3, y1, z1, 3, ys, z1, -3, ys, z1); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); const uv = pos.length / 3; geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(uv * 2).fill(0).map((_, i) => (i % 2 ? pos[Math.floor(i / 2) * 3 + 2] : pos[Math.floor(i / 2) * 3]) * 0.5), 2)); }
const ground = new THREE.Mesh(geo, mat); ground.receiveShadow = true; R.scene.add(ground);
const dbg: any = ((window as any).HARBOURLINE_DEBUG = { ready: false, R, result: null });
(async () => {
  const ch = await new Character(R, p.get('id') ?? 'standing_man').load(); R.scene.add(ch.root);
  const an = await new Animator(ch).init(); const ik = new FootIK(ch); an.update(0, 0, 0); ik.calibrate(); ik.enabled = !p.has('noik');
  const speeds = (p.get('speeds') ?? '1.4').split(',').map(Number); const crouch = +(p.get('crouch') ?? 0); const T = +(p.get('secs') ?? 4);
  const dt = 1 / 60; let visY = 0; const wasPlanted = [false, false]; let z = +(p.get('z0') ?? -1.5); const log: any = { planted: [] as number[], pen: [] as number[], slide: [] as number[], pelvisJump: 0, frames: 0 };
  const strip: string[] = []; const stripN = +(p.get('strip') ?? 0); const prevFoot = [new THREE.Vector3(), new THREE.Vector3()]; let prevPelvis = NaN;
  const L = ch.bone('LeftFoot')!, Rf = ch.bone('RightFoot')!, hips = ch.bone('Hips')!;
  let f = 0; const total = speeds.length * T * 60;
  const step = () => {
    const seg = Math.min(speeds.length - 1, Math.floor(f / (T * 60))); const v = speeds[seg];
    z += v * dt; const sy = surface(0, z).y; visY += (sy - visY) * Math.min(1, dt * 10); ch.root.position.set(0, visY, z); // capsule feet height, visually smoothed (steps)
    an.update(dt, v, crouch); ik.update(dt, (_s, x, zz) => surface(x, zz), ch.root.position.y, v); ch.model.updateMatrixWorld(true);
    // metrics (skip the first second of each segment: gait blend settling)
    if ((f % (T * 60)) > 60) [L, Rf].forEach((b, i) => { const w = b.getWorldPosition(new THREE.Vector3()); const d = ik.contact(i as 0 | 1, (_s, x, zz) => surface(x, zz));
      if (ik.debug.planted[i]) { log.planted.push(Math.abs(d)); if (wasPlanted[i]) log.slide.push(Math.hypot(w.x - prevFoot[i].x, w.z - prevFoot[i].z) / dt); } wasPlanted[i] = ik.debug.planted[i]; log.pen.push(-d); prevFoot[i].copy(w); });
    else [L, Rf].forEach((b, i) => b.getWorldPosition(prevFoot[i]));
    const py = hips.getWorldPosition(new THREE.Vector3()).y; if (!Number.isNaN(prevPelvis) && f % (T * 60) > 2) log.pelvisJump = Math.max(log.pelvisJump, Math.abs(py - prevPelvis) - v * dt * 0.6); prevPelvis = py;
    f++; log.frames = f;
  };
  const camAt = () => { const t = ch.root.position; R.camera.fov = 28; R.camera.position.set(t.x + 3.6, t.y + 0.7, t.z + 0.6); R.camera.lookAt(t.x, t.y + 0.45, t.z); R.camera.updateProjectionMatrix(); };
  const pct = (a: number[], q: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const finish = () => { dbg.result = { id: ch.id, surf, speeds, crouch, ik: ik.enabled, frames: log.frames, plantedP95cm: +(pct(log.planted, 0.95) * 100).toFixed(2), plantedMeanCm: +((log.planted.reduce((a: number, b: number) => a + b, 0) / Math.max(1, log.planted.length)) * 100).toFixed(2), penMaxCm: +(Math.max(0, pct(log.pen, 0.99)) * 100).toFixed(2), slideP95cms: +(pct(log.slide, 0.95) * 100).toFixed(1), slideMedCms: +(pct(log.slide, 0.5) * 100).toFixed(1), slideP90cms: +(pct(log.slide, 0.9) * 100).toFixed(1), slideMeanCms: +((log.slide.reduce((a: number, b: number) => a + b, 0) / Math.max(1, log.slide.length)) * 100).toFixed(1), pelvisJumpCm: +(log.pelvisJump * 100).toFixed(2), plantedFrac: +(log.planted.length / Math.max(1, log.pen.length)).toFixed(2) }; };
  // frame-strip mode: advance to the requested frame and render once
  const want = p.has('frame') ? +p.get('frame')! : -1;
  if (want >= 0) { while (f < want) step(); camAt(); finish(); } else { while (f < total) step(); finish(); camAt(); }
  let k = 0; const loop = () => { requestAnimationFrame(loop); env.update(1 / 30); if (k === 2) env.bakeEnv(); R.render(1 / 30); k++; if (k > 6 && pendingLoads() === 0) dbg.ready = true; }; loop(); void strip; void stripN;
})().catch((e) => console.error('animtest', e));
