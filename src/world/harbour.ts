// Harbour district (M8): the sea south of Downtown. Built once on the main thread (not streamed): animated water,
// concrete quay apron with a quay wall, edge kerb, bollards and tyre fenders, three timber piers on piles, container
// stacks (instanced, corrugated normal map), gantry cranes, corrugated warehouses, floodlight masts (pooled lights),
// moored trawlers that bob, and a drivable speedboat (arcade planing model: thrust, quadratic drag, keel damping,
// speed-scaled rudder, planing pitch and banked turns, collision with the quay and piers, stern spray).
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { PhysicsClient } from '../physics/client';
import type { StaticDesc } from '../sim/simcore';
import type { LightPool } from '../lighting/lightpool';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadBin } from '../core/assets';
import { EXTENT, QUAY_Z, PIERS, SEABED, line, roadW, GRID } from './citygen';

export const WATER_Y = -1.15;
const APRON_Z0 = line(GRID) + roadW(GRID) / 2;
/** Tileable wave normal map from a sum of integer-frequency sines (seamless at the texture edges). */
function waveNormals(size = 256) {
  const h = new Float32Array(size * size); const waves: [number, number, number, number][] = [];
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) { const kx = Math.round((r() - 0.5) * 2 * (2 + i)), ky = Math.round((r() - 0.5) * 2 * (2 + i)); waves.push([kx || 1, ky, 1 / (1 + i * 0.55), r() * 6.283]); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let v = 0; for (const [kx, ky, a, p] of waves) v += a * Math.sin(((kx * x + ky * y) / size) * 6.283 + p); h[y * size + x] = v; }
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!; const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const H = (xx: number, yy: number) => h[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * 0.9, dy = (H(x, y + 1) - H(x, y - 1)) * 0.9; const n = new THREE.Vector3(-dx, -dy, 1).normalize(); const o = (y * size + x) * 4;
    img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255; }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
/** Corrugated sheet normal map (vertical ribs). */
function ribs(n = 8) { const c = document.createElement('canvas'); c.width = 64; c.height = 4; const g = c.getContext('2d')!; const img = g.createImageData(64, 4);
  for (let x = 0; x < 64; x++) { const s = Math.cos((x / 64) * n * 6.283); for (let y = 0; y < 4; y++) { const o = (y * 64 + x) * 4; img.data[o] = (s * 0.45 + 0.5) * 255; img.data[o + 1] = 128; img.data[o + 2] = 230; img.data[o + 3] = 255; } }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t; }
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
async function loadProp(id: string) { const b = await loadBin(`props/${id}.glb`); const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b, ''); return g.scene; }

