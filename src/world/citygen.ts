// Seeded city generator. Layout (pure functions of the seed) + per-chunk content builders (near/far LOD).
// Downtown: 96 m grid blocks, 16 m streets, 24 m arterials every 4th line, central plaza set-piece, an underpass
// trench with a covered tunnel section, and an elevated highway viaduct above an arterial with end ramps.
// Districts plug in through DISTRICTS (Harbour/Hillside arrive in M8).
import * as THREE from 'three';
import { Batch, box, building, buildingFar, rnd, worldUV, TINTS, type BuildingSpec } from './kit';

export const CHUNK = 128, BLOCK = 96, GRID = 10; // lines k = -GRID..GRID at k*BLOCK
export const EXTENT = GRID * BLOCK; // 960 m
export const SIDEWALK = 5.5, KERB = 0.15;
export const roadW = (k: number) => (k % 4 === 0 ? 24 : 16);
export const line = (k: number) => k * BLOCK;
// underpass: road on x-line k=-3 dips into a trench for |z| < 170 (ramps 60 m), covered (tunnel) for |z| < 56
export const UNDER = { x: line(-3), z0: -170, z1: 170, ramp: 60, depth: 6.5, cover: 56 };
// elevated highway above the z-line k=4 arterial, deck at 9 m, ramps down over the last 110 m at each end
export const HWY = { z: line(4), x0: -EXTENT, x1: EXTENT, y: 9, w: 20, ramp: 110 };
export const PLAZA = { x0: line(0) + 12, x1: line(1) - 8, z0: line(0) + 12, z1: line(1) - 8 };
export const hwyY = (x: number) => { const d = Math.min(x - HWY.x0, HWY.x1 - x); return d >= HWY.ramp ? HWY.y : Math.max(0, (d / HWY.ramp) * HWY.y); };
export const trenchY = (z: number) => { const d = Math.min(z - UNDER.z0, UNDER.z1 - z); return d <= 0 ? 0 : -Math.min(UNDER.depth, (d / UNDER.ramp) * UNDER.depth); };
/** Rects for the citywide far ground plane (everything minus the trench). */
export function groundRects(size = 4200) { const all = { x0: -size / 2, x1: size / 2, z0: -size / 2, z1: size / 2 }; return subtract(all, { x0: UNDER.x - roadW(-3) / 2, x1: UNDER.x + roadW(-3) / 2, z0: UNDER.z0, z1: UNDER.z1 }); }
export const inTrench = (x: number, z: number) => Math.abs(x - UNDER.x) < roadW(-3) / 2 && z > UNDER.z0 && z < UNDER.z1;

/** Block interior (sidewalk outer edge) for block between lines i,i+1 (x) and j,j+1 (z). */
export function blockRect(i: number, j: number) { return { x0: line(i) + roadW(i) / 2, x1: line(i + 1) - roadW(i + 1) / 2, z0: line(j) + roadW(j) / 2, z1: line(j + 1) - roadW(j + 1) / 2 }; }
/** Building lots inside a block (deterministic subdivision, style by distance from centre). */
export function lots(i: number, j: number, seed: number): BuildingSpec[] {
  const R = blockRect(i, j); const r = rnd(seed + i * 7919 + j * 104729 + 12345);
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2; const dist = Math.hypot(cx, cz);
  if (cx > PLAZA.x0 && cx < PLAZA.x1 && cz > PLAZA.z0 && cz < PLAZA.z1) return [];
  if (Math.abs(cz - HWY.z) < 50 && false) return [];
  const inner = { x0: R.x0 + SIDEWALK, x1: R.x1 - SIDEWALK, z0: R.z0 + SIDEWALK, z1: R.z1 - SIDEWALK };
  const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0; const out: BuildingSpec[] = [];
  const towerish = dist < 380 ? 0.75 : dist < 650 ? 0.25 : 0.05;
  const split = r() < 0.5 ? [1, 1] : r() < 0.6 ? [2, 1] : [2, 2];
  for (let a = 0; a < split[0]; a++) for (let b = 0; b < split[1]; b++) {
    const w = W / split[0] - 1.2, d = D / split[1] - 1.2; const x = inner.x0 + (a + 0.5) * (W / split[0]), z = inner.z0 + (b + 0.5) * (D / split[1]);
    const tower = r() < towerish && w > 22 && d > 22;
    const style: BuildingSpec['style'] = tower ? 'tower' : (['brick', 'plaster', 'concrete', 'brick'] as const)[Math.floor(r() * 4)];
    const floors = tower ? 14 + Math.floor(r() * (dist < 250 ? 30 : 16)) : 3 + Math.floor(r() * (dist < 600 ? 10 : 5));
    const tints = TINTS[style] as readonly number[];
    out.push({ x, z, w, d, floors, style, seed: Math.floor(r() * 1e6), shop: !tower || r() < 0.6, tint: tints[Math.floor(r() * tints.length)], balconies: style === 'plaster' && r() < 0.5 });
  }
  return out;
}

