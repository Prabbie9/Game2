// Weapon models + sockets (assets/processed/weapons, written by tools/weapon_prep.mjs). Model space: origin = primary
// grip, +Z forward, +Y up. Sockets: grip, support (foregrip), muzzle, sight, eject, mag.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadBin, loadJSON } from '../core/assets';
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
/** Debug: small coloured spheres at every socket (child of the weapon root). */
export function socketGizmos(meta: WeaponMeta) {
  const g = new THREE.Group(); const col: Record<string, number> = { grip: 0xff3030, support: 0x30ff30, muzzle: 0x3080ff, sight: 0xffff30, eject: 0xff30ff, mag: 0x30ffff };
  for (const [k, p] of Object.entries(meta.sockets)) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: col[k], depthTest: false })); m.position.fromArray(p); m.renderOrder = 10; g.add(m); }
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3().fromArray(meta.sockets.muzzle), new THREE.Vector3().fromArray(meta.sockets.muzzle).add(new THREE.Vector3(0, 0, 0.6))]), new THREE.LineBasicMaterial({ color: 0x3080ff, depthTest: false })); g.add(ray);
  return g;
}
