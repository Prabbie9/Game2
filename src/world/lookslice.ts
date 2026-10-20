// M2 look slice: one downtown intersection + surrounding block at full target quality.
// Roads (16 m, 4 lanes), raised sidewalks with real 15 cm kerbs, lane paint, zebra crossings, stop lines, manholes,
// drains, tar patches, street lamps, working traffic lights, trees with wind, bins, benches, bollards, hydrants,
// parked cars, and four corner blocks (brick, plaster, concrete, a glass tower). Physics statics are emitted alongside.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Renderer } from '../renderer/renderer';
import type { StaticDesc } from '../sim/simcore';
import type { LightPool } from '../lighting/lightpool';
import { pbr } from '../materials/pbr';
import { buildBuilding, type BuildingSpec } from './buildings';
import { SourcedCar } from '../vehicles/sourced';
import { WORLD_UNIFORMS } from '../lighting/environment';

const ROAD = 8, WALK = 5.5, KERB = 0.15, HALF = 110; // road half-width, sidewalk width, kerb height, slice half-extent
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
function planeUV(g: THREE.BufferGeometry, scale: number) { const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale); return g; }
function worldUV(g: THREE.BufferGeometry, s: number) { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)); const [u, v] = ay > 0.5 ? [p.getX(i), p.getZ(i)] : ax > 0.5 ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]; uv.setXY(i, u / s, v / s); } return g; }
const rnd = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));

export interface Slice { group: THREE.Group; statics: StaticDesc[]; colliders: THREE.Object3D[]; update: (dt: number, night: number) => void; parked: SourcedCar[]; spawn: [number, number, number]; phase: (axis: number) => 'g' | 'a' | 'r' }

