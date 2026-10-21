// Parked cars as GPU instances: one InstancedMesh per material of the LOD1 model (frozen, merged), paint as
// per-instance colour. Replaces one SourcedCar (~20 draws) per parked car with ~20 draws for the whole city.
// No shadows (the instanced contact blob grounds them).
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import { SourcedCar } from './sourced';

export class ParkedFleet {
  meshes: THREE.InstancedMesh[] = []; private free: number[] = []; private pos: (THREE.Vector3 | null)[] = []; private pending: { pos: THREE.Vector3; yaw: number; paint: number; slot: number }[] = [];
  ready = false; private paintMesh = -1; private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(public R: Renderer, public cap: number, model = 'kiri') {
    for (let i = cap - 1; i >= 0; i--) this.free.push(i); this.pos = new Array(cap).fill(null);
    const src = new SourcedCar(R, model, { paint: 0xffffff, frozen: true, lod: 1 });
    src.load().then(() => { src.root.updateMatrixWorld(true);
      src.root.traverse((o) => { const me = o as THREE.Mesh; if (!me.isMesh) return; const g = me.geometry.clone().applyMatrix4(me.matrixWorld);
        const im = new THREE.InstancedMesh(g, me.material as THREE.Material, cap); im.count = cap; im.castShadow = false; im.receiveShadow = true; im.renderOrder = me.renderOrder; im.frustumCulled = false; im.userData.hlCat = 'parked car';
        for (let i = 0; i < cap; i++) { im.setMatrixAt(i, this.zero); im.setColorAt(i, new THREE.Color(1, 1, 1)); }
        if ((me.material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && (me.material as THREE.MeshPhysicalMaterial).clearcoat > 0) this.paintMesh = this.meshes.length;
        this.meshes.push(im); R.scene.add(im); });
      this.ready = true; for (const p of this.pending.splice(0)) this.place(p.slot, p.pos, p.yaw, p.paint); }).catch((e) => console.warn('parked fleet', e?.message));
  }
  /** Reserve a slot and place a car; returns the slot or -1 when full. */
  add(pos: THREE.Vector3, yaw: number, paint: number) { const slot = this.free.pop(); if (slot === undefined) return -1; this.pos[slot] = pos.clone();
    if (this.ready) this.place(slot, pos, yaw, paint); else this.pending.push({ pos: pos.clone(), yaw, paint, slot }); return slot; }
  private place(slot: number, pos: THREE.Vector3, yaw: number, paint: number) {
    this.m4.compose(pos, this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    this.meshes.forEach((im, i) => { im.setMatrixAt(slot, this.m4); if (i === this.paintMesh) im.setColorAt(slot, new THREE.Color(paint)); im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }); }
  remove(slot: number) { if (slot < 0 || !this.pos[slot]) return; this.pos[slot] = null; this.pending = this.pending.filter((p) => p.slot !== slot); this.free.push(slot);
    for (const im of this.meshes) { im.setMatrixAt(slot, this.zero); im.instanceMatrix.needsUpdate = true; } }
  /** Hide cars overlapping a point (the player's car spot). */
  hideNear(x: number, z: number, r: number) { this.pos.forEach((p, slot) => { if (p && Math.hypot(p.x - x, p.z - z) < r) { for (const im of this.meshes) { im.setMatrixAt(slot, this.zero); im.instanceMatrix.needsUpdate = true; } this.pending = this.pending.filter((q) => q.slot !== slot); } }); } // slot stays owned by its chunk
  get count() { return this.pos.filter(Boolean).length; }
}
