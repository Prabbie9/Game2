// Far-LOD chunks are tiny (1-2 meshes each) but numerous (80-130 in the far ring): this merges their geometry per
// material into regions of 4x4 chunks, rebuilding at most one dirty region per frame. ~90 draws -> ~10-20.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const REGION = 4;
export class FarMerger {
  private regions = new Map<string, { chunks: Map<string, { key: string; geo: THREE.BufferGeometry }[]>; meshes: THREE.Mesh[]; dirty: boolean }>();
  constructor(private root: THREE.Object3D, private mat: (key: string) => THREE.Material) {}
  private regionOf(chunkKey: string) { const [cx, cz] = chunkKey.split(',').map(Number); return `${Math.floor(cx / REGION)},${Math.floor(cz / REGION)}`; }
  set(chunkKey: string, parts: { key: string; geo: THREE.BufferGeometry }[]) { const rk = this.regionOf(chunkKey); const r = this.regions.get(rk) ?? this.regions.set(rk, { chunks: new Map(), meshes: [], dirty: false }).get(rk)!; r.chunks.set(chunkKey, parts); r.dirty = true; }
  remove(chunkKey: string) { const r = this.regions.get(this.regionOf(chunkKey)); if (!r || !r.chunks.has(chunkKey)) return; for (const p of r.chunks.get(chunkKey)!) p.geo.dispose(); r.chunks.delete(chunkKey); r.dirty = true; }
  /** Rebuild up to `max` dirty regions (call once per frame). */
  update(max = 1) { let n = 0;
    for (const [rk, r] of this.regions) { if (!r.dirty) continue; if (n++ >= max) break; r.dirty = false;
      for (const m of r.meshes) { this.root.remove(m); m.geometry.dispose(); } r.meshes = [];
      const byKey = new Map<string, THREE.BufferGeometry[]>(); for (const parts of r.chunks.values()) for (const p of parts) (byKey.get(p.key) ?? byKey.set(p.key, []).get(p.key)!).push(p.geo);
      for (const [key, geos] of byKey) { const g = mergeGeometries(geos); if (!g) continue; g.computeBoundingSphere(); const m = new THREE.Mesh(g, this.mat(key)); m.name = 'far_region:' + key; m.receiveShadow = true; m.matrixAutoUpdate = false; this.root.add(m); r.meshes.push(m); }
      if (!r.chunks.size) this.regions.delete(rk); }
  }
  get dirty() { let n = 0; for (const r of this.regions.values()) if (r.dirty) n++; return n; }
  get meshCount() { let n = 0; for (const r of this.regions.values()) n += r.meshes.length; return n; }
}
