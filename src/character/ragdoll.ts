// Ragdoll controller (main thread): measures body segments off the character's current pose, spawns the physics ragdoll
// in the worker, drives the skeleton from the simulated segments, and when the body settles, picks a get-up clip (from
// back / from stomach), aligns the character root to the lying body and blends from the ragdoll pose into the clip.
import * as THREE from 'three';
import type { Character } from './character';
import type { Animator } from '../animation/animator';
import type { PhysicsClient } from '../physics/client';
import type { SegDesc } from '../sim/ragdoll';

interface SegDef { bone: string; end: string | null; r: number; m: number; parent: number; hinge?: boolean; ext?: number }
// pelvis, chest, head, arms, forearms, thighs, shins (feet and hands ride on their parents)
const DEFS: SegDef[] = [
  { bone: 'Hips', end: 'Spine1', r: 0.12, m: 11, parent: -1 }, { bone: 'Spine1', end: 'Neck', r: 0.13, m: 15, parent: 0 }, { bone: 'Neck', end: 'HeadTop_End', r: 0.095, m: 5, parent: 1 },
  { bone: 'LeftArm', end: 'LeftForeArm', r: 0.05, m: 2.2, parent: 1 }, { bone: 'LeftForeArm', end: 'LeftHand', r: 0.045, m: 1.6, parent: 3, hinge: true, ext: 1.35 },
  { bone: 'RightArm', end: 'RightForeArm', r: 0.05, m: 2.2, parent: 1 }, { bone: 'RightForeArm', end: 'RightHand', r: 0.045, m: 1.6, parent: 5, hinge: true, ext: 1.35 },
  { bone: 'LeftUpLeg', end: 'LeftLeg', r: 0.075, m: 8, parent: 0 }, { bone: 'LeftLeg', end: 'LeftFoot', r: 0.055, m: 4, parent: 7, hinge: true, ext: 1.12 },
  { bone: 'RightUpLeg', end: 'RightLeg', r: 0.075, m: 8, parent: 0 }, { bone: 'RightLeg', end: 'RightFoot', r: 0.055, m: 4, parent: 9, hinge: true, ext: 1.12 },
];
const Y = new THREE.Vector3(0, 1, 0);
let nextId = 5000;

