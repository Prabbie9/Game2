// Cast lineup / contact-sheet scene (tests/lineup): every cast body (or ?ids=a,b) standing in a row on plaza tiles under the
// game's own renderer + sky, playing ?clip= (default standard_idle) at ?at= seconds. ?lod=1 shows crowd LODs, ?v= variant.
import * as THREE from 'three';
import { Renderer } from '../renderer/renderer';
import { Environment, type WeatherName } from '../lighting/environment';
import { initKTX2, pendingLoads } from '../core/assets';
import { pbr, setTextureRes } from '../materials/pbr';
import { Character, loadCast } from '../character/character';

const p = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app')!, (p.get('tier') as any) || 'high'); initKTX2(R.renderer); setTextureRes('1k');
const env = new Environment(R); env.setTime(+(p.get('t') ?? 17.2)); env.setWeather((p.get('w') as WeatherName) || 'clear', true);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), R.setupMaterial(pbr('tiles', { antiTile: true, grime: 0.4 }, 'plaza')));
ground.receiveShadow = true; R.scene.add(ground);
const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 8, 0.5), R.setupMaterial(pbr('concrete', { grime: 0.5, tint: 0xc8c3ba }, 'struct'))); wall.position.set(0, 4, -4); wall.receiveShadow = wall.castShadow = true; R.scene.add(wall);
const dbg: any = ((window as any).HARBOURLINE_DEBUG = { ready: false, R, chars: [] as Character[] });
(async () => {
  const cast = await loadCast(); const ids = p.get('ids')?.split(',') ?? Object.keys(cast);
  const gap = +(p.get('gap') ?? 0.85); const lod = (+(p.get('lod') ?? 0)) as 0 | 1; const clip = p.get('clip') ?? 'standard_idle'; const at = +(p.get('at') ?? 1.0);
  const chars = await Promise.all(ids.map((id, i) => new Character(R, id, { lod, variant: +(p.get('v') ?? 0) + (p.has('vary') ? i : 0) }).load()));
  for (const [i, c] of chars.entries()) {
    c.root.position.set((i - (chars.length - 1) / 2) * gap, 0, 0); R.scene.add(c.root);
    const a = await c.action(p.get('bundle') ?? 'core', clip); a.play(); c.mixer.update(at + i * 0.13);
  }
  dbg.chars = chars;
  const w = (chars.length - 1) * gap + 1.2; const dist = +(p.get('dist') ?? Math.max(3.2, w * 0.95));
  R.camera.fov = 32; R.camera.position.set(0, +(p.get('cy') ?? 1.05), dist); R.camera.lookAt(0, +(p.get('ly') ?? 0.92), 0); R.camera.updateProjectionMatrix();
  dbg.heights = chars.map((c) => { const b = new THREE.Box3().setFromObject(c.model, true); c.model.updateMatrixWorld(true); const v = new THREE.Vector3(); const fz = (c.bone("LeftToeBase")?.getWorldPosition(v).z ?? 0) - (c.bone("LeftFoot")?.getWorldPosition(new THREE.Vector3()).z ?? 0); const hz = (c.bone("Head")?.getWorldPosition(new THREE.Vector3()).z ?? 0); return { id: c.id, h: +b.max.y.toFixed(3), minY: +b.min.y.toFixed(3), toeZ: +fz.toFixed(3), headZ: +hz.toFixed(3), rotY: +c.model.rotation.y.toFixed(2) }; });
  let f = 0; const loop = () => { requestAnimationFrame(loop); env.update(1 / 30); if (f === 3) env.bakeEnv(); R.render(1 / 30); f++; if (f > 8 && pendingLoads() === 0) dbg.ready = true; }; loop();
})().catch((e) => console.error('lineup', e));
