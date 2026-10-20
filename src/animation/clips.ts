// Animation bundles (assets/processed/anim/<bundle>.json + .bin, written by tools/ingest_clips.mjs) -> THREE.AnimationClips
// bound to any Mixamo-rigged character by bare bone name ("mixamorig12:Hips", "mixamorigHips", "Hips" all match "Hips").
import * as THREE from 'three';
import { loadBin, loadJSON } from '../core/assets';
export interface ClipMeta { key: string; name: string; frames: number; fps: number; duration: number; loop: boolean; inPlace: boolean; speed: number; dir: number[]; rootDist: number; yaw: number; bones: number[]; rotOffset: number; posOffset: number }
export interface Bundle { bundle: string; bones: string[]; clips: ClipMeta[]; bin: ArrayBuffer }
const bundles = new Map<string, Promise<Bundle>>();
export const bareBone = (n: string) => n.replace(/^.*mixamorig\d*[:_]?/i, '').replace(/^.*:/, '');
export function loadBundle(name: string): Promise<Bundle> {
  if (!bundles.has(name)) bundles.set(name, Promise.all([loadJSON(`anim/${name}.json`), loadBin(`anim/${name}.bin`)]).then(([j, bin]) => ({ ...j, bin })));
  return bundles.get(name)!;
}
/** Map bare bone name -> actual bone node name in a character skeleton. */
export function boneMap(root: THREE.Object3D) { const m = new Map<string, string>(); root.traverse((o) => { if ((o as THREE.Bone).isBone) m.set(bareBone(o.name), o.name); }); return m; }
/** Retarget info for a character: hips height in root space (metres) and the hips' parent transform relative to the
 * character root. Clips are authored with an identity, Y-up, metre-scaled hips parent; rigs exported with a rotated /
 * centimetre armature (e.g. three.js Michelle: Rx(90deg), scale 0.01) need hips tracks converted into parent-local space. */
export interface Rig { bones: Map<string, string>; hipsHeight: number; parentInv: THREE.Matrix4; parentQInv: THREE.Quaternion }
export function rigOf(root: THREE.Object3D): Rig {
  const bones = boneMap(root); const hips = root.getObjectByName(bones.get('Hips')!)!; root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parentRel = new THREE.Matrix4().multiplyMatrices(rootInv, hips.parent!.matrixWorld);
  const hipsRel = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(rootInv, hips.matrixWorld));
  const pq = new THREE.Quaternion(); parentRel.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
  return { bones, hipsHeight: hipsRel.y, parentInv: parentRel.clone().invert(), parentQInv: pq.invert() };
}
/** Build a clip for a rig. The hips track is stored normalised by rest hips height and rescaled to this rig. */
export function makeClip(b: Bundle, key: string, rig: Rig, opts: { inPlaceXZ?: boolean } = {}): THREE.AnimationClip | null {
  const bones = rig.bones;
  const c = b.clips.find((x) => x.key === key); if (!c) return null;
  const q = new Int16Array(b.bin, c.rotOffset, c.frames * c.bones.length * 4); const p = new Float32Array(b.bin, c.posOffset, c.frames * 3);
  const times = new Float32Array(c.frames); for (let i = 0; i < c.frames; i++) times[i] = i / c.fps;
  const tracks: THREE.KeyframeTrack[] = [];
  c.bones.forEach((bi, j) => { const node = bones.get(b.bones[bi]); if (!node) return;
    const v = new Float32Array(c.frames * 4); for (let i = 0; i < c.frames; i++) for (let k = 0; k < 4; k++) v[i * 4 + k] = q[(i * c.bones.length + j) * 4 + k] / 32767;
    if (b.bones[bi] === 'Hips') { const t = new THREE.Quaternion(); for (let i = 0; i < c.frames; i++) { t.fromArray(v, i * 4).normalize().premultiply(rig.parentQInv); t.toArray(v, i * 4); } }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, v)); });
  const hips = bones.get('Hips');
  if (hips) { const v = new Float32Array(c.frames * 3); const t = new THREE.Vector3(); const h = rig.hipsHeight;
    for (let i = 0; i < c.frames; i++) { t.set(opts.inPlaceXZ ? 0 : p[i * 3] * h, p[i * 3 + 1] * h, opts.inPlaceXZ ? 0 : p[i * 3 + 2] * h).applyMatrix4(rig.parentInv); t.toArray(v, i * 3); }
    tracks.push(new THREE.VectorKeyframeTrack(`${hips}.position`, times, v)); }
  const clip = new THREE.AnimationClip(key, c.duration, tracks); (clip as any).meta = c; return clip;
}
