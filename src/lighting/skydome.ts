// Sky overlay dome drawn over the Preetham sky: layered fbm clouds lit by the sun (bright rims toward the sun,
// grey undersides, coverage by weather), plus a night layer of stars, moon and orange city glow on the horizon.
import * as THREE from 'three';
import { WORLD_UNIFORMS } from './environment';

export class SkyDome {
  mesh: THREE.Mesh; u: Record<string, THREE.IUniform>;
  constructor(scene: THREE.Scene) {
    this.u = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.8) }, uCover: { value: 0.3 }, uNight: WORLD_UNIFORMS.uNight, uTime: WORLD_UNIFORMS.uTime, uDark: { value: 0 }, uGlow: { value: new THREE.Color(1.0, 0.55, 0.28) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uSun; uniform vec3 uSunCol; uniform float uCover; uniform float uNight; uniform float uTime; uniform float uDark; uniform vec3 uGlow; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir); if (d.y < -0.02) discard;
          vec2 p = d.xz / (d.y + 0.12) * 1.6 + uTime * vec2(0.004, 0.0015);
          float base = fbm(p); float detail = fbm(p * 3.1 + 4.0);
          float c = smoothstep(1.0 - uCover - 0.05, 1.0 - uCover + 0.3, base * 0.75 + detail * 0.35);
          // lighting: thickness toward the sun darkens; forward scattering brightens rims near the sun
          float toward = fbm(p + normalize(uSun.xz + 1e-4) * 0.18);
          float shade = clamp(1.0 - (toward - base) * 2.6, 0.25, 1.15);
          float mu = max(dot(d, normalize(uSun)), 0.0);
          vec3 lit = uSunCol * (0.55 + 0.9 * pow(mu, 6.0) * (1.0 - c * 0.5)) * shade;
          vec3 under = mix(vec3(0.52, 0.55, 0.6), vec3(0.32, 0.33, 0.36), uCover) * (0.6 + 0.4 * uSun.y);
          vec3 col = mix(under, lit, 0.55 + 0.45 * shade) * (1.0 - uDark);
          // night: clouds lit from below by the city (orange), stars + moon where the sky is clear
          col = mix(col, uGlow * 0.035 * (0.4 + base), uNight);
          float horizon = exp(-max(d.y, 0.0) * 9.0);
          vec3 night = uGlow * 0.018 * horizon * (1.0 + uCover);
          float st = step(0.9975, h(floor(d.xz / (d.y + 0.3) * 260.0))) * smoothstep(0.05, 0.4, d.y) * (0.6 + 0.4 * sin(uTime * 3.0 + h(floor(d.xz * 300.0)) * 20.0));
          vec3 moonDir = normalize(vec3(-0.35, 0.55, 0.62)); float moon = smoothstep(0.9993, 0.9996, dot(d, moonDir)); float halo = pow(max(dot(d, moonDir), 0.0), 220.0) * 0.25;
          night += (vec3(st) * 0.9 + vec3(0.9, 0.93, 1.0) * (moon * 1.6 + halo)) * (1.0 - c) * uNight;
          float alpha = c * smoothstep(-0.02, 0.06, d.y) * mix(0.95, 0.9, uNight);
          gl_FragColor = vec4(col * alpha + night * uNight, max(alpha, uNight * clamp(length(night) * 8.0, 0.0, 1.0)));
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }
  update(cam: THREE.Camera, sun: THREE.Vector3, sunCol: THREE.Color, overcast: number, night: number) {
    this.mesh.position.copy(cam.position);
    (this.u.uSun.value as THREE.Vector3).copy(sun.y > -0.1 ? sun : new THREE.Vector3(0, 0.2, -1));
    (this.u.uSunCol.value as THREE.Color).copy(sunCol).multiplyScalar(1 - night * 0.9);
    this.u.uCover.value = 0.28 + overcast * 0.62; this.u.uDark.value = overcast * 0.35;
  }
}
