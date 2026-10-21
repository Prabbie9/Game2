// Visual for a sourced vehicle processed by tools/vehicle_prep.py (GLB + JSON metadata). Same interface as CarVisual:
// wheel pivots/spin groups, lights (head, brake, reverse, blinkers) driven by part names, clearcoat paint, tuned glass.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadBin, loadJSON } from '../core/assets';
import type { Renderer } from '../renderer/renderer';
import type { VehState } from '../physics/client';
import { mergeByMaterial, dequantize } from './carvisual';

export interface VehicleMeta { name: string; length: number; width: number; height: number; wheels: { name: string; center: number[]; radius: number; width: number }[]; parts: string[]; faces: number }
const models = new Map<string, Promise<{ scene: THREE.Group; meta: VehicleMeta }>>();
let _contact: THREE.MeshBasicMaterial | null = null;
function contactMat() {
  if (_contact) return _contact; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_contact = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
}
function loadModel(name: string, lod = 0) {
  const key = name + lod;
  if (!models.has(key)) models.set(key, Promise.all([loadBin(`vehicles/${name}${lod ? '_lod' + lod : ''}.glb`), loadJSON<VehicleMeta>(`vehicles/${name}.json`)]).then(async ([buf, meta]) => ({ scene: (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '')).scene, meta })));
  return models.get(key)!;
}
/** Physics geometry for a prepped model (feeds the vehicle tuning: track, wheelbase, radius, chassis box). */
export function geometryFromMeta(m: VehicleMeta, wheelY = -0.18) {
  const fl = m.wheels.find((w) => w.name === 'FL')!, rl = m.wheels.find((w) => w.name === 'RL')!, fr = m.wheels.find((w) => w.name === 'FR')!;
  return { track: +(fl.center[0] - fr.center[0]).toFixed(3), wheelbase: +(fl.center[2] - rl.center[2]).toFixed(3), wheelRadius: fl.radius, wheelWidth: fl.width,
    frontOffset: +((fl.center[2] + rl.center[2]) / 2).toFixed(3), halfExtents: [+(m.width / 2 - 0.06).toFixed(3), 0.42, +(m.length / 2 - 0.08).toFixed(3)], wheelY, wheelCenterY: fl.center[1] };
}