export function buildLookSlice(R: Renderer, pool: LightPool): Slice {
  const group = new THREE.Group(); const statics: StaticDesc[] = []; const colliders: THREE.Object3D[] = []; const r = rnd(42);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, collide = false) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; group.add(o); if (collide) colliders.push(o); return o; };
  // --- ground: one asphalt slab for the whole slice; sidewalks are raised blocks on top
  const asphalt = R.setupMaterial(pbr('asphalt', { antiTile: true, grime: 0.55, puddles: 1, normalScale: 1.1 }, 'road'));
  mesh(planeUV(new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2), 4.5), asphalt, false, true);
  statics.push({ kind: 'box', half: [HALF + 300, 0.5, HALF + 300], pos: [0, -0.5, 0], friction: 0.9 });
  const walkMat = R.setupMaterial(pbr('sidewalk', { antiTile: true, grime: 0.6, puddles: 0.45 }, 'walk'));
  const kerbMat = R.setupMaterial(pbr('kerb', { grime: 0.5, tint: 0xcfcac2, puddles: 0.2 }, 'kerbstone'));
  const walks: THREE.BufferGeometry[] = [], kerbs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // each quadrant: sidewalk L-shape around the corner block (block interior is filled by buildings)
    const x0 = ROAD, x1 = HALF; const cx = sx * (x0 + x1) / 2, cz = sz * (x0 + x1) / 2, len = x1 - x0;
    walks.push(worldUV(box(len, KERB, len, cx, KERB / 2, cz), 2.4));
    statics.push({ kind: 'box', half: [len / 2, KERB / 2, len / 2], pos: [cx, KERB / 2, cz], friction: 0.9 });
    // kerb stones along both road edges (0.3 m wide, slightly proud)
    kerbs.push(worldUV(box(len, KERB + 0.01, 0.3, cx, (KERB + 0.01) / 2, sz * (ROAD + 0.15)), 1.2), worldUV(box(0.3, KERB + 0.01, len, sx * (ROAD + 0.15), (KERB + 0.01) / 2, cz), 1.2));
  }
  mesh(merge(walks), walkMat, false, true); mesh(merge(kerbs), kerbMat, true);
  // --- road paint: lane dashes, centre double line, stop lines, zebra crossings (polygon-offset decals)
  const paint = R.setupMaterial(pbr('concrete', { grime: 0.2, tint: 0xf0ede4, puddles: 0.5, roughness: 0.7 }, 'paint'));
  paint.polygonOffset = true; paint.polygonOffsetFactor = -2; paint.polygonOffsetUnits = -2;
  const yellow = R.setupMaterial(pbr('concrete', { grime: 0.2, tint: 0xe2b23a, puddles: 0.5 }, 'paintY')); yellow.polygonOffset = true; yellow.polygonOffsetFactor = -2; yellow.polygonOffsetUnits = -2;
  const lines: THREE.BufferGeometry[] = [], ylines: THREE.BufferGeometry[] = [];
  const quad = (w: number, d: number, x: number, z: number, rot = 0) => { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(rot); g.translate(x, 0.004, z); return planeUV(g, 3); };
  for (const axis of [0, 1]) for (const s of [-1, 1]) {
    const rot = axis ? Math.PI / 2 : 0; const P = (a: number, b: number): [number, number] => (axis ? [b, a] : [a, b]);
    for (let t = ROAD + 14; t < HALF; t += 9) { const [x, z] = P(s * 4, s * t); lines.push(quad(0.14, 4.2, x, z, rot)); }      // lane dashes
    for (const o of [-0.12, 0.12]) { const [x, z] = P(o, s * (ROAD + 14 + (HALF - ROAD - 14) / 2)); ylines.push(quad(0.11, HALF - ROAD - 14, x, z, rot)); }
    { const [x, z] = P(s * ROAD / 2, s * (ROAD + 7.5)); lines.push(quad(ROAD, 0.45, x, z, rot)); }                             // stop line
    for (let k = -ROAD + 0.6; k < ROAD; k += 1.2) { const [x, z] = P(k, s * (ROAD + 3.5)); lines.push(quad(0.6, 4, x, z, rot)); } // zebra
  }
  mesh(merge(lines), paint, false); mesh(merge(ylines), yellow, false);
  // --- street detail decals: manholes, drains, tar patches, oil stains
  const iron = R.setupMaterial(pbr('rust', { grime: 0.3, tint: 0x6a6460, puddles: 0 }, 'iron'));
  const hardware: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[3.5, 30], [-4, -45], [40, -3.5], [-60, 4], [2, 70], [-3, -82]]) { const g = new THREE.CylinderGeometry(0.42, 0.42, 0.02, 24); g.translate(x, 0.008, z); hardware.push(g); }
  for (let t = ROAD + 10; t < HALF; t += 22) for (const s of [-1, 1]) for (const ax of [0, 1]) { const [x, z] = ax ? [s * t, s * (ROAD - 0.35)] : [s * (ROAD - 0.35), s * t]; hardware.push(box(ax ? 0.9 : 0.4, 0.02, ax ? 0.4 : 0.9, x, 0.008, z)); }
  mesh(merge(hardware), iron, false);
  const tar = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.55, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  R.setupMaterial(tar);
  const tars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) { const ax = r() < 0.5; const t = (r() - 0.5) * HALF * 1.8, o = (r() - 0.5) * ROAD * 1.6; const g = new THREE.CircleGeometry(0.6 + r() * 1.6, 7 + Math.floor(r() * 4)).rotateX(-Math.PI / 2); g.scale(1 + r() * 2, 1, 0.5 + r()); g.rotateY(r() * 3); g.translate(ax ? t : o, 0.006, ax ? o : t); tars.push(g); }
  mesh(merge(tars), tar, false);
  // --- buildings on the four corner blocks
  const specs: BuildingSpec[] = [
    { x: 26, z: 24, w: 22, d: 20, floors: 6, style: 'brick', seed: 1, shop: true, tint: 0xe8d6c8 },
    { x: 26, z: 52, w: 22, d: 24, floors: 8, style: 'plaster', seed: 2, shop: true, tint: 0xd9cdb4 },
    { x: 54, z: 30, w: 24, d: 34, floors: 5, style: 'brick', seed: 3, shop: false, tint: 0xb98c72 },
    { x: -30, z: 30, w: 30, d: 30, floors: 30, style: 'tower', seed: 4, shop: true },
    { x: -26, z: -24, w: 22, d: 20, floors: 7, style: 'plaster', seed: 5, shop: true, tint: 0xa9b7b9 },
    { x: -26, z: -50, w: 22, d: 22, floors: 5, style: 'brick', seed: 6, shop: true, tint: 0x9e6a55 },
    { x: -56, z: -30, w: 26, d: 30, floors: 10, style: 'concrete', seed: 7, shop: false },
    { x: 26, z: -24, w: 22, d: 20, floors: 4, style: 'brick', seed: 8, shop: true, tint: 0x8c5a48 },
    { x: 28, z: -52, w: 26, d: 26, floors: 12, style: 'concrete', seed: 9, shop: true, tint: 0xd8d4cc },
    { x: 58, z: -34, w: 26, d: 36, floors: 18, style: 'tower', seed: 10, shop: true },
    { x: -52, z: 66, w: 40, d: 30, floors: 22, style: 'tower', seed: 11, shop: false },
    { x: 60, z: 70, w: 30, d: 30, floors: 9, style: 'plaster', seed: 12, shop: true, tint: 0xc9b89a },
    { x: -62, z: -78, w: 30, d: 30, floors: 14, style: 'concrete', seed: 13, shop: false, tint: 0xbab3a8 },
    { x: 70, z: -80, w: 30, d: 30, floors: 6, style: 'brick', seed: 14, shop: true },
  ];
  for (const s of specs) { const b = buildBuilding(R, s); group.add(b.group); b.group.position.y = KERB;
    statics.push({ kind: 'box', half: [s.w / 2, b.height / 2, s.d / 2], pos: [s.x, KERB + b.height / 2, s.z], friction: 0.3 });
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(s.w, b.height, s.d)); proxy.position.set(s.x, KERB + b.height / 2, s.z); proxy.visible = false; proxy.updateMatrixWorld(); colliders.push(proxy); group.add(proxy); }
  // --- awnings + illuminated signs on shop buildings facing the main roads
  const fabric = R.setupMaterial(pbr('fabric', { grime: 0.3, tint: 0x7a2f2a, metalness: 0 }, 'awn'));
  const awn: THREE.BufferGeometry[] = []; const signMat: THREE.MeshStandardMaterial[] = [];
  const signCols = [0xff3d6e, 0x37d7ff, 0xffb238, 0x9dff6a, 0xff7a2e];
  for (const s of specs.filter((q) => q.shop && Math.abs(q.x) < 40 && Math.abs(q.z) < 40)) {
    const faceZ = Math.sign(s.x) * 0 + (Math.abs(s.z) - s.d / 2 > ROAD ? -Math.sign(s.z) : 0); const faceX = -Math.sign(s.x);
    for (const [nx, nz, len] of [[0, faceZ, s.w], [faceX, 0, s.d]] as [number, number, number][]) {
      if (!nx && !nz) continue; const cx = s.x + nx * (s.w / 2 + 0.9), cz = s.z + nz * (s.d / 2 + 0.9);
      const g = new THREE.BoxGeometry(nx ? 1.8 : len * 0.8, 0.08, nx ? len * 0.8 : 1.8); g.rotateX(nz ? -nz * 0.32 : 0); g.rotateZ(nx ? nx * 0.32 : 0); g.translate(cx, KERB + 3.9, cz); awn.push(g);
      const col = signCols[Math.floor(r() * signCols.length)];
      const sm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 3, roughness: 0.4 }); signMat.push(sm);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(nx ? 0.12 : len * 0.5, 0.7, nx ? len * 0.5 : 0.12), sm);
      sign.position.set(s.x + nx * (s.w / 2 + 0.35), KERB + 4.3, s.z + nz * (s.d / 2 + 0.35)); group.add(sign);
      pool.add({ pos: sign.position.clone().add(new THREE.Vector3(nx * 1.2, -0.4, nz * 1.2)), color: new THREE.Color(col), intensity: 14, distance: 9, nightOnly: true });
    }
  }
  if (awn.length) mesh(merge(awn), fabric);
  // --- street lamps (curved arm, emissive head) + pooled lights
  const poleMat = R.setupMaterial(pbr('metal', { grime: 0.4, tint: 0x3a3e44, roughness: 0.6 }, 'pole'));
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, emissive: 0xffd9a8, emissiveIntensity: 0, roughness: 0.3 });
  const poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
  const lampAt = (x: number, z: number, dx: number, dz: number) => {
    const p = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 10); p.translate(x, KERB + 3.75, z); poles.push(p);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6); arm.rotateZ(Math.PI / 2); arm.rotateY(Math.atan2(-dz, dx)); arm.translate(x + dx * 1.1, KERB + 7.4, z + dz * 1.1); poles.push(arm);
    const h = new THREE.BoxGeometry(0.7, 0.14, 0.32); h.rotateY(Math.atan2(-dz, dx)); h.translate(x + dx * 2.1, KERB + 7.3, z + dz * 2.1); heads.push(h);
    pool.add({ pos: new THREE.Vector3(x + dx * 2.1, KERB + 6.9, z + dz * 2.1), color: new THREE.Color(1, 0.8, 0.56), intensity: 160, distance: 26, nightOnly: true });
  };
  for (let t = ROAD + 12; t < HALF; t += 24) for (const s of [-1, 1]) { lampAt(s * (ROAD + 0.9), t * s, -s, 0); lampAt(-t * s, s * (ROAD + 0.9), 0, -s); }
  mesh(merge(poles), poleMat); const headMesh = mesh(merge(heads), headMat, false);
  // --- traffic lights at the four corners (cycle N-S / E-W), lamps are emissive discs
  const tlHousing = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.5, metalness: 0.4 }));
  const tlLamps: { mat: THREE.MeshStandardMaterial; axis: number; col: 'r' | 'a' | 'g' }[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const x = sx * (ROAD + 0.8), z = sz * (ROAD + 0.8); const pole = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 10); pole.translate(x, KERB + 2.6, z); poles.push(pole);
    const axis = sx === sz ? 0 : 1; const face = axis ? new THREE.Vector3(0, 0, -sz) : new THREE.Vector3(-sx, 0, 0);
    const hous = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.32), tlHousing); hous.position.set(x, KERB + 4.6, z); hous.lookAt(x + face.x, KERB + 4.6, z + face.z); group.add(hous);
    (['r', 'a', 'g'] as const).forEach((c, i) => { const m = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c === 'r' ? 0xff2a1a : c === 'a' ? 0xffa21a : 0x2dff7a, emissiveIntensity: 0.1 });
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), m); d.position.set(0, 0.38 - i * 0.38, 0.17); hous.add(d); tlLamps.push({ mat: m, axis, col: c }); });
  }
  mesh(merge(poles.slice(-4)), poleMat);
  // --- trees in sidewalk pits (trunk + clustered foliage, vertex wind sway)
  const bark = R.setupMaterial(pbr('wood', { grime: 0.5, tint: 0x6b5a4a, metalness: 0 }, 'bark'));
  // leaf atlas drawn procedurally: clusters of leaf ellipses in varied greens on transparent background (alpha-tested cards)
  const lc = document.createElement('canvas'); lc.width = lc.height = 256; const lg = lc.getContext('2d')!; const lr = rnd(7);
  for (let i = 0; i < 420; i++) { const x = lr() * 256, y = lr() * 256, a = lr() * Math.PI, l = 7 + lr() * 9; lg.fillStyle = `hsl(${88 + lr() * 34},${38 + lr() * 25}%,${20 + lr() * 22}%)`;
    lg.beginPath(); lg.ellipse(x, y, l, l * 0.42, a, 0, Math.PI * 2); lg.fill(); lg.strokeStyle = 'rgba(30,40,15,0.5)'; lg.beginPath(); lg.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); lg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); lg.stroke(); }
  const leafTex = new THREE.CanvasTexture(lc); leafTex.colorSpace = THREE.SRGBColorSpace; leafTex.anisotropy = 4;
  const leaf = R.setupMaterial(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8d8b0 }));
  const inner = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x1f2c14, roughness: 0.95 }));
  leaf.userData.patchKey = 'leafwind'; leaf.userData.patch = (sh: any) => { sh.uniforms.uTime = WORLD_UNIFORMS.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp0 = modelMatrix * vec4(transformed, 1.0); float sway = sin(uTime * 1.6 + wp0.x * 0.4 + wp0.z * 0.3) * 0.06 + sin(uTime * 4.7 + wp0.y * 2.0 + wp0.x) * 0.025; transformed.x += sway * max(0.0, transformed.y - 3.0); transformed.z += sway * 0.6 * max(0.0, transformed.y - 3.0);`);
    // foliage translucency fake: back-lit leaves glow slightly with the sun colour
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.12;'); };
  const trunks: THREE.BufferGeometry[] = [], foliage: THREE.BufferGeometry[] = [], innerG: THREE.BufferGeometry[] = [];
  for (let t = ROAD + 20; t < HALF - 6; t += 16) for (const s of [-1, 1]) for (const ax of [0, 1]) {
    const [x, z] = ax ? [s * t + 6, -s * (ROAD + 3.6)] : [-s * (ROAD + 3.6), s * t + 6]; if (r() < 0.25) continue;
    const tr = new THREE.CylinderGeometry(0.14, 0.22, 4.2, 8); tr.translate(x, KERB + 2.1, z); trunks.push(tr);
    const cx = x, cy = KERB + 5.3, cz = z;
    for (let k = 0; k < 3; k++) { const b = new THREE.IcosahedronGeometry(1.0 + r() * 0.5, 1); b.translate(cx + (r() - 0.5) * 1.5, cy + (r() - 0.5) * 1.2, cz + (r() - 0.5) * 1.5); innerG.push(b); }
    for (let k = 0; k < 46; k++) { const card = new THREE.PlaneGeometry(1.3, 1.3); const dir = new THREE.Vector3(r() - 0.5, (r() - 0.35) * 0.9, r() - 0.5).normalize();
      card.lookAt(dir); const d = 1.4 + r() * 1.3; card.translate(cx + dir.x * d * 1.15, cy + dir.y * d * 0.85, cz + dir.z * d * 1.15); foliage.push(card);
      if (k % 9 === 0) { const br = new THREE.CylinderGeometry(0.03, 0.06, d, 5); br.translate(0, d / 2, 0); br.lookAt(dir); br.rotateX(Math.PI / 2); br.translate(cx, cy - 0.6, cz); trunks.push(br); } }
    const pit = box(1.4, 0.02, 1.4, x, KERB + 0.011, z); trunks.push(pit);
  }
  mesh(merge(trunks), bark); mesh(merge(foliage), leaf); mesh(merge(innerG), inner);
  // --- street furniture: bins, benches, bollards, hydrants (merged per material)
  const darkMetal = R.setupMaterial(pbr('metal', { grime: 0.5, tint: 0x2d3136, roughness: 0.7 }, 'furn'));
  const hydrantMat = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xb3221b, roughness: 0.5, metalness: 0.3 }));
  const benchWood = R.setupMaterial(pbr('wood', { grime: 0.4, tint: 0xa07a52, metalness: 0 }, 'bench'));
  const furn: THREE.BufferGeometry[] = [], hyd: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [];
  for (let t = ROAD + 9; t < HALF - 4; t += 13) for (const s of [-1, 1]) for (const ax of [0, 1]) {
    const pick = r(); const off = ROAD + 1.0; const [x, z] = ax ? [s * t, s * off] : [s * off, s * t];
    if (pick < 0.3) { const g = new THREE.CylinderGeometry(0.3, 0.27, 0.95, 12); g.translate(x, KERB + 0.475, z); furn.push(g); }
    else if (pick < 0.5) { const g = new THREE.CylinderGeometry(0.14, 0.17, 0.75, 10); g.translate(x, KERB + 0.375, z); hyd.push(g); const c = new THREE.SphereGeometry(0.15, 10, 6); c.translate(x, KERB + 0.78, z); hyd.push(c); }
    else if (pick < 0.75) { for (let k = -1; k <= 1; k++) { const g = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 8); g.translate(x + (ax ? k * 1.4 : 0), KERB + 0.45, z + (ax ? 0 : k * 1.4)); furn.push(g); } }
    else { const [bx, bz] = ax ? [x, z + s * 2.8] : [x + s * 2.8, z]; wood.push(box(ax ? 1.8 : 0.45, 0.06, ax ? 0.45 : 1.8, bx, KERB + 0.45, bz), box(ax ? 1.8 : 0.06, 0.4, ax ? 0.06 : 1.8, bx + (ax ? 0 : s * 0.22), KERB + 0.7, bz + (ax ? s * 0.22 : 0)));
      for (const k of [-0.75, 0.75]) furn.push(box(ax ? 0.06 : 0.4, 0.45, ax ? 0.4 : 0.06, bx + (ax ? k : 0), KERB + 0.22, bz + (ax ? 0 : k))); }
  }
  mesh(merge(furn), darkMetal); if (hyd.length) mesh(merge(hyd), hydrantMat); if (wood.length) mesh(merge(wood), benchWood);
  // --- parked cars along the kerbs
  const parked: SourcedCar[] = []; const paints = [0x1f3e66, 0x8f8f92, 0x1b1b1d, 0xd8d6cf, 0x5b1d24, 0x2f4b37, 0xb08d3c];
  for (let t = ROAD + 22; t < HALF - 8; t += 7.2) for (const s of [-1, 1]) { if (r() < 0.45) continue;
    const c = new SourcedCar(R, 'kiri', { paint: paints[Math.floor(r() * paints.length)], frozen: true }); const along = r() < 0.5;
    const yaw = along ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2);
    c.root.position.set(along ? s * (ROAD - 1.2) : t * s, 0.725, along ? t * -s : s * (ROAD - 1.2)); c.root.rotation.y = yaw;
    group.add(c.root); parked.push(c); c.load().catch((e) => console.warn('parked car', e?.message));
    statics.push({ kind: 'box', half: [0.9, 0.6, 2.3], pos: [c.root.position.x, 0.7, c.root.position.z], rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], friction: 0.4 }); }
  R.scene.add(group);
  // traffic light cycle: 14 s per axis (green 10, amber 3, all-red 1)
  let tlT = 0;
  const phase = (axis: number): 'g' | 'a' | 'r' => { const t = (tlT - axis * 14 + 28) % 28; return t < 10 ? 'g' : t < 13 ? 'a' : 'r'; };
  const update = (dt: number, night: number) => {
    tlT = (tlT + dt) % 28;
    for (const l of tlLamps) l.mat.emissiveIntensity = phase(l.axis) === l.col ? 9 : 0.08;
    headMat.emissiveIntensity = night * 16; for (const sm of signMat) sm.emissiveIntensity = 0.7 + night * 4;
    void headMesh;
  };
  return { group, statics, colliders, update, parked, spawn: [3.8, 1.2, -60], phase };
}