type Rect = { x0: number; x1: number; z0: number; z1: number };
const clip = (a: Rect, b: Rect): Rect | null => { const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) }; return r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01 ? r : null; };
const subtract = (a: Rect, h: Rect): Rect[] => { const c = clip(a, h); if (!c) return [a]; const out: Rect[] = [];
  if (c.z0 > a.z0) out.push({ ...a, z1: c.z0 }); if (c.z1 < a.z1) out.push({ ...a, z0: c.z1 }); if (c.x0 > a.x0) out.push({ x0: a.x0, x1: c.x0, z0: c.z0, z1: c.z1 }); if (c.x1 < a.x1) out.push({ x0: c.x1, x1: a.x1, z0: c.z0, z1: c.z1 }); return out; };
const plane = (r: Rect, y: number, s: number) => { const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2); g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2); const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s); return g; };
const slab = (B: Batch, key: string, r: Rect, y0: number, h: number, uvs: number, collide = true, friction = 0.9) => {
  B.add(key, worldUV(box(r.x1 - r.x0, h, r.z1 - r.z0, (r.x0 + r.x1) / 2, y0 + h / 2, (r.z0 + r.z1) / 2), uvs));
  if (collide) B.colliders.push({ kind: 'box', half: [(r.x1 - r.x0) / 2, h / 2, (r.z1 - r.z0) / 2], pos: [(r.x0 + r.x1) / 2, y0 + h / 2, (r.z0 + r.z1) / 2], friction }); };
const hash2 = (x: number, z: number) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Build one chunk. lod 0 = near (full detail + colliders), 1 = far (massing only). */
export function buildChunk(cx: number, cz: number, lod: number, seed: number): Batch {
  const B = new Batch(); const C: Rect = { x0: cx * CHUNK, x1: (cx + 1) * CHUNK, z0: cz * CHUNK, z1: (cz + 1) * CHUNK };
  const outside = C.x1 < -EXTENT - 400 || C.x0 > EXTENT + 400 || C.z1 < -EXTENT - 400 || C.z0 > EXTENT + 400;
  if (outside) return B;
  // ground (asphalt) with the underpass trench cut out
  const trench: Rect = { x0: UNDER.x - roadW(-3) / 2, x1: UNDER.x + roadW(-3) / 2, z0: UNDER.z0, z1: UNDER.z1 };
  if (lod === 0) for (const g of subtract(C, trench)) { B.add('asphalt', plane(g, 0, 4.5)); if (lod === 0) B.colliders.push({ kind: 'box', half: [(g.x1 - g.x0) / 2, 0.5, (g.z1 - g.z0) / 2], pos: [(g.x0 + g.x1) / 2, -0.5, (g.z0 + g.z1) / 2], friction: 0.9 }); }
  const tc = clip(C, trench); if (tc) underpass(B, tc, lod);
  // blocks: sidewalks, kerbs, buildings, plaza
  const i0 = Math.floor(C.x0 / BLOCK) - 1, i1 = Math.floor(C.x1 / BLOCK) + 1, j0 = Math.floor(C.z0 / BLOCK) - 1, j1 = Math.floor(C.z1 / BLOCK) + 1;
  for (let i = Math.max(i0, -GRID); i <= Math.min(i1, GRID - 1); i++) for (let j = Math.max(j0, -GRID); j <= Math.min(j1, GRID - 1); j++) {
    const R = blockRect(i, j); const c = clip(C, R); if (!c) continue;
    slab(B, 'walk', c, 0, KERB, 2.4, lod === 0);
    if (lod === 0) kerbs(B, R, c);
    for (const b of lots(i, j, seed)) { if (b.x < C.x0 || b.x >= C.x1 || b.z < C.z0 || b.z >= C.z1) continue; if (lod === 0) building(B, b); else buildingFar(B, b); }
    if (lod === 0) { streetProps(B, R, c, i, j); if (R.x0 + 6 < PLAZA.x1 && R.x1 - 6 > PLAZA.x0 && R.z0 + 6 < PLAZA.z1 && R.z1 - 6 > PLAZA.z0) plaza(B, c); }
  }
  if (lod === 0) { roadPaint(B, C); intersections(B, C); }
  highway(B, C, lod);
  return B;
}

