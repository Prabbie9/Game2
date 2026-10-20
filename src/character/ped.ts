// Ambient pedestrian (M4 interim, before the M7 sidewalk graph): a cast body (crowd LOD1 unless near) with a palette
// variant, walking a path with the speed-matched gait animator, pausing on civilian idles at the ends.
import * as THREE from 'three';
import { Character, loadCast } from './character';
import { Animator } from '../animation/animator';
import type { Renderer } from '../renderer/renderer';
import type { PhysicsClient } from '../physics/client';
import { RagdollCtl } from './ragdoll';

const IDLES = ['standard_idle', 'male_standing_idle_01', 'female_standing_idle', 'standing_around_bored_idle'];
export class Pedestrian {
  root = new THREE.Group(); ch: Character; an!: Animator; rag: RagdollCtl | null = null; phys: PhysicsClient | null = null; down = false; speed = 1.3; ready = false; private i = 1; private wait = 0; private v = 0;
  constructor(public R: Renderer, public model: string, public path: [number, number][], public y = 0.15, variant = 0, lod: 0 | 1 = 1, public walkSpeed = 0) {
    this.ch = new Character(R, model, { lod, variant, shadows: lod === 0 });
  }
  async load() {
    await this.ch.load(); const female = loadCast().then((c) => c[this.model]?.sex === 'f');
    this.an = await new Animator(this.ch).init(IDLES[Math.floor(Math.random() * IDLES.length)], (await female) ? { walk: 'female_walk_forward' } : {});
    if (!this.walkSpeed) this.walkSpeed = this.an.gaits[0].speed * (0.88 + Math.random() * 0.12); // at or just under the walk clip: pure walk, no run blend
    this.root.add(this.ch.root); this.root.position.set(this.path[0][0], this.y, this.path[0][1]); this.R.scene.add(this.root); this.ready = true;
    if (this.phys) { this.rag = new RagdollCtl(this.ch, this.an, this.phys); this.rag.onDone = (pos, yaw) => { this.down = false; this.root.position.set(pos.x, this.y, pos.z); this.root.rotation.y = yaw; this.ch.root.position.set(0, 0, 0); this.ch.root.rotation.set(0, 0, 0); this.wait = 1.5; this.v = 0; }; }
    return this;
  }
  /** Hit by a vehicle: limp with this world velocity (ragdoll), get up afterwards. */
  knockDown(vel: THREE.Vector3) { if (!this.ready || !this.rag || this.down) return false; this.down = true; this.ch.root.updateMatrixWorld(true);
    // move the body into world space so the ragdoll owns it: character root = world pose, ped root = identity
    const wp = this.ch.root.getWorldPosition(new THREE.Vector3()), wq = this.ch.root.getWorldQuaternion(new THREE.Quaternion()); this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0);
    this.ch.root.position.copy(wp); this.ch.root.quaternion.copy(wq); this.an.stop(0.01); this.rag.start(vel); return true; }
  get worldPos() { return this.down ? this.ch.root.position : this.root.position; }
  update(dt: number, groundY: (x: number, z: number) => number = () => this.y) {
    if (!this.ready) return;
    if (this.down && this.rag) { if (this.rag.getup) this.an.update(dt, 0, 0); this.rag.update(dt, groundY); return; }
    const tgt = new THREE.Vector2(...this.path[this.i]); const p = new THREE.Vector2(this.root.position.x, this.root.position.z); const d = tgt.clone().sub(p); const dist = d.length();
    if (dist < 0.3 && this.wait <= 0) { this.i = (this.i + 1) % this.path.length; this.wait = 1.5 + Math.random() * 3; }
    if (this.wait > 0) this.wait -= dt;
    const want = this.wait > 0 ? 0 : this.walkSpeed; this.v += THREE.MathUtils.clamp(want - this.v, -3 * dt, 2 * dt);
    if (this.v > 0.02 && dist > 0.01) { const yaw = Math.atan2(d.x, d.y); const cur = this.root.rotation.y; let e = yaw - cur; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; this.root.rotation.y = cur + e * Math.min(1, dt * 5);
      const step = Math.min(dist, this.v * dt); this.root.position.x += (d.x / dist) * step; this.root.position.z += (d.y / dist) * step; }
    this.an.update(dt, this.v, 0);
  }
}
