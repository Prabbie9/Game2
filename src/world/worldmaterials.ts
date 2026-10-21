// Material library for kit keys (main thread). One shared material per key, created lazily; night-driven emissives
// (lamp heads, signs, far-LOD windows, traffic lights) are updated centrally in update().
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import { pbr } from '../materials/pbr';
import { interiorGlass } from './buildings';
import { WORLD_UNIFORMS } from '../lighting/environment';

const SIGN_COLS = [0xff3d6e, 0x37d7ff, 0xffb238, 0x9dff6a, 0xff7a2e];
export class WorldMaterials {
  private m = new Map<string, THREE.Material>(); night: THREE.MeshStandardMaterial[] = []; signs: THREE.MeshStandardMaterial[] = []; far: THREE.MeshStandardMaterial[] = [];
  tl: Record<string, THREE.MeshStandardMaterial> = {};
  constructor(public R: Renderer) {
    for (const axis of [0, 1]) for (const c of ['r', 'a', 'g']) this.tl[`${c}${axis}`] = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c === 'r' ? 0xff2a1a : c === 'a' ? 0xffa21a : 0x2dff7a, emissiveIntensity: 0.1 });
  }
  get(key: string): THREE.Material { let x = this.m.get(key); if (!x) { x = this.make(key); this.m.set(key, x); } return x; }
  private make(key: string): THREE.Material {
    const R = this.R; const S = <T extends THREE.Material>(m: T) => R.setupMaterial(m);
    if (key.startsWith('wall_')) { const [, style] = key.split('_'); const m = pbr(style === 'brick' ? 'brick' : style === 'concrete' ? 'concrete' : 'plaster', { grime: 0.5, aoIntensity: 0.8 }, key); m.vertexColors = true; return S(m); } // per-building tint comes from the vertex colour
    if (key.startsWith('sign_')) { const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: SIGN_COLS[+key.slice(5) % 5], emissiveIntensity: 1, roughness: 0.4 }); this.signs.push(m); return m; }
    if (key === 'far') return S(this.farMat());
    switch (key) {
      case 'asphalt': return S(pbr('asphalt', { antiTile: true, grime: 0.55, puddles: 1, normalScale: 1.1 }, 'road'));
      case 'walk': return S(pbr('sidewalk', { antiTile: true, grime: 0.6, puddles: 0.45 }, 'walk'));
      case 'kerb': return S(pbr('kerb', { grime: 0.5, tint: 0xcfcac2, puddles: 0.2 }, 'kerbstone'));
      case 'tiles': return S(pbr('tiles', { antiTile: true, grime: 0.4, puddles: 0.6 }, 'plaza'));
      case 'concrete': return S(pbr('concrete', { grime: 0.6, tint: 0xc8c3ba, puddles: 0.3 }, 'struct'));
      case 'trim': return S(pbr('concrete', { grime: 0.5, tint: 0xd8d2c8 }, 'trim'));
      case 'roof': return S(pbr('gravel', { grime: 0.3 }, 'roof'));
      case 'rooftop': return S(pbr('metal', { grime: 0.6, tint: 0xb8bcc0, roughness: 0.8 }, 'rooftop'));
      case 'awning': return S(pbr('fabric', { grime: 0.3, tint: 0x7a2f2a, metalness: 0 }, 'awn'));
      case 'pole': return S(pbr('metal', { grime: 0.4, tint: 0x3a3e44, roughness: 0.6 }, 'pole'));
      case 'furn': return S(pbr('metal', { grime: 0.5, tint: 0x2d3136, roughness: 0.7 }, 'furn'));
      case 'iron': return S(pbr('rust', { grime: 0.3, tint: 0x6a6460, puddles: 0 }, 'iron'));
      case 'bench': return S(pbr('wood', { grime: 0.4, tint: 0xa07a52, metalness: 0 }, 'bench'));
      case 'bark': return S(pbr('wood', { grime: 0.5, tint: 0x6b5a4a, metalness: 0 }, 'bark'));
      case 'hydrant': return S(new THREE.MeshStandardMaterial({ color: 0xb3221b, roughness: 0.5, metalness: 0.3 }));
      case 'tar': return S(new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.35, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      case 'litter': return S(new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
      case 'paint': case 'paintY': { const m = S(pbr('concrete', { grime: 0.2, tint: key === 'paint' ? 0xf0ede4 : 0xe2b23a, puddles: 0.5, roughness: 0.7 }, key)); m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; return m; }
      case 'lamphead': { const m = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, emissive: 0xffd9a8, emissiveIntensity: 0, roughness: 0.3 }); this.night.push(m); return m; }
      case 'frame_tower': return S(new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.4, metalness: 0.9 }));
      case 'frame_std': return S(new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.45, metalness: 0.2 }));
      case 'glass_std': return interiorGlass(R, [2.2, 3.4], 4.5, false);
      case 'glass_tower': return interiorGlass(R, [1.6, 3.8], 6, true);
      case 'glass_shop': return interiorGlass(R, [5.5, 4.6], 7, false, true);
      case 'glass_shelter': return S(new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false }));
      case 'water': return S(new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.03, metalness: 0.1, envMapIntensity: 1.5 }));
      case 'leaf': case 'leafInner': return this.leafMat(key === 'leafInner');
    }
    return S(new THREE.MeshStandardMaterial({ color: 0xff00ff }));
  }
  private leafMat(inner: boolean) {
    if (inner) return this.R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x1f2c14, roughness: 0.95 }));
    const lc = document.createElement('canvas'); lc.width = lc.height = 256; const lg = lc.getContext('2d')!; let s = 7; const lr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) { const x = lr() * 256, y = lr() * 256, a = lr() * Math.PI, l = 7 + lr() * 9; lg.fillStyle = `hsl(${88 + lr() * 34},${38 + lr() * 25}%,${20 + lr() * 22}%)`; lg.beginPath(); lg.ellipse(x, y, l, l * 0.42, a, 0, Math.PI * 2); lg.fill(); }
    const t = new THREE.CanvasTexture(lc); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = this.R.setupMaterial(new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8d8b0 }));
    m.userData.patchKey = 'leafwind'; m.userData.patch = (sh: any) => { sh.uniforms.uTime = WORLD_UNIFORMS.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp0 = modelMatrix * vec4(transformed, 1.0); float sway = sin(uTime * 1.6 + wp0.x * 0.4 + wp0.z * 0.3) * 0.06 + sin(uTime * 4.7 + wp0.y * 2.0 + wp0.x) * 0.025; transformed.xz += vec2(sway, sway * 0.6) * max(0.0, transformed.y - 3.0);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.12;'); };
    return m;
  }
  /** Far LOD massing: facade colour + window grid (emissive at night). */
  private farMat() {
    // shared window-grid texture (white = wall, dark = glass); vertex colour carries the facade tint
    const wc = document.createElement('canvas'); wc.width = 64; wc.height = 128; const wg = wc.getContext('2d')!; let s = 77; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const tower = false; wg.fillStyle = '#b4b0aa'; wg.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) { wg.fillStyle = r() < 0.15 ? '#5a6068' : '#262b31'; wg.fillRect(x * 8 + 1, y * 4 + 1, 6, 2); }
    const ec = document.createElement('canvas'); ec.width = 64; ec.height = 128; const eg = ec.getContext('2d')!; eg.fillStyle = '#000'; eg.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) if (r() < 0.4) { eg.fillStyle = `hsl(${32 + r() * 20},60%,${35 + r() * 30}%)`; eg.fillRect(x * 8 + 2, y * 4 + 1, 4, 2); }
    const mk = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
    const m = new THREE.MeshStandardMaterial({ map: mk(wc), vertexColors: true, roughness: tower ? 0.25 : 0.75, metalness: 0, emissive: 0xffd8a8, emissiveMap: mk(ec), emissiveIntensity: 0 });
    this.far.push(m); return m;
  }
  update(night: number, phase: (axis: number) => string) {
    for (const m of this.night) m.emissiveIntensity = night * 16; for (const m of this.signs) m.emissiveIntensity = 0.7 + night * 4; for (const m of this.far) m.emissiveIntensity = night * 1.4;
    for (const k in this.tl) this.tl[k].emissiveIntensity = phase(+k[1]) === k[0] ? 9 : 0.08;
  }
}
