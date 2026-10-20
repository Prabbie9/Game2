// Screen-space reflections for wet, upward-facing surfaces (roads, sidewalks, puddles), no extra G-buffer:
// view position from depth, surface orientation from depth derivatives, wetness/puddle mask recomputed in world space
// with the same noise as the materials. Ray-marched in view space with binary refinement; edge/distance/fresnel faded.
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';
import { WORLD_UNIFORMS } from '../lighting/environment';

export class SSREffect extends Effect {
  constructor(public camera: THREE.PerspectiveCamera) {
    super('SSR', `
      uniform mat4 uProj; uniform mat4 uInvProj; uniform mat4 uInvView; uniform vec3 uUp; uniform float uWet; uniform float uRain; uniform float uTime; uniform float uSteps; uniform float uDebug;
      float hlHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hlNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hlHash(i), hlHash(i+vec2(1,0)), f.x), mix(hlHash(i+vec2(0,1)), hlHash(i+vec2(1,1)), f.x), f.y); }
      float hlFbm(vec2 p){ return hlNoise(p) * 0.5 + hlNoise(p * 2.03) * 0.3 + hlNoise(p * 4.1) * 0.2; }
      vec3 vpos(vec2 uv, float d){ vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
      vec2 proj(vec3 p){ vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (uDebug > 0.5) outputColor = vec4(vec3(fract(-vpos(uv, depth).z * 0.1)), 1.0);
        if (uWet < 0.02 || depth >= 0.9999) return;
        vec3 P = vpos(uv, depth);
        vec3 Nd = normalize(cross(dFdx(P), dFdy(P))); if (dot(Nd, P) > 0.0) Nd = -Nd;
        float up = smoothstep(0.88, 0.97, dot(Nd, uUp)); if (up < 0.01) return;
        vec3 W = (uInvView * vec4(P, 1.0)).xyz;
        float pud = smoothstep(0.55, 0.64, hlFbm(W.xz * 0.09));
        float strength = uWet * up * mix(0.4, 1.0, pud);
        // rain ripples wobble the reflection inside puddles
        vec2 cell = floor(W.xz * 1.7); vec2 fr = fract(W.xz * 1.7) - 0.5; float ph = fract(uTime * 1.2 + hlHash(cell));
        float ring = sin((length(fr) - ph * 0.45) * 46.0) * (1.0 - ph) * smoothstep(0.45 * ph + 0.07, 0.45 * ph, length(fr)) * uRain * pud;
        vec3 N = normalize(uUp + vec3(fr.x, 0.0, fr.y) * ring * 0.06 + (1.0 - pud) * vec3(hlNoise(W.xz * 3.0) - 0.5, 0.0, hlNoise(W.zx * 3.0) - 0.5) * 0.05);
        vec3 V = normalize(P); vec3 R = reflect(V, N);
        float t = 0.25, prevT = 0.0; vec2 hitUV = vec2(-1.0); float jitter = hlHash(uv * 731.0 + uTime);
        for (int i = 0; i < 48; i++) {
          if (float(i) >= uSteps) break;
          vec3 Q = P + R * t; vec2 q = proj(Q);
          if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0 || Q.z > -0.05) break;
          float sz = vpos(q, readDepth(q)).z; float thick = 0.35 + t * 0.06;
          if (Q.z < sz && sz - Q.z < thick) {
            float a = prevT, b = t; for (int k = 0; k < 6; k++) { float m = 0.5 * (a + b); vec3 M = P + R * m; vec2 mq = proj(M); float mz = vpos(mq, readDepth(mq)).z; if (M.z < mz) b = m; else a = m; }
            hitUV = proj(P + R * b); break;
          }
          prevT = t; t = t * 1.13 + 0.12 + jitter * 0.1;
        }
        if (hitUV.x < 0.0) return;
        vec2 e = smoothstep(0.0, 0.12, hitUV) * smoothstep(1.0, 0.88, hitUV);
        float fade = e.x * e.y * smoothstep(90.0, 30.0, t);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        vec3 hit = texture2D(inputBuffer, hitUV).rgb;
        float k = clamp(strength * fade * mix(0.5, 1.0, fres) * mix(0.7, 1.0, pud), 0.0, 0.95);
        outputColor = vec4(mix(inputColor.rgb, inputColor.rgb * (1.0 - k * 0.6) + hit * k, 1.0), inputColor.a);
        if (uDebug > 0.5) outputColor = vec4(k, up, pud, 1.0);
      }`, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['uProj', new THREE.Uniform(new THREE.Matrix4())], ['uInvProj', new THREE.Uniform(new THREE.Matrix4())], ['uInvView', new THREE.Uniform(new THREE.Matrix4())],
        ['uUp', new THREE.Uniform(new THREE.Vector3())], ['uWet', WORLD_UNIFORMS.uWetness as any], ['uRain', WORLD_UNIFORMS.uRain as any], ['uTime', WORLD_UNIFORMS.uTime as any], ['uSteps', new THREE.Uniform(40)], ['uDebug', new THREE.Uniform(new URLSearchParams(location.search).has('ssrdebug') ? 1 : 0)]]),
    });
  }
  update() {
    const c = this.camera; const u = this.uniforms;
    (u.get('uProj')!.value as THREE.Matrix4).copy(c.projectionMatrix); (u.get('uInvProj')!.value as THREE.Matrix4).copy(c.projectionMatrixInverse);
    (u.get('uInvView')!.value as THREE.Matrix4).copy(c.matrixWorld); (u.get('uUp')!.value as THREE.Vector3).set(0, 1, 0).transformDirection(c.matrixWorldInverse);
  }
}
