// Renderer prototype: ?mode=a (WebGLRenderer + pmndrs postprocessing) vs ?mode=b (WebGPURenderer + TSL post).
import * as THREE from 'three';
import { SkyMesh as Sky } from 'three/addons/objects/SkyMesh.js';
const mode = 'b';
const W = innerWidth, H = innerHeight;
function buildScene(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(0xffe2c0, 4); sun.position.set(-60, 40, -30); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, new THREE.HemisphereLight(0x9fc4ff, 0x40352a, 0.6));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.35, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  for (let i = 0; i < 40; i++) {
    const h = 8 + rnd() * 50, w = 8 + rnd() * 10;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.1, 0.25 + rnd() * 0.4), roughness: 0.6, metalness: rnd() < 0.3 ? 0.9 : 0 }));
    const a = rnd() * Math.PI * 2, r = 25 + rnd() * 90; m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(3, 64, 32), new THREE.MeshStandardMaterial({ color: 0xb01010, roughness: 0.15, metalness: 0.0 }));
  ball.position.set(0, 3, 0); ball.castShadow = true; scene.add(ball);
  for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xff5aa0, 30, 15); l.position.set(-10 + i * 4, 1.5, 6); scene.add(l);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5aa0).multiplyScalar(20) })); e.position.copy(l.position); scene.add(e); }
  const sky = new Sky(); sky.scale.setScalar(4000); const u: any = sky;
  u.turbidity.value = 6; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.85; u.sunPosition.value.copy(sun.position).normalize(); scene.add(sky);
  scene.fog = new THREE.FogExp2(0xb8a890, 0.004);
}
const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 3000); camera.position.set(14, 5, 18); camera.lookAt(0, 3, 0);
const scene = new THREE.Scene(); buildScene(scene);
const t0 = performance.now(); let frames = 0;
(window as any).PROTO = { mode, ready: false, frames: 0, ms: 0, error: null };
async function runB() {
  const T = await import('three/webgpu'); const tsl: any = await import('three/tsl');
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js'); const { ao } = await import('three/addons/tsl/display/GTAONode.js');
  const r = new (T as any).WebGPURenderer({ antialias: false }); r.setSize(W, H); r.shadowMap.enabled = true; await r.init(); document.body.append(r.domElement);
  (window as any).PROTO.backend = r.backend?.isWebGLBackend ? 'webgl2' : 'webgpu';
  const post = new (T as any).PostProcessing(r);
  const sp = tsl.pass(scene, camera); sp.setMRT(tsl.mrt({ output: tsl.output, normal: tsl.normalView }));
  const col = sp.getTextureNode('output'), dep = sp.getTextureNode('depth'), nor = sp.getTextureNode('normal');
  const aoN = ao(dep, nor, camera); const lit = col.mul(aoN.getTextureNode().x);
  post.outputNode = lit.add(bloom(lit, 1.2, 0.4, 1.0));
  const loop = async () => { await post.renderAsync(); frames++; (window as any).PROTO.frames = frames; if (frames === 3) { (window as any).PROTO.ms = performance.now() - t0; (window as any).PROTO.ready = true; } requestAnimationFrame(loop); }; loop();
}
runB().catch((e) => { (window as any).PROTO.error = String(e?.stack || e); console.error(e); });
