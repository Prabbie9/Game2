// Vehicle damage: impacts detected from sudden velocity changes (and bullets/explosions via hit()) dent the body
// (vertex displacement in model space around the impact point, per-car geometry copies made on first damage), shatter
// glass (glass materials hidden + glass particles), and drain health -> engine smoke (<45%), fire (<20%), then an
// explosion (<= 0 or burning for 7 s) leaving a charred, immobile wreck. Detachable parts are logged as future work.
import * as THREE from 'three';
import type { CombatFX } from '../fx/combatfx';

export interface DamageHost { root: THREE.Object3D; modelSpace?: THREE.Object3D; ready?: boolean; setLights?: (on: boolean) => void; lightsOn?: boolean }
export class VehicleDamage {
  health = 1000; wrecked = false; burnT = 0; glassBroken = false; age = 0; private charred = false; private pendingDents: [THREE.Vector3, THREE.Vector3, number, number][] = []; private prevV = new THREE.Vector3(); private first = true; private owned = new Set<THREE.BufferGeometry>(); dents = 0; impacts: { age: number; g: number; dv: number; dmg: number }[] = []; // collision log (tests)
  onExplode: ((p: THREE.Vector3) => void) | null = null;
  constructor(public car: DamageHost, public fx: CombatFX, public massK = 1) {}
  private model() { return this.car.root; } // loaded cars merge their meshes under the body at load, so walk the whole root
  private static isGlass(m: THREE.Mesh) { const mat = m.material as THREE.Material; return /glass|window|windshield/i.test(m.name + (mat as any)?.name) || (!Array.isArray(mat) && mat.transparent && !mat.depthWrite); }
  /** Dent: push vertices within radius r of the local point p along local direction d (max depth). */
  dent(worldP: THREE.Vector3, worldDir: THREE.Vector3, depth: number, r = 0.6) {
    if (this.car.ready === false) { this.pendingDents.push([worldP.clone(), worldDir.clone(), depth, r]); return 0; } // model still loading: apply later
    const m = this.model(); m.updateWorldMatrix(true, true); let moved = 0;
    m.traverse((o) => { const mesh = o as THREE.Mesh; if (!mesh.isMesh || VehicleDamage.isGlass(mesh) || mesh.renderOrder === 2 || /light|wheel|tire|tyre|rim/i.test(mesh.name + ((mesh.material as any)?.name ?? '')) || /wheel/i.test(mesh.parent?.name ?? '')) return;
      if (!this.owned.has(mesh.geometry)) { mesh.geometry = mesh.geometry.clone(); this.owned.add(mesh.geometry); }
      const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert(); const lp = worldP.clone().applyMatrix4(inv); const ld = worldDir.clone().transformDirection(inv).normalize(); const pos = mesh.geometry.attributes.position as THREE.BufferAttribute; const v = new THREE.Vector3();
      const s = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld).x || 1; const rr = r / s, dd = depth / s;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const d = v.distanceTo(lp); if (d > rr) continue; const k = (1 - d / rr) ** 2; v.addScaledVector(ld, dd * k * (0.8 + Math.random() * 0.4)); pos.setXYZ(i, v.x, v.y, v.z); moved++; }
      if (moved) { pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); } });
    this.dents++; return moved;
  }
  shatterGlass(at: THREE.Vector3) { if (this.glassBroken) return; this.glassBroken = true;
    this.model().traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && VehicleDamage.isGlass(mesh)) mesh.visible = false; });
    for (let i = 0; i < 24; i++) this.fx.sparks.emit(at.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5))), new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4), 0.8, 0.02, 0, 0xd8e8f0, 0.9); }
  /** Bullet / explosion / ram damage. */
  hit(dmg: number, worldP: THREE.Vector3, dir: THREE.Vector3) { if (this.wrecked) return; this.health -= dmg; if (dmg > 25) this.dent(worldP, dir, Math.min(0.14, dmg * 0.0012), 0.35 + Math.min(0.5, dmg * 0.003));
    if (dmg > 60 || Math.random() < dmg / 300) this.shatterGlass(worldP); }
  /** Per frame with the physics state (pos/vel). Returns true when it just exploded. */
  update(dt: number, pos: THREE.Vector3, vel: THREE.Vector3, quat: THREE.Quaternion, dtVel = dt) {
    if (this.first) { this.prevV.copy(vel); this.first = false; } this.age += dt;
    if (this.car.ready !== false && this.pendingDents.length) for (const d of this.pendingDents.splice(0)) this.dent(...d);
    if (this.wrecked && !this.charred && this.car.ready !== false) this.char();
    const dv = vel.clone().sub(this.prevV); this.prevV.copy(vel); const dvh = Math.hypot(dv.x, dv.z); const g = Number.isFinite(dtVel) ? dvh / Math.max(dtVel, 1e-3) : 0;
    // collision: horizontal deceleration well above braking/kerbs (> ~3.5 g); vertical drops (spawn, landings) only when violent; 2 s spawn grace
    if (!this.wrecked && dt > 0 && this.age > 2 && ((g > 34 && dvh > 2.5) || Math.abs(dv.y) > 9)) { const dmg = (dv.length() - 2) * 28 * this.massK; const dirW = dv.clone().normalize(); this.impacts.push({ age: +this.age.toFixed(2), g: +g.toFixed(1), dv: +dv.length().toFixed(2), dmg: Math.round(dmg) });
      const hitP = pos.clone().addScaledVector(dirW.clone().negate(), 1.6).add(new THREE.Vector3(0, 0.6, 0)); this.hit(dmg, hitP, dirW); this.fx.impact(hitP, dirW, 'metal'); }
    // smoke / fire / explosion
    const hood = pos.clone().add(new THREE.Vector3(0, 0.9, 1.4).applyQuaternion(quat));
    if (!this.wrecked && this.health < 450 && Math.random() < dt * (this.health < 200 ? 30 : 12)) this.fx.smoke.emit(hood, new THREE.Vector3(0, 1.2, 0).add(vel.clone().multiplyScalar(-0.2)), 2.5, 0.35, 1.5, this.health < 200 ? 0x262422 : 0x8c8a86, 0.35);
    if (!this.wrecked && this.health < 200) { this.burnT += dt; if (Math.random() < dt * 40) this.fx.sparks.emit(hood.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), new THREE.Vector3(0, 2 + Math.random() * 2, 0), 0.5, 0.18, 0.6, 0xff8a30, 0.8); }
    if (!this.wrecked && (this.health <= 0 || this.burnT > 7)) { this.wrecked = true; this.health = 0; if (this.car.ready !== false) this.char(); this.onExplode?.(pos.clone()); return true; }
    if (this.wrecked && Math.random() < dt * 6) this.fx.smoke.emit(hood, new THREE.Vector3(0, 1.4, 0), 4, 0.5, 2.5, 0x1c1b1a, 0.4);
    return false;
  }
  /** Burnt-out look: darken and roughen every material, drop emissive. */
  private char() { this.charred = true; const done = new Map<THREE.Material, THREE.Material>();
    const burn = (m0: THREE.Material) => { if (!done.has(m0)) { const m = (m0 as THREE.MeshPhysicalMaterial).clone(); m.color?.lerp(new THREE.Color(0x1b1916), 0.88); m.roughness = 0.95; m.metalness = 0.15; m.emissive?.set(0); if ('clearcoat' in m) m.clearcoat = 0; done.set(m0, m); } return done.get(m0)!; };
    this.model().traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(burn) : burn(mesh.material); });
    this.car.setLights?.call(this.car, false); this.shatterGlass(this.car.root.position.clone()); }
}
