// Game orchestrator (M1: vehicle feel grey-box). Owns the loop and wires renderer, environment, physics worker,
// vehicles, camera, input, audio, fx and UI. Exposes window.HARBOURLINE_DEBUG and URL params for named shots.
import * as THREE from 'three';
import { Renderer } from './renderer/renderer';
import { TIERS, pickTier, saveTier, type TierName } from './renderer/tiers';
import { Environment, type WeatherName } from './lighting/environment';
import { LightPool } from './lighting/lightpool';
import { PhysicsClient } from './physics/client';
import { buildTestArea } from './world/testarea';
import { buildTestVisuals } from './world/testvisuals';
import { buildLookSlice, type Slice } from './world/lookslice';
import { initKTX2, pendingLoads } from './core/assets';
import { setTextureRes } from './materials/pbr';
import { resolveTuning } from './vehicles/tuning';
import { CarVisual } from './vehicles/carvisual';
import { SourcedCar } from './vehicles/sourced';
import { VehicleDamage } from './vehicles/damage';
import { ChaseCamera } from './camera/chase';
import { Input } from './input/input';
import { AudioSys, EngineSound } from './audio/engine';
import { Rain, SkidMarks, Particles } from './fx/fx';
import { HUD, TuningPanel, TimeWeatherPanel, PauseMenu } from './ui/ui';
import { BotDriver, ROUTES } from './tools/bot';
import { SHOTS } from './tools/shots';
import { Pedestrian } from './character/ped';
import { Streaming } from './world/streaming';
import { HWY, UNDER, PLAZA, QUAY_Z, PIERS, groundAt } from './world/citygen';
import { Player } from './character/player';
import { FollowCamera } from './camera/follow';
import { Crowd } from './crowds/crowd';
import { CombatFX } from './fx/combatfx';
import { Combat, type Target, type WorldHit, type WeaponId } from './combat/combat';
import { Arsenal } from './combat/arsenal';
import { Combatant } from './ai/combatant';
import { TrafficSystem, type TrafficCar } from './life/traffic';
import { Wanted, type Officer } from './life/police';
import { SpawnMenu } from './ui/spawnmenu';
import { Harbour, WATER_Y } from './world/harbour';
import { CLASSES } from './vehicles/tuning';
import vehicleData from './data/vehicle_tuning.json';