function kerbs(B: Batch, R: Rect, c: Rect) {
  const k = (x0: number, x1: number, z0: number, z1: number) => { const r = clip(c, { x0, x1, z0, z1 }); if (r) B.add('kerb', worldUV(box(r.x1 - r.x0, KERB + 0.01, r.z1 - r.z0, (r.x0 + r.x1) / 2, (KERB + 0.01) / 2, (r.z0 + r.z1) / 2), 1.2)); };
  k(R.x0, R.x1, R.z0, R.z0 + 0.3); k(R.x0, R.x1, R.z1 - 0.3, R.z1); k(R.x0, R.x0 + 0.3, R.z0, R.z1); k(R.x1 - 0.3, R.x1, R.z0, R.z1);
}
/** Paint: lane dashes, centre double yellow, edge lines; skipped inside intersections. */
function roadPaint(B: Batch, C: Rect) {
  const q = (w: number, d: number, x: number, z: number, rot = 0, key = 'paint') => { if (x < C.x0 || x >= C.x1 || z < C.z0 || z >= C.z1) return; const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(rot); g.translate(x, 0.004, z); B.add(key, g); };
  for (let k = -GRID; k <= GRID; k++) { const w = roadW(k), L = line(k);
    for (let t = Math.floor(C.x0 / 9) * 9; t < C.x1; t += 9) { const m = ((t % BLOCK) + BLOCK) % BLOCK; if (m < 22 || m > BLOCK - 22) continue;
      for (const o of w > 16 ? [-4, 4] : [-4, 4]) q(0.14, 4.2, t, L + o, Math.PI / 2);
      for (const o of w > 16 ? [-1.0, 1.0] : [-0.12, 0.12]) q(w > 16 ? 0.25 : 0.11, 9, t + 4.5, L + o, Math.PI / 2, w > 16 ? 'paint' : 'paintY'); }
    for (let t = Math.floor(C.z0 / 9) * 9; t < C.z1; t += 9) { const m = ((t % BLOCK) + BLOCK) % BLOCK; if (m < 22 || m > BLOCK - 22) continue;
      if (L === UNDER.x && t > UNDER.z0 && t < UNDER.z1) continue;
      for (const o of [-4, 4]) q(0.14, 4.2, L + o, t);
      for (const o of w > 16 ? [-1.0, 1.0] : [-0.12, 0.12]) q(w > 16 ? 0.25 : 0.11, 9, L + o, t + 4.5, 0, w > 16 ? 'paint' : 'paintY'); }
  }
  // road wear: oil stains in parking lanes and dark tar patches (transparent decals)
  const r = rnd(Math.floor(C.x0 * 13 + C.z0 * 7));
  for (let n = 0; n < 14; n++) { const x = C.x0 + r() * CHUNK, z = C.z0 + r() * CHUNK; const k = Math.round(x / BLOCK), j = Math.round(z / BLOCK);
    const onX = Math.abs(x - line(k)) < roadW(k) / 2 - 1, onZ = Math.abs(z - line(j)) < roadW(j) / 2 - 1; if (!onX && !onZ) continue;
    const g = new THREE.CircleGeometry(0.3 + r() * 0.9, 7).rotateX(-Math.PI / 2); g.scale(1 + r() * 1.5, 1, 0.4 + r() * 0.6); g.rotateY(r() * 3); g.translate(x, 0.006, z); B.add('tar', g); }
}
/** Intersections inside the chunk: zebras, stop lines, traffic lights, manholes (some steaming). */
function intersections(B: Batch, C: Rect) {
  for (let i = -GRID; i <= GRID; i++) for (let j = -GRID; j <= GRID; j++) { const x = line(i), z = line(j); if (x < C.x0 || x >= C.x1 || z < C.z0 || z >= C.z1) continue;
    if (x === UNDER.x && z > UNDER.z0 && z < UNDER.z1) continue;
    const wx = roadW(i), wz = roadW(j);
    for (const s of [-1, 1]) { for (let k = -wx / 2 + 0.6; k < wx / 2; k += 1.2) { const g = new THREE.PlaneGeometry(0.6, 4).rotateX(-Math.PI / 2); g.translate(x + k, 0.004, z + s * (wz / 2 + 3.2)); B.add('paint', g); }
      for (let k = -wz / 2 + 0.6; k < wz / 2; k += 1.2) { const g = new THREE.PlaneGeometry(4, 0.6).rotateX(-Math.PI / 2); g.translate(x + s * (wx / 2 + 3.2), 0.004, z + k); B.add('paint', g); }
      { const g = new THREE.PlaneGeometry(wx / 2, 0.45).rotateX(-Math.PI / 2); g.translate(x - s * wx / 4, 0.004, z + s * (wz / 2 + 6.5)); B.add('paint', g); }
      { const g = new THREE.PlaneGeometry(0.45, wz / 2).rotateX(-Math.PI / 2); g.translate(x + s * (wx / 2 + 6.5), 0.004, z + s * wz / 4); B.add('paint', g); } }
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { const px = x + sx * (wx / 2 + 0.8), pz = z + sz * (wz / 2 + 0.8); const pole = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 8); pole.translate(px, KERB + 2.6, pz); B.add('pole', pole);
      const axis = sx === sz ? 0 : 1; B.tlights.push({ pos: [px, KERB + 4.6, pz], face: axis ? [0, 0, -sz] : [-sx, 0, 0], axis }); }
    const h = hash2(x, z); const mh = new THREE.CylinderGeometry(0.42, 0.42, 0.02, 18); mh.translate(x + 3, 0.008, z + wz / 2 + 9); B.add('iron', mh); if (h < 0.3) B.steam.push([x + 3, 0.05, z + wz / 2 + 9]);
  }
}
function streetProps(B: Batch, R: Rect, c: Rect, i: number, j: number) {
  const inC = (x: number, z: number) => x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1;
  const r = rnd(i * 31337 + j * 7331 + 99);
  // lamps every 24 m along the four kerbs, arms reaching over the road
  const lamp = (x: number, z: number, dx: number, dz: number) => { if (!inC(x, z)) return;
    const p = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8); p.translate(x, KERB + 3.75, z); B.add('pole', p);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6); arm.rotateZ(Math.PI / 2); arm.rotateY(Math.atan2(-dz, dx)); arm.translate(x + dx * 1.1, KERB + 7.4, z + dz * 1.1); B.add('pole', arm);
    const h = new THREE.BoxGeometry(0.7, 0.14, 0.32); h.rotateY(Math.atan2(-dz, dx)); h.translate(x + dx * 2.1, KERB + 7.3, z + dz * 2.1); B.add('lamphead', h);
    B.lights.push({ pos: [x + dx * 2.1, KERB + 6.9, z + dz * 2.1], color: 0xffcc8f, intensity: 260, distance: 30 });
    B.colliders.push({ kind: 'box', half: [0.13, 3.75, 0.13], pos: [x, KERB + 3.75, z], friction: 0.5 }); };
  for (let t = R.x0 + 12; t < R.x1 - 6; t += 24) { lamp(t, R.z0 + 0.9, 0, -1); lamp(t + 12, R.z1 - 0.9, 0, 1); }
  for (let t = R.z0 + 12; t < R.z1 - 6; t += 24) { lamp(R.x0 + 0.9, t + 12, -1, 0); lamp(R.x1 - 0.9, t, 1, 0); }
  // trees, bins, hydrants, bollards, benches, newspaper boxes, bus stops along the kerbs
  const edges: [number, number, number, number, number][] = [[R.x0, R.z0 + 3.4, 1, 0, 0], [R.x0, R.z1 - 3.4, 1, 0, 0], [R.x0 + 3.4, R.z0, 0, 1, 1], [R.x1 - 3.4, R.z0, 0, 1, 1]];
  for (const [ex, ez, dx, dz] of edges) { const len = dx ? R.x1 - R.x0 : R.z1 - R.z0;
    for (let t = 8 + r() * 6; t < len - 8; t += 9 + r() * 8) { const x = ex + dx * t, z = ez + dz * t; if (!inC(x, z)) continue; const pick = r();
      if (pick < 0.32) tree(B, x, z, r);
      else if (pick < 0.45) { const g = new THREE.CylinderGeometry(0.3, 0.27, 0.95, 10); g.translate(x, KERB + 0.475, z); B.add('furn', g); }
      else if (pick < 0.53) { const g = new THREE.CylinderGeometry(0.14, 0.17, 0.75, 8); g.translate(x, KERB + 0.375, z); B.add('hydrant', g); const cap = new THREE.SphereGeometry(0.15, 8, 5); cap.translate(x, KERB + 0.78, z); B.add('hydrant', cap); }
      else if (pick < 0.62) { for (let k = -1; k <= 1; k++) { const g = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 7); g.translate(x + dx * k * 1.4, KERB + 0.45, z + dz * k * 1.4); B.add('furn', g); } }
      else if (pick < 0.72) { B.add('bench', box(dx ? 1.8 : 0.45, 0.06, dx ? 0.45 : 1.8, x, KERB + 0.45, z)); B.add('furn', box(dx ? 1.6 : 0.06, 0.45, dx ? 0.06 : 1.6, x, KERB + 0.22, z)); }
      else if (pick < 0.8) { B.add('sign_' + Math.floor(r() * 5), box(0.5, 1.0, 0.45, x, KERB + 0.5, z)); }
      else if (pick < 0.84) { // bus shelter
        B.add('furn', box(dx ? 4 : 0.08, 2.5, dx ? 0.08 : 4, x - dz * 0.9, KERB + 1.25, z - dx * 0.9)); B.add('glass_shelter', box(dx ? 4 : 1.4, 0.06, dx ? 1.4 : 4, x, KERB + 2.5, z)); }
      if (r() < 0.06) B.add('litter', box(0.3 + r() * 0.3, 0.02, 0.2 + r() * 0.2, x + (r() - 0.5) * 2, KERB + 0.011, z + (r() - 0.5) * 2));
    } }
  // parked car slots along two road edges of each block
  for (let t = R.x0 + 14; t < R.x1 - 10; t += 7.2) { const x = t, z = R.z0 - 2.2; if (inC(x, z + 2.2) && r() < 0.42 && Math.abs(z - HWY.z) > 14 && !inTrench(x, z)) B.parked.push({ pos: [x, 0.725, z], yaw: Math.PI / 2, paint: Math.floor(r() * 8) }); }
  for (let t = R.z0 + 14; t < R.z1 - 10; t += 7.2) { const x = R.x1 + 2.2, z = t; if (inC(x - 2.2, z) && r() < 0.42 && !inTrench(x, z)) B.parked.push({ pos: [x, 0.725, z], yaw: 0, paint: Math.floor(r() * 8) }); }
}
export function tree(B: Batch, x: number, z: number, r: () => number, y = KERB) {
  const tr = new THREE.CylinderGeometry(0.14, 0.22, 4.2, 7); tr.translate(x, y + 2.1, z); B.add('bark', tr);
  const cy = y + 5.3;
  for (let k = 0; k < 3; k++) { const b = new THREE.IcosahedronGeometry(1.0 + r() * 0.5, 1); b.translate(x + (r() - 0.5) * 1.5, cy + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.5); B.add('leafInner', b); }
  for (let k = 0; k < 60; k++) { const card = new THREE.PlaneGeometry(1.1, 1.1); const dir = new THREE.Vector3(r() - 0.5, (r() - 0.35) * 0.9, r() - 0.5).normalize();
    card.rotateX(r() * Math.PI); card.rotateY(r() * Math.PI * 2); card.rotateZ(r() * Math.PI); const d = Math.sqrt(r()) * 2.5; card.translate(x + dir.x * d * 1.1, cy + dir.y * d * 0.8, z + dir.z * d * 1.1); B.add('leaf', card); }
  B.add('iron', box(1.4, 0.02, 1.4, x, y + 0.011, z));
}
function plaza(B: Batch, c: Rect) {
  const P = PLAZA; const pr = clip(c, P); if (!pr) return; const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  B.add('tiles', worldUV(box(pr.x1 - pr.x0, 0.02, pr.z1 - pr.z0, (pr.x0 + pr.x1) / 2, KERB + 0.01, (pr.z0 + pr.z1) / 2), 3));
  if (cx >= c.x0 && cx < c.x1 && cz >= c.z0 && cz < c.z1) {
    const basin = new THREE.CylinderGeometry(7, 7.4, 0.7, 40, 1, true); basin.translate(cx, KERB + 0.35, cz); B.add('trim', basin);
    const rim = new THREE.TorusGeometry(7.2, 0.25, 6, 40); rim.rotateX(Math.PI / 2); rim.translate(cx, KERB + 0.72, cz); B.add('trim', rim);
    const water = new THREE.CircleGeometry(7, 40).rotateX(-Math.PI / 2); water.translate(cx, KERB + 0.5, cz); B.add('water', water);
    const col = new THREE.CylinderGeometry(0.6, 1.0, 3.2, 16); col.translate(cx, KERB + 1.6, cz); B.add('trim', col);
    B.colliders.push({ kind: 'box', half: [7.2, 0.4, 7.2], pos: [cx, KERB + 0.4, cz], friction: 0.5 });
    const r = rnd(4242); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; tree(B, cx + Math.cos(a) * 20, cz + Math.sin(a) * 20, r, KERB + 0.02); }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; const bx = cx + Math.cos(a) * 12, bz = cz + Math.sin(a) * 12; const g = box(1.8, 0.45, 0.5, 0, KERB + 0.25, 0); g.rotateY(-a); g.translate(bx, 0, bz); B.add('bench', g); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const g = new THREE.CylinderGeometry(0.12, 0.15, 4.5, 8); g.translate(cx + Math.cos(a) * 28, KERB + 2.25, cz + Math.sin(a) * 28); B.add('pole', g);
      B.lights.push({ pos: [cx + Math.cos(a) * 28, KERB + 4.6, cz + Math.sin(a) * 28], color: 0xffd9a8, intensity: 120, distance: 20 }); }
  }
}
/** Underpass trench (walls, ramps, floor) and covered tunnel section with lights; cross streets bridge over it. */
function underpass(B: Batch, t: Rect, lod: number) {
  const w = roadW(-3) / 2; const steps = Math.max(1, Math.ceil((t.z1 - t.z0) / 6));
  for (let s = 0; s < steps; s++) { const z0 = t.z0 + (s * (t.z1 - t.z0)) / steps, z1 = t.z0 + ((s + 1) * (t.z1 - t.z0)) / steps; const ya = trenchY(z0), yb = trenchY(z1), zm = (z0 + z1) / 2, ym = (ya + yb) / 2;
    const len = Math.hypot(z1 - z0, yb - ya), ang = Math.atan2(yb - ya, z1 - z0);
    const g = new THREE.PlaneGeometry(w * 2, len).rotateX(-Math.PI / 2 - ang * 0 ); g.rotateX(-ang); g.translate(UNDER.x, ym, zm); const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4.5, p.getZ(i) / 4.5); B.add('asphalt', g);
    if (lod === 0) B.colliders.push({ kind: 'box', half: [w, 0.5, len / 2], pos: [UNDER.x, ym - 0.5 * Math.cos(ang), zm + 0.5 * Math.sin(ang)], rot: [Math.sin(-ang / 2), 0, 0, Math.cos(-ang / 2)], friction: 0.9 });
    for (const sx of [-1, 1]) { const hgt = -Math.min(ya, yb) + 1.0; B.add('concrete', worldUV(box(0.4, hgt, z1 - z0, UNDER.x + sx * (w + 0.2), Math.min(ya, yb) + hgt / 2 - 0.05, zm), 3));
      if (lod === 0) B.colliders.push({ kind: 'box', half: [0.2, hgt / 2, (z1 - z0) / 2], pos: [UNDER.x + sx * (w + 0.2), Math.min(ya, yb) + hgt / 2 - 0.05, zm], friction: 0.2 }); }
    if (Math.abs(zm) < UNDER.cover) { B.add('concrete', worldUV(box(w * 2 + 0.8, 0.6, z1 - z0, UNDER.x, 0.15 - 0.3, zm), 3));
      if (lod === 0) { B.colliders.push({ kind: 'box', half: [w + 0.4, 0.3, (z1 - z0) / 2], pos: [UNDER.x, -0.15, zm], friction: 0.9 }); if (s % 2 === 0) { B.add('lamphead', box(0.8, 0.08, 0.3, UNDER.x, -0.5, zm)); B.lights.push({ pos: [UNDER.x, -1.0, zm], color: 0xfff0d8, intensity: 70, distance: 14 }); } } }
  }
  // cross-street bridges over the open trench sections
  for (let j = -GRID; j <= GRID; j++) { const z = line(j); if (z <= t.z0 || z >= t.z1 || Math.abs(z) < UNDER.cover) continue; const hw = roadW(j) / 2;
    B.add('concrete', worldUV(box(w * 2 + 0.8, 0.8, hw * 2, UNDER.x, -0.4, z), 3)); B.add('asphalt', plane({ x0: UNDER.x - w - 0.4, x1: UNDER.x + w + 0.4, z0: z - hw, z1: z + hw }, 0.002, 4.5));
    if (lod === 0) B.colliders.push({ kind: 'box', half: [w + 0.4, 0.4, hw], pos: [UNDER.x, -0.4, z], friction: 0.9 }); }
}
/** Elevated highway: deck, barriers, piers, lamps; ramps descend at both ends onto the arterial. */
function highway(B: Batch, C: Rect, lod: number) {
  if (HWY.z < C.z0 - HWY.w || HWY.z > C.z1 + HWY.w) return; const hw = HWY.w / 2; const zc = HWY.z;
  if (zc < C.z0 || zc >= C.z1) return;
  const x0 = Math.max(C.x0, HWY.x0), x1 = Math.min(C.x1, HWY.x1); if (x1 <= x0) return;
  for (let x = x0; x < x1 - 0.01; x += 8) { const xa = x, xb = Math.min(x + 8, x1); const ya = hwyY(xa), yb = hwyY(xb); if (ya < 0.05 && yb < 0.05) continue;
    const len = Math.hypot(xb - xa, yb - ya), ang = Math.atan2(yb - ya, xb - xa), xm = (xa + xb) / 2, ym = (ya + yb) / 2;
    const deck = box(len, 0.9, HWY.w, 0, -0.45, 0); deck.rotateZ(ang); deck.translate(xm, ym, zc); B.add('concrete', worldUV(deck, 3));
    const top = new THREE.PlaneGeometry(len, HWY.w - 1).rotateX(-Math.PI / 2); top.rotateZ(ang); top.translate(xm, ym + 0.005, zc); const p = top.attributes.position, uv = top.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4.5, p.getZ(i) / 4.5); B.add('asphalt', top);
    for (const s of [-1, 1]) { const bar = box(len, 0.9, 0.35, 0, 0.45, 0); bar.rotateZ(ang); bar.translate(xm, ym, zc + s * (hw - 0.2)); B.add('concrete', worldUV(bar, 3));
      if (lod === 0) B.colliders.push({ kind: 'box', half: [len / 2, 0.6, 0.2], pos: [xm, ym + 0.6, zc + s * (hw - 0.2)], rot: [0, 0, Math.sin(ang / 2), Math.cos(ang / 2)], friction: 0.15 }); }
    if (lod === 0) { B.colliders.push({ kind: 'box', half: [len / 2, 0.45, hw], pos: [xm, ym - 0.45, zc], rot: [0, 0, Math.sin(ang / 2), Math.cos(ang / 2)], friction: 0.9 });
      for (const o of [-3.5, 3.5]) { const d = new THREE.PlaneGeometry(4.2, 0.14).rotateX(-Math.PI / 2); d.rotateZ(ang); d.translate(xm, ym + 0.012, zc + o); B.add('paint', d); } }
    if (Math.round(xa) % 32 === 0 && ya > 2) { const pier = box(2.2, ya, 3.2, xa, ya / 2 - 0.9, zc); B.add('concrete', worldUV(pier, 3)); if (lod === 0) B.colliders.push({ kind: 'box', half: [1.1, ya / 2, 1.6], pos: [xa, ya / 2 - 0.9, zc], friction: 0.3 });
      if (lod === 0) { const lp = new THREE.CylinderGeometry(0.08, 0.1, 6, 6); lp.translate(xa, ya + 3, zc + hw - 0.3); B.add('pole', lp); B.add('lamphead', box(0.6, 0.12, 0.3, xa, ya + 6, zc + hw - 1.4)); B.lights.push({ pos: [xa, ya + 5.6, zc + hw - 1.6], color: 0xffd0a0, intensity: 200, distance: 28 }); } }
  }
}
