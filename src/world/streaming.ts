// Chunk streaming: maintains near (full detail + physics + lights + parked cars) and far (massing) LOD rings of
// 128 m chunks around the camera. Chunks are built in worker(s) (chunkworker.ts) and swapped in without gaps:
// a chunk upgraded far -> near keeps its far meshes until the near build arrives. Fog/haze hides the outer edge.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { PhysicsClient } from '../physics/client';
import type { LightPool } from '../lighting/lightpool';
import { WorldMaterials } from './worldmaterials';
import { SourcedCar } from '../vehicles/sourced';
import { CHUNK, groundRects } from './citygen';

interface ChunkState { boxes: THREE.Box3[]; key: string; cx: number; cz: number; lod: number; group: THREE.Group; lights: number[]; parked: SourcedCar[]; pending: number | null; built: number | null; steam: THREE.Vector3[] }
const PAINTS = [0x1f3e66, 0x8f8f92, 0x1b1b1d, 0xd8d6cf, 0x5b1d24, 0x2f4b37, 0xb08d3c, 0x6a7078];

export class Streaming {
  chunks = new Map<string, ChunkState>(); workers: Worker[] = []; busy = [0, 0]; queue: { key: string; cx: number; cz: number; lod: number }[] = [];
  mats: WorldMaterials; root = new THREE.Group(); nearR = 1; farR = 6; parkedBudget = 30; parkedCount = 0;
  stats = { built: 0, lastMs: 0, maxMs: 0, near: 0, far: 0, mainMs: 0, mainMaxMs: 0 }; steamVents: THREE.Vector3[] = [];
  private lightIds = 0; private inbox: any[] = [];
  constructor(public R: Renderer, public phys: PhysicsClient, public pool: LightPool, public seed = 1337) {
    this.mats = new WorldMaterials(R); R.scene.add(this.root);
    // citywide far ground (asphalt) 3 cm below chunk ground; near chunks draw their own detailed ground on top
    for (const r of groundRects()) { const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2); g.translate((r.x0 + r.x1) / 2, -0.03, (r.z0 + r.z1) / 2);
      const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4.5, p.getZ(i) / 4.5);
      const m = new THREE.Mesh(g, this.mats.get('asphalt')); m.receiveShadow = true; R.scene.add(m); }
    for (let i = 0; i < 2; i++) { const w = new Worker(new URL('./chunkworker.ts', import.meta.url), { type: 'module' }); w.onmessage = (e) => { this.busy[i]--; this.inbox.push(e.data); }; this.workers.push(w); }
    // pre-warm: compile every kit material up front (KHR_parallel_shader_compile) so first sight of a chunk doesn't stall
    const keys = ['asphalt', 'tar', 'walk', 'kerb', 'tiles', 'concrete', 'trim', 'roof', 'rooftop', 'awning', 'pole', 'furn', 'iron', 'bench', 'bark', 'hydrant', 'litter', 'paint', 'paintY', 'lamphead', 'frame_tower', 'frame_std', 'glass_std', 'glass_tower', 'glass_shop', 'glass_shelter', 'water', 'leaf', 'leafInner', 'far', 'sign_0',
      ...['brick', 'plaster', 'concrete'].flatMap((st) => (({ brick: [0xe8d6c8, 0xb98c72, 0x9e6a55, 0x8c5a48, 0xffffff], plaster: [0xd9cdb4, 0xa9b7b9, 0xc9b89a, 0xe6dccb, 0xb7a58c], concrete: [0xd8d4cc, 0xbab3a8, 0xffffff, 0xa8a49c] } as any)[st] as number[]).map((t) => `wall_${st}_${t.toString(16)}`))];
    const warm = new THREE.Scene(); const g = new THREE.BoxGeometry(1, 1, 1); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    for (const k of keys) warm.add(new THREE.Mesh(g, this.mats.get(k))); warm.environment = R.scene.environment; warm.fog = R.scene.fog;
    for (const l of R.csm.lights) warm.add(l.clone());
    (R.renderer as any).compileAsync?.(warm, R.camera, R.scene).catch?.(() => {});
    this.farR = Math.min(6, Math.max(3, Math.round(R.tier.drawDistance / CHUNK))); this.nearR = R.tier.name === 'Ultra' ? 2 : 1; this.parkedBudget = R.tier.name === 'Low' ? 12 : 30;
  }
  /** Chunks within near radius get LOD 0, the rest of the visible ring LOD 1. */
  update(cam: THREE.Vector3) {
    // apply finished chunks time-sliced: nearest LOD-0 first, at most ~4 ms of mesh creation per frame (no hitches)
    if (this.inbox.length) { const t0 = performance.now(); this.inbox.sort((a, b) => a.lod - b.lod);
      while (this.inbox.length && performance.now() - t0 < 4) this.onBuilt(this.inbox.shift()); }
    const ccx = Math.floor(cam.x / CHUNK), ccz = Math.floor(cam.z / CHUNK); const want = new Map<string, number>();
    for (let dz = -this.farR; dz <= this.farR; dz++) for (let dx = -this.farR; dx <= this.farR; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dz)); if (Math.hypot(dx, dz) > this.farR + 0.5) continue; want.set(`${ccx + dx},${ccz + dz}`, d <= this.nearR ? 0 : 1); }
    for (const [key, lod] of want) { const c = this.chunks.get(key); if (!c) { const [cx, cz] = key.split(',').map(Number); const st: ChunkState = { boxes: [], key, cx, cz, lod, group: new THREE.Group(), lights: [], parked: [], pending: null, built: null, steam: [] }; this.chunks.set(key, st); this.request(st, lod); }
      else if (c.pending === null && c.built !== lod) this.request(c, lod); }
    // unload with hysteresis (2 extra chunks)
    for (const [key, c] of this.chunks) { const d = Math.hypot(c.cx - ccx, c.cz - ccz); if (!want.has(key) && d > this.farR + 2) this.unload(c); }
    // sort queue by distance and dispatch to free workers (max 2 jobs each in flight)
    this.queue.sort((a, b) => Math.hypot(a.cx - ccx, a.cz - ccz) * (a.lod ? 1.5 : 1) - Math.hypot(b.cx - ccx, b.cz - ccz) * (b.lod ? 1.5 : 1));
    for (let i = 0; i < this.workers.length; i++) while (this.busy[i] < 2 && this.queue.length) { const j = this.queue.shift()!; const c = this.chunks.get(j.key); if (!c || c.pending !== j.lod) continue; this.busy[i]++; this.workers[i].postMessage({ id: j.key, cx: j.cx, cz: j.cz, lod: j.lod, seed: this.seed }); }
    this.stats.near = [...this.chunks.values()].filter((c) => c.built === 0).length; this.stats.far = [...this.chunks.values()].filter((c) => c.built === 1).length;
  }
  private request(c: ChunkState, lod: number) { c.pending = lod; this.queue = this.queue.filter((q) => q.key !== c.key); this.queue.push({ key: c.key, cx: c.cx, cz: c.cz, lod }); }
  get pending() { return this.queue.length + this.busy[0] + this.busy[1] + this.inbox.length; }
  private onBuilt(d: any) {
    const c = this.chunks.get(d.id); if (!c || c.pending !== d.lod) return; const tMain = performance.now();
    this.stats.built++; this.stats.lastMs = d.ms; this.stats.maxMs = Math.max(this.stats.maxMs, d.ms);
    this.clear(c); c.pending = null; c.built = d.lod;
    for (const m of d.meshes) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2)); if (m.col) g.setAttribute('color', new THREE.BufferAttribute(m.col, 3)); g.computeBoundingSphere();
      const mat = this.mats.get(m.key); const mesh = new THREE.Mesh(g, mat);
      const shadowless = /^(asphalt|walk|tar|paint|paintY|tiles|litter|iron|glass_|water|far|furn|hydrant|bench|sign_|kerb|lamphead)/.test(m.key) || d.lod === 1; mesh.castShadow = !shadowless; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      c.group.add(mesh); }
    if (d.lod === 0) {
      this.phys.addGroup(c.key, d.colliders);
      // axis-aligned blockers for camera collision (ignores rotation; buildings/walls/piers are axis-aligned here)
      c.boxes = d.colliders.filter((q: any) => q.kind === 'box' && q.half[1] > 0.6 && !q.rot).map((q: any) => new THREE.Box3(new THREE.Vector3(q.pos[0] - q.half[0], q.pos[1] - q.half[1], q.pos[2] - q.half[2]), new THREE.Vector3(q.pos[0] + q.half[0], q.pos[1] + q.half[1], q.pos[2] + q.half[2])));
      for (const l of d.lights) { const id = ++this.lightIds; this.pool.add({ pos: new THREE.Vector3(...l.pos), color: new THREE.Color(l.color), intensity: l.intensity, distance: l.distance, nightOnly: true, group: c.key } as any); c.lights.push(id); }
      for (const t of d.tlights) this.trafficLight(c.group, t);
      for (const p of d.parked) { if (this.parkedCount >= this.parkedBudget) break; const car = new SourcedCar(this.R, 'kiri', { paint: PAINTS[p.paint % PAINTS.length], frozen: true, lod: 1 }); car.root.position.set(p.pos[0], p.pos[1], p.pos[2]); car.root.rotation.y = p.yaw; c.group.add(car.root); c.parked.push(car); this.parkedCount++; car.load().catch(() => {}); }
      c.steam = d.steam.map((s: number[]) => new THREE.Vector3(...s));
    }
    this.root.add(c.group); this.refreshSteam();
    this.stats.mainMs = performance.now() - tMain; this.stats.mainMaxMs = Math.max(this.stats.mainMaxMs, this.stats.mainMs);
  }
  private trafficLight(group: THREE.Group, t: { pos: number[]; face: number[]; axis: number }) {
    const h = new THREE.Mesh(TL_HOUSING ??= new THREE.BoxGeometry(0.42, 1.25, 0.32), TL_MAT ??= this.R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.5, metalness: 0.4 })));
    h.position.set(t.pos[0], t.pos[1], t.pos[2]); h.lookAt(t.pos[0] + t.face[0], t.pos[1], t.pos[2] + t.face[2]); group.add(h);
    (['r', 'a', 'g'] as const).forEach((col, i) => { const d = new THREE.Mesh(TL_DISC ??= new THREE.CircleGeometry(0.12, 14), this.mats.tl[col + t.axis]); d.position.set(0, 0.38 - i * 0.38, 0.17); h.add(d); });
  }
  private clear(c: ChunkState) {
    for (const o of [...c.group.children]) { c.group.remove(o); const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== TL_HOUSING) m.geometry.dispose(); }
    for (const car of c.parked) { car.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); this.parkedCount--; } c.parked = [];
    if (c.built === 0) { this.phys.removeGroup(c.key); (this.pool as any).removeGroup?.(c.key); }
    c.steam = [];
  }
  private unload(c: ChunkState) { this.clear(c); this.root.remove(c.group); this.chunks.delete(c.key); this.queue = this.queue.filter((q) => q.key !== c.key); this.refreshSteam(); }
  /** Ray vs near-chunk blocker boxes (camera collision). */
  cast(o: THREE.Vector3, d: THREE.Vector3, far: number): number | null {
    const ray = new THREE.Ray(o, d); const hit = new THREE.Vector3(); let best: number | null = null;
    for (const c of this.chunks.values()) for (const b of c.boxes) { if (b.containsPoint(o)) continue; if (ray.intersectBox(b, hit)) { const t = hit.distanceTo(o); if (t < far && (best === null || t < best)) best = t; } }
    return best;
  }
  /** True once the near chunk under (x, z) has its colliders. */
  readyAt(x: number, z: number) { return this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`)?.built === 0; }
  private refreshSteam() { this.steamVents = [...this.chunks.values()].flatMap((c) => c.steam); }
}
let TL_HOUSING: THREE.BoxGeometry | undefined, TL_MAT: THREE.MeshStandardMaterial | undefined, TL_DISC: THREE.CircleGeometry | undefined;