const PLAYER = 1, PLAYER_CHAR = 100;
export async function startGame(app: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const probe = document.createElement('canvas').getContext('webgl2');
  const picked = pickTier(probe); const tierName = (params.get('tier') as TierName) || picked.tier;
  const R = new Renderer(app, tierName);
  const env = new Environment(R);
  const pool = new LightPool(R.scene, R.tier.maxLights);
  initKTX2(R.renderer); setTextureRes(R.tier.textureBudgetMB >= 4096 && !(window as any).HL_B64 ? '2k' : '1k'); // Artifact host: 1k sets only (download size)
  const sceneName = params.get('scene') || (params.get('shot')?.startsWith('m1_') ? 'test' : params.get('shot')?.startsWith('m2_') ? 'slice' : 'city');
  const phys = new PhysicsClient();
  let colliders: THREE.Object3D[] = [], spawn: number[] = [0, 1.2, 0], slice: Slice | null = null, vis: ReturnType<typeof buildTestVisuals> | null = null, city: Streaming | null = null;
  if (sceneName === 'city') {
    city = new Streaming(R, phys, pool, +(params.get('seed') ?? 1337)); spawn = [-4.2, 1.2, -150];
    phys.addStatics([{ kind: 'box', half: [3000, 0.5, 3000], pos: [0, -40, 0] }]); // safety floor far below the trench
    env.setProbe(new THREE.Vector3(spawn[0], 6, spawn[2]), R.tier.name === 'Low' ? 128 : 256);
  } else if (sceneName === 'test') {
    const area = buildTestArea(); vis = buildTestVisuals(R, area, pool); colliders = vis.colliders; spawn = area.spawn;
    phys.addStatics(area.statics.map(({ look, ...s }) => s)); phys.addDynamics(area.dynamics.map(({ look, ...d }) => d));
  } else {
    slice = buildLookSlice(R, pool); colliders = slice.colliders; spawn = slice.spawn; phys.addStatics(slice.statics);
    env.setProbe(new THREE.Vector3(0, 6, 0), R.tier.name === 'Low' ? 128 : 256);
  }
  let tuning = resolveTuning(params.get('vclass') ?? 'sedan', 'Balanced');
  let spawned = !city; if (!city) phys.spawnVehicle(PLAYER, tuning, spawn, 0);
  // traffic fleet: one class per car slot (sourced models from the same family)
  const TRAFFIC_CLASSES = ['sedan2', 'taxi', 'sedan3', 'compact', 'van', 'sports', 'muscle', 'suv', 'pickup', 'police', 'wagon', 'truck', 'ambulance'];
  const makeCar = (paint: number, beams = false, cls?: string): CarVisual | SourcedCar => { const tt = cls ? resolveTuning(cls, 'Grippy') : tuning; const model = tt.model; if (model) { const c = new SourcedCar(R, model, { paint, beams, seatFront: (tt as any).seatFront }); c.load().catch((e) => console.warn('vehicle model', e?.message)); return c; } return new CarVisual(R, { color: paint, beams, ...tuning }); };
  // ambient traffic (look slice): bot cars on fixed lanes, stopping at red lights, wrapping at the slice edge
  const traffic: { id: number; vis: CarVisual | SourcedCar; lane: [number, number]; axis: number; dir: number; bot: BotDriver; wrap?: number; y?: number; cls?: string; dmg?: VehicleDamage }[] = [];
  // city traffic (M3 placeholder for M7's lane-graph traffic): right-hand lanes on the highway deck and the main arterial
  if (city) [[HWY.z + 4, 1, 1, 0x2a4d7a, -600, 10.2], [HWY.z - 4, 1, -1, 0xd9d6cc, 400, 10.2], [HWY.z + 8, 1, 1, 0x6b6e72, -200, 10.2], [4.2, 0, -1, 0x1b1c1e, 300, 1.2], [-8.4, 0, 1, 0x7a1f1f, -60, 1.2], [8.4, 0, -1, 0xc8b78a, 100, 1.2]].filter((e) => e[5] > 5).forEach(([lane, axis, dir, col, start, y], i) => {
    const id = 10 + i; const pos = axis ? [start, y, lane] : [lane, y, start]; const yaw = axis ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    const cls = TRAFFIC_CLASSES[i % TRAFFIC_CLASSES.length]; const v = makeCar(col as number, false, cls); R.scene.add(v.root); const pts: [number, number][] = axis ? [[-2000 * dir, lane], [2000 * dir, lane]] : [[lane, -2000 * dir], [lane, 2000 * dir]];
    traffic.push({ id, vis: v, lane: [lane, 0], axis, dir, bot: new BotDriver(pts, axis ? 22 : 13), wrap: axis ? 780 : 600, y, cls }); void pos; void yaw;
  });
  if (slice) [[4.2, -1, 0, 1, 0x2a4d7a, 20], [-4.2, 1, 0, -1, 0xd9d6cc, -50], [-4.2, 1, 1, 1, 0x1b1c1e, 30], [1.4, -1, 0, 1, 0x6b6e72, -40], [-1.4, 1, 0, -1, 0x7a1f1f, 60], [4.2, 1, 1, -1, 0xc8b78a, -20]].forEach(([lane, , axis, dir, col, start], i) => {
    const id = 10 + i; const z0 = start as number; const pos = axis ? [z0, 1.2, lane as number] : [lane as number, 1.2, z0];
    phys.spawnVehicle(id, resolveTuning('sedan', 'Grippy'), pos, axis ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI);
    const v = makeCar(col as number); R.scene.add(v.root);
    const pts: [number, number][] = axis ? [[-200 * dir, lane as number], [200 * dir, lane as number]] : [[lane as number, -200 * dir], [lane as number, 200 * dir]];
    traffic.push({ id, vis: v, lane: [lane as number, 0], axis: axis as number, dir: dir as number, bot: new BotDriver(pts, 11) });
  });
  // placeholder pedestrians on the slice sidewalks (Mixamo characters + Mixamo clips through our animation pipeline)
  const peds: Pedestrian[] = [];
  const CIV = ['lod_andrew', 'lod_paul', 'lod_nancy', 'lod_jessica', 'lod_dude', 'man_coat', 'oldman_coat', 'debra', 'young_female', 'biz_jj', 'police_m', 'police_f'];
  if (city) [[[14, -170], [14, -110]], [[-14.6, -120], [-14.6, -178]], [[15.6, -140], [15.6, -196]], [[-15.8, -160], [-15.8, -100]], [[13.6, -128], [13.6, -88]], [[-13.9, -186], [-13.9, -132]], [[16.3, -100], [16.3, -160]], [[-16.4, -110], [-16.4, -150]]]
    .forEach((path, i) => peds.push(new Pedestrian(R, CIV[(i * 5 + 1) % CIV.length], path as [number, number][], 0.15, i % 4, Math.abs(path[0][0]) < 15 && Math.abs(path[0][1] + 150) < 30 ? 0 : 1)));
  if (slice) ([[[10.5, -60], [10.5, -14], [14, -11]], [[-10.6, -30], [-10.6, -80]], [[-40, 10.6], [-12, 10.6]], [[20, -10.6], [60, -10.6]], [[-10.6, 20], [-10.6, 70]], [[12, 40], [12, 12], [40, 11]], [[-60, -10.6], [-14, -10.6]], [[30, 10.6], [80, 10.6]]] as [number, number][][])
    .forEach((path, i) => peds.push(new Pedestrian(R, CIV[(i * 3) % CIV.length], path, 0.15, i % 4, 0)));
  peds.forEach((p) => { p.phys = phys; p.load().catch((e) => console.warn('ped load', e?.message)); });
  const cfxHolder: { fx: CombatFX | null } = { fx: null }; const cfxRef = () => cfxHolder.fx!;
  let car = makeCar(0x7d1520, true); R.scene.add(car.root);
  const velState = new Map<number, { p: THREE.Vector3; t: number; v: THREE.Vector3; snaps: number }>(); const damages = new Map<number, VehicleDamage>(); const prevPos = new Map<number, THREE.Vector3>();
  const addDamage = (id0: number, vis: { root: THREE.Object3D; modelSpace?: THREE.Object3D }, massK = 1) => { const d = new VehicleDamage(vis, cfxRef(), massK); d.onExplode = (p) => { const id = [...damages].find(([, v]) => v === d)?.[0] ?? id0; combat.explode(p.clone().add(new THREE.Vector3(0, 0.5, 0)), 6, 260, 14, 'car' + id);
      phys.setTuning(id, { ...(id === PLAYER ? tuning : resolveTuning(traffic.find((t) => t.id === id)?.cls ?? life?.cars.find((c) => c.id === id)?.cls ?? 'sedan', 'Grippy')), maxDriveForce: 0, powerW: 0, boostForce: 0 });
      if (id === PLAYER && player.state === 'drive') { player.exit(); } }; damages.set(id0, d); return d; };
  const chase = new ChaseCamera(R.camera, colliders); if (city) chase.cast = (o, d, f) => city!.cast(o, d, f);
  const follow = new FollowCamera(R.camera); if (city) follow.cast = (o, d, f) => city!.cast(o, d, f);
  const harbour = city ? new Harbour(R, phys, pool, city.mats.get('concrete')) : null; const boat = harbour?.boat ?? null;
  const player = new Player(R, phys, PLAYER_CHAR, params.get('char') ?? 'standing_man'); let playerLoading = false;
  const crowdMin = params.get('crowdmin'); const stress = params.has('stress'); const crowd = new Crowd(R, stress ? 100 : Math.round(+(params.get('crowd') ?? 220) * R.tier.crowd), ['lod_andrew', 'lod_paul', 'lod_jessica', 'lod_dude', 'debra', 'young_female', 'biz_jj', 'oldman_coat']); if (crowdMin) crowd.minDist = +crowdMin;
  const loadPlayer = () => { if (playerLoading) return; playerLoading = true; const st = phys.vehicle(PLAYER); const yaw0 = spawnYaw;
    const pos = onFootStart ? [spawn[0] - 3.4, city ? 0.16 : 0.05, spawn[2] + 3] : [spawn[0], 0, spawn[2]];
    player.load(pos, shot?.foot?.faceYaw ?? yaw0 + Math.PI / 2).then(() => { arsenal = new Arsenal(R, player, combat, input, follow, app); if (shot?.foot?.weapon) arsenal.equip(shot.foot.weapon as WeaponId); if (city && !params.has('nocrowd')) crowd.load().catch((e) => console.warn('crowd', e?.message)); if (!onFootStart) player.seatIn(car); else follow.snapBehind(shot?.foot?.camYaw ?? shot?.foot?.faceYaw ?? yaw0 + Math.PI / 2); void st; }).catch((e) => console.warn('player', e?.message)); };
  // combat: FX pools, world ray (streamed boxes + analytic ground), targets (pedestrians, player, cars)
  const cfx = new CombatFX(R.scene, R.tier.maxLights > 6 ? 4 : 2); cfxHolder.fx = cfx; cfx.ground = (x, z) => (city ? groundAt(x, z) : 0.15);
  const castWorld = (o: THREE.Vector3, d: THREE.Vector3, far: number): WorldHit | null => { let best: WorldHit | null = null;
    const h = city?.castHit(o, d, far); if (h) best = { t: h.t, p: h.p, n: h.n, kind: h.n.y > 0.7 ? 'concrete' : Math.random() < 0.3 ? 'glass' : 'concrete' };
    if (d.y < -1e-4) { let t = (cfx.ground(o.x, o.z) - o.y) / d.y; for (let i = 0; i < 2; i++) { const q = o.clone().addScaledVector(d, t); t = (cfx.ground(q.x, q.z) - o.y) / d.y; }
      if (t > 0 && t < far && (!best || t < best.t)) best = { t, p: o.clone().addScaledVector(d, t), n: new THREE.Vector3(0, 1, 0), kind: 'concrete' }; }
    return best; };
  const combat = new Combat(cfx, castWorld); combat.onExplode = (p, r, st) => phys.explode(p.toArray(), r, st); // st = delta-v (m/s) at the centre
  const pedTarget = (pd: Pedestrian, i: number): Target => ({ id: 'ped' + i, ch: pd.ch, team: 2, get alive() { return !pd.dead; }, get health() { return pd.health; }, pos: () => pd.worldPos, hit: (dmg, dir, _z, force) => pd.hit(dmg, dir, force) });
  let playerHealth = 200; const playerTarget: Target & { speed: number } = { id: 'player', ch: player.ch, team: 0, alive: true, get speed() { return player.speed; }, get health() { return playerHealth; }, pos: () => player.position,
    hit: (dmg, dir, _z, force) => { if ((dbg as any).god) return; playerHealth -= dmg; if ((playerHealth <= 0 || force > 7) && player.onFoot) { player.knockDown(dir.clone().setY(0).normalize().multiplyScalar(Math.min(8, force)).add(new THREE.Vector3(0, 1.5, 0))); } if (playerHealth <= 0 && !wastedT) { wastedT = 5; player.rag.stayDown = true; if (player.state === 'drive') player.exit(); if (player.onFoot) player.knockDown(dir.clone().setY(0).normalize().multiplyScalar(3).add(new THREE.Vector3(0, 1, 0))); banner('WASTED'); } } };
  let wastedT = 0; const bannerEl = document.createElement('div'); bannerEl.className = 'hl-banner'; bannerEl.hidden = true; app.append(bannerEl);
  const banner = (t: string) => { bannerEl.textContent = t; bannerEl.hidden = !t; };
  combat.targets.push(playerTarget); peds.forEach((pd, i) => combat.targets.push(pedTarget(pd, i)));
  const carHalf = (id: number) => (id === PLAYER ? tuning.halfExtents : resolveTuning(traffic.find((t) => t.id === id)?.cls ?? life?.cars.find((c) => c.id === id)?.cls ?? 'sedan', 'Grippy').halfExtents);
  const carTarget = (id: number): Target => ({ id: 'car' + id, ch: null, team: 3, alive: true, health: 1000, pos: () => { const st = phys.vehicle(id); return st ? new THREE.Vector3(...st.pos) : new THREE.Vector3(0, -99, 0); }, hit: (dmg, dir) => { const st = phys.vehicle(id); if (st) damages.get(id)?.hit(dmg * 1.4, new THREE.Vector3(...st.pos).addScaledVector(dir, -1).add(new THREE.Vector3(0, 0.7, 0)), dir); },
    get vehicle() { const st = phys.vehicle(id); return st ? { pos: new THREE.Vector3(...st.pos), quat: new THREE.Quaternion(...st.quat), half: carHalf(id) } : undefined; } });
  combat.targets.push(carTarget(PLAYER)); traffic.forEach((t) => combat.targets.push(carTarget(t.id)));
  addDamage(PLAYER, car as any); traffic.forEach((t) => { t.dmg = addDamage(t.id, t.vis as any, resolveTuning(t.cls ?? 'sedan', 'Grippy').mass / 1350); });
  // street traffic (M7): AI cars on the grid around the player; carjack swaps the player's car with a traffic car
  const PAINTS = [0x7d1520, 0x1b2a44, 0xd9d6cc, 0x2d2f33, 0x4a5a3a, 0x8a6a2a, 0x5a1d4a, 0x9aa3ad, 0x14161a, 0x2f5f7a];
  const LIVERY: Record<string, number> = { taxi: 0xe2b21a, police: 0xeeeeee, ambulance: 0xf0f0f0, wagon: 0xa8141c };
  let playerCls = params.get('vclass') ?? 'sedan'; let gunfire: THREE.Vector3 | null = null;
  const phase = (axis: number) => { const t = (lightT - axis * 14 + 28) % 28; return t < 10 ? 'g' : t < 13 ? 'a' : 'r'; };
  const disposeVis = (o: THREE.Object3D) => o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); for (const mt of [m.material].flat()) (mt as THREE.Material).dispose(); } });
  const life: TrafficSystem | null = city ? new TrafficSystem({ phys, camera: R.camera, readyAt: (x, z) => city!.readyAt(x, z), phase, wrecked: (id) => !!damages.get(id)?.wrecked, tuning: (c) => resolveTuning(c, 'Grippy'),
    spawnVis: (cls, id) => { const v = makeCar(LIVERY[cls] ?? PAINTS[Math.floor(Math.random() * PAINTS.length)], false, cls) as SourcedCar; R.scene.add(v.root); addDamage(id, v as any, resolveTuning(cls, 'Grippy').mass / 1350); combat.targets.push(carTarget(id)); return v; },
    removeVis: (c) => { R.scene.remove(c.vis.root); disposeVis(c.vis.root); damages.delete(c.id); prevPos.delete(c.id); velState.delete(c.id); combat.targets = combat.targets.filter((t) => t.id !== 'car' + c.id); },
    obstacles: () => { const o: THREE.Vector3[] = []; if (state) o.push(new THREE.Vector3(...state.pos)); if (player.ready && player.state !== 'drive') o.push(player.position.clone()); for (const pd of peds) if (!pd.dead) o.push(pd.worldPos); return o; } }, stress ? 40 : Math.round(+(params.get('traffic') ?? 16) * (R.tier.name === 'Lite' ? 0.25 : R.tier.crowd > 0.6 ? 1 : 0.6))) : null;
  combat.onEvent = (kind, owner, pos, tg) => { if (kind !== 'hit') { gunfire = pos.clone(); crowd.scare(pos, kind === 'explode' ? 60 : 40); const d = pos.distanceTo(R.camera.position); if (kind === 'explode') audio.boom(d); else audio.gun(d, owner === 'player' && ['shotgun', 'sniper', 'rpg'].includes(arsenal?.cur ?? '')); }
    if (owner !== 'player' || !wanted) return;
    if (kind === 'shot') wanted.crime('shot'); else if (kind === 'explode') wanted.crime('carBomb');
    else if (tg && tg.id !== 'player' && !tg.id.startsWith('car')) { const cop = cops.some((c) => c.tgt === tg); wanted.crime(cop ? (tg.alive ? 'hitCop' : 'killCop') : tg.alive ? 'hitPed' : 'killPed'); } };
  // police (M7): officers are Combatants in police uniforms; cruisers come from the traffic system
  const cops: Combatant[] = [];
  const wanted: Wanted | null = life ? new Wanted({ traffic: life, get audio() { return audio; }, onBusted: () => { banner('BUSTED'); wastedT = 3.5; },
    los: (a, b) => { const d = b.clone().sub(a); const L = d.length(); return city!.cast(a, d.normalize(), L) === null; },
    player: () => ({ pos: player.position.clone(), inCar: player.state === 'drive', carState: player.state === 'drive' ? state : null, onFoot: player.onFoot, speed: player.state === 'drive' ? Math.abs(state?.vf ?? 0) : player.speed }),
    spawnOfficer: (at, weapon, yaw): Officer => { at.y = groundAt(at.x, at.z); const c = new Combatant(R, phys, combat, { boxes: () => city?.allBoxes() ?? [] }, Math.random() < 0.7 ? 'police_m' : 'police_f', 1, weapon); cops.push(c);
      c.load(at, yaw).then(() => c.alert(player.position.clone())).catch((e) => console.warn('cop', e?.message));
      return { pos: () => c.ch.root.position, get dead() { return c.state === 'dead'; }, update: (dt) => c.update(dt, playerTarget, cops),
        dispose: () => { R.scene.remove(c.ch.root); if (c.state !== 'dead') phys.removeChar(c.id); combat.targets = combat.targets.filter((t) => t !== c.tgt); cops.splice(cops.indexOf(c), 1); } }; } }, app) : null;
  const barMats = [new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 }), new THREE.MeshStandardMaterial({ color: 0x000022, emissive: 0x1030ff, emissiveIntensity: 0 })];
  /** Roof light bar for cruisers: added once the model is loaded; per-car material copies so each flashes on its own. */
  const lightBar = (v: SourcedCar & { bar?: THREE.Mesh[] }, f: number) => { if (!v.ready) return; if (!v.bar) { const b = new THREE.Box3().setFromObject(v.body); const loc = v.root.worldToLocal(b.max.clone()); const y = loc.y + 0.06;
      v.bar = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.22), barMats[i].clone()); m.position.set(i ? -0.24 : 0.24, y, -0.2); v.root.add(m); return m; }); }
    (v.bar[0].material as THREE.MeshStandardMaterial).emissiveIntensity = f === 1 ? 12 : 0.2; (v.bar[1].material as THREE.MeshStandardMaterial).emissiveIntensity = f === 2 ? 12 : 0.2; };
  const yawOf = (q: number[]) => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...q)); return Math.atan2(f.x, f.z); };
  /** Carjack: the player's physics id takes over the traffic car; the old player car becomes an abandoned slot. */
  const jack = (t: TrafficCar) => { const st = phys.vehicle(t.id), mine = phys.vehicle(PLAYER); if (!st || damages.get(t.id)?.wrecked) return false;
    const oldCls = playerCls, oldVis = car, oldDmg = damages.get(PLAYER), tDmg = damages.get(t.id); if (t.mode === 'drive' || t.mode === 'pursuit') wanted?.crime(t.cls === 'police' ? 'hitCop' : 'jack'); if (t.mode === 'pursuit' && wanted) wanted.units = wanted.units.filter((u) => u !== t);
    tuning = resolveTuning(t.cls, 'Balanced'); playerCls = t.cls; phys.spawnVehicle(PLAYER, tuning, [st.pos[0], st.pos[1] + 0.05, st.pos[2]], yawOf(st.quat)); car = t.vis as any; if (tDmg) damages.set(PLAYER, tDmg);
    if (mine && oldDmg) { phys.spawnVehicle(t.id, resolveTuning(oldCls, 'Grippy'), [mine.pos[0], mine.pos[1] + 0.05, mine.pos[2]], yawOf(mine.quat)); t.vis = oldVis as any; t.cls = oldCls; t.mode = 'abandoned'; damages.set(t.id, oldDmg); if (oldDmg.wrecked) phys.setTuning(t.id, { ...resolveTuning(oldCls, 'Grippy'), maxDriveForce: 0, powerW: 0 }); }
    else { R.scene.remove(oldVis.root); }
    if (engine) { engine.dispose(); engine = new EngineSound(audio, tuning.engineSound); } (dbg as any).jacks = ((dbg as any).jacks ?? 0) + 1; return true; };
  let arsenal: Arsenal | null = null; const hostiles: Combatant[] = [];
  const spawnHostiles = (n = 3, dist = 26, body = 'fsb_op') => { const base = player.position.clone(); const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    for (let i = 0; i < n; i++) { const p = base.clone().addScaledVector(f, dist + i * 3).add(new THREE.Vector3((i - (n - 1) / 2) * 2.5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)); p.y = city ? groundAt(p.x, p.z) : 0.15;
      const c = new Combatant(R, phys, combat, { boxes: () => city?.allBoxes() ?? [] }, i % 3 === 2 ? 'swat_op' : body); hostiles.push(c); c.load(p, player.yaw + Math.PI).catch((e) => console.warn('ai', e?.message)); } };
  // ground under a foot: analytic city surfaces (exact, no latency) unless the physics ray finds something else (props, car roofs)
  const groundFn = (side: 0 | 1, x: number, z: number) => { const ps = player.phys; const nearY = player.position.y; const a = city ? groundAt(x, z, nearY) : 0;
    const py = ps ? ps.footY[side] : a; const y = Math.abs(py - a) < 0.2 || !ps ? a : py; const n = ps && y === py ? new THREE.Vector3(...ps.footN[side]) : new THREE.Vector3(0, 1, 0); return { y, n }; };
  const input = new Input(R.renderer.domElement);
  const audio = new AudioSys(); let engine: EngineSound | null = null;
  const rain = new Rain(R.scene, Math.round(9000 * R.tier.particles)); const skids = new SkidMarks(R.scene); const smoke = new Particles(R.scene, Math.round(500 * R.tier.particles)); const steam = new Particles(R.scene, Math.round(260 * R.tier.particles));
  const hud = new HUD(app);
  const tunePanel = new TuningPanel('sedan', (t) => { tuning = { ...tuning, ...t }; phys.setTuning(PLAYER, tuning); }, (s) => hud.say(s));
  const twPanel = new TimeWeatherPanel(env);
  // photo mode (P): frozen world, free orbit camera, HUD hidden
  const photo = { on: false, yaw: 0, pitch: 0.3, dist: 6, fov: 50, target: new THREE.Vector3() }; const photoHint = document.createElement('div'); photoHint.className = 'hl-photo'; photoHint.hidden = true;
  photoHint.textContent = 'PHOTO MODE · WASD / mouse orbit · R/F zoom · Q/E field of view · [ ] time of day · P exit'; app.append(photoHint);
  const inBoatNow = () => !!boat && player.state === 'drive' && player.car === (boat as any);
  /** Spawn menu vehicle: a new player car beside the player (or replacing the one they sit in); the previous car stays as a driverless car. */
  const spawnPlayerCar = (cls: string) => { const mine = phys.vehicle(PLAYER); const seated = player.state === 'drive'; const oldVis = car, oldDmg = damages.get(PLAYER), oldCls = playerCls;
    const yaw = seated && mine ? yawOf(mine.quat) : player.yaw; const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const at = seated && mine ? new THREE.Vector3(...mine.pos) : player.position.clone().addScaledVector(right, 3.4);
    if (!seated && mine && life && oldDmg) { const c = life.adopt(oldCls, oldVis as any, mine.pos, yawOf(mine.quat)); damages.set(c.id, oldDmg); combat.targets.push(carTarget(c.id)); } else { R.scene.remove(oldVis.root); }
    tuning = resolveTuning(cls, 'Balanced'); playerCls = cls; phys.spawnVehicle(PLAYER, tuning, [at.x, (city ? groundAt(at.x, at.z) : 0) + 1.0, at.z], yaw);
    car = makeCar(LIVERY[cls] ?? PAINTS[Math.floor(Math.random() * PAINTS.length)], true); R.scene.add(car.root); addDamage(PLAYER, car as any, tuning.mass / 1350);
    if (engine) { engine.dispose(); engine = new EngineSound(audio, tuning.engineSound); } if (seated) player.seatIn(car); hud.say((vehicleData.classes as any)[cls]?.label ?? cls); };
  const PLACES = (): Record<string, { label: string; p: [number, number, number]; yaw: number }> => ({ downtown: { label: 'Downtown (start)', p: [spawn[0] - 3.4, 0.16, spawn[2] + 3], yaw: spawnYaw + Math.PI / 2 },
    plaza: { label: 'Plaza', p: [(PLAZA.x0 + PLAZA.x1) / 2, 0.16, PLAZA.z0 + 4], yaw: 0 }, tunnel: { label: 'Underpass', p: [UNDER.x + 14, 0.16, UNDER.z0 - 40], yaw: 0 }, highway: { label: 'Highway ramp', p: [-900, 0.16, HWY.z - 14], yaw: Math.PI / 2 }, harbour: { label: 'Harbour', p: [PIERS[0][0] + 2, 0.05, QUAY_Z + 30], yaw: 0 } });
  const spawnMenu = new SpawnMenu(app, { vehicles: CLASSES.map((c) => ({ id: c, label: (vehicleData.classes as any)[c].label })), weapons: ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rpg', 'bat', 'knife', 'crowbar'],
    places: Object.entries({ downtown: { label: 'Downtown (start)' }, plaza: { label: 'Plaza' }, tunnel: { label: 'Underpass' }, highway: { label: 'Highway ramp' }, harbour: { label: 'Harbour' } }).map(([id, v]) => ({ id, label: v.label })), weathers: ['clear', 'overcast', 'rain', 'fog', 'storm'],
    spawnVehicle: spawnPlayerCar, giveWeapon: (id) => { if (player.state === 'drive') return; arsenal?.equip(id as WeaponId); },
    teleport: (id) => { const pl = PLACES()[id]; const p = new THREE.Vector3(...pl.p); p.y = city ? groundAt(p.x, p.z) : p.y; if (player.state === 'drive') phys.teleportVehicle(PLAYER, [p.x, p.y + 1.2, p.z], pl.yaw); else player.respawn(p, pl.yaw); },
    setTraffic: (n) => { if (life) life.max = n; }, addStar: () => wanted?.setStars(Math.min(5, wanted.stars + 1)), clearWanted: () => wanted?.clear(),
    setGod: (on) => ((dbg as any).god = on), setNeverWanted: (on) => { if (wanted) { wanted.disabled = on; if (on) wanted.clear(); } return on; },
    setTime: (h) => env.setTime(h), setWeather: (w) => env.setWeather(w as WeatherName), onClose: () => { if (paused && !pause.open) paused = false; } });
  const pause = new PauseMenu(app, input, { resume: () => setPause(false), tiers: Object.keys(TIERS), current: () => tierName,
    tier: (t) => { R.setTier(t as TierName); pool.max = R.tier.maxLights; saveTier(t as TierName); hud.say(`Quality: ${TIERS[t as TierName].name}`); },
    sensitivity: (v) => (input.sensitivity = v), comfort: R.comfort, onComfort: () => { chase.shake = R.comfort.shake; } });
  hud.setHint('W/S drive · A/D steer · Space handbrake · Shift boost · V camera · K tuning · T time & weather · Esc menu');
  let paused = false; const setPause = (p: boolean) => { paused = p; pause.show(p); if (p) document.exitPointerLock?.(); };
  // audio + pointer lock need a user gesture
  const gesture = () => { audio.resume(); if (!engine) engine = new EngineSound(audio, tuning.engineSound); };
  addEventListener('keydown', gesture); R.renderer.domElement.addEventListener('mousedown', () => { gesture(); if (!paused) R.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); });

  // defaults: golden hour; URL params / shots override
  env.setTime(+(params.get('t') ?? 18.6)); env.setWeather((params.get('w') as WeatherName) || 'clear', true);
  let bot: BotDriver | null = null; let botYaw = 0;
  const shot = params.get('shot') ? { ...SHOTS[params.get('shot')!], ...(params.get('frames') ? { frames: +params.get('frames')! } : {}) } : null;
  if (shot) { env.setTime(shot.t); env.setWeather(shot.w, true); if (shot.route) bot = new BotDriver(ROUTES[shot.route], shot.speed ?? 20); hud.root.hidden = !!shot.hideHud; }
  if (params.get('bot')) { const rt = ROUTES[params.get('bot')!] ?? ROUTES.loop; bot = new BotDriver(rt, +(params.get('speed') ?? 22));
    if (city && !shot) { spawn = [rt[0][0], params.get('bot') === 'highway' ? 1.6 : 1.2, rt[0][1]]; botYaw = Math.atan2(rt[1][0] - rt[0][0], rt[1][1] - rt[0][1]); } }
  if (shot?.start) { if (city) spawn = shot.start; else phys.teleportVehicle(PLAYER, shot.start, shot.yaw ?? 0); }
  const spawnYaw = shot?.yaw ?? botYaw;
  // default sandbox start is on foot beside the parked car; shots and bot routes start seated
  const onFootStart = (!!city && !shot && !params.get('bot')) || params.has('foot') || !!shot?.foot;
  if (onFootStart && city && !shot?.start) spawn = [-10.4, 1.2, -150];

  const focusPt = () => (player.ready && player.state !== 'drive' ? player.position.clone() : state ? new THREE.Vector3(...state.pos) : new THREE.Vector3(spawn[0], 0, spawn[2]));
  const clock = new THREE.Clock(); let frames = 0, loadedOnce = false, lightT = 0; let state: ReturnType<PhysicsClient['vehicle']> = null;
  const tmp = { q: new THREE.Quaternion(), p: new THREE.Vector3(), v: new THREE.Vector3(), prevP: new THREE.Vector3() };
  const dbg: any = (window as any).HARBOURLINE_DEBUG = {
    ready: false, frames: 0, R, env, phys, report: [] as any[], player, crowd, get harbour() { return harbour; },
    teleport: (x: number, y: number, z: number, yaw = 0) => phys.teleportVehicle(PLAYER, [x, y, z], yaw),
    setTime: (h: number) => env.setTime(h), setWeather: (w: WeatherName) => env.setWeather(w, true),
    spawnVehicle: (cls = 'sedan') => { tuning = resolveTuning(cls, 'Balanced'); phys.spawnVehicle(PLAYER, tuning, [state?.pos[0] ?? 0, (state?.pos[1] ?? 0) + 2, state?.pos[2] ?? 0], 0); R.scene.remove(car.root); car = makeCar(0x7d1520, true); R.scene.add(car.root); addDamage(PLAYER, car as any); if (engine) { engine.dispose(); engine = new EngineSound(audio, tuning.engineSound); } if (player.state === 'drive') player.seatIn(car); },
    traffic: () => life && { ...life.stats, cars: life.cars.map((c) => ({ id: c.id, cls: c.cls, mode: c.mode, axis: c.axis, dir: c.dir, k: c.k, turning: !!c.turn, why: c.why, stuck: +c.stuck.toFixed(1), pos: phys.vehicle(c.id)?.pos.map((v) => +v.toFixed(1)), kmh: +((phys.vehicle(c.id)?.vf ?? 0) * 3.6).toFixed(0) })) },
    crime: (k: any) => wanted?.crime(k), wanted: () => wanted && { stars: wanted.stars, unseen: +wanted.unseen.toFixed(1), units: wanted.units.length, officers: wanted.officers.length, cops: cops.map((c) => c.state), stats: wanted.stats }, playerDamage: (n = 50) => playerTarget.hit(n, new THREE.Vector3(1, 0, 0), 'torso', 2),
    setTraffic: (n: number) => { if (life) life.max = n; }, get trafficSys() { return life; }, pending: () => pendingLoads(),
    jackNearest: () => { const t = life?.nearest(player.position, 30); return t ? jack(t) : false; },
    dmgState: (id = PLAYER) => { const d: any = damages.get(id); return d && { hp: d.health, wrecked: d.wrecked, charred: d.charred, ready: (d.car as any).ready, same: d.car === car, burnT: d.burnT, pos: d.car.root.position.toArray().map((v: number) => +v.toFixed(1)), vis: d.car.root.visible, inScene: !!d.car.root.parent, cols: (() => { const a: string[] = []; d.car.root.traverse((o: any) => { if (o.isMesh && a.length < 6) a.push(o.material.color?.getHexString() + ':' + o.material.clearcoat); }); return a; })() }; },
    damage: (id = PLAYER, dmg = 300) => { const st = phys.vehicle(id); if (st) damages.get(id)?.hit(dmg, new THREE.Vector3(...st.pos).add(new THREE.Vector3(0, 0.7, 1.8)), new THREE.Vector3(0, 0, -1)); return damages.get(id)?.health; },
    setVelocity: (kmh: number) => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(tmp.q); phys.setVelocity(PLAYER, [f.x * kmh / 3.6, 0, f.z * kmh / 3.6]); },
    bot: (route = 'loop', speed = 22) => { bot = route ? new BotDriver(ROUTES[route], speed) : null; },
    stats: () => ({ ...R.stats, chunks: city?.stats, fps: Math.round(1 / Math.max(1e-3, clock.getDelta())), physicsMs: +phys.lastStepMs.toFixed(2), vehicle: state && { kmh: +(state.vf * 3.6).toFixed(1), slipDeg: +(state.slip * 57.3).toFixed(1), contacts: state.contacts }, tier: R.tier.name, heapMB: Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6) }),
    passes: () => R.composer.passes.map((p: any) => `${p.name}:${p.enabled}:${p.effects ? p.effects.map((e: any) => e.name).join('+') : ''}`),
    // these arrive in later milestones; present so tools can call them safely
    giveWeapon: (id: WeaponId | null) => arsenal?.equip(id), explode: (x: number, y: number, z: number, r = 6) => combat.explode(new THREE.Vector3(x, y, z), r, 250, 12, 'debug'), combat: () => ({ ...combat.stats, arsenal: arsenal && { cur: arsenal.cur, rig: arsenal.rig.metrics } }),
    spawnHostiles: (n = 3, d = 26) => spawnHostiles(n, d), hostiles: () => hostiles.map((h) => ({ state: h.state, hp: Math.round(h.health), pos: h.ch.root.position.toArray().map((v) => +v.toFixed(1)) })), playerHealth: () => playerHealth,
    spawnPed: () => null, ragdoll: (v = [0, 3, 6]) => player.knockDown(new THREE.Vector3(...v)), knockPeds: () => peds.forEach((p) => p.knockDown(new THREE.Vector3(1, 2.5, 3))), setWanted: () => null,
  };

  function frame() {
    requestAnimationFrame(frame);
    const report = params.has('report'); const dt = shot || report ? 1 / 30 : Math.min(clock.getDelta(), 0.1);
    if (input.pressed('photoMode') && !spawnMenu.open && !pause.open) { photo.on = !photo.on; paused = photo.on; app.classList.toggle('photo', photo.on); photoHint.hidden = !photo.on;
      if (photo.on) { photo.target = (player.state === 'drive' ? (inBoatNow() ? boat!.root.position.clone() : tmp.p.clone()) : player.position.clone()).add(new THREE.Vector3(0, 1.1, 0)); const d = R.camera.position.clone().sub(photo.target); photo.dist = d.length(); photo.yaw = Math.atan2(d.x, d.z); photo.pitch = Math.asin(THREE.MathUtils.clamp(d.y / photo.dist, -1, 1)); photo.fov = R.camera.fov; } }
    if (input.pressed('spawnMenu') || (spawnMenu.open && input.pressed('pause'))) { const o = spawnMenu.toggle(); paused = o; if (o) document.exitPointerLock?.(); }
    else if (input.pressed('pause')) setPause(!paused);
    if (input.pressed('tuning')) { if (tunePanel.toggle()) document.exitPointerLock?.(); }
    if (input.pressed('timeWeather')) { if (twPanel.toggle()) document.exitPointerLock?.(); }
    audio.ambience(paused ? 0.3 : 1 - env.night * 0.5);
    input.poll(); if (input.pad.connected && !(dbg as any).padSaid) { (dbg as any).padSaid = true; hud.say('Controller connected'); }
    if (input.pressed('frameOverlay')) hud.toggleOverlay();
    if (input.pressed('camera')) chase.cycle();
    const sim = paused ? 0 : dt;
    if (city) {
      const focus = player.ready && player.state !== 'drive' ? player.position.clone() : state ? new THREE.Vector3(state.pos[0], state.pos[1], state.pos[2]) : new THREE.Vector3(spawn[0], 0, spawn[2]); city.update(focus);
      if (!spawned && city.readyAt(spawn[0], spawn[2])) { phys.spawnVehicle(PLAYER, tuning, spawn, spawnYaw); spawned = true; loadPlayer();
        for (const t of traffic) phys.spawnVehicle(t.id, resolveTuning(t.cls ?? 'sedan', 'Grippy'), t.axis ? [t.bot.pts[0][0] * 0 + (t.dir > 0 ? -600 + t.id * 90 : 500 - t.id * 60), t.y!, t.lane[0]] : [t.lane[0], t.y!, t.dir > 0 ? -300 + t.id * 40 : 300 - t.id * 40], t.axis ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : t.dir > 0 ? 0 : Math.PI); }
      lightT = (lightT + sim) % 28; city.mats.update(env.night, phase);
      if (state && env.probe && Math.hypot(state.pos[0] - env.probe.pos.x, state.pos[2] - env.probe.pos.z) > 160 && city.pending === 0) { env.probe.pos.set(state.pos[0], state.pos[1] + 6, state.pos[2]); env.probe.cube.position.copy(env.probe.pos); env.bakeEnv(); }
    }
    if (!city && !playerLoading) loadPlayer();
    // vehicle input: player (only while seated) or bot; a parked car holds its handbrake
    const driving = player.state === 'drive' || (!player.ready && !onFootStart);
    let vin = driving ? { steer: input.axis('steerLeft', 'steerRight'), throttle: input.value('throttle'), brake: input.value('brake'), handbrake: input.value('handbrake'), boost: input.value('boost') } : { steer: 0, throttle: 0, brake: 0, handbrake: 1, boost: 0 };
    if (bot && state) vin = bot.drive(state, tmp.q);
    const inBoat = !!boat && player.state === 'drive' && player.car === (boat as any);
    const bt = (shot?.foot as any)?.boatThrottle; if (inBoat && bt !== undefined && player.state === 'drive') vin = { steer: (shot!.foot as any).boatSteer ?? 0, throttle: bt, brake: 0, handbrake: 0, boost: 0 };
    if (input.pressed('interact') && player.ready && boat && (inBoat || (player.onFoot && player.doorDistance(boat as any) < 3))) { if (inBoat) { const d = boat.root.localToWorld(boat.door.clone()); if (boat.speed < 2.5 && groundAt(d.x, d.z) > -1) player.exit(); else hud.say('Bring the boat alongside a pier to get off'); } else player.enter(boat as any); }
    else if (input.pressed('interact') && player.ready) { const tj = player.onFoot && player.doorDistance(car) >= 3.2 ? life?.nearest(player.position, 4.2) : null; if (tj && jack(tj)) player.enter(car); else if (player.onFoot && player.doorDistance(car) < 3.2) player.enter(car); else if (player.state === 'drive' && Math.abs(state?.vf ?? 0) < 3) player.exit(); }
    if (boat && sim > 0) { const stern = boat.update(sim, inBoat ? vin : null, harbour!.blocked); if (boat.speed > 4 && Math.random() < sim * boat.speed * 3) cfx.smoke.emit(stern.add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, 0)), new THREE.Vector3(0, 1.2 + Math.random(), 0), 0.9, 0.35, 0.9, 0xe8eef0, 0.5); }
    if (inBoat) vin = { steer: 0, throttle: 0, brake: 0, handbrake: 1, boost: 0 };
    phys.inputs[PLAYER] = vin; phys.update(sim);
    state = phys.vehicle(PLAYER);
    if (state) {
      tmp.q.set(state.quat[0], state.quat[1], state.quat[2], state.quat[3]); tmp.p.set(state.pos[0], state.pos[1], state.pos[2]);
      if (sim > 0) { tmp.v.copy(tmp.p).sub(tmp.prevP).divideScalar(sim); if (tmp.v.length() > 120) tmp.v.set(0, 0, 0); } tmp.prevP.copy(tmp.p);
      car.update(state, vin.brake > 0.1 && state.vf > 0.5 ? 1 : 0);
      // skids + tyre smoke at each wheel contact
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(tmp.q);
      state.wheels.forEach((w, i) => { if (!car.wheels[i]) return; const wp = car.wheels[i].pivot.getWorldPosition(new THREE.Vector3()); const contact = w.contact ? wp.clone().setY(wp.y - tuning.wheelRadius) : null;
        skids.add(i, contact, side, w.skid);
        if (contact && w.skid > 0.45 && sim > 0 && Math.random() < w.skid * 0.9) smoke.emit(contact.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5), 1.6 + Math.random(), 0.6, 3.5, env.night > 0.5 ? 0x4a4c52 : 0xd9d7d2, 0.35 * w.skid); });
      const [ldx, ldy] = input.lookDelta(); const footCam = player.ready && player.state !== 'drive'; if (footCam) follow.orbit(ldx, ldy); else chase.orbit(ldx, ldy);
      const sf = shot?.foot; if (player.ready && (dbg as any).readyFrame === undefined) (dbg as any).readyFrame = frames; const pf = frames - ((dbg as any).readyFrame ?? frames);
      if (sf && player.ready && sf.interactAt !== undefined && pf >= sf.interactAt && player.state === 'foot' && !(dbg as any).entered) { (dbg as any).entered = true; player.enter((sf as any).boat && boat ? (boat as any) : car); }
      if (sf?.camYaw !== undefined && frames < 3) follow.snapBehind(sf.camYaw);
      if ((sf as any)?.wantedAt !== undefined && pf === (sf as any).wantedAt && wanted) { const n = (sf as any).wanted ?? 2; for (let i = 0; i < 6 && wanted.stars < n; i++) wanted.crime(n >= 3 ? 'hitCop' : n >= 2 ? 'hitPed' : 'shot'); }
      if (sf?.knockAt !== undefined && pf === sf.knockAt && player.ready) player.knockDown(new THREE.Vector3(0.6, 3.0, 5.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw), new THREE.Vector3(2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw));
      if (arsenal) { arsenal.update(dt, R.camera, player.onFoot && !paused); if (sf?.aim) { arsenal.aiming = true; arsenal.aimToggle = true; } if (sf?.fireEvery && player.ready && frames % sf.fireEvery === 0) (input as any).pressedEdge.add('Mouse0'); if (sf?.fireEvery) (input as any).down.add('Mouse0');
        for (const [at, dmg] of sf?.carDamage ?? []) if (pf === at) (dbg as any).damage(PLAYER, dmg);
        if (sf?.hostiles && pf === 5) spawnHostiles(sf.hostiles, sf.hostileDist ?? 24);
        if (sf?.explodeAt !== undefined && pf === sf.explodeAt) combat.explode(player.position.clone().add(new THREE.Vector3(...(sf.explodeRel ?? [3, 0, 0])).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)), 6, 250, 12, 'shot'); }
      if (player.ready) player.update(sim, { move: sf ? (sf.move ?? [0, 0]) : [input.axis('moveLeft', 'moveRight'), input.axis('moveBack', 'moveForward')], sprint: sf ? !!sf.sprint : input.held('sprint'), jump: !sf && input.pressed('jump'), crouch: !sf && input.pressed('crouch'), interact: false }, follow.headingYaw, groundFn);
      if (photo.on) { const k = (c: string) => input.down.has(c); const rate = 1.2 * dt; photo.yaw += ((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0)) * rate; photo.pitch = THREE.MathUtils.clamp(photo.pitch + ((k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0)) * rate, -0.2, 1.45);
        const [lx, ly] = input.lookDelta(); photo.yaw -= lx; photo.pitch = THREE.MathUtils.clamp(photo.pitch + ly, -0.2, 1.45);
        photo.dist = THREE.MathUtils.clamp(photo.dist * (k('KeyR') ? 1 - dt : k('KeyF') ? 1 + dt : 1), 1.2, 60); photo.fov = THREE.MathUtils.clamp(photo.fov + ((k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0)) * 25 * dt, 12, 90);
        if (k('BracketLeft') || k('BracketRight')) env.setTime((env.hours + (k('BracketRight') ? 1 : -1) * dt + 24) % 24);
        const c = photo.target.clone().add(new THREE.Vector3(Math.sin(photo.yaw) * Math.cos(photo.pitch), Math.sin(photo.pitch), Math.cos(photo.yaw) * Math.cos(photo.pitch)).multiplyScalar(photo.dist));
        R.camera.position.copy(c); R.camera.lookAt(photo.target); R.camera.fov = photo.fov; R.camera.updateProjectionMatrix(); }
      else if (shot?.cam) { R.camera.position.fromArray(shot.cam.pos); R.camera.lookAt(new THREE.Vector3().fromArray(shot.cam.look)); R.camera.fov = shot.cam.fov ?? 60; R.camera.updateProjectionMatrix(); }
      else if (shot?.foot?.camRel && player.ready) { follow.update(dt, player.position, null, player.speed, 0, false); const c = shot.foot.camRel; const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        if (shot.foot.camFixed) { (dbg as any).camAnchor ??= player.position.clone(); } const P: THREE.Vector3 = shot.foot.camFixed ? (dbg as any).camAnchor : player.position;
        R.camera.position.copy(P).add(new THREE.Vector3(-c.pos[0], c.pos[1], c.pos[2]).applyQuaternion(yq)); R.camera.lookAt(P.clone().add(new THREE.Vector3(-c.look[0], c.look[1], c.look[2]).applyQuaternion(yq))); R.camera.fov = c.fov ?? 50; R.camera.updateProjectionMatrix(); }
      else if (footCam) follow.update(dt, player.position, player.speed > 0.3 ? player.yaw : null, player.speed, player.crouch ? 1 : 0);
      else if (boat && player.state === 'drive' && player.car === (boat as any)) chase.update(dt, boat.root.position.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), boat.yaw), new THREE.Vector3(boat.vel.x, 0, boat.vel.y), input.held('lookBehind'));
      else chase.update(dt, tmp.p, tmp.q, tmp.v, input.held('lookBehind'));
      hud.setHint(player.state === 'drive' ? 'W/S drive · A/D steer · Space handbrake · Shift boost · V camera · E exit · Esc menu' : player.onFoot && player.doorDistance(car) < 3.2 ? 'E  enter car · WASD move · Shift sprint · Space jump/vault · C crouch' : player.onFoot && frames % 10 === 0 && life?.nearest(player.position, 4.2) ? 'E  steal car · WASD move · Shift sprint · Space jump/vault · C crouch' : 'WASD move · Shift sprint · Space jump/vault · C crouch · E interact · T time & weather · Esc menu');
      if (engine && boat && player.state === 'drive' && player.car === (boat as any)) engine.update(900 + boat.speed * 160 + boat.throttle * 1500, boat.throttle, 0, boat.speed, input.held('horn')); else
      if (engine) engine.update(state.rpm, state.throttle, Math.max(...state.wheels.map((w) => w.skid)), state.speed, input.held('horn'));
      const speedBlur = R.comfort.motionBlur ? THREE.MathUtils.clamp((state.speed - 14) / 60, 0, 1) * 0.06 : 0;
      (R.speedBlur.uniforms.get('strength') as THREE.Uniform).value = speedBlur;
    }
    for (const t of traffic) {
      const st = phys.vehicle(t.id); if (!st) continue; const q = new THREE.Quaternion(st.quat[0], st.quat[1], st.quat[2], st.quat[3]);
      const along = t.axis ? st.pos[0] : st.pos[2]; const stopAt = -t.dir * 15.5; const red = slice ? slice.phase(t.axis) !== 'g' : false;
      const before = t.dir > 0 ? along < stopAt && along > stopAt - 30 : along > stopAt && along < stopAt + 30;
      const inp = t.bot.drive(st, q); if (red && before && Math.abs(along - stopAt) < 22) { inp.throttle = 0; inp.brake = Math.abs(along - stopAt) < 12 ? 1 : 0.4; }
      phys.inputs[t.id] = inp; t.vis.update(st, inp.brake > 0.1 ? 1 : 0);
      const W = t.wrap ?? 105; if (along * t.dir > W) phys.teleportVehicle(t.id, t.axis ? [-(W - 5) * t.dir, t.y ?? 1.2, t.lane[0]] : [t.lane[0], t.y ?? 1.2, -(W - 5) * t.dir], t.axis ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : t.dir > 0 ? 0 : Math.PI);
      t.vis.setLights((env.night > 0.3 || env.cur.overcast > 0.8) && !damages.get(t.id)?.wrecked);
    }
    if (life && sim > 0 && spawned) { life.update(sim, focusPt(), gunfire); gunfire = null; if (player.ready) wanted?.update(sim);
      for (const c of life.cars) if (c.cls === 'police') lightBar(c.vis as any, wanted?.flash(c.id) ?? 0); }
    if (harbour) harbour.update(sim, env.night, clock.elapsedTime);
    if (harbour && player.ready && !wastedT && (player.onFoot || player.state === 'ragdoll') && player.position.y < WATER_Y - 0.9) { wastedT = 4; banner('WASTED'); }
    if (harbour && player.state === 'drive' && player.car === (car as any) && state && state.pos[1] < WATER_Y - 0.4 && !wastedT) { wastedT = 4; banner('WASTED'); }
    if (wastedT > 0 && sim > 0) { wastedT -= sim; if (wastedT <= 0) { wastedT = 0; banner(''); playerHealth = 200; wanted?.clear(); const p = new THREE.Vector3(spawn[0] - 3.4, city ? 0.16 : 0.05, spawn[2] + 3); player.respawn(p, spawnYaw + Math.PI / 2); } }
    if (city && state && frames % 15 === 0) city.clearParked(state.pos[0], state.pos[2], 4.5);
    if (sim > 0) for (const [id, d] of damages) { const st = phys.vehicle(id); if (!st) continue; const p = new THREE.Vector3(...st.pos);
      // velocity is only re-measured when a new physics snapshot lands (over the time since the last one); per-frame deltas of the interpolated position jitter at low fps and read as phantom crashes
      const vs = velState.get(id) ?? { p: p.clone(), t: 0, v: new THREE.Vector3(), snaps: phys.snaps }; velState.set(id, vs); vs.t += sim; let dtv = sim;
      if (phys.snaps !== vs.snaps && vs.t > 1e-3) { dtv = vs.t; vs.v = p.clone().sub(vs.p).divideScalar(vs.t); vs.p = p.clone(); vs.t = 0; vs.snaps = phys.snaps; } else dtv = Infinity;
      if (vs.v.length() < 90) d.update(sim, p, vs.v, new THREE.Quaternion(...st.quat), dtv); }
    if (vis) for (const [id, mesh] of vis.dyn) { const b = phys.body(id); if (b) { mesh.position.set(b.pos[0], b.pos[1], b.pos[2]); mesh.quaternion.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]); } }
    env.update(sim);
    car.setLights((env.night > 0.3 || env.cur.overcast > 0.8 || env.cur.fog > 0.6) && !damages.get(PLAYER)?.wrecked);
    if (vis) { vis.lampHeadMat.emissiveIntensity = env.night * 14; vis.buildingMat.emissiveIntensity = env.night * 2.5; }
    slice?.update(sim, env.night); const gY = (x: number, z: number) => (city ? groundAt(x, z) : 0.15); for (const p of peds) p.update(sim, gY); crowd.update(sim, R.camera.position); combat.update(sim, cfx.ground); Combatant.frame(); for (const h of hostiles) h.update(sim, playerTarget, hostiles); cfx.update(sim, R.camera);
    if (cfx.shake > 0.02 && R.comfort.shake) { R.camera.position.x += (Math.random() - 0.5) * cfx.shake * 0.12; R.camera.position.y += (Math.random() - 0.5) * cfx.shake * 0.12; }
    // vehicle impacts: any moving car overlapping a pedestrian or the on-foot player knocks them down (ragdoll)
    if (sim > 0) for (const v of [{ id: PLAYER }, ...traffic]) { const st = phys.vehicle(v.id); if (!st || st.speed < 2.5) continue;
      const q = new THREE.Quaternion(st.quat[0], st.quat[1], st.quat[2], st.quat[3]); const inv = q.clone().invert(); const cp = new THREE.Vector3(st.pos[0], st.pos[1], st.pos[2]);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const vel = fwd.multiplyScalar(st.vf);
      const hit = (p: THREE.Vector3) => { const l = p.clone().sub(cp).applyQuaternion(inv); return Math.abs(l.x) < tuning.halfExtents[0] + 0.32 && Math.abs(l.z) < tuning.halfExtents[2] + 0.3 && l.y > -1.6 && l.y < 1.2; };
      const fling = (p: THREE.Vector3) => vel.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, 1.5 + st.speed * 0.12, 0)).add(p.clone().sub(cp).setY(0).normalize().multiplyScalar(1.5));
      if (v.id !== PLAYER || player.state !== 'drive') if (player.onFoot && hit(player.position)) player.knockDown(fling(player.position));
      for (const pd of peds) if (pd.ready && !pd.down && hit(pd.worldPos)) pd.knockDown(fling(pd.worldPos)); }
    pool.update(R.camera.position, env.night);
    rain.update(R.camera, env.night); smoke.update(sim, R.camera);
    // manhole steam: slow, wind-drifted, brighter when cold/wet
    if (sim > 0) for (const v of (slice?.steamVents ?? city?.steamVents ?? [])) if (Math.random() < 0.5) steam.emit(v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), new THREE.Vector3(0.25 + Math.random() * 0.2, 0.7 + Math.random() * 0.5, 0.1), 3 + Math.random() * 2, 0.35, 2.2, env.night > 0.5 ? 0x7d828a : 0xdfe2e5, 0.07 + env.cur.wet * 0.05);
    steam.update(sim, R.camera);
    R.ca.blendMode.opacity.value = R.comfort.lens ? 1 : 0; R.noise.blendMode.opacity.value = R.comfort.lens ? 0.025 : 0;
    // shot mode: simulate the warm-up without rendering (software GPU is slow); render only the final frames
    const dtSim = shot || report ? 1 / 30 : dt;
    if (report ? frames % 30 === 29 : !shot || frames - ((dbg as any).readyFrame ?? 1e9) >= (shot.frames ?? 30) - 4) R.render(dtSim);
    hud.update(dt, boat && player.state === 'drive' && player.car === (boat as any) ? { speed: boat.speed, vf: boat.speed, gear: 1, rpm: 900 + boat.speed * 160 + boat.throttle * 1200, boost: 1, redline: 6500 } : !state || player.state !== 'drive' ? null : { speed: state.speed, vf: state.vf, gear: state.gear, rpm: state.rpm, boost: state.boost, redline: tuning.redlineRpm }, { draws: R.stats.drawCalls, tris: R.stats.triangles, phys: phys.lastStepMs.toFixed(1) + 'ms', tier: R.tier.name });
    input.endFrame();
    frames++; dbg.frames = frames; if ((dbg as any).rec) (dbg as any).rec.push([+(dt * 1000).toFixed(1), +phys.lastStepMs.toFixed(2), R.renderer.info.render.calls, life?.cars.length ?? 0, hostiles.filter((h) => h.state !== 'dead').length]);
    if (params.has('report') && frames % 30 === 0 && state) dbg.report.push({ f: frames, x: Math.round(state.pos[0]), z: Math.round(state.pos[2]), kmh: Math.round(state.vf * 3.6), draws: R.stats.drawCalls, tris: R.stats.triangles, heapMB: Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6), geos: R.stats.geometries, near: city?.stats.near, far: city?.stats.far, buildMax: Math.round(city?.stats.maxMs ?? 0), mainMax: Math.round(city?.stats.mainMaxMs ?? 0), pending: city?.pending });
    // once streaming settles, re-bake the reflection probe (textures/models now present) and allow shots
    const idle = pendingLoads() === 0 && (!city || (spawned && city.pending === 0));
    if (idle && !loadedOnce && frames > 5) { loadedOnce = true; env.bakeEnv(); }
    if (frames - ((dbg as any).readyFrame ?? 0) >= (shot?.frames ?? 30) && phys.snaps > 5 && loadedOnce && spawned && (!city || city.pending === 0) && player.ready && (!city || crowd.ready || params.has('nocrowd') || !!shot?.route)) dbg.ready = true;
  }
  await phys.ready; frame();
}
