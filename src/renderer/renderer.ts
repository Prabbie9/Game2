// Renderer: WebGL2 + pmndrs postprocessing HDR pipeline.
// Scene (linear HDR, half-float) -> N8AO (GTAO-class AO) -> bloom -> speed blur -> exposure -> AgX tonemap -> grade -> grain/vignette -> SMAA.
// Shadows: three CSM, 4 cascades (tier-scaled). Every lit material must pass through `setupMaterial`.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, VignetteEffect, NoiseEffect, BlendFunction, ChromaticAberrationEffect, Effect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { CSM } from 'three/addons/csm/CSM.js';
import { TIERS, type TierSettings } from './tiers';
import { SSREffect } from './ssr';

/** Exposure + simple filmic grade (lift/gamma/gain/saturation) applied before/after tonemapping. */
class ExposureEffect extends Effect {
  constructor() {
    super('Exposure', `uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }`,
      { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }
}
class GradeEffect extends Effect {
  constructor() {
    super('Grade', `uniform vec3 lift; uniform vec3 gain; uniform float sat; uniform float contrast;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722));
        c = mix(vec3(l), c, sat); c = (c - 0.5) * contrast + 0.5; c = c * gain + lift * (1.0 - c);
        outputColor = vec4(max(c, 0.0), inputColor.a); }`,
      { uniforms: new Map<string, THREE.Uniform>([['lift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))], ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['sat', new THREE.Uniform(1)], ['contrast', new THREE.Uniform(1)]]) });
  }
}
/** Speed blur: radial streak from screen centre, strength from vehicle speed (cheap stand-in for per-pixel motion blur). */
class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlur', `uniform float strength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec2 d = uv - vec2(0.5, 0.45); float r = length(d); float k = strength * r * r * 2.2;
        if (k < 0.0005) { outputColor = inputColor; return; }
        vec3 acc = inputColor.rgb; for (int i = 1; i < 8; i++) { acc += texture2D(inputBuffer, uv - d * k * float(i) / 8.0).rgb; }
        outputColor = vec4(acc / 8.0, inputColor.a); }`,
      { uniforms: new Map([['strength', new THREE.Uniform(0)]]) });
  }
}

export class Renderer {
  renderer: THREE.WebGLRenderer; composer: EffectComposer; scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
  csm!: CSM; ao!: N8AOPostPass; bloom!: BloomEffect; exposure = new ExposureEffect(); grade = new GradeEffect(); speedBlur = new SpeedBlurEffect();
  tone!: ToneMappingEffect; vignette!: VignetteEffect; noise!: NoiseEffect; ca!: ChromaticAberrationEffect; smaa!: SMAAEffect;
  ssr!: SSREffect; ssrPass!: EffectPass;
  tier: TierSettings; materials = new Set<THREE.Material>(); resScale = 1; comfort = { motionBlur: true, lens: true, shake: true, reduceFlashing: false };
  stats = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  constructor(public container: HTMLElement, tierName: keyof typeof TIERS = 'high') {
    this.tier = TIERS[tierName];
    const r = (this.renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: true, preserveDrawingBuffer: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    container.append(r.domElement);
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.buildPasses();
    this.buildCSM();
    addEventListener('resize', () => this.resize()); this.resize();
  }
  private buildPasses() {
    const c = this.composer; c.removeAllPasses();
    c.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    Object.assign(this.ao.configuration, { aoRadius: 2.4, distanceFalloff: 1.0, intensity: 3.6, aoSamples: 16, denoiseSamples: 8, denoiseRadius: 10, halfRes: true, gammaCorrection: false });
    this.ssr = new SSREffect(this.camera); this.ssrPass = new EffectPass(this.camera, this.ssr); this.ssrPass.enabled = this.tier.ssr; c.addPass(this.ssrPass); // before N8AO: passes after N8AO lose its output chain
    this.ao.enabled = this.tier.ao && !new URLSearchParams(location.search).has('noao'); c.addPass(this.ao);
    this.bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72, levels: 7 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.vignette = new VignetteEffect({ darkness: 0.42, offset: 0.32 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false }); this.noise.blendMode.opacity.value = 0.025;
    this.ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    c.addPass(new EffectPass(this.camera, this.bloom, this.speedBlur));
    c.addPass(new EffectPass(this.camera, this.exposure, this.tone));
    c.addPass(new EffectPass(this.camera, this.grade, this.ca, this.vignette, this.noise));
    c.addPass(new EffectPass(this.camera, this.smaa));
  }
  private buildCSM() {
    this.csm?.dispose(); this.csm?.remove();
    const t = this.tier;
    this.csm = new CSM({ maxFar: t.shadowFar, cascades: t.cascades, mode: 'practical', parent: this.scene, shadowMapSize: t.shadowMap, lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera: this.camera, lightIntensity: 3, shadowBias: -0.00025 });
    (this.csm as any).fade = true;
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.035; l.castShadow = t.shadows; }
    for (const m of this.materials) this.hook(m);
  }
  /** CSM owns onBeforeCompile; chain it with the material's own patch (userData.patch) so both apply. */
  private hook(m: THREE.Material) {
    this.csm.setupMaterial(m); const csmHook = m.onBeforeCompile.bind(m);
    m.onBeforeCompile = (sh, r) => { csmHook(sh, r); m.userData.patch?.(sh); };
    if (m.userData.patchKey) m.customProgramCacheKey = () => m.userData.patchKey;
  }
  /** Register a lit material for cascaded shadows (idempotent). */
  setupMaterial<M extends THREE.Material>(m: M): M { if (!this.materials.has(m)) { this.materials.add(m); this.noTransmission(m); this.hook(m); this.capTextures(m); } return m; }
  /** Transmissive glass (KHR_materials_transmission on the speedboat windshield) makes three.js re-render every opaque
   * object into a refraction target whenever one is on screen (~+700 draws in the Harbour view). Plain alpha glass instead. */
  private noTransmission(m: THREE.Material) { const p = m as THREE.MeshPhysicalMaterial; if (!p.isMeshPhysicalMaterial || !(p.transmission > 0)) return;
    p.opacity = Math.min(p.opacity, 0.2 + 0.6 * (1 - p.transmission)); p.transmission = 0; p.transparent = true; p.depthWrite = false; }
  /** Lite: uncompressed textures larger than 512 px are downscaled once on a canvas before their first GPU upload
   * (car/character/boat WebP textures were ~85% of Lite's texture memory). KTX2 textures are left alone. */
  private capped = new WeakSet<THREE.Texture>();
  private capTextures(m: THREE.Material) { const cap = this.tier.name === 'Lite' ? 512 : 0; if (!cap) return;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) { const t = (m as any)[k] as THREE.Texture | null; if (!t || (t as any).isCompressedTexture || this.capped.has(t)) continue; this.capped.add(t);
      const img = t.image as any; if (!img || !img.width || Math.max(img.width, img.height) <= cap) continue; const s = cap / Math.max(img.width, img.height);
      try { const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); t.image = c; t.needsUpdate = true; } catch { /* keep the original */ } } }
  setTier(name: keyof typeof TIERS) { this.tier = TIERS[name]; this.ao.enabled = this.tier.ao; this.ssrPass.enabled = this.tier.ssr; this.buildCSM(); this.resize(); }
  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio, this.tier.maxPixelRatio) * this.tier.renderScale * this.resScale;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.csm?.updateFrustums();
  }
  render(dt: number) {
    this.csm.update(); this.camera.updateMatrixWorld(); this.ssr.update();
    this.renderer.info.reset();
    this.composer.render(dt);
    const i = this.renderer.info; this.stats.drawCalls = i.render.calls; this.stats.triangles = i.render.triangles; this.stats.textures = i.memory.textures; this.stats.geometries = i.memory.geometries;
  }
}
