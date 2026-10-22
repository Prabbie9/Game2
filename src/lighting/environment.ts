// Time of day + weather: physically-based (Preetham) sky, sun/moon light via CSM, hemisphere fill, sky-tinted fog,
// image-based lighting from a PMREM of the current sky (re-baked when the sky changes enough), per-TOD exposure and grade,
// and global weather uniforms (wetness, rain, overcast) shared by materials and effects.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Renderer } from '../renderer/renderer';
import { SkyDome } from './skydome';

export type WeatherName = 'clear' | 'overcast' | 'rain' | 'fog' | 'storm';
const WEATHER: Record<WeatherName, { overcast: number; rain: number; fog: number; wet: number }> = {
  clear: { overcast: 0, rain: 0, fog: 0.0, wet: 0 }, overcast: { overcast: 0.75, rain: 0, fog: 0.08, wet: 0.15 },
  rain: { overcast: 0.85, rain: 0.7, fog: 0.45, wet: 1 }, fog: { overcast: 0.6, rain: 0, fog: 1, wet: 0.35 }, storm: { overcast: 1, rain: 1, fog: 0.6, wet: 1 },
};
/** Global uniforms injected into world materials (see materials/surface.ts). */
export const WORLD_UNIFORMS = { uWetness: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 } };

export class Environment {
  sky = new Sky(); hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4036, 0.5);
  hours = 17.6; weatherName: WeatherName = 'clear'; target = { ...WEATHER.clear }; cur = { ...WEATHER.clear };
  sunDir = new THREE.Vector3(); fog = new THREE.FogExp2(0xbfc8d0, 0.0015); timeSpeed = 0; // game-hours per real second
  private pmrem: THREE.PMREMGenerator; private envRT: THREE.WebGLRenderTarget | null = null; private skyScene = new THREE.Scene();
  private lastBake = { hours: -99, overcast: -1 }; exposure = 1; night = 0; dome: SkyDome; sunColor = new THREE.Color();
  constructor(public R: Renderer) {
    this.sky.scale.setScalar(3500); this.sky.frustumCulled = false;
    R.scene.add(this.sky, this.hemi); R.scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(R.renderer);
    this.skyScene.add(new Sky()); (this.skyScene.children[0] as Sky).scale.setScalar(1000);
    this.dome = new SkyDome(R.scene);
  }
  setTime(h: number) { this.hours = ((h % 24) + 24) % 24; }
  setWeather(w: WeatherName, instant = false) { this.weatherName = w; this.target = { ...WEATHER[w] }; if (instant) this.cur = { ...this.target }; }
  update(dt: number) {
    this.hours = (this.hours + dt * this.timeSpeed) % 24;
    for (const k of Object.keys(this.cur) as (keyof typeof this.cur)[]) this.cur[k] += (this.target[k] - this.cur[k]) * Math.min(1, dt * 0.25);
    const { overcast, rain, fog, wet } = this.cur;
    // sun path (summer): rises ~05:30 east (+x), sets ~19:30 west, peak elevation ~62 deg at 12:30
    const a = ((this.hours - 5.5) / 14) * Math.PI; const elev = Math.sin(a) * 1.08; const az = Math.cos(a);
    this.sunDir.set(az * 0.85, elev, -0.45 + az * 0.1).normalize();
    const sunUp = THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.12);
    this.night = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.18, 0.02);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir.y > -0.2 ? this.sunDir : new THREE.Vector3(0, -0.2, -1));
    u.turbidity.value = 2.5 + overcast * 12 + fog * 6 + (1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.0, 0.35)) * 6; u.rayleigh.value = 1.2 + overcast * 1.5 - this.night * 0.8;
    u.mieCoefficient.value = 0.004 + overcast * 0.02; u.mieDirectionalG.value = 0.82 - overcast * 0.3;
    // sun light (or moon at night) drives the cascaded shadow lights
    const low = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.02, 0.45);
    const sunCol = new THREE.Color().setRGB(1, 0.93 - low * 0.32, 0.85 - low * 0.55);
    const moonCol = new THREE.Color(0.55, 0.65, 0.95);
    const dir = this.sunDir.y > -0.05 ? this.sunDir.clone() : new THREE.Vector3(-0.3, 0.75, 0.4).normalize();
    const intensity = sunUp * (4.6 + low * 1.2 - overcast * 3.9) + this.night * 0.12;
    for (const l of this.R.csm.lights) { l.color.copy(sunUp > 0.01 ? sunCol : moonCol); l.intensity = intensity; }
    this.R.csm.lightDirection.copy(dir).negate(); this.sunColor.copy(sunCol);
    this.dome.update(this.R.camera, this.sunDir, sunCol, overcast, this.night);
    // hemisphere fill: sky-ish above, warm ground bounce below (bounce-light stand-in)
    this.hemi.color.setRGB(0.5 + low * 0.1, 0.62 + low * 0.04, 0.95 - low * 0.08).lerp(new THREE.Color(0.7, 0.72, 0.75), overcast).multiplyScalar(1 - this.night * 0.9);
    this.hemi.groundColor.setRGB(0.32, 0.27, 0.22).multiplyScalar(0.6 + sunUp * 0.4);
    this.hemi.intensity = (0.78 + overcast * 0.35) * (1 - this.night * 0.88); // look pass: less flat fill on clear days (more form from the sun)
    // fog: colour follows the horizon; density follows weather
    const horizon = new THREE.Color().setRGB(0.62 + low * 0.3, 0.7 + low * 0.05, 0.8 - low * 0.25).lerp(new THREE.Color(0.6, 0.63, 0.66), overcast).lerp(new THREE.Color(0.03, 0.04, 0.07), this.night);
    this.fog.color.copy(horizon); this.fog.density = 0.00045 + fog * 0.009 + rain * 0.0022 + overcast * 0.0004;
    this.R.scene.environmentIntensity = (0.6 + sunUp * 0.7) * (1 - overcast * 0.2) * (1 - this.night * 0.6) + this.night * 0.25;
    // exposure: adapt per scene brightness (auto-exposure lite; full luminance adaptation later)
    const targetExp = THREE.MathUtils.lerp(1.0 - overcast * 0.08, 1.45, this.night);
    this.exposure += (targetExp - this.exposure) * Math.min(1, dt * 1.5);
    (this.R.exposure.uniforms.get('exposure') as THREE.Uniform).value = this.exposure;
    // grade per TOD: warm golden hour, cool blue night, desaturated overcast
    const g = this.R.grade.uniforms; const gain = g.get('gain')!.value as THREE.Vector3, lift = g.get('lift')!.value as THREE.Vector3;
    gain.set(1.0 + low * 0.12 * sunUp, 1.0 + low * 0.01 * sunUp, 1.0 - low * 0.14 * sunUp).lerp(new THREE.Vector3(0.94, 0.98, 1.07), this.night);
    lift.set(0.0, 0.004, 0.012).multiplyScalar(1 + this.night * 2);
    g.get('sat')!.value = 1.08 + low * 0.12 * sunUp - overcast * 0.2 - this.night * 0.05; g.get('contrast')!.value = 1.08 + low * 0.03 - overcast * 0.05;
    WORLD_UNIFORMS.uWetness.value += (wet - WORLD_UNIFORMS.uWetness.value) * Math.min(1, dt * 0.2);
    WORLD_UNIFORMS.uRain.value = rain; WORLD_UNIFORMS.uNight.value = this.night; WORLD_UNIFORMS.uTime.value += dt;
    // IBL: rebake the sky into a PMREM when time/weather moved enough
    if (Math.abs(this.hours - this.lastBake.hours) > 0.25 || Math.abs(overcast - this.lastBake.overcast) > 0.08) this.bakeEnv();
  }
  /** Optional scene reflection probe (district/look-slice centre): real buildings in car paint, glass and wet roads. */
  probe: { pos: THREE.Vector3; cube: THREE.CubeCamera; rt: THREE.WebGLCubeRenderTarget } | null = null;
  setProbe(pos: THREE.Vector3, res = 256) { const rt = new THREE.WebGLCubeRenderTarget(res, { type: THREE.HalfFloatType }); const cube = new THREE.CubeCamera(1, 1500, rt); cube.position.copy(pos); this.probe = { pos, cube, rt }; this.lastBake.hours = -99; }
  bakeEnv() {
    const s = this.skyScene.children[0] as Sky; const su = s.material.uniforms, u = this.sky.material.uniforms;
    for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) (su as any)[k].value = (u as any)[k].value?.clone ? (u as any)[k].value.clone() : (u as any)[k].value;
    let rt: THREE.WebGLRenderTarget;
    if (this.probe) {
      // render the real scene into a cube (sky dome included), then prefilter it for roughness-based IBL
      const sc = this.R.scene; const prevEnv = sc.environment; sc.environment = this.envRT?.texture ?? null;
      this.dome.mesh.position.copy(this.probe.pos); this.probe.cube.update(this.R.renderer, sc); sc.environment = prevEnv;
      rt = this.pmrem.fromCubemap(this.probe.rt.texture);
    } else rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000);
    this.envRT?.dispose(); this.envRT = rt; this.R.scene.environment = rt.texture;
    this.lastBake = { hours: this.hours, overcast: this.cur.overcast };
  }
}
