// Combat effects, all pooled and capped: muzzle flash (additive star sprite + one pooled point light per flash, capped),
// tracers (stretched additive quads), bullet decals on surfaces (FIFO ring, polygon offset, oriented to the hit normal),
// spark and dust bursts (CPU particles), shell casings (ballistic instanced with a ground bounce), explosions (flash
// light, growing fireball sprites, smoke column, debris chunks, expanding shockwave ring, camera shake callback).
import * as THREE from 'three';
import { Particles } from './fx';

const tex = (draw: (g: CanvasRenderingContext2D, s: number) => void, s = 64) => { const c = document.createElement('canvas'); c.width = c.height = s; draw(c.getContext('2d')!, s); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const FLASH = () => tex((g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,250,230,1)'); r.addColorStop(0.25, 'rgba(255,200,90,0.9)'); r.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,220,150,0.8)'; g.lineWidth = 3; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * s / 2, s / 2 + Math.sin(a) * s / 2); g.stroke(); } });
const HOLE = () => tex((g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(10,8,6,1)'); r.addColorStop(0.18, 'rgba(25,22,20,0.95)'); r.addColorStop(0.4, 'rgba(60,55,50,0.45)'); r.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
const FIRE = () => tex((g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.35, 'rgba(255,150,40,0.9)'); r.addColorStop(0.7, 'rgba(160,50,10,0.45)'); r.addColorStop(1, 'rgba(40,10,0,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }, 128);

export class CombatFX {
  sparks: Particles; dust: Particles; smoke: Particles; private flashes: { s: THREE.Sprite; t: number }[] = []; private lights: { l: THREE.PointLight; t: number; peak: number; dur: number }[] = [];
  private tracers: { m: THREE.Mesh; t: number }[] = []; private decals: THREE.InstancedMesh; private decalI = 0; private shells: THREE.InstancedMesh; private shellS: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; t: number }[] = [];
  private fireballs: { s: THREE.Sprite; t: number; dur: number; v: THREE.Vector3; size: number }[] = []; private rings: { m: THREE.Mesh; t: number; r: number }[] = []; private debris: THREE.InstancedMesh; private debrisS: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; t: number }[] = [];
  shake = 0; ground: (x: number, z: number) => number = () => 0;
  constructor(public scene: THREE.Scene, maxLights = 4) {
    this.sparks = new Particles(scene, 500, true); this.dust = new Particles(scene, 500); this.smoke = new Particles(scene, 600);
    const fm = new THREE.SpriteMaterial({ map: FLASH(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff });
    for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(fm.clone()); s.visible = false; scene.add(s); this.flashes.push({ s, t: 9 }); }
    for (let i = 0; i < maxLights; i++) { const l = new THREE.PointLight(0xffb060, 0, 9, 2); l.visible = false; scene.add(l); this.lights.push({ l, t: 9, peak: 0, dur: 0.05 }); }
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2), tm.clone()); m.visible = false; scene.add(m); this.tracers.push({ m, t: 9 }); }
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshStandardMaterial({ map: HOLE(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 }), 256);
    this.decals.count = 0; this.decals.frustumCulled = false; scene.add(this.decals);
    this.shells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }), 64); this.shells.count = 0; this.shells.frustumCulled = false; scene.add(this.shells);
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.06, 0.09), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9 }), 96); this.debris.count = 0; this.debris.frustumCulled = false; this.debris.castShadow = true; scene.add(this.debris);
    const fireMat = new THREE.SpriteMaterial({ map: FIRE(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 40; i++) { const s = new THREE.Sprite(fireMat.clone()); s.visible = false; scene.add(s); this.fireballs.push({ s, t: 9, dur: 1, v: new THREE.Vector3(), size: 1 }); }
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.visible = false; scene.add(m); this.rings.push({ m, t: 9, r: 1 }); }
  }
  private light(p: THREE.Vector3, peak: number, dur: number, color = 0xffb060, dist = 9) { const L = this.lights.reduce((a, b) => (a.t > b.t ? a : b)); L.l.position.copy(p); L.l.color.set(color); L.l.distance = dist; L.t = 0; L.peak = peak; L.dur = dur; L.l.visible = true; }
  muzzle(p: THREE.Vector3, dir: THREE.Vector3, size = 0.35) { const F = this.flashes.reduce((a, b) => (a.t > b.t ? a : b)); F.s.position.copy(p).addScaledVector(dir, size * 0.3); F.s.scale.setScalar(size * (0.8 + Math.random() * 0.5)); (F.s.material as THREE.SpriteMaterial).rotation = Math.random() * 6.28; F.s.visible = true; F.t = 0; this.light(p, 60, 0.06);
    this.smoke.emit(p.clone().addScaledVector(dir, 0.1), dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)), 0.9, 0.08, 0.6, 0xcfcac2, 0.12); }
  tracer(a: THREE.Vector3, b: THREE.Vector3) { const T = this.tracers.reduce((x, y) => (x.t > y.t ? x : y)); const len = a.distanceTo(b); if (len < 1) return; const m = T.m; m.position.copy(a); m.lookAt(b); m.scale.set(1, 1, Math.min(len, 6)); m.visible = true; T.t = 0; (m.userData as any).v = b.clone().sub(a).normalize().multiplyScalar(320); (m.userData as any).end = b.clone(); }
  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'concrete' | 'metal' | 'glass' | 'flesh' | 'dirt' = 'concrete') {
    const m = new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.003), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28)), new THREE.Vector3().setScalar(kind === 'glass' ? 1.6 : 0.8 + Math.random() * 0.4));
    if (kind !== 'flesh') { this.decals.setMatrixAt(this.decalI % 256, m); this.decalI++; this.decals.count = Math.min(256, this.decalI); this.decals.instanceMatrix.needsUpdate = true; }
    const nS = kind === 'metal' ? 10 : kind === 'glass' ? 6 : 4; for (let i = 0; i < nS; i++) this.sparks.emit(p.clone(), n.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 0.15 + Math.random() * 0.2, 0.02, 0, kind === 'flesh' ? 0x6a1010 : 0xffc070, 0.9);
    const dc = kind === 'flesh' ? 0x5a1a14 : kind === 'dirt' ? 0x6b5a45 : kind === 'glass' ? 0xd8e4ea : 0xb8b2a8; for (let i = 0; i < 3; i++) this.dust.emit(p.clone().addScaledVector(n, 0.05), n.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3(0, 0.2, 0)), 0.7 + Math.random() * 0.5, 0.12, 0.5, dc, 0.35);
  }
  shell(p: THREE.Vector3, right: THREE.Vector3) { const s = { p: p.clone(), v: right.clone().multiplyScalar(1.5 + Math.random()).add(new THREE.Vector3(0, 1.6 + Math.random(), 0)), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20), t: 0 }; this.shellS.push(s); if (this.shellS.length > 64) this.shellS.shift(); }
  explosion(p: THREE.Vector3, radius: number) {
    this.light(p.clone().add(new THREE.Vector3(0, 1, 0)), 3000, 0.6, 0xffa040, radius * 6); this.shake = Math.max(this.shake, 1);
    for (let i = 0; i < 14; i++) { const F = this.fireballs.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b)); F.s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.4, Math.random() * radius * 0.25, (Math.random() - 0.5) * radius * 0.4)); F.v.set((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4); F.t = 0; F.dur = 0.5 + Math.random() * 0.6; F.size = radius * (0.35 + Math.random() * 0.35); F.s.visible = true; }
    for (let i = 0; i < 40; i++) this.smoke.emit(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.5, Math.random() * radius * 0.3, (Math.random() - 0.5) * radius * 0.5)), new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 2), 4 + Math.random() * 4, 1.2 + Math.random(), 2.5, 0x2a2826, 0.55);
    for (let i = 0; i < 30; i++) this.sparks.emit(p.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3((Math.random() - 0.5) * 18, 4 + Math.random() * 12, (Math.random() - 0.5) * 18), 0.6 + Math.random() * 0.8, 0.04, 0, 0xffb050, 1);
    for (let i = 0; i < 24; i++) { this.debrisS.push({ p: p.clone().add(new THREE.Vector3(0, 0.3, 0)), v: new THREE.Vector3((Math.random() - 0.5) * 14, 5 + Math.random() * 9, (Math.random() - 0.5) * 14), r: new THREE.Euler(), w: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), t: 0 }); if (this.debrisS.length > 96) this.debrisS.shift(); }
    const R = this.rings.reduce((a, b) => (a.t > b.t ? a : b)); R.m.position.copy(p).add(new THREE.Vector3(0, 0.15, 0)); R.t = 0; R.r = radius * 2.2; R.m.visible = true;
  }
  update(dt: number, cam: THREE.Camera) {
    for (const F of this.flashes) { F.t += dt; if (F.t > 0.05) F.s.visible = false; }
    for (const L of this.lights) { L.t += dt; const k = Math.max(0, 1 - L.t / L.dur); L.l.intensity = L.peak * k * k; if (k <= 0) L.l.visible = false; }
    for (const T of this.tracers) { if (!T.m.visible) continue; T.t += dt; const u = T.m.userData as any; T.m.position.addScaledVector(u.v, dt); if (T.t > 0.12 || T.m.position.distanceTo(u.end) < 3) T.m.visible = false; }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const sim = (list: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; t: number }[], im: THREE.InstancedMesh, life: number, half: number) => {
      let n = 0; for (const s of list) { s.t += dt; if (s.t > life) continue; s.v.y -= 9.81 * dt; s.p.addScaledVector(s.v, dt); const gy = this.ground(s.p.x, s.p.z) + half;
        if (s.p.y < gy) { s.p.y = gy; s.v.y = Math.abs(s.v.y) * 0.3; s.v.x *= 0.6; s.v.z *= 0.6; s.w.multiplyScalar(0.6); }
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt; im.setMatrixAt(n++, m.compose(s.p, q.setFromEuler(s.r), one)); }
      im.count = n; im.instanceMatrix.needsUpdate = true; };
    sim(this.shellS, this.shells, 12, 0.005); sim(this.debrisS, this.debris, 25, 0.03);
    for (const F of this.fireballs) { if (!F.s.visible) continue; F.t += dt; const k = F.t / F.dur; if (k >= 1) { F.s.visible = false; continue; } F.s.position.addScaledVector(F.v, dt); F.s.scale.setScalar(F.size * (0.5 + k * 1.2)); (F.s.material as THREE.SpriteMaterial).opacity = (1 - k) ** 1.5; }
    for (const R of this.rings) { if (!R.m.visible) continue; R.t += dt; const k = R.t / 0.35; if (k >= 1) { R.m.visible = false; continue; } R.m.scale.setScalar(R.r * k); (R.m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k); }
    this.sparks.update(dt, cam); this.dust.update(dt, cam); this.smoke.update(dt, cam); this.shake *= Math.exp(-dt * 5);
  }
}