let FAR_MAT: THREE.MeshStandardMaterial | undefined; const avgCache = new Map<THREE.Texture, THREE.Color>();
/** Average colour of a texture (8x8 downsample), cached; white when unavailable. */
function avgColor(t: THREE.Texture | null | undefined) { if (!t || !t.image) return new THREE.Color(1, 1, 1); const hit = avgCache.get(t); if (hit) return hit;
  let c = new THREE.Color(1, 1, 1); try { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const g = cv.getContext('2d')!; g.drawImage(t.image as CanvasImageSource, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    c = new THREE.Color().setRGB(r / 64 / 255, gg / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace); } catch { /* unreadable image */ } avgCache.set(t, c); return c; }
export class SourcedCar {
  root = new THREE.Group(); body = new THREE.Group(); wheels: { pivot: THREE.Group; spin: THREE.Group }[] = []; ready = false;
  lights: { head: THREE.MeshStandardMaterial[]; brake: THREE.MeshStandardMaterial[]; reverse: THREE.MeshStandardMaterial[]; blink: THREE.MeshStandardMaterial[] } = { head: [], brake: [], reverse: [], blink: [] };
  beams: THREE.SpotLight[] = []; braking = 0; lightsOn = false; geo!: ReturnType<typeof geometryFromMeta>; restSusp = 0.25; modelSpace: THREE.Object3D = this.body; seat?: THREE.Vector3; door?: THREE.Vector3; // driver H-point / door stand point in model space (derived from the model size) // model space: origin on the ground, +Z forward, +X = driver side
  constructor(public R: Renderer, public model: string, public opts: { paint?: number; beams?: boolean; frozen?: boolean; lod?: number; seatFront?: number; farLod?: boolean } = {}) { this.root.add(this.body); }
  async load() {
    const { scene, meta } = await loadModel(this.model, this.opts.lod ?? 0); const R = this.R; this.geo = geometryFromMeta(meta);
    { const hw = meta.width / 2, z = meta.length / 2 - (this.opts.seatFront ?? 2.5); this.seat = new THREE.Vector3(hw * 0.41, 0.5 + Math.max(0, meta.height - 1.36) * 0.45, z); this.door = new THREE.Vector3(hw + 0.42, 0, z + 0.23); }
    const src = scene.clone(true); const mats = new Map<any, THREE.Material>();
    const conv = (m: THREE.MeshStandardMaterial, nodeName: string) => {
      const key = m; const role = /glass|window|windshield/i.test(nodeName) ? 'glass' : /bodymat/i.test(m.name + nodeName) && !/inner|bottom/i.test(nodeName) ? 'paint'
        : /headlights(?!_glass)/i.test(nodeName) ? 'head' : /brakelights|taillights(?!_glass)/i.test(nodeName) ? 'brake' : /reverse/i.test(nodeName) ? 'reverse' : /blinker/i.test(nodeName) ? 'blink' : 'other';
      const ck = role === 'other' || role === 'paint' ? key : (role + ':' + (m.uuid)) as any; if (mats.has(ck)) return mats.get(ck)!; // every role is cached per source material, so meshes sharing a material merge into one draw
      let out: THREE.MeshStandardMaterial;
      if (role === 'paint') { const p = new THREE.MeshPhysicalMaterial({ map: m.map, color: this.opts.paint ?? 0xffffff, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, normalMap: m.normalMap }); out = p; }
      else if (role === 'glass') { out = m.clone(); Object.assign(out, { transparent: true, opacity: 0.5, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.6, depthWrite: false }); out.color.multiplyScalar(0.4); }
      else if (role !== 'other') { out = m.clone(); out.emissive = new THREE.Color(role === 'brake' ? 0xff1a0e : role === 'blink' ? 0xffa21a : 0xfff4e0); out.emissiveMap = m.map; out.emissiveIntensity = 0.2; (this.lights as any)[role].push(out); }
      else { out = m.clone(); out.roughness = Math.max(out.roughness, 0.35); }
      R.setupMaterial(out); mats.set(ck, out); return out;
    };
    src.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { me.material = conv(me.material as THREE.MeshStandardMaterial, me.name); me.castShadow = !(me.material as any).transparent; me.receiveShadow = true; } });
    // body offset: physics chassis centre sits above the ground; wheel hard points are at wheelY, sagged by rest suspension
    const bodyY = this.geo.wheelY - this.restSusp - this.geo.wheelCenterY;
    for (const w of meta.wheels) {
      const mesh = src.getObjectByName('wheel_' + w.name)!; const pivot = new THREE.Group(), spin = new THREE.Group(); spin.name = 'wheel_spin_' + w.name; // name keeps dents off merged wheel meshes
      pivot.position.set(w.center[0], w.center[1] + bodyY, w.center[2]); mesh.position.x -= w.center[0]; mesh.position.y -= w.center[1]; mesh.position.z -= w.center[2]; /* keeps any packing offset on the node (meshopt quantisation) */ spin.add(mesh); pivot.add(spin); this.root.add(pivot); this.wheels.push({ pivot, spin });
    }
    src.position.y = bodyY; this.body.add(src); this.modelSpace = src;
    // contact shadow: soft dark blob under the chassis grounds the car where cascaded shadows are too coarse
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(meta.width * 1.25, meta.length * 1.12), contactMat()); blob.rotation.x = -Math.PI / 2; blob.position.y = bodyY + 0.02; blob.renderOrder = 2; this.body.add(blob);
    if (this.opts.beams) for (const x of [-1, 1]) { const b = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.6); b.position.set(x * 0.6, 0.6 + bodyY, meta.length / 2 - 0.1); b.target.position.set(x * 0.9, -0.6 + bodyY, 22); this.body.add(b, b.target); this.beams.push(b); }
    if (this.opts.frozen) { mergeByMaterial(this.root); this.wheels = []; }
    else { mergeByMaterial(this.body); for (const w of this.wheels) mergeByMaterial(w.spin); } // wheels: one mesh per material per wheel (they were 10+ sub-meshes each)
    // Lite/Low: each shadow-casting mesh is re-drawn per cascade, so only the largest body mesh casts (parked cars: none; the contact blob grounds them)
    if (/^(Lite|Low)$/.test(R.tier.name)) { let big: THREE.Mesh | null = null, n = 0; this.root.traverse((o) => { const me = o as THREE.Mesh; if (!me.isMesh || me.renderOrder === 2) return; const c = me.geometry.attributes.position.count; if (c > n && !(me.material as any).transparent) { n = c; big = me; } me.castShadow = false; });
      if (big && !this.opts.frozen) (big as THREE.Mesh).castShadow = true; }
    if (!this.opts.frozen && this.opts.farLod) this.buildFar();
    this.ready = true; this.setLights(this.lightsOn); return this;
  }
  /** Far LOD: every opaque body + wheel mesh merged into one vertex-coloured mesh (material colour x average texture colour). */
  far: THREE.Mesh | null = null; isFar = false;
  private buildFar() { this.root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert(); const geos: THREE.BufferGeometry[] = [];
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || m.renderOrder === 2) return; const mat = m.material as THREE.MeshStandardMaterial; if (Array.isArray(mat) || mat.transparent) return;
      const g = dequantize(m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); const keep = ['position', 'normal']; for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      const c = mat.color.clone().multiply(avgColor(mat.map)); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); geos.push(g.index ? g.toNonIndexed() : g); });
    const g = mergeGeometries(geos); if (!g) return; this.far = new THREE.Mesh(g, FAR_MAT ??= this.R.setupMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }))); this.far.visible = false; this.far.castShadow = false; this.root.add(this.far); }
  /** Swap to/from the far LOD (wheels and body hidden while far). */
  setFar(on: boolean) { if (!this.far || on === this.isFar) return; this.isFar = on; this.far.visible = on; this.body.visible = !on; for (const w of this.wheels) w.pivot.visible = !on; }
  setLights(on: boolean) { this.lightsOn = on; for (const b of this.beams) b.intensity = on ? 60 : 0; for (const m of this.lights.head) m.emissiveIntensity = on ? 7 : 0.2; for (const m of this.lights.brake) m.emissiveIntensity = (on ? 2 : 0.3) + this.braking * 10; }
  update(s: VehState, braking: number, reversing = false) {
    this.root.position.set(s.pos[0], s.pos[1], s.pos[2]); this.root.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
    if (!this.ready) return;
    s.wheels.forEach((w, i) => { const v = this.wheels[i]; if (!v) return; v.pivot.position.y = this.geo.wheelY - w.susp; v.pivot.rotation.y = w.steer; v.spin.rotation.x = w.rot; });
    this.braking += (braking - this.braking) * 0.3; for (const m of this.lights.brake) m.emissiveIntensity = (this.lightsOn ? 2 : 0.3) + this.braking * 10;
    for (const m of this.lights.reverse) m.emissiveIntensity = reversing ? 5 : 0.1;
  }
}