export class Boat {
  root = new THREE.Group(); modelSpace = new THREE.Group(); ready = false; yaw = 0; vel = new THREE.Vector2(); yawRate = 0; pitch = 0; roll = 0; t = Math.random() * 10; speed = 0; throttle = 0;
  seat = new THREE.Vector3(0.45, 1.05, -0.9); door = new THREE.Vector3(-3.1, 1.7, -0.4); // model space (+Z bow); door = stand point on the pier side
  constructor(public x: number, public z: number, yaw: number) { this.yaw = yaw; this.root.add(this.modelSpace); }
  /** Arcade boat. inp as for cars. Returns the stern point for spray. */
  update(dt: number, inp: { steer: number; throttle: number; brake: number; boost: number } | null, blocked: (x: number, z: number) => boolean) {
    this.t += dt; const f = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw)), rgt = new THREE.Vector2(f.y, -f.x);
    let vf = this.vel.dot(f), vl = this.vel.dot(rgt);
    if (inp) { const thrust = inp.throttle * (inp.boost > 0.5 ? 13 : 8.5) - inp.brake * (vf > 0.5 ? 9 : 4); vf += thrust * dt; this.throttle = inp.throttle; } else this.throttle = 0;
    vf -= (0.012 * vf * Math.abs(vf) + 0.08 * vf) * dt * 4; vl *= Math.exp(-dt * 2.6); // hull drag, keel
    const steerAuth = Math.min(1, Math.abs(vf) / 5) * Math.sign(vf || 1); const wantRate = (inp ? -inp.steer : 0) * 0.85 * steerAuth; this.yawRate += (wantRate - this.yawRate) * Math.min(1, dt * 2.5);
    this.yaw += this.yawRate * dt; vl += -this.yawRate * vf * 0.18 * dt; // a little slide out of the turn
    const nf = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw)), nr = new THREE.Vector2(nf.y, -nf.x); this.vel.copy(nf.multiplyScalar(vf)).add(nr.multiplyScalar(vl));
    const nx = this.x + this.vel.x * dt, nz = this.z + this.vel.y * dt;
    if (blocked(nx, nz)) { this.vel.multiplyScalar(-0.25); } else { this.x = nx; this.z = nz; }
    this.speed = this.vel.length(); const plane = THREE.MathUtils.clamp((vf - 4) / 10, 0, 1);
    this.pitch += ((-0.07 * plane - (inp?.throttle ?? 0) * 0.025 * (1 - plane)) - this.pitch) * Math.min(1, dt * 2); this.roll += (this.yawRate * Math.min(1, this.speed / 10) * 0.22 - this.roll) * Math.min(1, dt * 3);
    const bob = Math.sin(this.t * 1.3) * 0.06 * (1 - plane * 0.6) + Math.sin(this.t * 0.7 + 1) * 0.04;
    this.root.position.set(this.x, WATER_Y - 0.55 + bob + plane * 0.18, this.z); this.root.rotation.set(0, 0, 0); this.root.rotateY(this.yaw); this.root.rotateX(this.pitch + Math.sin(this.t * 1.1) * 0.012); this.root.rotateZ(this.roll + Math.sin(this.t * 0.9) * 0.015);
    return new THREE.Vector3(this.x, WATER_Y + 0.1, this.z).sub(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(3.4));
  }
  get quat() { return this.root.quaternion; }
}