export class RagdollCtl {
  id = nextId++; active = false; t = 0; still = 0; getup = false; private bones: (THREE.Bone | null)[] = []; private off: THREE.Quaternion[] = []; private hipsOff = new THREE.Vector3();
  private snap = new Map<THREE.Object3D, THREE.Quaternion>(); private snapHips = new THREE.Vector3(); private blendT = 0; onDone: ((pos: THREE.Vector3, yaw: number) => void) | null = null;
  constructor(public ch: Character, public an: Animator, public phys: PhysicsClient) {}
  /** Go limp. vel: initial linear velocity (m/s, world); spin: angular velocity (rad/s). */
  start(vel: THREE.Vector3, spin = new THREE.Vector3()) {
    const ch = this.ch; ch.model.updateMatrixWorld(true); this.bones = DEFS.map((d) => ch.bone(d.bone));
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()));
    const segs: SegDesc[] = []; this.off = [];
    DEFS.forEach((d, i) => { const b = this.bones[i]!; const a = b.getWorldPosition(new THREE.Vector3());
      let e = d.end ? ch.bone(d.end)?.getWorldPosition(new THREE.Vector3()) : null; if (!e) e = a.clone().add(new THREE.Vector3(0, 0.2, 0)); if (d.ext) e = a.clone().lerp(e, d.ext);
      const dir = e.clone().sub(a); const len = Math.max(0.05, dir.length()); dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir); const mid = a.clone().addScaledVector(dir, len / 2);
      segs.push({ pos: mid.toArray(), quat: q.toArray() as number[], half: Math.max(0.01, len / 2 - d.r * 0.6), radius: d.r, mass: d.m, parent: d.parent, anchor: a.toArray(),
        hinge: d.hinge ? right.toArray() : undefined, lim: d.hinge ? (d.bone.includes('Leg') ? [-0.05, 2.4] : [-2.4, 0.05]) : undefined });
      this.off.push(q.clone().invert().multiply(b.getWorldQuaternion(new THREE.Quaternion())));
      if (i === 0) this.hipsOff.copy(a).sub(mid).applyQuaternion(q.clone().invert()); });
    this.phys.spawnRagdoll(this.id, segs, vel.toArray(), spin.toArray());
    this.active = true; this.getup = false; this.t = 0; this.still = 0;
  }
  /** Returns true while the ragdoll (or the get-up blend) owns the skeleton. */
  update(dt: number, groundY: (x: number, z: number) => number): boolean {
    if (!this.active) return false;
    this.t += dt;
    if (!this.getup) {
      const r = this.phys.ragdoll(this.id); if (!r || r.segs.length !== DEFS.length) return true;
      const ch = this.ch; const q = new THREE.Quaternion(), p = new THREE.Vector3(), pq = new THREE.Quaternion();
      DEFS.forEach((_, i) => { const b = this.bones[i]!; const s = r.segs[i]; q.set(s[3], s[4], s[5], s[6]).multiply(this.off[i]);
        b.parent!.updateWorldMatrix(true, false); b.parent!.getWorldQuaternion(pq); b.quaternion.copy(pq.invert().multiply(q));
        if (i === 0) { p.copy(this.hipsOff).applyQuaternion(new THREE.Quaternion(s[3], s[4], s[5], s[6])).add(new THREE.Vector3(s[0], s[1], s[2])); b.position.copy(b.parent!.worldToLocal(p)); }
        b.updateMatrixWorld(true); });
      // keep the character root under the pelvis so culling, shadows and the camera follow the body
      const h = r.segs[0]; ch.root.position.set(h[0], groundY(h[0], h[2]), h[2]); void ch;
      this.still = r.speed < 0.22 ? this.still + dt : 0;
      if (this.t > 1.4 && this.still > 0.7) this.beginGetUp(groundY);
      return true;
    }
    // get-up: animation runs; blend from the ragdoll snapshot over the first 0.4 s
    this.blendT += dt; const k = THREE.MathUtils.smoothstep(this.blendT, 0, 0.4);
    if (k < 1) { for (const [b, sq] of this.snap) b.quaternion.slerpQuaternions(sq, b.quaternion.clone(), k); const hips = this.ch.bone('Hips')!; hips.position.lerpVectors(this.snapHips, hips.position.clone(), k); this.ch.model.updateMatrixWorld(true); }
    if (!this.an.shot) { this.active = false; this.onDone?.(this.ch.root.position.clone(), this.ch.root.rotation.y); }
    return true;
  }
  private async beginGetUp(groundY: (x: number, z: number) => number) {
    this.getup = true; const ch = this.ch; ch.model.updateMatrixWorld(true);
    const P = (n: string) => ch.bone(n)!.getWorldPosition(new THREE.Vector3());
    const hips = P('Hips'), head = P('Head'), l = P('LeftUpLeg'), rr = P('RightUpLeg');
    const fwd = new THREE.Vector3().crossVectors(l.clone().sub(rr), head.clone().sub(hips)).normalize(); const faceUp = fwd.y > 0;
    // snapshot the ragdoll pose in root space before moving the root
    const worldPose = new Map<THREE.Object3D, THREE.Matrix4>(); ch.model.traverse((o) => { if ((o as THREE.Bone).isBone) worldPose.set(o, o.matrixWorld.clone()); });
    const key = faceUp ? 'standing_up_from_back' : 'standing_up_from_lying_on_stomach';
    const clip = await ch.clip('react', key); if (!clip) { this.active = false; return; }
    // head direction of the clip's first frame (root yaw 0) vs the lying body: rotate the root to match
    const probe = ch.mixer.clipAction(clip); const saved = (ch.mixer as any)._actions.map((a: THREE.AnimationAction) => a.getEffectiveWeight()); (ch.mixer as any)._actions.forEach((a: THREE.AnimationAction) => a.setEffectiveWeight(0));
    ch.root.rotation.set(0, 0, 0); ch.root.position.set(0, 0, 0); ch.root.updateMatrixWorld(true); probe.reset().play(); probe.setEffectiveWeight(1); probe.time = 0; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
    const cHips = P('Hips'), cHead = P('Head'); const clipYaw = Math.atan2(cHead.x - cHips.x, cHead.z - cHips.z), bodyYaw = Math.atan2(head.x - hips.x, head.z - hips.z);
    probe.stop(); (ch.mixer as any)._actions.forEach((a: THREE.AnimationAction, i: number) => a.setEffectiveWeight(saved[i] ?? 0));
    const yaw = bodyYaw - clipYaw; const rq = new THREE.Quaternion().setFromAxisAngle(Y, yaw); const hipsOffset = cHips.clone().setY(0).applyQuaternion(rq);
    ch.root.rotation.y = yaw; ch.root.position.set(hips.x - hipsOffset.x, groundY(hips.x, hips.z), hips.z - hipsOffset.z); ch.root.updateMatrixWorld(true);
    // convert the world snapshot to locals under the new root
    this.snap.clear(); for (const [b, m] of worldPose) { const pw = new THREE.Matrix4(); if (b.parent) pw.copy(b.parent.matrixWorld).invert(); const local = pw.multiply(m); const q = new THREE.Quaternion(); const pos = new THREE.Vector3(); local.decompose(pos, q, new THREE.Vector3()); this.snap.set(b, q); if (b === ch.bone('Hips')) this.snapHips.copy(pos); }
    this.phys.removeRagdoll(this.id); this.blendT = 0;
    this.an.play('react', key, { fadeIn: 0.01, fadeOut: 0.3, timeScale: 1.15 });
  }
  /** Debug/metrics: lowest point of the body above the ground (negative = sinking). */
  clearance(groundY: (x: number, z: number) => number) { let m = 9; const r = this.phys.ragdoll(this.id); if (!r) return m; r.segs.forEach((s, i) => { m = Math.min(m, s[1] - DEFS[i].r - groundY(s[0], s[2])); }); return m; }
}
