// Building kit: procedural facades with real depth (piers + spandrels around recessed windows), per-floor bands,
// cornice, parapet, rooftop clutter, ground-floor storefronts with awnings + signage, and glass curtain-wall towers.
// Windows use an interior-mapping material (fake rooms behind glass, lights on at night) with fresnel env reflection.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Renderer } from '../renderer/renderer';
import { pbr } from '../materials/pbr';
import { WORLD_UNIFORMS } from '../lighting/environment';

export interface BuildingSpec { x: number; z: number; w: number; d: number; floors: number; floorH?: number; style: 'brick' | 'plaster' | 'tower' | 'concrete'; seed: number; rot?: number; shop?: boolean; tint?: number }

/** Interior-mapped glass: room cells behind the facade plane, room colour/lights per cell hash, reflections via envMap + fresnel. */
export function interiorGlass(R: Renderer, cell: [number, number], depth: number, office = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.4 });
  m.userData.patchKey = 'interior' + cell.join() + depth + office;
  m.userData.patch = (sh: any) => {
    Object.assign(sh.uniforms, { uNight: WORLD_UNIFORMS.uNight, uCell: { value: new THREE.Vector2(...cell) }, uDepth: { value: depth } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjCam; varying vec3 vObjN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvObj = transformed; vObjN = objectNormal; vObjCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; varying vec3 vObjCam; varying vec3 vObjN; uniform float uNight; uniform vec2 uCell; uniform float uDepth;
      float ihash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // facade frame: u along facade, v up, w into the building
        vec3 n = normalize(vObjN); vec3 up = vec3(0.0, 1.0, 0.0); vec3 t = normalize(cross(up, n));
        vec3 rd = normalize(vObj - vObjCam); vec3 ro = vObj;
        vec3 r = vec3(dot(rd, t), dot(rd, up), -dot(rd, n)); vec3 p = vec3(dot(ro, t), dot(ro, up), 0.0);
        vec2 cellId = floor(p.xy / uCell); vec2 lo = cellId * uCell, hi = lo + uCell;
        float tx = (r.x > 0.0 ? hi.x - p.x : lo.x - p.x) / r.x; float ty = (r.y > 0.0 ? hi.y - p.y : lo.y - p.y) / r.y; float tz = uDepth / max(r.z, 1e-3);
        float th = min(min(tx, ty), tz); vec3 hit = p + r * th;
        float h = ihash(vec3(cellId, n.x * 3.0 + n.z * 7.0));
        vec3 wall = mix(vec3(0.55, 0.5, 0.44), vec3(0.42, 0.47, 0.52), ihash(vec3(cellId, 2.0)));
        ${office ? 'wall = mix(vec3(0.62), vec3(0.5, 0.55, 0.6), h);' : ''}
        vec3 col = th == tz ? wall * 0.9 : th == tx ? wall * 0.75 : (r.y > 0.0 ? vec3(0.8) : vec3(0.25, 0.2, 0.16));
        // blinds / curtains on some windows, a desk/furniture silhouette near the floor
        float vy = (hit.y - lo.y) / uCell.y; float blinds = step(0.55, ihash(vec3(cellId, 5.0))) * step(1.0 - ihash(vec3(cellId, 9.0)) * 0.7, vy);
        col = mix(col, vec3(0.7, 0.66, 0.58), blinds * 0.85);
        col *= mix(1.0, 0.45, step(vy, 0.28) * step(0.35, fract((hit.x - lo.x) / uCell.x * 2.0 + h)) * step(th, tz - 0.1));
        float lit = step(0.42, ihash(vec3(cellId, 11.0)));
        vec3 lamp = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.92, 1.0), step(0.7, ihash(vec3(cellId, 13.0)))${office ? ' * 1.0 + 0.0' : ''});
        float dayLevel = 0.11 + 0.05 * h; float nightLevel = lit * (1.1 + h * 0.8);
        float depthFade = exp(-th * 0.12);
        totalEmissiveRadiance += col * mix(dayLevel, nightLevel, uNight) * mix(vec3(1.0), lamp, uNight) * depthFade;
      }`);
  };
  return R.setupMaterial(m);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
/** Box-map UVs in world metres (scale = metres per texture tile). */
function worldUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const [u, v] = ny > 0.5 ? [p.getX(i), p.getZ(i)] : nx > 0.5 ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]; uv.setXY(i, u / scale, v / scale); }
  return g;
}
const rnd = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

export function buildBuilding(R: Renderer, b: BuildingSpec) {
  const r = rnd(b.seed * 9973 + 7); const fh = b.floorH ?? (b.style === 'tower' ? 3.8 : 3.4); const H = b.floors * fh; const gfH = b.shop ? 4.6 : fh;
  const totalH = gfH + (b.floors - 1) * fh;
  const group = new THREE.Group(); group.position.set(b.x, 0, b.z); group.rotation.y = b.rot ?? 0;
  const wallSlot = b.style === 'brick' ? 'brick' : b.style === 'concrete' ? 'concrete' : 'plaster';
  const wallMat = R.setupMaterial(pbr(wallSlot, { grime: 0.45, normalScale: 1, tint: b.tint ?? 0xffffff, aoIntensity: 0.8 }, `bld${b.tint ?? ''}`));
  const trimMat = R.setupMaterial(pbr('concrete', { grime: 0.5, tint: 0xd8d2c8 }, 'trim'));
  const winCell: [number, number] = [b.style === 'tower' ? 1.6 : 2.2, fh];
  const glass = interiorGlass(R, winCell, b.style === 'tower' ? 6 : 4.5, b.style === 'tower');
  const frameMat = R.setupMaterial(new THREE.MeshStandardMaterial({ color: b.style === 'tower' ? 0x2b3036 : 0x26221e, roughness: 0.45, metalness: b.style === 'tower' ? 0.9 : 0.2 }));
  const walls: THREE.BufferGeometry[] = [], trims: THREE.BufferGeometry[] = [], glassG: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
  const faces: { len: number; place: (g: THREE.BufferGeometry) => THREE.BufferGeometry }[] = [
    { len: b.w, place: (g) => g.translate(0, 0, b.d / 2) }, { len: b.w, place: (g) => g.rotateY(Math.PI).translate(0, 0, -b.d / 2) },
    { len: b.d, place: (g) => g.rotateY(Math.PI / 2).translate(b.w / 2, 0, 0) }, { len: b.d, place: (g) => g.rotateY(-Math.PI / 2).translate(-b.w / 2, 0, 0) },
  ];
  const recess = 0.22;
  // core volume slightly inset so facade elements sit proud of it
  walls.push(worldUV(box(b.w - recess * 2, totalH, b.d - recess * 2, 0, totalH / 2, 0), 3));
  for (const f of faces) {
    if (b.style === 'tower') {
      // curtain wall: full-height glass with mullion grid, spandrel band per floor
      glassG.push(f.place(box(f.len - 0.4, totalH - gfH, 0.05, 0, gfH + (totalH - gfH) / 2, -0.06)));
      const cols = Math.round(f.len / winCell[0]);
      for (let i = 0; i <= cols; i++) frames.push(f.place(box(0.08, totalH - gfH, 0.18, -f.len / 2 + 0.2 + (i * (f.len - 0.4)) / cols, gfH + (totalH - gfH) / 2, 0)));
      for (let k = 1; k < b.floors; k++) frames.push(f.place(box(f.len - 0.3, 0.32, 0.16, 0, gfH + (k - 1) * fh, 0)));
    } else {
      const n = Math.max(1, Math.floor((f.len - 1.2) / winCell[0])); const pierW = (f.len - n * 1.25) / (n + 1);
      for (let k = 1; k < b.floors; k++) {
        const y0 = gfH + (k - 1) * fh;
        // spandrel below window + lintel above, piers between windows: real depth around recessed glass
        walls.push(worldUV(f.place(box(f.len, 0.95, recess, 0, y0 + 0.475, recess / 2)), 3));
        walls.push(worldUV(f.place(box(f.len, fh - 0.95 - 1.75, recess, 0, y0 + 0.95 + 1.75 + (fh - 2.7) / 2, recess / 2)), 3));
        for (let i = 0; i <= n; i++) { const x = -f.len / 2 + pierW / 2 + i * (pierW + 1.25); walls.push(worldUV(f.place(box(pierW, 1.75, recess, x, y0 + 0.95 + 0.875, recess / 2)), 3)); }
        for (let i = 0; i < n; i++) { const x = -f.len / 2 + pierW + 0.625 + i * (pierW + 1.25);
          glassG.push(f.place(box(1.25, 1.75, 0.04, x, y0 + 0.95 + 0.875, 0.02)));
          frames.push(f.place(box(1.25, 0.06, 0.08, x, y0 + 0.95 + 0.875, 0.06)), f.place(box(0.05, 1.75, 0.08, x, y0 + 0.95 + 0.875, 0.06)));
          trims.push(f.place(box(1.45, 0.08, 0.3, x, y0 + 0.92, recess + 0.08))); }
        if (k % 1 === 0) trims.push(f.place(box(f.len + 0.1, 0.14, 0.12, 0, y0, recess + 0.05)));
      }
    }
    // ground floor: shopfronts (big glass, mullions, awning frame) or plinth with doors
    if (b.shop) {
      const bays = Math.max(1, Math.round(f.len / 5.5)); const bw = f.len / bays;
      for (let i = 0; i < bays; i++) { const x = -f.len / 2 + bw * (i + 0.5);
        glassG.push(f.place(box(bw - 0.7, 3.2, 0.05, x, 1.95, 0.05)));
        frames.push(f.place(box(bw - 0.5, 0.12, 0.14, x, 3.6, 0.12)), f.place(box(0.1, 3.3, 0.12, x - bw / 2 + 0.35, 1.95, 0.1)), f.place(box(bw - 0.6, 0.35, 0.16, x, 0.18, 0.12)));
        walls.push(worldUV(f.place(box(0.6, gfH, recess + 0.08, -f.len / 2 + bw * i + 0.3, gfH / 2, recess / 2 + 0.04)), 3)); }
      walls.push(worldUV(f.place(box(f.len, gfH - 3.85, recess + 0.08, 0, 3.85 + (gfH - 3.85) / 2, recess / 2 + 0.04)), 3));
    } else walls.push(worldUV(f.place(box(f.len, gfH, recess + 0.06, 0, gfH / 2, recess / 2 + 0.03)), 3));
    trims.push(f.place(box(f.len + 0.4, 0.5, 0.45, 0, totalH - 0.25, recess + 0.12))); // cornice
    trims.push(f.place(box(f.len + 0.1, 0.9, 0.25, 0, totalH + 0.45, 0.0))); // parapet
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => { if (!geos.length) return; const g = mergeGeometries(geos.map((x) => x.index ? x.toNonIndexed() : x)); const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; group.add(m); return m; };
  add(walls, wallMat); add(trims, trimMat); add(frames, frameMat); add(glassG, glass, false);
  // rooftop: roof slab, AC units, vents, water tank, antenna
  const roof = new THREE.Mesh(worldUV(box(b.w - 0.3, 0.2, b.d - 0.3, 0, totalH + 0.1, 0), 4), R.setupMaterial(pbr('gravel', { grime: 0.3 }, 'roof'))); roof.receiveShadow = true; group.add(roof);
  const metal = R.setupMaterial(pbr('metal', { grime: 0.6, tint: 0xb8bcc0, roughness: 0.8 }, 'rooftop'));
  const clutter: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3 + Math.floor(r() * 5); i++) { const w = 1 + r() * 1.6; clutter.push(box(w, 0.9 + r() * 0.6, w * (0.6 + r() * 0.5), (r() - 0.5) * (b.w - 4), totalH + 0.65, (r() - 0.5) * (b.d - 4))); }
  if (r() < 0.6) { const t = new THREE.CylinderGeometry(1.3, 1.3, 2.6, 16); t.translate((r() - 0.5) * (b.w - 5), totalH + 2.2, (r() - 0.5) * (b.d - 5)); clutter.push(t); }
  add(clutter, metal);
  return { group, height: totalH };
}
