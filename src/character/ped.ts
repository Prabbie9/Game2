// Placeholder pedestrian (M2): a Mixamo-rigged character (three.js repo Michelle/Soldier) walking a sidewalk path
// with speed-matched Mixamo walk + idle blending. Full controller, IK and crowds arrive in M4.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadBin } from '../core/assets';
import { loadBundle, rigOf, makeClip } from '../animation/clips';
import type { Renderer } from '../renderer/renderer';

export class Pedestrian {
  root = new THREE.Group(); mixer!: THREE.AnimationMixer; walk!: THREE.AnimationAction; idle!: THREE.AnimationAction; speed = 1.3; ready = false;
  private i = 1; private wait = 0;
  constructor(public R: Renderer, public model: string, public path: [number, number][], public y = 0.15, public walkKey = 'walking_forwards', public idleKey = 'standard_idle') {}
  async load() {
    const buf = await loadBin(`chars/${this.model}.glb`);
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    const ch = gltf.scene; ch.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) { const s = mt as THREE.MeshStandardMaterial; if (s.isMeshStandardMaterial) { s.roughness = Math.max(0.55, s.roughness); s.emissive?.set(0); s.emissiveMap = null; this.R.setupMaterial(s); } } } });
    const rig = rigOf(ch); const core = await loadBundle('core');
    const walk = makeClip(core, this.walkKey, rig, { inPlaceXZ: true })!, idle = makeClip(core, this.idleKey, rig, { inPlaceXZ: true })!;
    // speed-match: clip root speed (metres for a 0.99 m hips height) scaled to this character's leg length
    this.speed = (walk as any).meta.speed * (rig.hipsHeight / 0.99);
    this.mixer = new THREE.AnimationMixer(ch); this.walk = this.mixer.clipAction(walk); this.idle = this.mixer.clipAction(idle);
    this.walk.play(); this.idle.play(); this.idle.weight = 0;
    this.root.add(ch); this.root.position.set(this.path[0][0], this.y, this.path[0][1]); this.R.scene.add(this.root); this.ready = true; return this;
  }
  update(dt: number) {
    if (!this.ready) return;
    const tgt = new THREE.Vector2(...this.path[this.i]); const p = new THREE.Vector2(this.root.position.x, this.root.position.z); const d = tgt.clone().sub(p); const dist = d.length();
    let moving = this.wait <= 0;
    if (dist < 0.3) { this.i = (this.i + 1) % this.path.length; this.wait = 1.5 + Math.random() * 2; moving = false; }
    if (this.wait > 0) this.wait -= dt;
    const target = moving ? 1 : 0; this.walk.weight += (target - this.walk.weight) * Math.min(1, dt * 4); this.idle.weight = 1 - this.walk.weight;
    if (moving) { const yaw = Math.atan2(d.x, d.y); const cur = this.root.rotation.y; let e = yaw - cur; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; this.root.rotation.y = cur + e * Math.min(1, dt * 5);
      const step = Math.min(dist, this.speed * this.walk.weight * dt); this.root.position.x += (d.x / dist) * step; this.root.position.z += (d.y / dist) * step; }
    this.mixer.update(dt);
  }
}
