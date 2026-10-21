// Weapon socket debug view (tests/weapons): every weapon side-on on a grid with socket gizmos (grip red, support green,
// muzzle + aim ray blue, sight yellow, eject magenta, mag cyan). ?hold=1 adds the player holding ?w= with hand IK.
import * as THREE from 'three';
import { Renderer } from '../renderer/renderer';
import { Environment } from '../lighting/environment';
import { initKTX2, pendingLoads } from '../core/assets';
import { weaponMeta, weaponModel, socketGizmos } from '../weapons/models';
import { Character } from '../character/character';
import { Animator } from '../animation/animator';
import { WeaponRig } from '../weapons/rig';
import WDATA from '../data/weapons.json';

const p = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app')!, 'high'); initKTX2(R.renderer);
const env = new Environment(R); env.setTime(13); env.setWeather('overcast', true); for (let i = 0; i < 300; i++) env.update(1 / 30);
R.scene.background = new THREE.Color(0x8a9098); R.scene.fog = null;
const dbg: any = ((window as any).HARBOURLINE_DEBUG = { ready: false });
(async () => {
  const meta = await weaponMeta(); const ids = Object.keys(meta);
  if (p.get('hold')) { // one character holding a weapon, aiming along +Z (pitch ?pitch deg), side (?view=side) or front-quarter view
    const id = p.get('hold')!; const ch = await new Character(R, p.get('id') ?? 'standing_man').load(); R.scene.add(ch.root); const an = await new Animator(ch).init();
    const st = (WDATA as any)[id]?.stance; if (st) { await an.addStance(st); an.stance = st; } for (let i = 0; i < 40; i++) an.update(1 / 30, +(p.get('speed') ?? 0), 0, +(p.get('dir') ?? 0));
    const rig = new WeaponRig(R, ch); await rig.equip(id); const pitch = THREE.MathUtils.degToRad(+(p.get('pitch') ?? 0)); const aim = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)); const aiming = p.get('aim') !== '0';
    for (let i = 0; i < 30; i++) { an.update(1 / 30, +(p.get('speed') ?? 0), 0, +(p.get('dir') ?? 0)); rig.update(1 / 30, aim, aiming, 0); }
    rig.model!.add(socketGizmos(rig.meta!)); dbg.metrics = rig.metrics;
    const view = p.get('view') ?? 'side'; R.camera.fov = 30; if (view === 'side') R.camera.position.set(-3.2, 1.3, 0.3); else R.camera.position.set(1.4, 1.6, 2.6); R.camera.lookAt(0, 1.2, 0.3); R.camera.updateProjectionMatrix();
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x6b6f75 }))); fl.receiveShadow = true; R.scene.add(fl);
    let f = 0; const loop = () => { requestAnimationFrame(loop); if (f === 2) env.bakeEnv(); R.render(1 / 30); f++; if (f > 6 && pendingLoads() === 0) dbg.ready = true; }; loop(); return; }
  for (const [i, id] of ids.entries()) { const m = await weaponModel(R, id); const g = new THREE.Group(); g.add(m, socketGizmos(meta[id])); g.rotation.y = -Math.PI / 2; // side view: forward = screen right
    g.position.set((i % 4) * 1.35 - 2.0, 1.1 - Math.floor(i / 4) * 0.55, 0); const s = Math.min(1, 1.0 / meta[id].length); g.scale.setScalar(s); R.scene.add(g); }
  R.camera.fov = 40; R.camera.position.set(0, 0.55, -4.2); R.camera.lookAt(0, 0.55, 0); R.camera.updateProjectionMatrix();
  let f = 0; const loop = () => { requestAnimationFrame(loop); if (f === 2) env.bakeEnv(); R.render(1 / 30); f++; if (f > 6 && pendingLoads() === 0) dbg.ready = true; }; loop();
})().catch((e) => console.error('weapontest', e));
