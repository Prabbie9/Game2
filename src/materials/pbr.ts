// PBR material library: KTX2 sets from assets/processed/tex/<slot>/ (albedo, normal, ORM) at 2k (High/Ultra) or 1k,
// with a world-space shader patch providing: anti-tiling (IQ-style hashed tile offsets), low-frequency grime/variation,
// world-scale triplanar-free UVs (box-mapped by the caller), and the shared wet-surface/puddle response.
import * as THREE from 'three';
import { loadKTX2 } from '../core/assets';
import { WORLD_UNIFORMS } from '../lighting/environment';

export interface SurfaceOpts { antiTile?: boolean; grime?: number; puddles?: number; wet?: boolean; tint?: THREE.ColorRepresentation; roughness?: number; metalness?: number; normalScale?: number; aoIntensity?: number; uvScale?: number }
let texRes: '2k' | '1k' = '2k';
export function setTextureRes(r: '2k' | '1k') { texRes = r; }

const ANTI = `
vec4 hlHash4(vec2 p){ return fract(sin(vec4(1.0 + dot(p, vec2(37.0, 17.0)), 2.0 + dot(p, vec2(11.0, 47.0)), 3.0 + dot(p, vec2(41.0, 29.0)), 4.0 + dot(p, vec2(23.0, 31.0)))) * 103.0); }
// IQ "texture repetition" (variant 1): blend 4 randomly offset/flipped tiles; keeps derivatives for mip selection.
vec4 hlTex(sampler2D s, vec2 uv){
  vec2 iuv = floor(uv), fuv = fract(uv); vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 ofa = hlHash4(iuv + vec2(0,0)), ofb = hlHash4(iuv + vec2(1,0)), ofc = hlHash4(iuv + vec2(0,1)), ofd = hlHash4(iuv + vec2(1,1));
  ofa.zw = sign(ofa.zw - 0.5); ofb.zw = sign(ofb.zw - 0.5); ofc.zw = sign(ofc.zw - 0.5); ofd.zw = sign(ofd.zw - 0.5);
  vec2 uva = uv * ofa.zw + ofa.xy, ddxa = dx * ofa.zw, ddya = dy * ofa.zw; vec2 uvb = uv * ofb.zw + ofb.xy, ddxb = dx * ofb.zw, ddyb = dy * ofb.zw;
  vec2 uvc = uv * ofc.zw + ofc.xy, ddxc = dx * ofc.zw, ddyc = dy * ofc.zw; vec2 uvd = uv * ofd.zw + ofd.xy, ddxd = dx * ofd.zw, ddyd = dy * ofd.zw;
  vec2 b = smoothstep(0.25, 0.75, fuv);
  return mix(mix(textureGrad(s, uva, ddxa, ddya), textureGrad(s, uvb, ddxb, ddyb), b.x), mix(textureGrad(s, uvc, ddxc, ddyc), textureGrad(s, uvd, ddxd, ddyd), b.x), b.y);
}`;
const NOISE = `
float hlHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hlNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hlHash(i), hlHash(i+vec2(1,0)), f.x), mix(hlHash(i+vec2(0,1)), hlHash(i+vec2(1,1)), f.x), f.y); }
float hlFbm(vec2 p){ return hlNoise(p) * 0.5 + hlNoise(p * 2.03) * 0.3 + hlNoise(p * 4.1) * 0.2; }`;

