// Fixed-capacity InstancedMesh with slot allocation: streamed chunks add/remove instances of repeated static props
// (traffic lights, etc.) so the whole city draws each prop type once instead of once per object.
import * as THREE from 'three';
export class InstancePool {
  mesh: THREE.InstancedMesh; private free: number[] = []; private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(scene: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, public cap: number, opts: { castShadow?: boolean; name?: string } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.count = cap; this.mesh.frustumCulled = false; this.mesh.castShadow = !!opts.castShadow; this.mesh.receiveShadow = true; this.mesh.name = opts.name ?? '';
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, this.zero); this.free.push(cap - 1 - i); } scene.add(this.mesh);
  }
  add(m: THREE.Matrix4) { const s = this.free.pop(); if (s === undefined) return -1; this.mesh.setMatrixAt(s, m); this.mesh.instanceMatrix.needsUpdate = true; return s; }
  remove(s: number) { if (s < 0) return; this.mesh.setMatrixAt(s, this.zero); this.mesh.instanceMatrix.needsUpdate = true; this.free.push(s); }
  get used() { return this.cap - this.free.length; }
}
