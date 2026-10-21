// Hostile / police combatant AI: a cast body with the rifle stance and a WeaponRig, moved by its own physics capsule.
// Perception: sight cone + line of sight (world ray) and hearing (gunfire events). Tactics: take the nearest cover
// point that hides it from the threat (generated from streamed building boxes and parked cars), peek and fire bursts
// after a reaction delay with distance/motion-scaled spread, relocate when flanked or after a while, close in when the
// target has no cover. Navigation: steer straight; when blocked, route via the nearest corner of the blocking box
// (grid streets make this sufficient; see DESIGN.md for the navmesh decision). Fairness: an aim-up warning before the
// first burst, a grace period, capped accuracy and a hard cap on simultaneous shooters.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { PhysicsClient } from '../physics/client';
import { CHAR_MODE } from '../sim/charsim';
import { Character } from '../character/character';
import { Animator } from '../animation/animator';
import { FootIK } from '../ik/footik';
import { WeaponRig } from '../weapons/rig';
import { RagdollCtl } from '../character/ragdoll';
import { WDATA, type Combat, type Target } from '../combat/combat';

export interface CoverSource { boxes(): THREE.Box3[] }
type AIState = 'idle' | 'alert' | 'toCover' | 'cover' | 'advance' | 'dead';
let nextId = 300; const reserved = new Map<number, THREE.Vector3>(); export const AI_LIMITS = { maxShooters: 4, grace: 1.5, warn: 0.8 };
let shootersNow = 0;
export class Combatant {
  ch: Character; an!: Animator; ik!: FootIK; rig!: WeaponRig; rag!: RagdollCtl; id = nextId++; state: AIState = 'idle'; health = 160; armour = 0.65; ready = false;
  yaw = 0; speed = 0; target: Target | null = null; seen = 0; lastSeen = new THREE.Vector3(); cover: THREE.Vector3 | null = null; t = 0; burst = 0; cool = 1; warnT = 0; alertT = 0; peek = 0;
  private wp: THREE.Vector3 | null = null; private visY = 0; tgt: Target;
  /** Advance stops this far from the last-seen point (police arresting at 1 star use ~1 m); noCover = never take cover. */
  standoff = 12; noCover = false;
  constructor(public R: Renderer, public phys: PhysicsClient, public combat: Combat, public world: CoverSource, public body = 'fsb_op', public team = 1, public weapon: 'rifle' | 'smg' | 'pistol' = 'rifle') {
    this.ch = new Character(R, body, { lod: R.tier.name === 'Lite' ? 1 : 0 }); const self = this;
    this.tgt = { id: 'ai' + this.id, ch: this.ch, team, get alive() { return self.state !== 'dead'; }, get health() { return self.health; }, armour: this.armour, pos: () => this.ch.root.position, hit: (d, dir, z, f) => this.hit(d, dir, z, f) };
  }
  async load(pos: THREE.Vector3, yaw = 0) {
    await this.ch.load(); this.an = await new Animator(this.ch).init(); const st = WDATA[this.weapon].stance!; await this.an.addStance(st); this.an.stance = st;
    this.ik = new FootIK(this.ch); this.an.update(0, 0, 0); this.ik.calibrate(); this.rig = new WeaponRig(this.R, this.ch); await this.rig.equip(this.weapon);
    this.rag = new RagdollCtl(this.ch, this.an, this.phys); this.rag.stayDown = true;
    this.ch.root.position.copy(pos); this.yaw = yaw; this.visY = pos.y; this.R.scene.add(this.ch.root); this.phys.spawnChar(this.id, pos.toArray()); this.combat.targets.push(this.tgt); this.ready = true; return this;
  }
  hit(dmg: number, dir: THREE.Vector3, zone: string, force: number) {
    if (this.state === 'dead') return; this.health -= dmg; this.alert(this.ch.root.position.clone().sub(dir.clone().multiplyScalar(20)));
    if (this.health <= 0) { this.state = 'dead'; this.phys.removeChar(this.id); this.rig.equip(null); this.an.stop(0.01); this.rag.start(dir.clone().setY(0).normalize().multiplyScalar(Math.min(6, force)).add(new THREE.Vector3(0, 1, 0))); return; }
    const key = zone === 'head' || Math.random() < 0.5 ? 'hit_reaction_when_walking_while_aiming_rifle' : 'left_reaction_to_front_hit_holding_a_rifle'; this.an.play('rifle', key, { fadeIn: 0.05, fadeOut: 0.2, timeScale: 1.4 }).catch(() => {}); this.cool = Math.max(this.cool, 0.6);
  }
  /** Gunfire / damage nearby: turn toward it. */
  alert(from: THREE.Vector3) { if (this.state === 'idle') { this.state = 'alert'; this.alertT = 0; } this.lastSeen.copy(from); }
  private los(a: THREE.Vector3, b: THREE.Vector3) { const d = b.clone().sub(a); const L = d.length(); const h = this.combat.castWorld(a, d.normalize(), L); return !h || h.t > L - 0.4; }
  /** Cover: points 0.7 m outside box faces whose box lies between the point and the threat; nearest wins. */
  private findCover(threat: THREE.Vector3) { const me = this.ch.root.position; let best: THREE.Vector3 | null = null, bd = 1e9;
    for (const b of this.world.boxes()) { const c = b.getCenter(new THREE.Vector3()); if (c.distanceTo(me) > 40 || b.max.y - b.min.y < 1.0) continue; const sz = b.getSize(new THREE.Vector3());
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const p = new THREE.Vector3(c.x + dx * (sz.x / 2 + 0.7), me.y, c.z + dz * (sz.z / 2 + 0.7));
        const toT = threat.clone().sub(p).setY(0).normalize(); const toB = c.clone().sub(p).setY(0).normalize(); if (toT.dot(toB) < 0.55) continue; // box must be between
        if ([...reserved].some(([id, r]) => id !== this.id && r.distanceTo(p) < 2.2)) continue; // another combatant holds it
        const d = p.distanceTo(me) + p.distanceTo(threat) * 0.15; if (d < bd && !this.los(p.clone().setY(p.y + 1.2), threat.clone().setY(threat.y + 1.3))) { bd = d; best = p; } } }
    if (best) reserved.set(this.id, best); return best; }
  private steer(to: THREE.Vector3, speed: number) {
    const me = this.ch.root.position; const goal = this.wp ?? to; const d = goal.clone().sub(me).setY(0); if (d.length() < 0.4) { if (this.wp) this.wp = null; return 0; }
    // blocked straight line -> go via the nearest corner of the first box in the way
    if (!this.wp && !this.los(me.clone().setY(me.y + 0.6), to.clone().setY(to.y + 0.6))) { let best: THREE.Vector3 | null = null, bd = 1e9; const ray = new THREE.Ray(me.clone().setY(me.y + 0.6), to.clone().sub(me).setY(0).normalize());
      for (const b of this.world.boxes()) { if (!ray.intersectsBox(b)) continue; for (const [x, z] of [[b.min.x - 0.8, b.min.z - 0.8], [b.min.x - 0.8, b.max.z + 0.8], [b.max.x + 0.8, b.min.z - 0.8], [b.max.x + 0.8, b.max.z + 0.8]]) { const c = new THREE.Vector3(x, me.y, z); const k = c.distanceTo(me) + c.distanceTo(to); if (k < bd) { bd = k; best = c; } } }
      this.wp = best; }
    const dir = d.normalize(); this.yaw = Math.atan2(dir.x, dir.z); return speed; }
  update(dt: number, player: Target, others: Combatant[]) {
    if (!this.ready) return; this.t += dt; const me = this.ch.root.position;
    if (this.state === 'dead') { this.rag.update(dt, () => 0.15); return; }
    const ps = this.phys.char(this.id); if (ps) { this.visY += (ps.pos[1] - this.visY) * Math.min(1, dt * 12); me.set(ps.pos[0], this.visY, ps.pos[2]); }
    // perception
    const tp = player.pos(); const eye = me.clone().setY(me.y + 1.6); const toP = tp.clone().sub(me); const dist = toP.length(); const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const inCone = toP.clone().setY(0).normalize().dot(fwd) > (this.state === 'idle' ? 0.35 : -0.5); const visible = player.alive && dist < 70 && inCone && this.los(eye, tp.clone().setY(tp.y + 1.3));
    if (visible) { this.seen += dt; this.lastSeen.copy(tp); if (this.state === 'idle' && this.seen > 0.4) this.alert(tp); } else this.seen = 0;
    let want = 0; let aim = false; this.cool -= dt;
    switch (this.state) {
      case 'idle': { const a = this.t * 0.3 + this.id; this.yaw += Math.sin(a) * dt * 0.3; break; }
      case 'alert': this.alertT += dt; this.yaw = Math.atan2(this.lastSeen.x - me.x, this.lastSeen.z - me.z); aim = true; if (this.alertT > 0.6) { this.cover = this.noCover ? null : this.findCover(this.lastSeen); this.state = this.cover ? 'toCover' : 'advance'; this.warnT = 0; } break;
      case 'toCover': { if (!this.cover) { this.state = 'advance'; break; } want = this.steer(this.cover, 3.4); aim = true; if (want === 0) { this.state = 'cover'; this.peek = 0; } break; }
      case 'cover': { // peek out sideways to shoot, duck back when hit or after the burst; relocate when the threat sees us from cover
        this.peek += dt; const exposed = this.los(eye, tp.clone().setY(tp.y + 1.3)); this.yaw = Math.atan2(this.lastSeen.x - me.x, this.lastSeen.z - me.z); aim = true;
        if (this.peek > 9 || (exposed && this.peek > 3 && Math.random() < dt * 0.3)) { const c = this.findCover(this.lastSeen); if (c && c.distanceTo(me) > 2) { this.cover = c; this.state = 'toCover'; } else this.state = 'advance'; this.peek = 0; } break; }
      case 'advance': { const goal = this.lastSeen.clone().add(me.clone().sub(this.lastSeen).setY(0).normalize().multiplyScalar(this.standoff)); want = this.steer(goal, 2.2); aim = true; if (this.t % 6 < dt && !this.noCover) { const c = this.findCover(this.lastSeen); if (c) { this.cover = c; this.state = 'toCover'; } } break; }
    }
    // shooting: warning (aim up) -> grace -> bursts with reaction time and capped accuracy
    if (aim && visible && this.state !== 'idle') { this.warnT += dt;
      if (this.warnT > AI_LIMITS.warn && this.cool <= 0 && shootersNow < AI_LIMITS.maxShooters && this.rig.model) { const w = WDATA[this.weapon];
        if (this.burst <= 0) { this.burst = 3 + Math.floor(Math.random() * 4); } this.burst--; this.cool = this.burst > 0 ? 60 / w.rpm : 0.9 + Math.random() * 0.9; shootersNow++;
        const muzzle = this.rig.socketWorld('muzzle'); const err = THREE.MathUtils.clamp(dist * 0.012 + (player as any).speed * 0.02, 0.012, 0.09) + (this.warnT < AI_LIMITS.warn + AI_LIMITS.grace ? 0.25 : 0); // grace: misses first
        const aimPt = tp.clone().setY(tp.y + 1.25 + (Math.random() - 0.5) * 0.4); const d = aimPt.sub(eye).normalize(); d.x += (Math.random() - 0.5) * err * 2; d.y += (Math.random() - 0.5) * err; d.z += (Math.random() - 0.5) * err * 2;
        this.combat.fire(this.tgt.id, { ...w, spread: [0.5, 0.5] }, muzzle, eye, d.normalize(), true, 0, this.team); this.rig.fireKick(w.recoil![0]); for (const o of others) if (o !== this && o.state === 'idle' && o.ch.root.position.distanceTo(me) < 60) o.alert(me); } }
    else this.warnT = Math.max(0, this.warnT - dt * 0.5);
    // move (capsule) + animate (armed stance, strafing toward the aim while moving)
    this.speed += THREE.MathUtils.clamp(want - this.speed, -8 * dt, 6 * dt); const moveYaw = this.wp || this.cover ? Math.atan2((this.wp ?? this.cover ?? me).x - me.x, (this.wp ?? this.cover ?? me).z - me.z) : this.yaw;
    const faceYaw = aim ? Math.atan2(this.lastSeen.x - me.x, this.lastSeen.z - me.z) : this.yaw; const v = new THREE.Vector3(Math.sin(moveYaw), 0, Math.cos(moveYaw)).multiplyScalar(this.speed);
    this.phys.charInputs[this.id] = { vx: v.x, vz: v.z, jump: 0, crouch: 0, yaw: faceYaw, mode: CHAR_MODE.walk, feet: [] };
    this.ch.root.rotation.y = faceYaw; let rel = moveYaw - faceYaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.an.update(dt, this.speed, 0, rel); const ad = this.lastSeen.clone().setY(this.lastSeen.y + 1.2).sub(me.clone().setY(me.y + 1.4)).normalize(); this.rig.update(dt, aim ? ad : new THREE.Vector3(Math.sin(faceYaw), -0.25, Math.cos(faceYaw)), aim, this.speed);
    this.ik.update(dt, () => ({ y: 0.15, n: new THREE.Vector3(0, 1, 0) }), me.y, this.speed);
  }
  static frame() { shootersNow = 0; }
}
