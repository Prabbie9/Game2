// Weapon models + sockets (assets/processed/weapons, written by tools/weapon_prep.mjs). Model space: origin = primary
// grip, +Z forward, +Y up. Sockets: grip, support (foregrip), muzzle, sight, eject, mag.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadBin, loadJSON } from '../core/assets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dequantize } from '../vehicles/carvisual';
import type { Renderer } from '../renderer/renderer';

export interface WeaponMeta { name: string; kind: 'gun' | 'melee' | 'throw'; length: number; sockets: Record<'grip' | 'support' | 'muzzle' | 'sight' | 'eject' | 'mag', number[]> }
let metaP: Promise<Record<string, WeaponMeta>> | null = null;
export const weaponMeta = () => (metaP ??= loadJSON('weapons/weapons.json'));
const tpl = new Map<string, Promise<THREE.Object3D>>();
export async function weaponModel(R: Renderer, id: string) {
  if (!tpl.has(id)) tpl.set(id, loadBin(`weapons/${id}.glb`).then((b) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b, '')).then((g) => {
    g.scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true; for (const mt of ([] as THREE.Material[]).concat(m.material)) { const s = mt as THREE.MeshStandardMaterial; s.emissive?.set(0); R.setupMaterial(s); } });
    return g.scene; }));
  return (await tpl.get(id)!).clone(true);
}
const leanTpl = new Map<string, Promise<THREE.Object3D>>();
/** AI-held copy with few draws: textured parts merged per material, untextured parts (flat-colour materials; the rifle
 * has 11) merged into one vertex-coloured mesh with the parts' average roughness/metalness. The player keeps the full model. */
export async function weaponModelLean(R: Renderer, id: string) {
  if (!leanTpl.has(id)) leanTpl.set(id, weaponModel(R, id).then((src) => {
    src.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(src.matrixWorld).invert(); const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>(); const flat: THREE.BufferGeometry[] = [];
    let rw = 0, rs = 0, ms = 0, twoSided = false;
    src.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const mat = m.material as THREE.MeshStandardMaterial;
      let g = dequantize(m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (mat.map) { (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(g); return; }
      const n = g.attributes.position.count; const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set([mat.color.r, mat.color.g, mat.color.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv');
      rw += n; rs += mat.roughness * n; ms += mat.metalness * n; twoSided ||= mat.side === THREE.DoubleSide; flat.push(g); });
    const out = new THREE.Group(); out.name = id + '_lean';
    for (const [mat, gs] of byMat) out.add(Object.assign(new THREE.Mesh(mergeGeometries(gs), mat), { castShadow: true, receiveShadow: true }));
    if (flat.length) { const mat = R.setupMaterial(new THREE.MeshStandardMaterial({ name: id + '_flat', vertexColors: true, roughness: rs / rw, metalness: ms / rw, side: twoSided ? THREE.DoubleSide : THREE.FrontSide }));
      out.add(Object.assign(new THREE.Mesh(mergeGeometries(flat), mat), { castShadow: true, receiveShadow: true })); }
    return out; }));
  return (await leanTpl.get(id)!).clone(true);
}
/** Debug: small coloured spheres at every socket (child of the weapon root). */
export function socketGizmos(meta: WeaponMeta) {
  const g = new THREE.Group(); const col: Record<string, number> = { grip: 0xff3030, support: 0x30ff30, muzzle: 0x3080ff, sight: 0xffff30, eject: 0xff30ff, mag: 0x30ffff };
  for (const [k, p] of Object.entries(meta.sockets)) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: col[k], depthTest: false })); m.position.fromArray(p); m.renderOrder = 10; g.add(m); }
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3().fromArray(meta.sockets.muzzle), new THREE.Vector3().fromArray(meta.sockets.muzzle).add(new THREE.Vector3(0, 0, 0.6))]), new THREE.LineBasicMaterial({ color: 0x3080ff, depthTest: false })); g.add(ray);
  return g;
}
