// Effects: rain streaks (instanced, camera-wrapped), skid-mark ribbons (pooled ring buffer), and a CPU billboard
// particle pool (tyre smoke, dust, sparks later). All capped by tier.
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../lighting/environment';

export class Rain {
  mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, count = 9000) {
    const g = new THREE.PlaneGeometry(0.012, 0.7); g.translate(0, 0.35, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: WORLD_UNIFORMS.uTime, uRain: WORLD_UNIFORMS.uRain, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(1.2, 0.4) }, uBright: { value: 1 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; varying float vA;
        void main(){ vec3 seed = instanceMatrix[3].xyz; float box = 36.0;
          vec3 p = seed; p.y = mod(seed.y - uTime * 11.0, 22.0) - 4.0; p.xz += uWind * (22.0 - p.y) * 0.05;
          p.xz = mod(p.xz - uCam.xz + box * 0.5, box) - box * 0.5 + uCam.xz; p.y += uCam.y - 6.0;
          float lenK = 0.55 + fract(seed.x * 7.13 + seed.z * 3.1) * 0.9; vec3 toCam = normalize(cameraPosition - p); vec3 up = normalize(vec3(-uWind.x * 0.05, 1.0, -uWind.y * 0.05)); vec3 side = normalize(cross(up, toCam));
          vec3 wp = p + side * position.x + up * position.y * lenK;
          float d = length(cameraPosition - wp); vA = smoothstep(36.0, 4.0, d) * smoothstep(0.3, 1.5, d) * (0.4 + 0.6 * fract(seed.x * 13.7 + seed.y));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uRain; uniform float uBright; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.6, 0.65, 0.72) * uBright, vA * 0.15 * uRain); }`,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, count); this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4(); for (let i = 0; i < count; i++) { m.makeTranslation((Math.random() - 0.5) * 36, Math.random() * 22, (Math.random() - 0.5) * 36); this.mesh.setMatrixAt(i, m); }
    scene.add(this.mesh);
  }
  update(cam: THREE.Camera, night: number) { this.mat.uniforms.uCam.value.copy(cam.position); this.mat.uniforms.uBright.value = 1 - night * 0.6; this.mesh.visible = WORLD_UNIFORMS.uRain.value > 0.02; }
}

/** Skid marks: per-wheel ribbons written into one pooled dynamic mesh (oldest segments overwritten). */
export class SkidMarks {
  max = 2400; geo = new THREE.BufferGeometry(); pos: Float32Array; alpha: Float32Array; i = 0; last: (THREE.Vector3 | null)[] = [null, null, null, null];
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.max * 6 * 3); this.alpha = new Float32Array(this.max * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.02, vA * 0.55); }' });
    const mesh = new THREE.Mesh(this.geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  }
  /** contact = wheel contact point on the ground, side = wheel axle direction (world), w = tyre width. */
  add(wheel: number, contact: THREE.Vector3 | null, side: THREE.Vector3, strength: number, w = 0.22) {
    if (!contact || strength < 0.25) { this.last[wheel] = null; return; }
    const p = contact.clone(); p.y += 0.015; const prev = this.last[wheel];
    if (prev && prev.distanceTo(p) > 0.25) {
      const a0 = prev.clone().addScaledVector(side, w / 2), a1 = prev.clone().addScaledVector(side, -w / 2), b0 = p.clone().addScaledVector(side, w / 2), b1 = p.clone().addScaledVector(side, -w / 2);
      const o = (this.i % this.max) * 18; [a0, a1, b0, a1, b1, b0].forEach((v, k) => { this.pos[o + k * 3] = v.x; this.pos[o + k * 3 + 1] = v.y; this.pos[o + k * 3 + 2] = v.z; this.alpha[(this.i % this.max) * 6 + k] = Math.min(1, strength); });
      this.i++; this.last[wheel] = p;
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    } else if (!prev) this.last[wheel] = p;
  }
}

/** Billboard particle pool (soft round sprites), CPU simulated; used for tyre smoke, dust, sparks. */
export class Particles {
  mesh: THREE.InstancedMesh; p: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; size: number; grow: number; col: THREE.Color; a: number }[] = []; next = 0;
  private dummy = new THREE.Object3D();
  constructor(scene: THREE.Scene, public cap = 600, additive = false) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: false, fog: true });
    (mat as any).onBeforeCompile = (sh: any) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>'); };
    const geo = new THREE.PlaneGeometry(1, 1); geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.frustumCulled = false; this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (let i = 0; i < cap; i++) this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 1, col: new THREE.Color(), a: 0 });
    scene.add(this.mesh);
  }
  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, grow: number, col: THREE.ColorRepresentation, alpha = 0.5) {
    const q = this.p[this.next]; this.next = (this.next + 1) % this.cap; q.pos.copy(pos); q.vel.copy(vel); q.life = q.max = life; q.size = size; q.grow = grow; q.col.set(col); q.a = alpha;
  }
  update(dt: number, cam: THREE.Camera) {
    const aA = this.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < this.cap; i++) { const q = this.p[i];
      if (q.life <= 0) { aA.setX(i, 0); this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); continue; }
      q.life -= dt; q.vel.multiplyScalar(1 - dt * 1.2); q.vel.y += dt * 0.6; q.pos.addScaledVector(q.vel, dt);
      const t = 1 - q.life / q.max; this.dummy.position.copy(q.pos); this.dummy.quaternion.copy(cam.quaternion); this.dummy.scale.setScalar(q.size + q.grow * t); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix); this.mesh.setColorAt(i, q.col); aA.setX(i, q.a * Math.sin(Math.PI * Math.min(1, t * 1.4 + 0.05)) * (1 - t)); }
    this.mesh.instanceMatrix.needsUpdate = true; aA.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
