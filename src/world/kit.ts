// Geometry-only world kit (worker-safe: no DOM, no materials). Every builder appends geometry to a Batch under a
// material KEY; the main thread maps keys to shared materials (src/world/worldmaterials.ts). Colliders and light
// anchors are emitted alongside. Used by the chunk worker for streamed districts.
import * as THREE from 'three';
import type { StaticDesc } from '../sim/simcore';

export interface LightOut { pos: number[]; color: number; intensity: number; distance: number }
export class Batch {
  geos = new Map<string, THREE.BufferGeometry[]>(); colliders: StaticDesc[] = []; lights: LightOut[] = []; parked: { pos: number[]; yaw: number; paint: number }[] = [];
  steam: number[][] = []; tlights: { pos: number[]; face: number[]; axis: number }[] = [];
  add(key: string, g: THREE.BufferGeometry) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k); (this.geos.get(key) ?? this.geos.set(key, []).get(key)!).push(n); }
}
export const rnd = (s: number) => () => ((s = (Math.imul(s, 16807) >>> 0) % 2147483647 || 1) / 2147483647);
export const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
/** Box-map UVs in world metres (s = metres per tile). */
export function worldUV(g: THREE.BufferGeometry, s: number, ox = 0, oz = 0) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [u, v] = ay > 0.5 ? [p.getX(i) + ox, p.getZ(i) + oz] : ax > 0.5 ? [p.getZ(i) + oz, p.getY(i)] : [p.getX(i) + ox, p.getY(i)]; uv.setXY(i, u / s, v / s); }
  return g;
}
const tf = (g: THREE.BufferGeometry, x: number, y: number, z: number, rot: number) => { g.rotateY(rot); g.translate(x, y, z); return g; };

export interface BuildingSpec { x: number; z: number; y?: number; w: number; d: number; floors: number; style: 'brick' | 'plaster' | 'tower' | 'concrete'; seed: number; rot?: number; shop?: boolean; tint: number; balconies?: boolean }
export const TINTS = { brick: [0xe8d6c8, 0xb98c72, 0x9e6a55, 0x8c5a48, 0xffffff], plaster: [0xd9cdb4, 0xa9b7b9, 0xc9b89a, 0xe6dccb, 0xb7a58c], concrete: [0xd8d4cc, 0xbab3a8, 0xffffff, 0xa8a49c], tower: [0xffffff] } as const;

