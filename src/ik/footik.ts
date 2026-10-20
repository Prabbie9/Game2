// Procedural leg layer: analytic two-bone IK (thigh-shin-foot) onto the ground under each foot, pelvis lowered to the
// lower foot, ankle aligned to the surface normal, and planted-foot locking so a foot on the ground doesn't slide.
// Ground comes from a callback: physics rays in game (worker, one step latency), analytic surfaces in the realism tests.
import * as THREE from 'three';
import type { Character } from '../character/character';

export type GroundFn = (side: 0 | 1, x: number, z: number) => { y: number; n: THREE.Vector3 } | null;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
/** Rotate a bone by a world-space delta (keeps the hierarchy consistent). */
const _rw = new THREE.Quaternion(), _rp = new THREE.Quaternion();
export function rotateWorld(b: THREE.Object3D, delta: THREE.Quaternion) {
  b.getWorldQuaternion(_rw); const pq = b.parent!.getWorldQuaternion(_rp); // local' = parent^-1 * delta * world
  b.quaternion.copy(pq.invert().multiply(delta).multiply(_rw)); b.updateMatrixWorld(true);
}
/** Two-bone IK: rotate a (upper) and b (lower) so c (end) reaches t, bending toward pole. */
export function solveTwoBone(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, t: THREE.Vector3, pole: THREE.Vector3) {
  const A = a.getWorldPosition(new THREE.Vector3()), B = b.getWorldPosition(new THREE.Vector3()), C = c.getWorldPosition(new THREE.Vector3());
  const la = A.distanceTo(B), lb = B.distanceTo(C); const d = THREE.MathUtils.clamp(A.distanceTo(t), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  // knee: set the interior angle at B from the law of cosines, rotating in the plane of the limb (pole for straight legs)
  const ba = _v.copy(A).sub(B).normalize(), bc = _w.copy(C).sub(B).normalize();
  const cur = Math.acos(THREE.MathUtils.clamp(ba.dot(bc), -1, 1)); const want = Math.acos(THREE.MathUtils.clamp((la * la + lb * lb - d * d) / (2 * la * lb), -1, 1));
  let axis = _u.crossVectors(bc, ba); if (axis.lengthSq() < 1e-8) axis.crossVectors(C.clone().sub(A), pole.clone().sub(A)); axis.normalize();
  if (axis.lengthSq() > 0.5) rotateWorld(b, _q.setFromAxisAngle(axis, cur - want));
  // hip: swing the whole chain so the end lands on the target
  c.getWorldPosition(C); const from = C.sub(A).normalize(), to = t.clone().sub(A).normalize();
  rotateWorld(a, _q.setFromUnitVectors(from, to));
}

export class FootIK {
  enabled = true; weight = 1; pelvisOffset = 0; ankleH = [0.08, 0.08]; toeH = [0.03, 0.03];
  debug = { err: [0, 0], planted: [false, false], pelvis: 0, contact: [0, 0] };
  private lock: (THREE.Vector3 | null)[] = [null, null]; private release = [0, 0]; private relFrom: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  private prevAnim: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()]; private first = true;
  private legs: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D | null][] = [];
  private hips: THREE.Object3D;
  constructor(public ch: Character) {
    for (const s of ['Left', 'Right']) this.legs.push([ch.bone(s + 'UpLeg')!, ch.bone(s + 'Leg')!, ch.bone(s + 'Foot')!, ch.bone(s + 'ToeBase')]);
    this.hips = ch.bone('Hips')!;
  }
  /** Call once with the character in a neutral standing pose on flat ground at root y. */
  calibrate() { this.ch.model.updateMatrixWorld(true); const y0 = this.ch.root.getWorldPosition(_v).y;
    this.legs.forEach((l, i) => { this.ankleH[i] = l[2].getWorldPosition(_w).y - y0; this.toeH[i] = l[3] ? l[3].getWorldPosition(_w).y - y0 : this.ankleH[i]; }); }
  reset() { this.first = true; this.lock = [null, null]; this.pelvisOffset = 0; }
  /** After the mixer: plant feet. rootY = height the animation's flat ground is at (visual root), speed = ground speed. */
  update(dt: number, ground: GroundFn, rootY: number, speed: number) {
    if (!this.enabled || this.weight <= 0.001) { this.pelvisOffset = 0; this.lock = [null, null]; return; }
    const m = this.ch.model; m.updateMatrixWorld(true);
    const feet = this.legs.map((l, i) => { const p = l[2].getWorldPosition(new THREE.Vector3()); const toe = l[3] ? l[3].getWorldPosition(new THREE.Vector3()) : p;
      // contact = lowest of heel (ankle) and toe above the animation's ground, so heel-off keeps the toe planted
      const lift = Math.min(p.y - rootY - this.ankleH[i], toe.y - rootY - this.toeH[i]);
      const vel = this.first || dt <= 0 ? 0 : Math.hypot(p.x - this.prevAnim[i].x, p.z - this.prevAnim[i].z) / dt; this.prevAnim[i].copy(p);
      // ground under heel and toe; the foot is raised to whichever needs more so neither penetrates (stairs, kerb edges)
      const gh = ground(i as 0 | 1, p.x, p.z), gt = l[3] ? ground(i as 0 | 1, toe.x, toe.z) : gh;
      const need = Math.max(gh ? gh.y - rootY : -9, gt ? gt.y - rootY : -9);
      return { p, lift, vel, g: gh ?? gt, need }; });
    this.first = false;
    // pelvis: drop by the lower foot's deficit (never raise: legs would overstretch), smoothed
    let off = 0; for (const f of feet) if (f.g) off = Math.min(off, f.need); off = Math.max(off, -0.45);
    this.pelvisOffset += (off - this.pelvisOffset) * Math.min(1, dt * 14); this.debug.pelvis = this.pelvisOffset;
    { const par = this.hips.parent!; const w0 = this.hips.getWorldPosition(new THREE.Vector3()); const l0 = par.worldToLocal(w0.clone()); const l1 = par.worldToLocal(w0.setY(w0.y + this.pelvisOffset * this.weight));
      this.hips.position.add(l1.sub(l0)); m.updateMatrixWorld(true); }
    this.legs.forEach(([a, b, c], i) => { const f = feet[i]; if (!f.g) return;
      // flush contact: small authored lifts (heel/toe roll noise) collapse to zero, swing keeps its height
      const lift2 = f.lift <= 0.02 ? 0 : (f.lift - 0.02) * Math.min(1, (f.lift - 0.02) / 0.04);
      const target = c.getWorldPosition(new THREE.Vector3()); target.y += f.need - (f.lift - lift2);
      const footQ = c.getWorldQuaternion(new THREE.Quaternion()); // keep the animated foot orientation through the leg solve
      const planted = lift2 === 0 && f.vel < 0.45 + speed * 0.08 && speed < 7.5; this.debug.planted[i] = planted; this.debug.contact[i] = lift2;
      if (planted) { if (!this.lock[i] || this.lock[i]!.distanceToSquared(target) > 0.3 * 0.3) this.lock[i] = target.clone(); target.x = this.lock[i]!.x; target.z = this.lock[i]!.z; this.release[i] = 0; }
      else if (this.lock[i]) { this.relFrom[i].copy(this.lock[i]!); this.lock[i] = null; this.release[i] = 1; }
      if (this.release[i] > 0) { const k = this.release[i]; target.x += (this.relFrom[i].x - target.x) * k; target.z += (this.relFrom[i].z - target.z) * k; this.release[i] = Math.max(0, k - dt / 0.12); }
      const cur = c.getWorldPosition(new THREE.Vector3()); target.lerpVectors(cur, target, this.weight);
      const knee = b.getWorldPosition(new THREE.Vector3()); const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.ch.root.getWorldQuaternion(_q)); const pole = knee.add(fwd);
      solveTwoBone(a, b, c, target, pole);
      { const pq = c.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(); c.quaternion.copy(pq.multiply(footQ)); c.updateMatrixWorld(true); }
      // ankle: tilt the foot to the surface normal (limited), fading out while the foot is in the air
      const align = THREE.MathUtils.clamp(1 - lift2 / 0.1, 0, 1) * this.weight; if (align > 0.01) { const n = f.g.n.clone().normalize();
        const tilt = new THREE.Quaternion().setFromUnitVectors(_u.set(0, 1, 0), n); const ang = 2 * Math.acos(Math.min(1, Math.abs(tilt.w))); if (ang > 0.6) tilt.slerp(new THREE.Quaternion(), 1 - 0.6 / ang);
        rotateWorld(c, new THREE.Quaternion().slerp(tilt, align)); }
      this.debug.err[i] = c.getWorldPosition(_w).distanceTo(target); });
  }
  /** Sole contact height above ground for metrics: min(heel, toe) minus the ground under it. */
  contact(i: 0 | 1, ground: GroundFn) { const l = this.legs[i]; const p = l[2].getWorldPosition(new THREE.Vector3()); const t = l[3] ? l[3].getWorldPosition(new THREE.Vector3()) : p;
    const gh = ground(i, p.x, p.z), gt = ground(i, t.x, t.z); return Math.min(p.y - this.ankleH[i] * (gh?.n.y ?? 1) - (gh?.y ?? 0), t.y - this.toeH[i] - (gt?.y ?? 0)); }
}
