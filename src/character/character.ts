// Cast characters: Sketchfab/Mixamo-rigged bodies processed by tools/char_prep.mjs (assets/processed/chars/<id>[_lod1].glb
// + cast.json). Each instance gets its own skeleton clone, palette variant (clothing/hair tint by material role) and a
// clip cache bound to its rig. LOD1 (~6k tris, 512 textures) is the crowd body used by the Low/Medium tiers and mid range.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadBin, loadJSON } from '../core/assets';
import { loadBundle, rigOf, makeClip, type Rig } from '../animation/clips';
import type { Renderer } from '../renderer/renderer';

export interface CastEntry { sex: string; uid: string; height: number; lod0: { tris: number; kb: number }; lod1: { tris: number; kb: number }; mats: number; joints: number }
export interface CastRole { id: string; role: 'player' | 'civilian' | 'police' | 'tactical' | 'faction'; sex: 'm' | 'f' }
let cast: Promise<Record<string, CastEntry>> | null = null;
export const loadCast = () => (cast ??= loadJSON('chars/cast.json'));
const templates = new Map<string, Promise<THREE.Group>>();
/** Material role from its name: skin/eyes keep their texture, hair and clothing take palette tints. */
export function matRole(name: string): 'skin' | 'hair' | 'cloth' {
  const n = name.toLowerCase();
  if (/hair|beard|brow|lash|mustache|moustache/.test(n)) return 'hair';
  if (/body|skin|head|face|eye|teeth|tongue|mouth|hand(?!bag)|arm(?!o)|leg(?!ging)|cornea|iris/.test(n)) return 'skin';
  return 'cloth';
}
// clothing palettes: realistic, slightly desaturated street colours (multiplied over the albedo; white keeps the source)
const CLOTH = [0xffffff, 0xffffff, 0xd2dae8, 0xb8c4d6, 0xe6d6bc, 0xc8d8c0, 0xecc8c0, 0xc4c4cc, 0xdcc8a4, 0xa8b4c8, 0xd8b0b0, 0x9aa4b4, 0xb4a890];
const HAIR = [0xffffff, 0x3b2a1e, 0x1c1714, 0x6b4a2f, 0x9a7a50, 0x2a2420, 0x8a8580];
export const VARIANTS_PER_BODY = 4;

export class Character {
  root = new THREE.Group(); model!: THREE.Object3D; rig!: Rig; mixer!: THREE.AnimationMixer; height = 1.75;
  private clips = new Map<string, THREE.AnimationClip>(); actions = new Map<string, THREE.AnimationAction>();
  constructor(public R: Renderer, public id: string, public opts: { lod?: 0 | 1; variant?: number; shadows?: boolean } = {}) {}
  async load() {
    const lod = this.opts.lod ?? 0; const key = `${this.id}${lod ? '_lod1' : ''}`;
    if (!templates.has(key)) templates.set(key, loadBin(`chars/${key}.glb`).then((b) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b, '')).then((g) => this.prepTemplate(g.scene)));
    const tpl = await templates.get(key)!;
    this.model = SkeletonUtils.clone(tpl); this.applyVariant(this.opts.variant ?? 0);
    this.root.add(this.model); this.rig = rigOf(this.model); this.mixer = new THREE.AnimationMixer(this.model);
    this.height = (await loadCast())[this.id]?.height ?? 1.75;
    await this.fixFacing();
    return this;
  }
  private prepTemplate(s: THREE.Group) {
    s.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!m.isMesh) return; m.castShadow = this.opts.shadows ?? true; m.receiveShadow = true; m.frustumCulled = false;
      for (const mt of ([] as THREE.Material[]).concat(m.material)) { const s = mt as THREE.MeshStandardMaterial; if (!s.isMeshStandardMaterial) continue;
        s.emissive?.set(0); s.emissiveMap = null; s.metalness = Math.min(s.metalness, 0.1); s.roughness = Math.max(0.45, s.roughness);
        s.userData.role = matRole(s.name);
        // hair cards / lashes rely on albedo alpha even when exported OPAQUE: cutout (shadowed, no sorting)
        if ((s.transparent || s.userData.role === 'hair') && s.map) { s.transparent = false; s.depthWrite = true; s.alphaTest = 0.5; }
        if (s.alphaTest > 0) s.side = THREE.DoubleSide;
        this.R.setupMaterial(s); } });
    return s;
  }
  /** Palette variant: deterministic tints per clothing material and hair from the variant index. */
  applyVariant(v: number) {
    if (!v) return; let seed = v * 7919 + this.id.length * 104729; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tinted = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return;
      const swap = (mt: THREE.Material) => { const s = mt as THREE.MeshStandardMaterial; const role = s.userData.role; if (role === 'skin' || !s.isMeshStandardMaterial) return mt;
        if (!tinted.has(mt)) { const c = s.clone(); const pal = role === 'hair' ? HAIR : CLOTH; c.color.multiply(new THREE.Color(pal[Math.floor(rnd() * pal.length)]));
          c.userData = { ...s.userData }; this.R.setupMaterial(c); tinted.set(mt, c); }
        return tinted.get(mt)!; };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material); });
  }
  /** Some sources bind the hips with a yaw offset, so Mixamo clips turn them around: sample the idle pose and face the
   * model down +Z (toes ahead of ankles), then return to the bind pose. */
  private async fixFacing() {
    const c = await this.clip('core', 'standard_idle'); if (!c) return; const a = this.mixer.clipAction(c); a.play(); this.mixer.update(0);
    this.model.updateMatrixWorld(true); const v = new THREE.Vector3(); let z = 0;
    for (const side of ['Left', 'Right']) { const f = this.bone(side + 'Foot'), t = this.bone(side + 'ToeBase'); if (f && t) z += t.getWorldPosition(v).z - f.getWorldPosition(new THREE.Vector3()).z; }
    if (z < 0) this.model.rotation.y += Math.PI;
    a.stop(); this.mixer.uncacheAction(c);
  }
  clip(bundle: string, key: string, inPlaceXZ = true, removeYaw = false): Promise<THREE.AnimationClip | null> {
    const k = `${bundle}/${key}/${inPlaceXZ}/${removeYaw}`; const hit = this.clips.get(k); if (hit) return Promise.resolve(hit);
    return loadBundle(bundle).then((b) => { const c = makeClip(b, key, this.rig, { inPlaceXZ, removeYaw }); if (c) this.clips.set(k, c); return c; });
  }
  async action(bundle: string, key: string, opts: { loop?: boolean; inPlaceXZ?: boolean; removeYaw?: boolean; name?: string } = {}) {
    const k = opts.name ?? `${bundle}/${key}`; if (this.actions.has(k)) return this.actions.get(k)!;
    const c = await this.clip(bundle, key, opts.inPlaceXZ ?? true, opts.removeYaw ?? false); if (!c) throw new Error(`clip ${bundle}/${key} missing`);
    const a = this.mixer.clipAction(c); if (opts.loop === false) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    this.actions.set(k, a); return a;
  }
  bone(name: string) { const n = this.rig.bones.get(name); return n ? (this.model.getObjectByName(n) as THREE.Bone) : null; }
}