export class Harbour {
  water: THREE.Mesh; normals: THREE.Texture; boats: Boat[] = []; boat: Boat; moored: { o: THREE.Object3D; base: THREE.Vector3; t: number }[] = [];
  constructor(public R: Renderer, phys: PhysicsClient, pool: LightPool, concrete: THREE.Material) {
    const S = R.scene; const statics: StaticDesc[] = []; const col = (half: number[], pos: number[]) => statics.push({ kind: 'box', half, pos, friction: 0.8 } as any);
    // water
    this.normals = waveNormals(); this.normals.repeat.set(1, 1);
    const wm = new THREE.MeshPhysicalMaterial({ color: 0x0c2a33, roughness: 0.07, metalness: 0.0, normalMap: this.normals, normalScale: new THREE.Vector2(0.26, 0.26), envMapIntensity: 1.25, clearcoat: 0.6, clearcoatRoughness: 0.12 });
    // second, finer wave layer scrolling the other way (breaks the single-layer tiling) + broken foam along the quay wall and around the piers
    wm.userData.patch = (sh: any) => { sh.uniforms.uWave2 = this.wave2; sh.uniforms.uPiers = { value: PIERS.map(([x, hw, ze]) => new THREE.Vector3(x, hw, ze)) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform vec2 uWave2; uniform vec3 uPiers[${PIERS.length}];`)
        .replace('#include <normal_fragment_maps>', `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0; vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 3.3 + uWave2 ).xyz * 2.0 - 1.0;
          mapN = vec3( mapN.xy + mapN2.xy * 0.55, mapN.z ); mapN.xy *= normalScale; normal = normalize( tbn * mapN );`)
        .replace('#include <lights_physical_fragment>', `float fd = vWPos.z - ${QUAY_Z.toFixed(1)}; for (int i = 0; i < ${PIERS.length}; i++) { vec3 P = uPiers[i]; fd = min(fd, length(max(vec2(abs(vWPos.x - P.x) - P.y, vWPos.z - P.z), 0.0))); }
          float fk = 1.0 - smoothstep(0.0, 2.4, fd); float fn = texture2D( normalMap, vNormalMapUv * 7.0 - uWave2 * 1.7 ).x; float foam = fk * smoothstep(0.42, 0.62, fn * 0.7 + fk * 0.45);
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.68, 0.68 ), foam * 0.85 ); roughnessFactor = mix( roughnessFactor, 0.75, foam );
          #include <lights_physical_fragment>
          material.clearcoat *= 1.0 - foam;`); };
    wm.userData.patchKey = 'water2'; R.setupMaterial(wm);
    const wg = new THREE.PlaneGeometry(10000, 5000 - QUAY_Z, 1, 1).rotateX(-Math.PI / 2).translate(0, WATER_Y, (5000 + QUAY_Z) / 2); const uv = wg.attributes.uv as THREE.BufferAttribute; const p = wg.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) * 0.87 + p.getZ(i) * 0.5) / 57, (p.getZ(i) * 0.87 - p.getX(i) * 0.5) / 57);
    this.water = new THREE.Mesh(wg, wm); this.water.receiveShadow = true; S.add(this.water);
    col([5000, 0.5, 2500], [0, SEABED - 0.5, QUAY_Z + 2500]);
    // apron + quay wall + edge kerb (gaps at the piers)
    const ag = new THREE.PlaneGeometry(2 * EXTENT + 700, QUAY_Z - APRON_Z0).rotateX(-Math.PI / 2).translate(0, 0.012, (QUAY_Z + APRON_Z0) / 2); { const u = ag.attributes.uv as THREE.BufferAttribute, q = ag.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, q.getX(i) / 3, q.getZ(i) / 3); }
    const apron = new THREE.Mesh(ag, concrete); apron.receiveShadow = true; S.add(apron);
    const wallM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x8e8a82, roughness: 0.92 })); const wall = new THREE.Mesh(box(2 * EXTENT + 700, -SEABED + 0.3, 1.2, 0, (SEABED + 0.3) / 2, QUAY_Z - 0.6), wallM); wall.receiveShadow = true; S.add(wall);
    const kerbG: THREE.BufferGeometry[] = []; let x0 = -EXTENT - 350; const gaps = [...PIERS].sort((a, b) => a[0] - b[0]);
    for (const [px, hw] of [...gaps, [EXTENT + 350 + 1e3, 0] as [number, number]]) { const xa = x0, xb = Math.min(px - hw, EXTENT + 350); if (xb > xa) { kerbG.push(box(xb - xa, 0.32, 0.6, (xa + xb) / 2, 0.16, QUAY_Z - 0.3)); col([(xb - xa) / 2, 0.16, 0.3], [(xa + xb) / 2, 0.16, QUAY_Z - 0.3]); } x0 = px + hw; }
    const kerbM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xd8c35a, roughness: 0.7 })); const kerb = new THREE.Mesh(mergeGeometries(kerbG), kerbM); kerb.castShadow = kerb.receiveShadow = true; S.add(kerb);
    // bollards + tyre fenders
    const bolM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.5, metalness: 0.6 })); const tyreM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }));
    const bol = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.28, 0.75, 10).translate(0, 0.375, 0), bolM, 300); const tyre = new THREE.InstancedMesh(new THREE.TorusGeometry(0.42, 0.17, 8, 14), tyreM, 300); let nb = 0, nt = 0; const m4 = new THREE.Matrix4();
    for (let x = -EXTENT - 340; x < EXTENT + 340; x += 12) { if (PIERS.some(([px, hw]) => Math.abs(x - px) < hw + 1)) continue; bol.setMatrixAt(nb++, m4.makeTranslation(x, 0, QUAY_Z - 1.1)); tyre.setMatrixAt(nt++, m4.makeTranslation(x + 6, -0.55, QUAY_Z + 0.2)); }
    bol.count = nb; tyre.count = nt; bol.castShadow = true; S.add(bol, tyre);
    // piers: timber deck + piles
    const deckM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x6b5641, roughness: 0.85 })); const pileM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 0.9 }));
    const deckG: THREE.BufferGeometry[] = []; const pile = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, -SEABED + 0.4, 8).translate(0, (SEABED + 0.4) / 2 - 0.2, 0), pileM, 400); let np = 0;
    for (const [px, hw, ze] of PIERS) { const L = ze - QUAY_Z; for (let i = 0; i < Math.floor(L / 0.9); i++) deckG.push(box(hw * 2, 0.12, 0.84, px, -0.06, QUAY_Z + 0.45 + i * 0.9));
      deckG.push(box(hw * 2 + 0.4, 0.4, L, px, -0.38, QUAY_Z + L / 2)); col([hw, 0.25, L / 2], [px, -0.25, QUAY_Z + L / 2]);
      for (let z = QUAY_Z + 3; z < ze; z += 6) for (const s of [-1, 1]) pile.setMatrixAt(np++, m4.makeTranslation(px + s * (hw + 0.1), 0, z)); }
    pile.count = np; const deck = new THREE.Mesh(mergeGeometries(deckG), deckM); deck.castShadow = deck.receiveShadow = true; S.add(deck, pile);
    // containers
    const cRibs = ribs(10); cRibs.repeat.set(6, 1); const cM = R.setupMaterial(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.35, normalMap: cRibs, normalScale: new THREE.Vector2(0.6, 0.6) }));
    const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(2.44, 2.59, 12.19).translate(0, 1.295, 0), cM, 260); let nc = 0; const COLS = [0x8c2b22, 0x1f4e79, 0x2f6b3a, 0xb8761c, 0x6d6f73, 0x8a1d4a, 0xd0cfc8, 0x234a52, 0xa8471f];
    let seed = 11; const rr = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [xa, xb] of [[-560, -330], [300, 520]]) for (let x = xa; x < xb; x += 3.1) for (const z of [APRON_Z0 + 12, APRON_Z0 + 28]) { if (rr() < 0.12) continue; const h = 1 + Math.floor(rr() * 4);
      for (let k = 0; k < h && nc < 260; k++) { cont.setMatrixAt(nc, m4.makeTranslation(x, k * 2.6, z)); cont.setColorAt(nc++, new THREE.Color(COLS[Math.floor(rr() * COLS.length)]).multiplyScalar(0.8 + rr() * 0.3)); }
      col([1.22, (h * 2.6) / 2, 6.1], [x, (h * 2.6) / 2, z]); }
    cont.count = nc; cont.castShadow = cont.receiveShadow = true; S.add(cont);
    // gantry cranes (legs on the apron, boom over the water)
    const craneM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xb4321f, roughness: 0.55, metalness: 0.4 })); const craneW = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6, metalness: 0.2 }));
    const g: THREE.BufferGeometry[] = [], w: THREE.BufferGeometry[] = []; // all four cranes share two meshes (one per material)
    for (const cx of [-470, -390, 380, 460]) { const zA = QUAY_Z - 22, zB = QUAY_Z - 4;
      for (const dx of [-8, 8]) for (const zz of [zA, zB]) { g.push(box(1.2, 34, 1.2, cx + dx, 17, zz)); col([0.6, 17, 0.6], [cx + dx, 17, zz]); }
      for (const dx of [-8, 8]) g.push(box(1.0, 1.4, zB - zA, cx + dx, 6, (zA + zB) / 2), box(1.4, 2.2, zB - zA + 1.2, cx + dx, 34, (zA + zB) / 2));
      g.push(box(17.2, 1.6, 1.6, cx, 34, zA), box(17.2, 1.6, 1.6, cx, 34, zB)); w.push(box(3.2, 2.6, 62, cx, 36.2, QUAY_Z + 12), box(5, 4, 5, cx + 3.5, 31.5, QUAY_Z - 2), box(2, 12, 2, cx, 43, zA + 3));
      for (let i = 0; i < 8; i++) g.push(box(0.25, 0.25, 9, cx + (i % 2 ? 1.3 : -1.3), 37.8, QUAY_Z - 18 + i * 8));
    }
    { const cm = new THREE.Mesh(mergeGeometries(g), craneM), cw = new THREE.Mesh(mergeGeometries(w), craneW); cm.castShadow = cw.castShadow = true; S.add(cm, cw); }
    // warehouses: corrugated sheds with low-pitched roofs
    const shedRibs = ribs(14); shedRibs.repeat.set(20, 1); const shedM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.55, metalness: 0.5, normalMap: shedRibs }));
    const roofM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x5d6468, roughness: 0.6, metalness: 0.5 })); const doorM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x2f3a40, roughness: 0.7, metalness: 0.4 }));
    const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], doors: THREE.BufferGeometry[] = []; // merged per material across all sheds
    for (const [sx, len] of [[-250, 70], [-30, 54], [170, 64], [620, 80]]) { const W = 24, H = 11, z = APRON_Z0 + 22; walls.push(box(len, H, W, sx, H / 2, z));
      const roof = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.6, 0), new THREE.Vector2(0, 2.6), new THREE.Vector2(W / 2 + 0.6, 0)]); const rg = new THREE.ExtrudeGeometry(roof, { depth: len + 1.2, bevelEnabled: false }).rotateY(Math.PI / 2).translate(sx - len / 2 - 0.6, H, z);
      roofs.push(rg); for (let i = 0; i < 3; i++) doors.push(box(7, 6, 0.2, sx - len / 3 + (i * len) / 3, 3, z + W / 2 + 0.05));
      col([len / 2, H / 2, W / 2], [sx, H / 2, z]); }
    S.add(Object.assign(new THREE.Mesh(mergeGeometries(walls), shedM), { castShadow: true, receiveShadow: true }), Object.assign(new THREE.Mesh(mergeGeometries(roofs), roofM), { castShadow: true }), new THREE.Mesh(mergeGeometries(doors), doorM));
    // floodlight masts (pooled lights at night)
    const mastM = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.5, metalness: 0.7 })); const headM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0 }); this.headM = headM;
    const mg: THREE.BufferGeometry[] = [], hg: THREE.BufferGeometry[] = [];
    for (let x = -EXTENT; x <= EXTENT; x += 90) { const z = QUAY_Z - 14; mg.push(new THREE.CylinderGeometry(0.25, 0.35, 22, 8).translate(x, 11, z)); hg.push(box(2.6, 0.5, 1.0, x, 22.2, z + 0.4)); col([0.3, 11, 0.3], [x, 11, z]);
      pool.add({ pos: new THREE.Vector3(x, 20, z + 3), color: new THREE.Color(0xffd9a0), intensity: 900, distance: 55, nightOnly: true }); }
    S.add(Object.assign(new THREE.Mesh(mergeGeometries(mg), mastM), { castShadow: true }), new THREE.Mesh(mergeGeometries(hg), headM));
    this.dressApron(statics);
    phys.addStatics(statics);
    // boats: the drivable speedboat beside the first pier, moored speedboats and trawlers
    const [p0x, p0hw] = PIERS[0]; this.boat = new Boat(p0x + p0hw + 1.45, QUAY_Z + 38, 0); this.boats.push(this.boat); S.add(this.boat.root);
    loadProp('speedboat').then((m) => { this.boat.modelSpace.add(m); m.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { R.setupMaterial(me.material as THREE.Material); me.castShadow = true; } }); this.boat.ready = true;
      for (const [x, z, yaw] of [[PIERS[1][0] - PIERS[1][1] - 1.5, QUAY_Z + 30, Math.PI], [PIERS[2][0] + PIERS[2][1] + 1.5, QUAY_Z + 60, 0]] as [number, number, number][]) { const c = m.clone(); const b = new THREE.Group(); b.add(c); b.position.set(x, WATER_Y - 0.55, z); b.rotation.y = yaw; S.add(b); this.moored.push({ o: b, base: b.position.clone(), t: x }); } }).catch((e) => console.warn('boat', e?.message));
    loadProp('trawler').then((m) => { m.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { R.setupMaterial(me.material as THREE.Material); me.castShadow = true; } });
      for (const [x, z, yaw] of [[PIERS[2][0] - PIERS[2][1] - 2.4, QUAY_Z + 55, Math.PI], [PIERS[0][0] - PIERS[0][1] - 2.4, QUAY_Z + 60, 0], [PIERS[1][0] + PIERS[1][1] + 2.4, QUAY_Z + 45, Math.PI]] as [number, number, number][]) { const b = new THREE.Group(); b.add(m.clone()); b.position.set(x, WATER_Y - 1.1, z); b.rotation.y = yaw; S.add(b); this.moored.push({ o: b, base: b.position.clone(), t: z }); } }).catch((e) => console.warn('trawler', e?.message));
  }
  headM: THREE.MeshStandardMaterial; wave2 = { value: new THREE.Vector2() };
  /** Apron dressing (look pass): painted quay markings and bay lines, oil stains, and cargo clusters (pallet stacks, crates,
   * drums, site cabins) between the shed fronts and the quay, clear of the pier roots. 6 draws in all (instanced/merged). */
  private dressApron(statics: StaticDesc[]) {
    const S = this.R.scene; const R = this.R; let seed = 977; const rr = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const clearOfPiers = (x: number) => PIERS.every(([px, hw]) => Math.abs(x - px) > hw + 10);
    // paint: yellow dashed quay-edge line, solid lane edge, hatched crane-leg zones, white bays in front of the sheds (vertex colour)
    const paint: THREE.BufferGeometry[] = []; const Y = new THREE.Color(0xc9a63a), W = new THREE.Color(0xc8c8c0);
    const strip = (w: number, d: number, x: number, z: number, c: THREE.Color, yaw = 0) => { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, 0.022, z); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); paint.push(g); };
    for (let x = -EXTENT - 330; x < EXTENT + 330; x += 6) if (PIERS.every(([px, hw]) => Math.abs(x - px) > hw + 2)) strip(3.2, 0.16, x, QUAY_Z - 2.6, Y);
    strip(2 * EXTENT + 660, 0.14, 0, QUAY_Z - 30, Y);
    for (const cx of [-470, -390, 380, 460]) for (const dx of [-8, 8]) for (let k = -3; k <= 3; k++) strip(4.2, 0.22, cx + dx + k * 0.9, QUAY_Z - 13, Y, Math.PI / 4);
    for (const [sx, len] of [[-250, 70], [-30, 54], [170, 64], [620, 80]]) for (let i = 0; i <= Math.floor(len / 3.2); i++) strip(0.12, 5.5, sx - len / 2 + i * 3.2, APRON_Z0 + 37.5, W);
    const pm = R.setupMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 })); const pmesh = new THREE.Mesh(mergeGeometries(paint), pm); pmesh.receiveShadow = true; S.add(pmesh);
    // oil stains / tyre scuffs: soft dark blots (one transparent merged mesh, radial canvas texture)
    const c = document.createElement('canvas'); c.width = c.height = 64; const g2 = c.getContext('2d')!; const gr = g2.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    const st: THREE.BufferGeometry[] = []; for (let i = 0; i < 90; i++) { const x = -EXTENT - 300 + rr() * (2 * EXTENT + 600), z = APRON_Z0 + 36 + rr() * (QUAY_Z - APRON_Z0 - 40), r = 0.8 + rr() * 2.4; st.push(new THREE.PlaneGeometry(r * (1 + rr()), r).rotateX(-Math.PI / 2).rotateY(rr() * 3).translate(x, 0.018, z)); }
    const sm = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x0b0a09, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })); const smesh = new THREE.Mesh(mergeGeometries(st), sm); smesh.receiveShadow = true; S.add(smesh);
    // cargo clusters (instanced; every item gets a box collider)
    const wood = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })); const crateM = R.setupMaterial(new THREE.MeshStandardMaterial({ roughness: 0.8 })); const drumM = R.setupMaterial(new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.55 })); const cabM = R.setupMaterial(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }));
    const pal = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1, 1.0).translate(0, 0.5, 0), wood, 160), crate = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 1.25, 1.25).translate(0, 0.625, 0), crateM, 200);
    const drum = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12).translate(0, 0.45, 0), drumM, 240), cab = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 2.6, 2.4).translate(0, 1.3, 0), cabM, 16);
    const n = { pal: 0, crate: 0, drum: 0, cab: 0 }; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), U = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const put = (im: THREE.InstancedMesh, k: keyof typeof n, x: number, y: number, z: number, yaw: number, sy: number, col: number | null, half: number[]) => { if (n[k] >= im.instanceMatrix.count) return;
      im.setMatrixAt(n[k], m4.compose(p.set(x, y, z), q.setFromAxisAngle(U, yaw), sc.set(1, sy, 1))); if (col !== null) im.setColorAt(n[k], new THREE.Color(col)); n[k]++; statics.push({ kind: 'box', half, pos: [x, y + half[1], z], friction: 0.7 } as any); };
    const CR = [0x6f7d55, 0x8b5a2b, 0x4f6a7a, 0x9a8a5c], DR = [0x2f5f8f, 0xb03a2e, 0x2e6b3f, 0x7a7a72, 0xc7a23a], CB = [0xd8d2c0, 0x7d8b6a, 0x3f6f9a];
    for (let x = -EXTENT - 250; x < EXTENT + 250; x += 26 + rr() * 30) { if (!clearOfPiers(x) || rr() < 0.25) continue; const z0 = rr() < 0.5 ? APRON_Z0 + 41 + rr() * 4 : QUAY_Z - 22 + rr() * 6;
      if ([-470, -390, 380, 460].some((cx) => Math.abs(x - cx) < 14) || Math.abs(x % 90) < 4 || Math.abs(x % 90) > 86) continue; // crane legs, mast bases
      const kind = rr(); if (kind < 0.12 && n.cab < 16) { put(cab, 'cab', x, 0, z0, rr() < 0.5 ? 0 : 0.08, 1, CB[Math.floor(rr() * CB.length)], [3, 1.3, 1.2]); continue; }
      for (let i = 0, m = 2 + Math.floor(rr() * 4); i < m; i++) { const h = 1 + Math.floor(rr() * 3); put(pal, 'pal', x + i * 1.35, 0, z0 + (rr() - 0.5) * 0.3, 0, h * 0.15, null, [0.6, h * 0.075, 0.5]); }
      for (let i = 0, m = Math.floor(rr() * 5); i < m; i++) { const cx = x + 6 + (i % 3) * 1.3, cz = z0 + Math.floor(i / 3) * 1.3; put(crate, 'crate', cx, 0, cz, (rr() - 0.5) * 0.2, 1, CR[Math.floor(rr() * CR.length)], [0.63, 0.63, 0.63]); if (rr() < 0.3) put(crate, 'crate', cx, 1.25, cz, rr() * 0.3, 1, CR[Math.floor(rr() * CR.length)], [0.63, 0.63, 0.63]); }
      for (let i = 0, m = Math.floor(rr() * 7); i < m; i++) put(drum, 'drum', x - 3 - (i % 4) * 0.65, 0, z0 + Math.floor(i / 4) * 0.65, 0, 1, DR[Math.floor(rr() * DR.length)], [0.3, 0.45, 0.3]); }
    for (const [im, k] of [[pal, 'pal'], [crate, 'crate'], [drum, 'drum'], [cab, 'cab']] as [THREE.InstancedMesh, keyof typeof n][]) { im.count = n[k]; im.castShadow = im.receiveShadow = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; S.add(im); }
  }
  /** Is (x,z) solid for a boat (quay, piers, beyond the map)? */
  blocked = (x: number, z: number) => z < QUAY_Z + 1.8 || Math.abs(x) > 4000 || z > 4800 || PIERS.some(([px, hw, ze]) => Math.abs(x - px) < hw + 1.3 && z < ze + 2.5);
  update(dt: number, night: number, t: number) {
    this.normals.offset.set((t * 0.011) % 1, (t * 0.017) % 1); this.wave2.value.set((-t * 0.019) % 1, (t * 0.008) % 1); this.headM.emissiveIntensity = night * 12;
    for (const m of this.moored) { m.o.position.y = m.base.y + Math.sin(t * 1.1 + m.t) * 0.06; m.o.rotation.z = Math.sin(t * 0.8 + m.t) * 0.02; m.o.rotation.x = Math.sin(t * 0.6 + m.t * 0.3) * 0.012; }
  }
}
