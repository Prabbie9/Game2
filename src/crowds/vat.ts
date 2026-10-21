// Vertex animation textures for crowds: bake a cast body's (LOD1) skinned vertices over one gait cycle into float
// textures on the CPU at load time, then draw many instances with a vertex shader that fetches and interpolates the
// baked positions/normals by gl_VertexID. Per instance: gait phase, cycle rate and clothing tint.
import * as THREE from 'three';
import type { Character } from '../character/character';
import type { Renderer } from '../renderer/renderer';

const TEX_W = 2048;
export interface VatPart { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; pos: THREE.DataTexture; nrm: THREE.DataTexture; verts: number; frames: number; role: string }
export interface VatBody { id: string; parts: VatPart[]; stride: number; speed: number; height: number }

/** Bake every skinned submesh of ch while playing `clip` (one cycle) at `frames` samples. */
export function bakeVAT(ch: Character, clip: THREE.AnimationClip, frames = 24): VatPart[] {
  const meshes: THREE.SkinnedMesh[] = []; ch.model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const a = ch.mixer.clipAction(clip); (ch.mixer as any)._actions.forEach((x: THREE.AnimationAction) => x !== a && x.setEffectiveWeight(0)); a.reset().play(); a.setEffectiveWeight(1); a.timeScale = 0;
  const rootInv = new THREE.Matrix4(); const parts: VatPart[] = []; const v = new THREE.Vector3(), n = new THREE.Vector3();
  const data = meshes.map((m) => { const cnt = m.geometry.attributes.position.count; const rows = Math.ceil((cnt * frames) / TEX_W); return { m, cnt, P: new Float32Array(TEX_W * rows * 4), N: new Float32Array(TEX_W * rows * 4), rows }; });
  for (let f = 0; f < frames; f++) {
    a.time = (f / frames) * clip.duration; ch.mixer.update(0); ch.root.updateMatrixWorld(true); rootInv.copy(ch.root.matrixWorld).invert();
    for (const d of data) { const m = d.m; m.skeleton.update(); const pa = m.geometry.attributes.position, na = m.geometry.attributes.normal; const mw = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld); const nm = new THREE.Matrix3().getNormalMatrix(mw);
      // per-bone normal matrices once per frame (normals follow the strongest bone: cheap, fine at crowd distance)
      const bn = m.skeleton.bones.map((b, k) => new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().multiplyMatrices(b.matrixWorld, m.skeleton.boneInverses[k])));
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < d.cnt; i++) { v.fromBufferAttribute(pa, i); m.applyBoneTransform(i, v); v.applyMatrix4(mw); const o = (f * d.cnt + i) * 4; d.P[o] = v.x; d.P[o + 1] = v.y; d.P[o + 2] = v.z; d.P[o + 3] = 1;
        if (na) { n.fromBufferAttribute(na, i); let b = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; b = si.getComponent(i, k); } }
          n.applyMatrix3(bn[b]).applyMatrix3(nm).normalize(); d.N[o] = n.x; d.N[o + 1] = n.y; d.N[o + 2] = n.z; } } } }
  a.stop();
  for (const d of data) { const tex = (arr: Float32Array) => { const t = new THREE.DataTexture(arr, TEX_W, d.rows, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
    const g = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv']) if (d.m.geometry.attributes[k]) g.setAttribute(k, d.m.geometry.attributes[k]); g.setIndex(d.m.geometry.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3); const mat = (Array.isArray(d.m.material) ? d.m.material[0] : d.m.material) as THREE.MeshStandardMaterial;
    parts.push({ geo: g, mat, pos: tex(d.P), nrm: tex(d.N), verts: d.cnt, frames, role: mat.userData.role ?? 'cloth' }); }
  return parts;
}

/** Instanced crowd material: VAT vertex fetch + per-instance phase/rate (aVat = [phase, rate]); instanceColor tints. */
export function vatMaterial(R: Renderer, p: VatPart, time: { value: number }) {
  const m = p.mat.clone(); m.userData = { ...p.mat.userData };
  const U = { uVatPos: { value: p.pos }, uVatNrm: { value: p.nrm }, uVatVerts: { value: p.verts }, uVatFrames: { value: p.frames }, uTime: time };
  const vert = (sh: any) => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      uniform sampler2D uVatPos; uniform sampler2D uVatNrm; uniform float uVatVerts; uniform float uVatFrames; uniform float uTime; attribute vec2 aVat;
      vec4 vatFetch(sampler2D t, float f) { int idx = int(mod(f, uVatFrames)) * int(uVatVerts) + gl_VertexID; return texelFetch(t, ivec2(idx % ${TEX_W}, idx / ${TEX_W}), 0); }`)
      .replace('#include <beginnormal_vertex>', `float nf = fract(uTime * aVat.y + aVat.x) * uVatFrames; float nf0 = floor(nf);
      vec3 objectNormal = normalize(mix(vatFetch(uVatNrm, nf0).xyz, vatFetch(uVatNrm, nf0 + 1.0).xyz, nf - nf0));
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
      #endif`)
      .replace('#include <begin_vertex>', 'float vf = fract(uTime * aVat.y + aVat.x) * uVatFrames; float vf0 = floor(vf); vec3 transformed = mix(vatFetch(uVatPos, vf0).xyz, vatFetch(uVatPos, vf0 + 1.0).xyz, vf - vf0);'); };
  m.userData.patch = (sh: any) => { p.mat.userData.patch?.(sh); vert(sh); }; m.userData.patchKey = 'vat' + (p.mat.userData.patchKey ?? ''); R.setupMaterial(m);
  // shadow pass: same deformation in the depth material
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.onBeforeCompile = (sh) => vert(sh); depth.customProgramCacheKey = () => 'vatdepth';
  if (m.alphaTest > 0 && m.map) { depth.map = m.map; depth.alphaTest = m.alphaTest; }
  return { mat: m, depth };
}

