// Surface materials. M1: procedural canvas textures (replaced by sourced PBR sets in M2) + a shared
// wet-surface patch: darker albedo, lower roughness, noise-driven puddles on upward-facing surfaces, rain ripples.
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../lighting/environment';

const rand = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, n: number) => void, srgb = true, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!; draw(g, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t;
}
/** Height-noise canvas -> tangent-space normal map. */
function normalFromNoise(size: number, seed: number, scale: number, strength: number) {
  const r = rand(seed); const h = new Float32Array(size * size);
  for (let o = 1; o <= 4; o++) { const cells = 8 * 2 ** o, amp = 1 / o; const grid = Array.from({ length: (cells + 1) ** 2 }, r);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const gx = (x / size) * cells, gy = (y / size) * cells, ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
      const g = (a: number, b: number) => grid[(b % cells) * (cells + 1) + (a % cells)];
      h[y * size + x] += amp * ((g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy); } }
  for (let i = 0; i < h.length; i++) h[i] += (r() - 0.5) * scale;
  return canvasTex(size, (g, n) => { const im = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = h[y * n + ((x + 1) % n)] - h[y * n + ((x + n - 1) % n)], dy = h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x];
      const nx = -dx * strength, ny = -dy * strength, l = Math.hypot(nx, ny, 1), i = (y * n + x) * 4;
      im.data[i] = (nx / l * 0.5 + 0.5) * 255; im.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; im.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); }, false);
}
/** Wet-surface + puddle patch (chained after CSM by Renderer.setupMaterial). `puddles` scales puddle coverage. */
export function wetPatch(m: THREE.MeshStandardMaterial, puddles = 1, key = 'wet') {
  m.userData.patchKey = key + puddles;
  m.userData.patch = (sh: any) => {
    sh.uniforms.uWetness = WORLD_UNIFORMS.uWetness; sh.uniforms.uRain = WORLD_UNIFORMS.uRain; sh.uniforms.uTime = WORLD_UNIFORMS.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; varying vec3 vWNrm; uniform float uWetness; uniform float uRain; uniform float uTime;
      float hlHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hlNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hlHash(i), hlHash(i+vec2(1,0)), f.x), mix(hlHash(i+vec2(0,1)), hlHash(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float hlUp = smoothstep(0.6, 0.95, vWNrm.y);
      float hlP = hlNoise(vWPos.xz * 0.11) * 0.65 + hlNoise(vWPos.xz * 0.43) * 0.35;
      float hlPuddle = smoothstep(0.58 - 0.12 * ${puddles.toFixed(2)}, 0.7 - 0.1 * ${puddles.toFixed(2)}, hlP) * hlUp * uWetness * ${Math.min(1, puddles).toFixed(2)};
      float hlWet = uWetness * mix(0.55, 1.0, hlUp);
      diffuseColor.rgb *= mix(1.0, 0.55, hlWet * 0.8) * mix(1.0, 0.75, hlPuddle);
      roughnessFactor = mix(roughnessFactor, 0.28, hlWet * 0.7); roughnessFactor = mix(roughnessFactor, 0.03, hlPuddle);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float hlUp2 = smoothstep(0.6, 0.95, vWNrm.y); float hlP2 = hlNoise(vWPos.xz * 0.11) * 0.65 + hlNoise(vWPos.xz * 0.43) * 0.35;
        float pud = smoothstep(0.5, 0.62, hlP2) * hlUp2 * uWetness;
        // flatten normals inside puddles (mirror-like water), add rain ripple rings
        vec2 cell = floor(vWPos.xz * 1.6); vec2 f = fract(vWPos.xz * 1.6) - 0.5; float ph = fract(uTime * 1.3 + hlHash(cell));
        float ring = sin((length(f) - ph * 0.5) * 40.0) * (1.0 - ph) * smoothstep(0.5 * ph + 0.06, 0.5 * ph, length(f)) * uRain;
        normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, pud * 0.85));
        normal = normalize(normal + (viewMatrix * vec4(f.x, 0.0, f.y, 0.0)).xyz * ring * 0.25 * pud); }`);
  };
  return m;
}
const cache: Record<string, THREE.Material> = {};
export function material(look: string): THREE.Material {
  if (cache[look]) return cache[look];
  let m: THREE.MeshStandardMaterial;
  switch (look) {
    case 'asphalt': {
      const map = canvasTex(512, (g, n) => { const r = rand(3); g.fillStyle = '#58595b'; g.fillRect(0, 0, n, n);
        for (let i = 0; i < 26000; i++) { const v = 62 + r() * 58; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(r() * n, r() * n, 1 + r() * 1.5, 1 + r() * 1.5); }
        g.globalAlpha = 0.18; for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? '#222' : '#555'; g.beginPath(); g.ellipse(r() * n, r() * n, 10 + r() * 60, 6 + r() * 30, r() * 3, 0, 7); g.fill(); } }, true, 60);
      m = new THREE.MeshStandardMaterial({ map, normalMap: normalFromNoise(256, 9, 0.6, 2.2), roughness: 0.86, metalness: 0 });
      m.normalMap!.repeat.set(120, 120); m.normalScale.set(0.6, 0.6); wetPatch(m, 1, 'asphalt'); break; }
    case 'concrete': m = wetPatch(new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.9, normalMap: normalFromNoise(256, 4, 0.3, 1.5) }), 0.3, 'concrete'); break;
    case 'kerb': m = wetPatch(new THREE.MeshStandardMaterial({ map: canvasTex(64, (g, n) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e8e4dc' : '#b3261e'; g.fillRect((i * n) / 4, 0, n / 4, n); } }, true), roughness: 0.6 }), 0.2, 'kerb'); break;
    case 'building': m = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0,
      emissiveMap: canvasTex(256, (g, n) => { const r = rand(11); g.fillStyle = '#000'; g.fillRect(0, 0, n, n); for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) if (r() < 0.45) { g.fillStyle = `hsl(${30 + r() * 20},70%,${40 + r() * 30}%)`; g.fillRect(x * 32 + 6, y * 16 + 4, 20, 9); } }, true) }); break;
    case 'lamp': m = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.8 }); break;
    case 'cone': m = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.55 }); break;
    case 'crate': m = new THREE.MeshStandardMaterial({ color: 0x8b6a43, roughness: 0.85 }); break;
    case 'paint': m = wetPatch(new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.6, 'paint'); break;
    default: m = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
  }
  return (cache[look] = m);
}
