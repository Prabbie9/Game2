// Player on foot: camera-relative movement with inertia (walk / run / sprint / crouch), jump-fall-land, vault and
// climb over low obstacles found by the physics probe, entering and exiting the car without teleports (walk to the
// door, slide into the seat while sitting down, seated driving pose; reverse on exit), and the foot IK layer.
// The physics capsule (worker, CharacterSim) is the authority for position; the visual root follows it with a
// smoothed height so autostepped kerbs and stairs don't pop.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { PhysicsClient, CharState } from '../physics/client';
import { CHAR_MODE } from '../sim/charsim';
import { Character } from './character';
import { Animator } from '../animation/animator';
import { FootIK, solveTwoBone } from '../ik/footik';
import { RagdollCtl } from './ragdoll';

export type PlayerState = 'foot' | 'traverse' | 'toDoor' | 'enter' | 'drive' | 'exit' | 'ragdoll' | 'getup';
export interface Car { root: THREE.Object3D; modelSpace?: THREE.Object3D }
// driver seat (hips) and door point in the car's model space (origin on the ground, +Z forward, +X = left = driver side)
export const SEAT = new THREE.Vector3(0.37, 0.5, -0.28), DOOR = new THREE.Vector3(1.32, 0, -0.05); // SEAT = hips (H-point)
const SPEED = { walk: 1.6, run: 3.7, sprint: 5.9, crouch: 1.25 };
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Player {
  ch: Character; an!: Animator; ik!: FootIK; rag!: RagdollCtl; state: PlayerState = 'foot'; ready = false;
  yaw = 0; speed = 0; vel = new THREE.Vector3(); crouch = false; sprint = false; airT = 0; visY = 0; phys: CharState | null = null;
  car: Car | null = null; private seq = { t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), fromYaw: 0, toYaw: 0, path: null as null | ((k: number) => THREE.Vector3) };
  private pinK = 0; private wasGrounded = true; private target = new THREE.Vector3(); private moveYaw: number | null = null; prompt = '';
  constructor(public R: Renderer, public physics: PhysicsClient, public id: number, castId = 'standing_man') { this.ch = new Character(R, castId); }
  async load(pos: number[], yaw = 0) {
    await this.ch.load(); this.an = await new Animator(this.ch).init(); this.an.update(0, 0, 0); this.ik = new FootIK(this.ch); this.ik.calibrate(); this.rag = new RagdollCtl(this.ch, this.an, this.physics);
    this.rag.onDone = (pos, yaw) => { this.state = 'foot'; this.yaw = yaw; this.speed = 0; this.visY = pos.y; this.physics.teleportChar(this.id, [pos.x, pos.y + 0.02, pos.z]); this.physics.charInputs[this.id] = { mode: CHAR_MODE.walk, vx: 0, vz: 0 }; this.ik.reset(); };
    // warm the one-shot clips we use so the first jump/enter doesn't hitch on clip creation
    await Promise.all([['core', 'jumping_while_running'], ['core', 'jumping_up_from_action_idle_game_blend'], ['core', 'mid_air_falling_idle'], ['core', 'land_from_fall_a_to_standing_idle'],
      ['core', 'starting_to_climb_onto_a_box_or_short_fence'], ['core', 'climbing_up_a_wall'], ['civil', 'standing_to_sitting_transition'], ['vehicle', 'standard_drive'], ['vehicle', 'standing_up_from_seated_position']].map(([b, k]) => this.ch.clip(b, k)));
    this.yaw = yaw; this.visY = pos[1]; this.ch.root.position.set(pos[0], pos[1], pos[2]); this.ch.root.rotation.y = yaw; this.R.scene.add(this.ch.root);
    this.physics.spawnChar(this.id, pos); this.ready = true; return this;
  }
  get position() { return this.ch.root.position; }
  get onFoot() { return this.state === 'foot' || this.state === 'traverse'; }
  /** Seat the player in a car immediately (shots / bot routes start driving). */
  seatIn(car: Car) { this.car = car; this.state = 'drive'; this.pinK = 1; this.physics.charInputs[this.id] = { mode: CHAR_MODE.disabled }; this.an.play('vehicle', 'standard_drive', { fadeIn: 0.01, hold: true }); }
  private modelPoint(car: Car, local: THREE.Vector3) { (car.modelSpace ?? car.root).updateWorldMatrix(true, false); return (car.modelSpace ?? car.root).localToWorld(local.clone()); }
  private carYaw(car: Car) { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(car.root.getWorldQuaternion(new THREE.Quaternion())); return Math.atan2(f.x, f.z); }
  doorDistance(car: Car) { return this.modelPoint(car, DOOR).setY(0).distanceTo(this.position.clone().setY(0)); }
  enter(car: Car) { if (!this.onFoot) return; this.car = car; this.state = 'toDoor'; }
  exit() { if (this.state !== 'drive' || !this.car) return; const car = this.car; this.state = 'exit';
    const seat = this.modelPoint(car, SEAT), door = this.modelPoint(car, DOOR); const y = this.carYaw(car);
    this.startSeq(1.25, seat, door, y, y, (k) => { const d = this.modelPoint(car, DOOR), s = this.modelPoint(car, SEAT); this.pinK = 1 - THREE.MathUtils.smoothstep(k, 0.05, 0.6); return s.clone().lerp(d, THREE.MathUtils.smoothstep(k, 0.25, 0.95)).setY(d.y); });
    this.an.play('vehicle', 'standing_up_from_seated_position', { fadeIn: 0.15, timeScale: 1.35, fadeOut: 0.3 });
  }
  private startSeq(dur: number, from: THREE.Vector3, to: THREE.Vector3, fromYaw: number, toYaw: number, path: ((k: number) => THREE.Vector3) | null = null) {
    Object.assign(this.seq, { t: 0, dur, fromYaw, toYaw, path }); this.seq.from.copy(from); this.seq.to.copy(to);
  }
  /** Knocked down: go limp with this velocity (car hit, explosion, fall). */
  knockDown(vel: THREE.Vector3, spin = new THREE.Vector3()) { if (!this.ready || this.state === 'ragdoll' || this.state === 'drive' || this.state === 'enter' || this.state === 'exit') return false;
    this.state = 'ragdoll'; this.physics.charInputs[this.id] = { mode: CHAR_MODE.disabled }; this.an.stop(0.01); this.rag.start(vel, spin); return true; }
  /** move: camera-relative input (x right, y forward) in -1..1; camYaw: camera heading. */
  update(dt: number, inp: { move: [number, number]; sprint: boolean; jump: boolean; crouch: boolean; interact: boolean }, camYaw: number, ground: (side: 0 | 1, x: number, z: number) => { y: number; n: THREE.Vector3 } | null) {
    if (!this.ready) return;
    if (this.state === 'ragdoll') { const gy = (x: number, z: number) => ground(0, x, z)?.y ?? 0;
      if (this.rag.getup) { this.ch.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.ch.root.rotation.y); this.an.update(dt, 0, 0); }
      this.rag.update(dt, gy); return; }
    const ps = (this.phys = this.physics.char(this.id)); const ci: any = (this.physics.charInputs[this.id] ??= {});
    let animSpeed = 0;
    if (this.state === 'foot' || this.state === 'toDoor') {
      // desired planar velocity: camera relative input, or auto-walk to the car door
      let mx = inp.move[0], my = inp.move[1]; let want = 0;
      if (this.state === 'toDoor' && this.car) { const door = this.modelPoint(this.car, DOOR);
        // route around the car body: from the far side or the ends, go via the nearest driver-side corner first
        const ms = this.car.modelSpace ?? this.car.root; const lp = ms.worldToLocal(this.position.clone()); let goal = door;
        if (lp.x < 1.05 && Math.abs(lp.z) < 2.75) goal = this.modelPoint(this.car, new THREE.Vector3(1.35, 0, lp.z >= 0 ? 2.85 : -2.85));
        else if (lp.x < 1.05) goal = this.modelPoint(this.car, new THREE.Vector3(1.35, 0, Math.sign(lp.z) * 2.85));
        const finalLeg = goal === door; const d = goal.clone().sub(this.position).setY(0); let dist = d.length(); if (!finalLeg) dist += 1;
        if (finalLeg && (dist < 0.22 || (dist < 0.5 && this.speed < 0.3))) { this.beginEnter(); } else { const a = Math.atan2(d.x, d.z) - camYaw; mx = -Math.sin(a); my = Math.cos(a); want = Math.min(SPEED.run, 0.6 + dist * 1.6); }
        if (Math.hypot(inp.move[0], inp.move[1]) > 0.3 && this.state === 'toDoor') { this.state = 'foot'; this.car = null; } }
      const mag = Math.min(1, Math.hypot(mx, my));
      if (inp.crouch) this.crouch = !this.crouch; if (inp.sprint) this.crouch = false;
      if (this.state === 'foot') want = mag < 0.05 ? 0 : (this.crouch ? SPEED.crouch : inp.sprint ? SPEED.sprint : mag < 0.6 ? SPEED.walk : SPEED.run) * Math.max(mag, 0.35);
      if (mag > 0.05) { const fx = Math.sin(camYaw), fz = Math.cos(camYaw); const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
        const dx = fx * my + rx * mx, dz = fz * my + rz * mx; this.moveYaw = Math.atan2(dx, dz);
        // facing turns toward the move direction, slower at speed (momentum); velocity follows facing so sprints arc
        const rate = THREE.MathUtils.lerp(11, 4.5, THREE.MathUtils.clamp(this.speed / SPEED.sprint, 0, 1)); const e = wrap(this.moveYaw - this.yaw);
        this.yaw = wrap(this.yaw + THREE.MathUtils.clamp(e, -rate * dt, rate * dt)); if (Math.abs(e) > 2.4 && this.speed < 1) this.yaw = this.moveYaw; } else this.moveYaw = null;
      const grounded = ps?.grounded ?? true; const acc = grounded ? (want > this.speed ? 7.5 : 11) : 1.5;
      this.speed += THREE.MathUtils.clamp(want - this.speed, -acc * dt, acc * dt);
      const dirYaw = this.moveYaw === null ? this.yaw : this.yaw; this.vel.set(Math.sin(dirYaw) * this.speed, 0, Math.cos(dirYaw) * this.speed);
      // traversal: jump into a low obstacle -> vault/climb; otherwise a normal jump
      let jump = inp.jump && grounded && !this.crouch;
      if (jump && ps && ps.obstacle.dist < 0.95 && ps.obstacle.top > 0.35 && ps.obstacle.top < 2.25) { this.beginTraverse(ps); jump = false; }
      if (jump) { this.an.play('core', this.speed > 2 ? 'jumping_while_running' : 'jumping_up_from_action_idle_game_blend', { fadeIn: 0.08, fadeOut: 0.2, timeScale: this.speed > 2 ? 1.15 : 1 }); }
      const fl = this.ch.bone('LeftFoot')!.getWorldPosition(new THREE.Vector3()), fr = this.ch.bone('RightFoot')!.getWorldPosition(new THREE.Vector3());
      Object.assign(ci, { vx: this.vel.x, vz: this.vel.z, jump: jump ? 1 : 0, crouch: this.crouch ? 1 : 0, yaw: this.yaw, mode: CHAR_MODE.walk, feet: [fl.x, fl.z, fr.x, fr.z] });
      // air time -> falling loop; landing -> recover
      if (ps) { if (!ps.grounded) this.airT += dt; else { if (!this.wasGrounded && this.airT > 0.55) this.an.play('core', 'land_from_fall_a_to_standing_idle', { fadeIn: 0.05, fadeOut: 0.3, timeScale: 1.6, from: 0.15 }); this.airT = 0; }
        if (this.airT > 0.5 && !this.an.shot) this.an.play('core', 'mid_air_falling_idle', { fadeIn: 0.25, hold: true }); if (ps.grounded && this.an.shot?.a.getClip().name === 'mid_air_falling_idle') this.an.stop(0.15);
        this.wasGrounded = ps.grounded; }
      // real ground speed (blocked by a wall -> no moonwalking)
      animSpeed = ps ? Math.min(Math.hypot(ps.vel[0], ps.vel[2]), this.speed + 0.2) : this.speed;
      this.prompt = this.state === 'foot' && this.car === null ? '' : '';
    } else if (this.state === 'traverse' || this.state === 'enter' || this.state === 'exit') {
      const s = this.seq; s.t += dt; const k = Math.min(1, s.t / s.dur);
      const p = s.path ? s.path(k) : s.from.clone().lerp(s.to, k); this.yaw = s.fromYaw + wrap(s.toYaw - s.fromYaw) * THREE.MathUtils.smoothstep(k, 0, 0.5);
      Object.assign(ci, { mode: CHAR_MODE.scripted, target: [p.x, p.y, p.z], vx: 0, vz: 0, jump: 0 }); this.target.copy(p);
      if (this.state === 'enter' && this.car) this.yaw = this.carYaw(this.car);
      if (k >= 1) { if (this.state === 'traverse') { this.state = 'foot'; this.physics.teleportChar(this.id, [p.x, p.y, p.z]); }
        else if (this.state === 'enter') { this.state = 'drive'; Object.assign(ci, { mode: CHAR_MODE.disabled }); this.an.play('vehicle', 'standard_drive', { fadeIn: 0.25, hold: true }); }
        else if (this.state === 'exit') { this.state = 'foot'; this.physics.teleportChar(this.id, [p.x, p.y + 0.02, p.z]); this.car = null; this.speed = 0; } }
    } else if (this.state === 'drive' && this.car) {
      const seat = this.modelPoint(this.car, SEAT); this.yaw = this.carYaw(this.car); this.target.copy(seat); this.pinK = 1;
      Object.assign(ci, { mode: CHAR_MODE.disabled, target: [seat.x, seat.y, seat.z] });
    }
    // visual root: physics feet (smoothed height for steps) or the scripted / seated target
    const root = this.ch.root;
    if (this.state === 'foot' || this.state === 'toDoor') { if (ps) { const ty = ps.pos[1]; this.visY = Math.abs(ty - this.visY) > 0.6 ? ty : this.visY + (ty - this.visY) * Math.min(1, dt * 12); root.position.set(ps.pos[0], this.visY, ps.pos[2]); } }
    else if (this.state === 'drive' && this.car) { root.position.copy(this.target); root.quaternion.copy(this.car.root.getWorldQuaternion(new THREE.Quaternion())); }
    else { root.position.copy(this.target); this.visY = this.target.y; }
    if (this.state !== 'drive') root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const ry = this.an.update(dt, animSpeed, this.crouch && this.state === 'foot' ? 1 : 0); if (ry) this.yaw += ry;
    // foot IK only on foot, fading with one-shots that leave the ground
    const ikW = this.state === 'foot' && (ps?.grounded ?? true) ? 1 - (this.an.shot && !/land/.test(this.an.shot.a.getClip().name) ? this.an.shot.w : 0) : 0;
    this.ik.weight += (ikW - this.ik.weight) * Math.min(1, dt * 10); this.ik.update(dt, ground, root.position.y, animSpeed);
    // seat constraint: move the whole body so the hips sit on the seat's H-point (blended in/out while entering/exiting)
    if (this.car && this.pinK > 0 && (this.state === 'drive' || this.state === 'enter' || this.state === 'exit')) { const hips = this.ch.bone('Hips')!; this.ch.model.updateMatrixWorld(true);
      const want = this.modelPoint(this.car, SEAT); const off = want.sub(hips.getWorldPosition(new THREE.Vector3())).multiplyScalar(this.pinK); root.position.add(off); root.updateMatrixWorld(true); }
    if (this.state === 'drive') this.seatedPose(); else if (this.state !== 'enter' && this.state !== 'exit') this.pinK = 0;
  }
  private beginEnter() { if (!this.car) return; const car = this.car; const door = this.modelPoint(car, DOOR), seat = this.modelPoint(car, SEAT); const y = this.carYaw(car);
    this.state = 'enter'; this.speed = 0; void door; void seat; this.startSeq(1.35, door, seat, this.yaw, y, (k) => { const d = this.modelPoint(car, DOOR), s = this.modelPoint(car, SEAT); const q = THREE.MathUtils.smoothstep(k, 0.3, 0.95);
      this.pinK = THREE.MathUtils.smoothstep(k, 0.35, 1); return d.clone().lerp(s, q).setY(d.y); });
    this.an.play('civil', 'standing_to_sitting_transition', { fadeIn: 0.2, timeScale: 1.25, hold: true }); }
  private beginTraverse(ps: CharState) {
    const o = ps.obstacle; const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); const p0 = this.position.clone(); const base = ps.pos[1];
    const top = base + o.top; const onTop = p0.clone().addScaledVector(f, o.dist + Math.min(0.45, o.depth * 0.5)).setY(top);
    const over = o.top < 1.3 && o.depth < 0.7; // thin + low: vault over and drop on the far side
    const end = over ? p0.clone().addScaledVector(f, o.dist + o.depth + 0.55).setY(base) : onTop; const high = o.top >= 1.3;
    this.state = 'traverse'; this.speed = over ? 2.2 : 0;
    const dur = high ? 1.55 : over ? 0.95 : 1.15;
    this.startSeq(dur, p0, end, this.yaw, this.yaw, (k) => { if (over) { const mid = p0.clone().lerp(end, 0.5).setY(top + 0.12); return k < 0.5 ? p0.clone().lerp(mid, THREE.MathUtils.smoothstep(k, 0, 0.5)).setY(THREE.MathUtils.lerp(base, top + 0.12, Math.sin((k / 0.5) * Math.PI / 2))) : mid.clone().lerp(end, (k - 0.5) / 0.5).setY(THREE.MathUtils.lerp(top + 0.12, base, ((k - 0.5) / 0.5) ** 2)); }
      return p0.clone().lerp(onTop, THREE.MathUtils.smoothstep(k, 0.35, 1)).setY(THREE.MathUtils.lerp(base, top, THREE.MathUtils.smoothstep(k, 0.1, 0.75))); });
    if (high) this.an.play('core', 'climbing_up_a_wall', { fadeIn: 0.12, fadeOut: 0.25, timeScale: 2.0 / dur });
    else this.an.play('core', 'starting_to_climb_onto_a_box_or_short_fence', { fadeIn: 0.1, fadeOut: 0.25, timeScale: over ? 2.2 : 1.9, from: 0.15 });
  }
  /** Seated: hands to the wheel rim (two-bone IK on the arms toward wheel points in car space). */
  private seatedPose() { if (!this.car) return; const arms: [string, THREE.Vector3][] = [['Left', new THREE.Vector3(0.55, 0.86, 0.33)], ['Right', new THREE.Vector3(0.19, 0.86, 0.33)]];
    for (const [s, local] of arms) { const a = this.ch.bone(s + 'Arm'), b = this.ch.bone(s + 'ForeArm'), c = this.ch.bone(s + 'Hand'); if (!a || !b || !c) continue;
      const t = this.modelPoint(this.car, local); const elbow = b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -1, 0)); solveTwoBone(a, b, c, t, elbow); } }
}