/** Shader patch for world surfaces. Chained after CSM by Renderer.setupMaterial via userData.patch. */
export function surfacePatch(m: THREE.MeshStandardMaterial, o: SurfaceOpts) {
  const anti = !!o.antiTile, grime = o.grime ?? 0.35, pud = o.puddles ?? 0, wet = o.wet !== false;
  m.userData.patchKey = `surf${+anti}${grime}${pud}${+wet}`;
  m.userData.patch = (sh: any) => {
    Object.assign(sh.uniforms, { uWetness: WORLD_UNIFORMS.uWetness, uRain: WORLD_UNIFORMS.uRain, uTime: WORLD_UNIFORMS.uTime });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    let f = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform float uWetness; uniform float uRain; uniform float uTime;\n${ANTI}\n${NOISE}`);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float hlG = hlFbm(vWPos.xz * 0.06 + vWPos.y * 0.03); float hlG2 = hlNoise(vWPos.xz * 0.9 + vWPos.y * 0.7);
      diffuseColor.rgb *= mix(1.0 - ${grime.toFixed(2)} * 0.45, 1.0 + ${grime.toFixed(2)} * 0.12, hlG) * mix(0.94, 1.03, hlG2);
      roughnessFactor = clamp(roughnessFactor * mix(0.92, 1.08, hlG), 0.04, 1.0);
      ${wet ? `float hlUp = smoothstep(0.6, 0.95, vWNrm.y);
      float hlP = hlFbm(vWPos.xz * 0.09) ;
      float hlPud = ${pud > 0 ? `smoothstep(0.62 - 0.1 * ${pud.toFixed(2)}, 0.7 - 0.08 * ${pud.toFixed(2)}, hlP) * hlUp * uWetness` : '0.0'};
      float hlWet = uWetness * mix(0.45, 1.0, hlUp);
      diffuseColor.rgb *= mix(1.0, 0.5, hlWet * 0.85) * mix(1.0, 0.7, hlPud);
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35 + 0.05, hlWet); roughnessFactor = mix(roughnessFactor, 0.02, hlPud);` : ''}`);
    if (wet && pud > 0) f = f.replace('#include <normal_fragment_maps>', (mm: string) => `${mm}
      { float hlUp2 = smoothstep(0.6, 0.95, vWNrm.y); float pd = smoothstep(0.55, 0.64, hlFbm(vWPos.xz * 0.09)) * hlUp2 * uWetness;
        vec2 cell = floor(vWPos.xz * 1.7); vec2 fr = fract(vWPos.xz * 1.7) - 0.5; float ph = fract(uTime * 1.2 + hlHash(cell)); float rr = length(fr);
        float ring = sin((rr - ph * 0.45) * 46.0) * (1.0 - ph) * smoothstep(0.45 * ph + 0.07, 0.45 * ph, rr) * uRain;
        normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, pd * 0.9));
        normal = normalize(normal + (viewMatrix * vec4(fr.x, 0.0, fr.y, 0.0)).xyz * ring * 0.3 * pd); }`);
    // anti-tiling last: inline the chunks with texture2D -> hlTex (after the wet/puddle code has attached to the include tokens)
    if (anti) {
      const sub = (chunk: string) => (THREE.ShaderChunk as any)[chunk].replace(/texture2D\(\s*(map|normalMap|roughnessMap|metalnessMap|aoMap)\s*,/g, 'hlTex( $1,');
      for (const c of ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment', 'metalnessmap_fragment', 'aomap_fragment']) f = f.replace(`#include <${c}>`, sub(c));
    }
    sh.fragmentShader = f;
  };
  return m;
}

const lib = new Map<string, THREE.MeshStandardMaterial>();
/** Get (or create) a PBR material for a texture slot; textures stream in asynchronously. */
export function pbr(slot: string, o: SurfaceOpts = {}, key = ''): THREE.MeshStandardMaterial {
  const k = slot + key; if (lib.has(k)) return lib.get(k)!;
  // until textures stream in: neutral dielectric grey (never a white mirror)
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.tint ?? 0xffffff).multiplyScalar(0.35), roughness: 0.85, metalness: 0 });
  m.normalScale.setScalar(o.normalScale ?? 1); m.aoMapIntensity = o.aoIntensity ?? 1;
  const base = `tex/${slot}/`;
  // each map applies as soon as it arrives; ORM drives roughness (G), metalness (B) and AO (R)
  loadKTX2(base + `albedo_${texRes}.ktx2`, true).then((a) => { m.map = a; m.color.set(o.tint ?? 0xffffff); m.needsUpdate = true; }).catch(() => console.warn('albedo missing', slot));
  loadKTX2(base + `normal_${texRes}.ktx2`, false).then((n) => { m.normalMap = n; m.needsUpdate = true; }).catch(() => console.warn('normal missing', slot));
  loadKTX2(base + `orm_${texRes}.ktx2`, false).then((orm) => { m.roughnessMap = orm; m.metalnessMap = orm; m.aoMap = orm; m.roughness = o.roughness ?? 1; m.metalness = o.metalness ?? 1; m.needsUpdate = true; }).catch(() => console.warn('orm missing', slot));
  surfacePatch(m, o); lib.set(k, m); return m;
}
