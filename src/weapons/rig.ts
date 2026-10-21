// Weapon on a character: the model sits at the right palm with its grip socket (origin), oriented by a per-stance
// calibration of the hand frame or, while aiming, exactly along the aim ray. Procedural layers after the mixer: spine
// aim offset (pitch/yaw spread over Spine..Spine2) that turns the torso until the hand-held muzzle points down the aim
// ray, right-hand IK onto the grip, left-hand IK onto the support socket (or the magazine during reloads), additive
// recoil (kick back + muzzle rise with a spring) and sway. Metrics for the grip test are exposed in `metrics`.
import * as THREE from 'three';
import type { Character } from '../character/character';
import type { Renderer } from '../renderer/renderer';
import { weaponMeta, weaponModel, weaponModelLean, type WeaponMeta } from './models';
import { solveTwoBone, rotateWorld } from '../ik/footik';

const Y = new THREE.Vector3(0, 1, 0);
export class WeaponRig {
  model: THREE.Object3D | null = null; meta: WeaponMeta | null = null; id: string | null = null; aimW = 0; aimDir = new THREE.Vector3(0, 0, 1);
  recoil = { kick: 0, rise: 0, vk: 0, vr: 0 }; reloadT = -1; reloadDur = 1; sway = 0; holstered = false;
  metrics = { gripErr: 0, supportErr: 0, muzzleErrDeg: 0 };
  private bones: Record<string, THREE.Bone> = {};
  lean = false; // AI holders: merged low-draw model (weaponModelLean)
  constructor(public R: Renderer, public ch: Character) {
    for (const n of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1']) { const b = ch.bone(n); if (b) this.bones[n] = b; }
  }
  async equip(id: string | null) {
    if (this.model) { this.model.removeFromParent(); this.model = null; } this.id = id; this.meta = null; if (!id) return;
    const meta = (await weaponMeta())[id]; const m = await (this.lean ? weaponModelLean : weaponModel)(this.R, id); if (this.id !== id || this.model) return; /* a newer equip() won */
    this.meta = meta; this.model = m; this.R.scene.add(m);
  }
  /** Palm point: between the hand bone and the middle-finger base, nudged toward the palm. */
  private palm(side: 'Right' | 'Left') { const h = this.bones[side + 'Hand'], mid = this.bones[side + 'HandMiddle1']; const a = h.getWorldPosition(new THREE.Vector3()); return mid ? a.lerp(mid.getWorldPosition(new THREE.Vector3()), 0.55) : a; }
  socketWorld(name: keyof WeaponMeta['sockets']) { return this.model!.localToWorld(new THREE.Vector3().fromArray(this.meta!.sockets[name])); }
  fireKick(pitchDeg: number) { this.recoil.vk += 0.9 + pitchDeg * 0.08; this.recoil.vr += pitchDeg * 0.9; }
  startReload(dur: number) { this.reloadT = 0; this.reloadDur = dur; }
  /** After the mixer. aimDir = camera aim (world); aiming 0..1; facing = character root yaw. */
  update(dt: number, aimDir: THREE.Vector3, aiming: boolean, speed: number) {
    if (!this.model || !this.meta || this.holstered) { if (this.model) this.model.visible = !this.holstered; return; }
    this.model.visible = true; if (this.model.userData.cast !== this.ch.castsShadow) { this.model.userData.cast = this.ch.castsShadow; this.model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = this.ch.castsShadow; }); } /* follows the holder's shadow budget */
    const B = this.bones; const m = this.model; this.aimDir.copy(aimDir).normalize();
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * Math.min(1, dt * 10);
    // recoil spring (kick metres back, rise degrees)
    const r = this.recoil; r.vk += (-r.kick * 220 - r.vk * 24) * dt; r.kick = Math.max(0, r.kick + r.vk * dt * 0.01); r.vr += (-r.rise * 160 - r.vr * 20) * dt; r.rise += r.vr * dt;
    this.ch.model.updateMatrixWorld(true);
    const reloading = this.reloadT >= 0; if (reloading) { this.reloadT += dt; if (this.reloadT > this.reloadDur) this.reloadT = -1; }
    const gun = this.meta.kind === 'gun'; const aimK = gun ? Math.max(this.aimW, 0.55) * (reloading ? 0.35 : 1) : 0; // guns always point roughly forward (low ready)
    // 1) torso aim offset: rotate Spine..Spine2 so the chest faces the aim direction (yaw) and pitch follows it
    if (gun) { const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.ch.root.getWorldQuaternion(new THREE.Quaternion()));
      const yawErr = Math.atan2(aimDir.x, aimDir.z) - Math.atan2(chestFwd.x, chestFwd.z); const yw = Math.atan2(Math.sin(yawErr), Math.cos(yawErr)) * aimK;
      const pitch = Math.asin(THREE.MathUtils.clamp(aimDir.y, -0.95, 0.95)) * aimK; const right = new THREE.Vector3().crossVectors(Y, chestFwd).normalize();
      for (const n of ['Spine', 'Spine1', 'Spine2']) { const b = B[n]; if (!b) continue; rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(Y, yw / 3).multiply(new THREE.Quaternion().setFromAxisAngle(right, -pitch / 3))); } }
    // 2) weapon transform: palm-anchored; orientation = aim (blended) else hand-relative carry
    const palm = this.palm('Right'); const hq = B.RightHand.getWorldQuaternion(new THREE.Quaternion());
    const aimQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), this.aimDir.clone().negate(), Y)); // +Z along aim
    const carryQ = gun ? aimQ.clone().slerp(hq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)), 1 - aimK)
      : hq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2))); // melee/throw: blade along the fingers' curl
    m.quaternion.copy(carryQ);
    const riseQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(r.rise)); m.quaternion.multiply(riseQ);
    if (reloading) { const k = Math.sin(Math.min(1, this.reloadT / this.reloadDur) * Math.PI); m.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35 * k, 0, 0.5 * k))); }
    m.position.copy(palm).add(new THREE.Vector3(0, 0, -r.kick * 0.06).applyQuaternion(m.quaternion));
    // long guns: shoulder the stock while aiming (stock = rear end along -Z from the grip, at bore height)
    const long = gun && this.meta.length > 0.45; if (long && this.aimW > 0.01) { const S = this.meta.sockets; const gz = this.meta.length - S.muzzle[2]; const stock = new THREE.Vector3(0, S.muzzle[1] * 0.6, -gz + 0.03);
      const sh = (B.RightShoulder ?? B.RightArm).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.03, 0.05).applyQuaternion(this.ch.root.getWorldQuaternion(new THREE.Quaternion())));
      const want = sh.sub(stock.applyQuaternion(m.quaternion)); m.position.lerp(want, this.aimW * (reloading ? 0.3 : 1)); }
    m.updateMatrixWorld(true);
    // 3) right hand onto the grip (IK), hand orientation follows the weapon
    const elbowR = B.RightForeArm.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.2, -0.4, -0.1).applyQuaternion(this.ch.root.quaternion));
    solveTwoBone(B.RightArm, B.RightForeArm, B.RightHand, this.socketWorld('grip').sub(palm.clone().sub(B.RightHand.getWorldPosition(new THREE.Vector3()))), elbowR);
    // re-anchor the weapon at the (now IK'd) palm so grip error is exact (shouldered guns: the hand reached the grip)
    { m.position.copy(this.palm('Right')).add(new THREE.Vector3(0, 0, -r.kick * 0.06).applyQuaternion(m.quaternion)); m.updateMatrixWorld(true); }
    // 4) left hand: support socket (two-handed guns), magazine during the reload's middle third
    if (gun && this.meta.length > 0.3 || (gun && this.aimW > 0.5)) { let t = this.socketWorld('support');
      // keep the support hand on the handguard but within the left arm's reach (slide back toward the grip)
      { const sh = B.LeftArm.getWorldPosition(new THREE.Vector3()); const reach = (B.LeftArm.getWorldPosition(new THREE.Vector3()).distanceTo(B.LeftForeArm.getWorldPosition(new THREE.Vector3())) + B.LeftForeArm.getWorldPosition(new THREE.Vector3()).distanceTo(B.LeftHand.getWorldPosition(new THREE.Vector3()))) * 0.96;
        const g = this.socketWorld('grip').add(new THREE.Vector3(0, t.clone().sub(this.socketWorld('grip')).y, 0)); for (let i = 0; i < 12 && t.distanceTo(sh) > reach; i++) t.lerp(g, 0.12); }
      if (reloading) { const u = this.reloadT / this.reloadDur; const mag = this.socketWorld('mag'); const down = mag.clone().add(new THREE.Vector3(0, -0.25, 0.05)); t = u < 0.25 ? t.lerp(mag, u / 0.25) : u < 0.5 ? mag.lerp(down, (u - 0.25) / 0.25) : u < 0.75 ? down.lerp(mag, (u - 0.5) / 0.25) : mag.lerp(t, (u - 0.75) / 0.25); }
      const lp = this.palm('Left'), lh = B.LeftHand.getWorldPosition(new THREE.Vector3()); const elbowL = B.LeftForeArm.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.2, -0.4, 0).applyQuaternion(this.ch.root.quaternion));
      solveTwoBone(B.LeftArm, B.LeftForeArm, B.LeftHand, t.clone().sub(lp.sub(lh)), elbowL);
      for (let it = 0; it < 2; it++) { const lp2 = this.palm('Left'), lh2 = B.LeftHand.getWorldPosition(new THREE.Vector3()); solveTwoBone(B.LeftArm, B.LeftForeArm, B.LeftHand, t.clone().sub(lp2.sub(lh2)), elbowL); } /* palm offset changes as the hand rotates */ this.metrics.supportErr = this.palm('Left').distanceTo(t); }
    this.metrics.gripErr = this.palm('Right').distanceTo(this.socketWorld('grip'));
    const mdir = this.socketWorld('muzzle').sub(this.socketWorld('grip')).normalize(); const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
    this.metrics.muzzleErrDeg = THREE.MathUtils.radToDeg(fwd.angleTo(this.aimDir)) * (this.aimW > 0.9 ? 1 : 0); void mdir; void speed;
  }
}
