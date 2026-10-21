// Combat core: data-driven weapons (src/data/weapons.json), hitscan with spread, pellets and range falloff against the
// world (streamed blocker boxes + analytic ground), characters (bone hitboxes by zone: head / torso / limbs) and
// vehicles (oriented boxes); projectiles (launcher rocket) and thrown grenades/molotovs with bounces; explosions with
// radial damage + physics impulses. Every combatant is a Target registered by the game.
import * as THREE from 'three';
import WEAPONS from '../data/weapons.json';
import type { CombatFX } from '../fx/combatfx';
import type { Character } from '../character/character';

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rpg' | 'bat' | 'crowbar' | 'knife' | 'grenade' | 'molotov';
export interface WeaponData { slot: number; stance: string | null; auto?: boolean; damage: number; pellets?: number; rpm: number; mag?: number; reload?: number; spread?: number[]; recoil?: number[]; falloff?: number[]; range: number; aimFov?: number; headMul?: number; melee?: boolean; throw?: boolean; arc?: number; impulse?: number; fuse?: number; speed?: number; radius?: number; fire?: number; projectile?: { speed: number; radius: number; impulse: number } }
export const WDATA = WEAPONS as unknown as Record<WeaponId, WeaponData>;
export type Zone = 'head' | 'torso' | 'limb';
export interface Target { id: string; ch: Character | null; alive: boolean; health: number; armour?: number; team: number; pos(): THREE.Vector3; hit(dmg: number, dir: THREE.Vector3, zone: Zone, force: number): void; vehicle?: { pos: THREE.Vector3; quat: THREE.Quaternion; half: number[] } }
export interface WorldHit { t: number; p: THREE.Vector3; n: THREE.Vector3; kind: 'concrete' | 'metal' | 'glass' | 'dirt' }
const ZONES: [string, string | null, number, Zone][] = [['Head', 'HeadTop_End', 0.11, 'head'], ['Spine2', 'Neck', 0.17, 'torso'], ['Hips', 'Spine1', 0.17, 'torso'], ['LeftUpLeg', 'LeftLeg', 0.08, 'limb'], ['RightUpLeg', 'RightLeg', 0.08, 'limb'], ['LeftLeg', 'LeftFoot', 0.06, 'limb'], ['RightLeg', 'RightFoot', 0.06, 'limb'], ['LeftArm', 'LeftForeArm', 0.05, 'limb'], ['RightArm', 'RightForeArm', 0.05, 'limb'], ['LeftForeArm', 'LeftHand', 0.045, 'limb'], ['RightForeArm', 'RightHand', 0.045, 'limb']];
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Ray vs capsule (segment a-b, radius r): distance or null. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, far: number) {
  // closest approach between the ray and the segment by alternating projection (converges in a few steps)
  const ab = b.clone().sub(a); const abab = ab.dot(ab) || 1; let t = Math.max(0, a.clone().sub(o).dot(d)); const p = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < 4; i++) { p.copy(o).addScaledVector(d, t); const u = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / abab, 0, 1); c.copy(a).addScaledVector(ab, u); t = Math.max(0, c.clone().sub(o).dot(d)); }
  p.copy(o).addScaledVector(d, t); const dist = p.distanceTo(c);
  if (dist > r || t > far) return null; return Math.max(0, t - Math.sqrt(Math.max(0, r * r - dist * dist)));
}
export class Combat {
  targets: Target[] = []; rockets: { p: THREE.Vector3; v: THREE.Vector3; t: number; owner: string; w: WeaponData }[] = []; throws: { p: THREE.Vector3; v: THREE.Vector3; t: number; owner: string; w: WeaponData; id: WeaponId; mesh?: THREE.Object3D }[] = [];
  onExplode: ((p: THREE.Vector3, radius: number, strength: number) => void) | null = null; stats = { shots: 0, hits: 0 };
  /** Witnessable events for the wanted system and fleeing crowds (owner = shooter id). */
  onEvent: ((kind: 'shot' | 'hit' | 'explode', owner: string, pos: THREE.Vector3, target?: Target) => void) | null = null;
  constructor(public fx: CombatFX, public castWorld: (o: THREE.Vector3, d: THREE.Vector3, far: number) => WorldHit | null) {}
  /** First thing a ray hits (world / character zone / vehicle), excluding the shooter. */
  trace(o: THREE.Vector3, d: THREE.Vector3, far: number, ignore: string, ignoreTeam = -1) {
    let best: { t: number; target?: Target; zone?: Zone; world?: WorldHit } | null = null; const w = this.castWorld(o, d, far); if (w) best = { t: w.t, world: w };
    for (const tg of this.targets) { if (tg.id === ignore || tg.team === ignoreTeam || !tg.alive && !tg.ch) continue; const lim = best ? best.t : far;
      if (tg.vehicle) { const v = tg.vehicle; const inv = v.quat.clone().invert(); const lo = o.clone().sub(v.pos).applyQuaternion(inv), ld = d.clone().applyQuaternion(inv); const box = new THREE.Box3(new THREE.Vector3(-v.half[0], -v.half[1], -v.half[2]), new THREE.Vector3(v.half[0], v.half[1], v.half[2]));
        const hp = new THREE.Ray(lo, ld).intersectBox(box, _a); if (hp) { const t = hp.distanceTo(lo); if (t < lim) best = { t, target: tg, world: { t, p: o.clone().addScaledVector(d, t), n: d.clone().negate(), kind: 'metal' } }; } continue; }
      if (!tg.ch || !tg.ch.model) continue; if (tg.pos().distanceTo(o) > lim + 2) continue; tg.ch.model.updateMatrixWorld(true);
      for (const [b0, b1, r, zone] of ZONES) { const A = tg.ch.bone(b0), Bn = b1 ? tg.ch.bone(b1) : null; if (!A || !Bn) continue; const t = rayCapsule(o, d, A.getWorldPosition(_a).clone(), Bn.getWorldPosition(_b).clone(), r, best ? best.t : far);
        if (t !== null && (!best || t < best.t)) best = { t, target: tg, zone }; } }
    return best;
  }
  /** Fire one trigger pull. Returns the hits for metrics. */
  fire(owner: string, w: WeaponData, muzzle: THREE.Vector3, eye: THREE.Vector3, aimDir: THREE.Vector3, aiming: boolean, bloom = 0, ignoreTeam = -1) {
    const out: { zone?: Zone; target?: string; dist: number }[] = []; const spreadDeg = (aiming ? w.spread![1] : w.spread![0]) + bloom;
    if (w.projectile) { const v = aimDir.clone().multiplyScalar(w.projectile.speed); this.rockets.push({ p: muzzle.clone(), v, t: 0, owner, w }); this.fx.muzzle(muzzle, aimDir, 0.6); return out; }
    for (let i = 0; i < (w.pellets ?? 1); i++) {
      const d = aimDir.clone(); const a = Math.random() * Math.PI * 2, r = THREE.MathUtils.degToRad(spreadDeg) * Math.sqrt(Math.random()) * 0.5; const ax = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(); const ay = new THREE.Vector3().crossVectors(ax, d);
      d.addScaledVector(ax, Math.cos(a) * Math.tan(r)).addScaledVector(ay, Math.sin(a) * Math.tan(r)).normalize();
      // ray from the eye (crosshair) so what you aim at is what you hit; the tracer starts at the muzzle
      const hit = this.trace(eye, d, w.range, owner, ignoreTeam); this.stats.shots++;
      const end = hit ? eye.clone().addScaledVector(d, hit.t) : eye.clone().addScaledVector(d, w.range); if (Math.random() < (w.pellets && w.pellets > 1 ? 0.3 : 0.6)) this.fx.tracer(muzzle, end);
      if (!hit) continue; out.push({ zone: hit.zone, target: hit.target?.id, dist: hit.t });
      if (hit.target) { this.stats.hits++; const fall = w.falloff ? THREE.MathUtils.clamp(1 - (hit.t - w.falloff[0]) / (w.falloff[1] - w.falloff[0]), 0, 1) * (1 - w.falloff[2]) + w.falloff[2] : 1;
        const zoneMul = hit.zone === 'head' ? (w.headMul ?? 2) : hit.zone === 'limb' ? 0.7 : 1; const arm = hit.zone === 'torso' ? (hit.target.armour ?? 1) : 1;
        hit.target.hit(w.damage * fall * zoneMul * arm, d, hit.zone ?? 'torso', 2 + w.damage * 0.05); this.onEvent?.('hit', owner, end, hit.target);
        if (hit.zone) this.fx.impact(end, d.clone().negate(), 'flesh'); else if (hit.world) this.fx.impact(hit.world.p, hit.world.n, 'metal'); }
      else if (hit.world) this.fx.impact(hit.world.p, hit.world.n, hit.world.kind); }
    this.fx.muzzle(muzzle, aimDir, w.pellets && w.pellets > 1 ? 0.5 : 0.32); this.onEvent?.('shot', owner, muzzle);
    return out;
  }
  /** Melee swing: targets inside the range and arc in front of the attacker. */
  melee(owner: string, w: WeaponData, from: THREE.Vector3, fwd: THREE.Vector3) { const hits: string[] = [];
    for (const tg of this.targets) { if (tg.id === owner || !tg.alive || tg.vehicle) continue; const d = tg.pos().clone().sub(from).setY(0); const L = d.length(); if (L > (w.range ?? 1.5) + 0.3) continue;
      if (THREE.MathUtils.radToDeg(d.normalize().angleTo(fwd.clone().setY(0).normalize())) > (w.arc ?? 60) / 2 + 15) continue; tg.hit(w.damage, d, 'torso', w.impulse ?? 3); hits.push(tg.id); this.onEvent?.('hit', owner, from, tg); this.fx.impact(tg.pos().clone().add(new THREE.Vector3(0, 1.3, 0)), d.clone().negate(), 'flesh'); }
    return hits; }
  throwItem(owner: string, id: WeaponId, from: THREE.Vector3, dir: THREE.Vector3, mesh?: THREE.Object3D) { const w = WDATA[id]; this.throws.push({ p: from.clone(), v: dir.clone().multiplyScalar(w.speed ?? 15).add(new THREE.Vector3(0, 3, 0)), t: 0, owner, w, id, mesh }); }
  explode(p: THREE.Vector3, radius: number, damage: number, strength: number, owner: string) {
    this.fx.explosion(p, radius); this.onExplode?.(p, radius, strength); this.onEvent?.('explode', owner, p);
    for (const tg of this.targets) { if (!tg.alive) continue; const L = tg.pos().distanceTo(p); if (L > radius) continue; const k = 1 - L / radius; tg.hit(damage * k * k, tg.pos().clone().sub(p).normalize(), 'torso', strength * k); }
    void owner;
  }
  update(dt: number, ground: (x: number, z: number) => number) {
    for (const r of this.rockets) { r.t += dt; const step = r.v.clone().multiplyScalar(dt); const L = step.length(); const d = step.clone().normalize();
      const hit = this.trace(r.p, d, L, r.owner); this.fx.smoke.emit(r.p.clone(), new THREE.Vector3(0, 0.4, 0), 1.6, 0.25, 1.2, 0xd8d4cc, 0.3);
      const gy = ground(r.p.x, r.p.z); if (hit || r.p.y + step.y < gy || r.t > 8) { const at = hit ? r.p.clone().addScaledVector(d, hit.t) : r.p.clone().setY(Math.max(gy, r.p.y)); this.explode(at, r.w.projectile!.radius, r.w.damage, r.w.projectile!.impulse, r.owner); r.t = 99; } else r.p.add(step); }
    this.rockets = this.rockets.filter((r) => r.t < 99);
    for (const g of this.throws) { g.t += dt; g.v.y -= 9.81 * dt; const step = g.v.clone().multiplyScalar(dt); const d = step.clone().normalize(); const w = this.castWorld(g.p, d, step.length());
      if (w) { g.p.copy(w.p).addScaledVector(w.n, 0.05); g.v.reflect(w.n).multiplyScalar(0.4); if (g.id === 'molotov') g.t = 99; } else g.p.add(step);
      const gy = ground(g.p.x, g.p.z) + 0.05; if (g.p.y < gy) { g.p.y = gy; g.v.y = Math.abs(g.v.y) * 0.35; g.v.x *= 0.6; g.v.z *= 0.6; if (g.id === 'molotov') g.t = 99; }
      if (g.mesh) { g.mesh.position.copy(g.p); g.mesh.rotation.x += dt * 8; }
      if ((g.w.fuse && g.t > g.w.fuse) || g.t >= 99) { this.explode(g.p.clone(), g.w.radius ?? 5, g.w.damage, g.w.impulse ?? 5, g.owner); g.t = 199; g.mesh?.removeFromParent(); } }
    this.throws = this.throws.filter((g) => g.t < 199);
  }
}