/** One draw per crowd body (Lite/Low): concatenates a body's baked parts into one geometry + one VAT pair, with the parts'
 * albedo maps packed into a 1024 px atlas (normal/roughness maps dropped; crowd walkers are 26 m+ away). Material colour
 * per part goes into vertex colour; aCloth marks the parts that take the per-walker clothing tint. */
export function mergeVatParts(parts: VatPart[]): VatPart {
  const frames = parts[0].frames; const total = parts.reduce((a, p) => a + p.verts, 0); const rows = Math.ceil((total * frames) / TEX_W);
  const P = new Float32Array(TEX_W * rows * 4), N = new Float32Array(TEX_W * rows * 4); let off = 0;
  const A = 1024, cols = Math.ceil(Math.sqrt(parts.length)), tile = Math.floor(A / cols); const cv = document.createElement('canvas'); cv.width = cv.height = A; const cx = cv.getContext('2d')!;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], cloth: number[] = [], idx: number[] = []; let alphaTest = 0;
  parts.forEach((p, k) => {
    const sp = p.pos.image.data as unknown as Float32Array, sn = p.nrm.image.data as unknown as Float32Array;
    for (let f = 0; f < frames; f++) { P.set(sp.subarray(f * p.verts * 4, (f + 1) * p.verts * 4), (f * total + off) * 4); N.set(sn.subarray(f * p.verts * 4, (f + 1) * p.verts * 4), (f * total + off) * 4); }
    const tx = (k % cols) * tile, ty = Math.floor(k / cols) * tile; const img = p.mat.map?.image as CanvasImageSource | undefined; const cut = p.mat.alphaTest > 0;
    if (!cut || !img) { cx.fillStyle = '#fff'; cx.fillRect(tx, ty, tile, tile); } if (cut) alphaTest = 0.5;
    if (img) try { cx.drawImage(img, tx + 1, ty + 1, tile - 2, tile - 2); } catch { /* undrawable (compressed): plain colour */ }
    const g = p.geo, ua = g.attributes.uv, c = p.mat.color; const inset = (t: number) => (1 + Math.min(1, Math.max(0, t)) * (tile - 2)) / A;
    for (let i = 0; i < p.verts; i++) { pos.push(0, 0, 0); uv.push(tx / A + inset(ua ? ua.getX(i) : 0.5), ty / A + inset(ua ? ua.getY(i) : 0.5)); col.push(c.r, c.g, c.b); cloth.push(p.role === 'cloth' ? 1 : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.verts; i++) idx.push(i + off);
    off += p.verts; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aCloth', new THREE.Float32BufferAttribute(cloth, 1)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
  const atlas = new THREE.CanvasTexture(cv); atlas.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ name: 'crowd_atlas', map: atlas, vertexColors: true, roughness: 0.8, metalness: 0, alphaTest, side: alphaTest ? THREE.DoubleSide : THREE.FrontSide });
  mat.userData.patch = (sh: any) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCloth;').replace('#include <color_vertex>', `vColor = vec3(1.0); vColor *= color;
    #ifdef USE_INSTANCING_COLOR
    vColor *= mix(vec3(1.0), instanceColor.xyz, aCloth);
    #endif`); }; mat.userData.patchKey = 'crowdatlas';
  const tex = (arr: Float32Array) => { const t = new THREE.DataTexture(arr, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; };
  for (const p of parts) { p.pos.dispose(); p.nrm.dispose(); }
  return { geo: g, mat, pos: tex(P), nrm: tex(N), verts: total, frames, role: 'merged' };
}