/** Full-detail building (near LOD). Keys: wall_<style>_<tint>, trim, frame_<tower|std>, glass_<std|tower>, glass_shop, roof, rooftop, awning, sign_<i>. */
export function building(B: Batch, b: BuildingSpec) {
  const r = rnd(b.seed * 9973 + 7); const tower = b.style === 'tower'; const fh = tower ? 3.8 : 3.4; const gfH = b.shop ? 4.6 : fh;
  const totalH = gfH + (b.floors - 1) * fh; const y0b = b.y ?? 0.15; const rot = b.rot ?? 0;
  const wallKey = `wall_${b.style === 'tower' ? 'concrete' : b.style}_${b.tint.toString(16)}`; const WS = b.style === 'brick' ? 1.7 : 2.6;
  const place = (g: THREE.BufferGeometry) => tf(g, b.x, y0b, b.z, rot);
  const recess = 0.22; const cellW = tower ? 1.6 : 2.2;
  const add = (key: string, g: THREE.BufferGeometry, uvs = 0) => B.add(key, uvs ? worldUV(place(g), uvs) : place(g));
  add(wallKey, box(b.w - recess * 2, totalH, b.d - recess * 2, 0, totalH / 2, 0), WS);
  const winStyle = Math.floor(r() * 3); // 0: single, 1: paired, 2: tall
  const faces: { len: number; f: (g: THREE.BufferGeometry) => THREE.BufferGeometry }[] = [
    { len: b.w, f: (g) => g.translate(0, 0, b.d / 2) }, { len: b.w, f: (g) => g.rotateY(Math.PI).translate(0, 0, -b.d / 2) },
    { len: b.d, f: (g) => g.rotateY(Math.PI / 2).translate(b.w / 2, 0, 0) }, { len: b.d, f: (g) => g.rotateY(-Math.PI / 2).translate(-b.w / 2, 0, 0) }];
  for (const F of faces) {
    const put = (key: string, g: THREE.BufferGeometry, uvs = 0) => add(key, F.f(g), uvs);
    if (tower) {
      put('glass_tower', box(F.len - 0.4, totalH - gfH, 0.05, 0, gfH + (totalH - gfH) / 2, -0.06));
      const cols = Math.round(F.len / cellW);
      for (let i = 0; i <= cols; i++) put('frame_tower', box(0.08, totalH - gfH, 0.18, -F.len / 2 + 0.2 + (i * (F.len - 0.4)) / cols, gfH + (totalH - gfH) / 2, 0));
      for (let k = 1; k < b.floors; k++) put('frame_tower', box(F.len - 0.3, k % 6 === 0 ? 0.9 : 0.32, k % 6 === 0 ? 0.3 : 0.16, 0, gfH + (k - 1) * fh, 0));
    } else {
      const ww = winStyle === 1 ? 2.1 : 1.25, wh = winStyle === 2 ? 2.2 : 1.75, sill = winStyle === 2 ? 0.6 : 0.95;
      const n = Math.max(1, Math.floor((F.len - 1.2) / (ww + 0.95))); const pierW = (F.len - n * ww) / (n + 1);
      for (let k = 1; k < b.floors; k++) {
        const y0 = gfH + (k - 1) * fh;
        put(wallKey, box(F.len, sill, recess, 0, y0 + sill / 2, recess / 2), WS);
        put(wallKey, box(F.len, fh - sill - wh, recess, 0, y0 + sill + wh + (fh - sill - wh) / 2, recess / 2), WS);
        for (let i = 0; i <= n; i++) put(wallKey, box(pierW, wh, recess, -F.len / 2 + pierW / 2 + i * (pierW + ww), y0 + sill + wh / 2, recess / 2), WS);
        for (let i = 0; i < n; i++) { const x = -F.len / 2 + pierW + ww / 2 + i * (pierW + ww);
          put('glass_std', box(ww, wh, 0.04, x, y0 + sill + wh / 2, 0.02));
          put('frame_std', box(ww, 0.06, 0.08, x, y0 + sill + wh * 0.62, 0.06)); put('frame_std', box(0.05, wh, 0.08, x, y0 + sill + wh / 2, 0.06));
          put('trim', box(ww + 0.2, 0.08, 0.3, x, y0 + sill - 0.03, recess + 0.08), 2);
          if (b.balconies && k % 2 === 0 && i % 2 === 0) { put('trim', box(ww + 0.6, 0.15, 1.1, x, y0 + 0.05, recess + 0.55), 2); put('frame_std', box(ww + 0.6, 0.9, 0.04, x, y0 + 0.55, recess + 1.08)); }
        }
        put('trim', box(F.len + 0.1, 0.14, 0.12, 0, y0, recess + 0.05), 2);
      }
    }
    if (b.shop) {
      const bays = Math.max(1, Math.round(F.len / 5.5)); const bw = F.len / bays;
      for (let i = 0; i < bays; i++) { const x = -F.len / 2 + bw * (i + 0.5);
        put('glass_shop', box(bw - 0.7, 3.2, 0.05, x, 1.95, 0.05));
        put('frame_std', box(bw - 0.5, 0.12, 0.14, x, 3.6, 0.12)); put('frame_std', box(0.1, 3.3, 0.12, x - bw / 2 + 0.35, 1.95, 0.1)); put('frame_std', box(bw - 0.6, 0.35, 0.16, x, 0.18, 0.12));
        put(wallKey, box(0.6, gfH, recess + 0.08, -F.len / 2 + bw * i + 0.3, gfH / 2, recess / 2 + 0.04), WS);
        if (r() < 0.55) { const aw = new THREE.BoxGeometry(bw - 0.8, 0.07, 1.7); aw.rotateX(-0.32); aw.translate(x, 3.95, 0.95); put('awning', aw); }
        if (r() < 0.35) put(`sign_${Math.floor(r() * 5)}`, box(Math.min(3, bw - 1.2), 0.6, 0.12, x, 4.25, 0.35));
      }
      put(wallKey, box(F.len, gfH - 3.85, recess + 0.08, 0, 3.85 + (gfH - 3.85) / 2, recess / 2 + 0.04), WS);
    } else if (tower) { // tower lobby: full-height glazing between columns
      const bays = Math.max(1, Math.round(F.len / 6)); const bw = F.len / bays;
      for (let i = 0; i < bays; i++) { const x = -F.len / 2 + bw * (i + 0.5); put('glass_shop', box(bw - 0.9, gfH - 0.5, 0.05, x, (gfH - 0.5) / 2, 0.05)); put('frame_tower', box(0.7, gfH, 0.7, -F.len / 2 + bw * i + 0.35, gfH / 2, 0.2)); }
      put('frame_tower', box(F.len, 0.5, 0.4, 0, gfH - 0.25, 0.15));
    } else put(wallKey, box(F.len, gfH, recess + 0.06, 0, gfH / 2, recess / 2 + 0.03), WS);
    put('trim', box(F.len + 0.4, 0.5, 0.45, 0, totalH - 0.25, recess + 0.12), 2);
    put('trim', box(F.len + 0.1, 0.9, 0.25, 0, totalH + 0.45, 0), 2);
  }
  add('roof', box(b.w - 0.3, 0.2, b.d - 0.3, 0, totalH + 0.1, 0), 4);
  for (let i = 0; i < 3 + Math.floor(r() * 5); i++) { const w = 1 + r() * 1.6; add('rooftop', box(w, 0.9 + r() * 0.6, w * (0.6 + r() * 0.5), (r() - 0.5) * (b.w - 4), totalH + 0.65, (r() - 0.5) * (b.d - 4)), 2); }
  if (r() < 0.6) { const t = new THREE.CylinderGeometry(1.3, 1.3, 2.6, 14); t.translate((r() - 0.5) * (b.w - 5), totalH + 2.2, (r() - 0.5) * (b.d - 5)); add('rooftop', t, 2); }
  if (tower && r() < 0.7) add('rooftop', box(0.3, 8, 0.3, (r() - 0.5) * 4, totalH + 4, (r() - 0.5) * 4));
  // brick walk-ups: fire escape on the street face (platforms, zig-zag stairs, railings) and a timber water tower
  if (b.style === 'brick' && b.floors >= 4 && r() < 0.7) {
    const fx = (r() - 0.5) * (b.w - 8), fz = b.d / 2 + 0.85;
    for (let k = 1; k < b.floors; k++) { const y = gfH + (k - 1) * fh;
      add('furn', box(3.6, 0.06, 1.2, fx, y, fz)); add('furn', box(3.6, 0.04, 0.04, fx, y + 0.95, fz + 0.58)); add('furn', box(0.04, 0.95, 1.2, fx - 1.78, y + 0.47, fz)); add('furn', box(0.04, 0.95, 1.2, fx + 1.78, y + 0.47, fz));
      for (let q = 0; q < 6; q++) add('furn', box(0.04, 0.95, 0.04, fx - 1.5 + q * 0.6, y + 0.47, fz + 0.58));
      if (k < b.floors - 1) { const st = box(0.7, 0.05, Math.hypot(fh, 2.6), 0, 0, 0); st.rotateX(Math.atan2(fh, 2.6) * (k % 2 ? 1 : -1)); st.rotateY(Math.PI / 2); st.translate(fx, y + fh / 2, fz + 0.2); add('furn', st); } }
  }
  if (b.style === 'brick' && r() < 0.45) { const wx = (r() - 0.5) * (b.w - 6), wz = (r() - 0.5) * (b.d - 6); const t = new THREE.CylinderGeometry(1.5, 1.5, 3.2, 12); t.translate(wx, totalH + 3.6, wz); add('bench', t);
    const cap = new THREE.ConeGeometry(1.6, 1.1, 12); cap.translate(wx, totalH + 5.75, wz); add('rooftop', cap); for (const [ox, oz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) add('furn', box(0.12, 2.0, 0.12, wx + ox * 1.1, totalH + 1.0, wz + oz * 1.1)); }
  // rooftop billboard on some mid-rises (lit sign panel on a steel frame)
  if (!tower && b.floors <= 8 && r() < 0.18) { const bw = Math.min(10, b.w - 3); add(`sign_${Math.floor(r() * 5)}`, box(bw, 3.2, 0.2, 0, totalH + 3.6, b.d / 2 - 1)); for (const ox of [-bw / 2 + 0.5, bw / 2 - 0.5]) add('furn', box(0.15, 2.2, 0.15, ox, totalH + 1.1, b.d / 2 - 1)); }
  B.colliders.push({ kind: 'box', half: [b.w / 2, totalH / 2, b.d / 2], pos: [b.x, y0b + totalH / 2, b.z], rot: [0, Math.sin(rot / 2), 0, Math.cos(rot / 2)], friction: 0.3 });
  return totalH;
}
const FAR_COL: Record<string, number[]> = { tower: [0.36, 0.42, 0.48], brick: [0.55, 0.36, 0.3], concrete: [0.66, 0.64, 0.6], plaster: [0.78, 0.73, 0.64] };
/** Far LOD building: one box sharing the single 'far' material (vertex colour = facade tint, uv = window grid). */
export function buildingFar(B: Batch, b: BuildingSpec) {
  const fh = b.style === 'tower' ? 3.8 : 3.4; const H = (b.shop ? 4.6 : fh) + (b.floors - 1) * fh;
  const g = new THREE.BoxGeometry(b.w, H, b.d); const uv = g.attributes.uv as THREE.BufferAttribute; const nrm = g.attributes.normal;
  const tint = (b.tint >> 16 & 255) / 255 * 0.3 + 0.7; const c = FAR_COL[b.style].map((v) => v * tint); const col = new Float32Array(uv.count * 3);
  for (let k = 0; k < uv.count; k++) { const top = Math.abs(nrm.getY(k)) > 0.5; uv.setXY(k, top ? 0 : uv.getX(k) * b.w / 16, top ? 0 : uv.getY(k) * H / 16); col.set(top ? [0.35, 0.33, 0.31] : c, k * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  B.add('far', tf(g, b.x, (b.y ?? 0.15) + H / 2, b.z, b.rot ?? 0)); return H;
}
