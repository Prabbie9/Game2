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
import { resolveTuning } from './vehicles/tuning';
import { CarVisual } from './vehicles/carvisual';
import { ChaseCamera } from './camera/chase';
import { Input } from './input/input';
import { AudioSys, EngineSound } from './audio/engine';
import { Rain, SkidMarks, Particles } from './fx/fx';
import { HUD, TuningPanel, TimeWeatherPanel, PauseMenu } from './ui/ui';
import { BotDriver, ROUTES } from './tools/bot';
import { SHOTS } from './tools/shots';

const PLAYER = 1;
export async function startGame(app: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const probe = document.createElement('canvas').getContext('webgl2');
  const picked = pickTier(probe); const tierName = (params.get('tier') as TierName) || picked.tier;
  const R = new Renderer(app, tierName);
  const env = new Environment(R);
  const pool = new LightPool(R.scene, R.tier.maxLights);
  const area = buildTestArea();
  const vis = buildTestVisuals(R, area, pool);
  const phys = new PhysicsClient();
  phys.addStatics(area.statics.map(({ look, ...s }) => s)); phys.addDynamics(area.dynamics.map(({ look, ...d }) => d));
  let tuning = resolveTuning('sedan', 'Balanced');
  phys.spawnVehicle(PLAYER, tuning, area.spawn, area.spawnYaw);
  const car = new CarVisual(R, { color: 0x7d1520, ...tuning }); R.scene.add(car.root);
  const chase = new ChaseCamera(R.camera, vis.colliders);
  const input = new Input(R.renderer.domElement);
  const audio = new AudioSys(); let engine: EngineSound | null = null;
  const rain = new Rain(R.scene, Math.round(9000 * R.tier.particles)); const skids = new SkidMarks(R.scene); const smoke = new Particles(R.scene, Math.round(500 * R.tier.particles));
  const hud = new HUD(app);
  const tunePanel = new TuningPanel('sedan', (t) => { tuning = { ...tuning, ...t }; phys.setTuning(PLAYER, tuning); }, (s) => hud.say(s));
  const twPanel = new TimeWeatherPanel(env);
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
  let bot: BotDriver | null = null;
  const shot = params.get('shot') ? SHOTS[params.get('shot')!] : null;
  if (shot) { env.setTime(shot.t); env.setWeather(shot.w, true); if (shot.route) bot = new BotDriver(ROUTES[shot.route], shot.speed ?? 20); hud.root.hidden = !!shot.hideHud; }
  if (params.get('bot')) bot = new BotDriver(ROUTES[params.get('bot')!] ?? ROUTES.loop, +(params.get('speed') ?? 22));
  if (shot?.start) phys.teleportVehicle(PLAYER, shot.start, shot.yaw ?? 0);

  const clock = new THREE.Clock(); let frames = 0; let state: ReturnType<PhysicsClient['vehicle']> = null;
  const tmp = { q: new THREE.Quaternion(), p: new THREE.Vector3(), v: new THREE.Vector3(), prevP: new THREE.Vector3() };
  const dbg: any = (window as any).HARBOURLINE_DEBUG = {
    ready: false, frames: 0, R, env, phys,
    teleport: (x: number, y: number, z: number, yaw = 0) => phys.teleportVehicle(PLAYER, [x, y, z], yaw),
    setTime: (h: number) => env.setTime(h), setWeather: (w: WeatherName) => env.setWeather(w, true),
    spawnVehicle: (cls = 'sedan') => { tuning = resolveTuning(cls, 'Balanced'); phys.spawnVehicle(PLAYER, tuning, [state?.pos[0] ?? 0, (state?.pos[1] ?? 0) + 2, state?.pos[2] ?? 0], 0); },
    setVelocity: (kmh: number) => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(tmp.q); phys.setVelocity(PLAYER, [f.x * kmh / 3.6, 0, f.z * kmh / 3.6]); },
    bot: (route = 'loop', speed = 22) => { bot = route ? new BotDriver(ROUTES[route], speed) : null; },
    stats: () => ({ ...R.stats, fps: Math.round(1 / Math.max(1e-3, clock.getDelta())), physicsMs: +phys.lastStepMs.toFixed(2), vehicle: state && { kmh: +(state.vf * 3.6).toFixed(1), slipDeg: +(state.slip * 57.3).toFixed(1), contacts: state.contacts }, tier: R.tier.name, heapMB: Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6) }),
    // these arrive in later milestones; present so tools can call them safely
    spawnPed: () => null, giveWeapon: () => null, setWanted: () => null, explode: () => null,
  };

  function frame() {
    requestAnimationFrame(frame);
    const dt = shot ? 1 / 30 : Math.min(clock.getDelta(), 0.1);
    if (input.pressed('pause')) setPause(!paused);
    if (input.pressed('tuning')) { if (tunePanel.toggle()) document.exitPointerLock?.(); }
    if (input.pressed('timeWeather')) { if (twPanel.toggle()) document.exitPointerLock?.(); }
    if (input.pressed('frameOverlay')) hud.toggleOverlay();
    if (input.pressed('camera')) chase.cycle();
    const sim = paused ? 0 : dt;
    // vehicle input: player or bot
    let vin = { steer: input.axis('steerLeft', 'steerRight'), throttle: input.value('throttle'), brake: input.value('brake'), handbrake: input.value('handbrake'), boost: input.value('boost') };
    if (bot && state) vin = bot.drive(state, tmp.q);
    phys.inputs[PLAYER] = vin; phys.update(sim);
    state = phys.vehicle(PLAYER);
    if (state) {
      tmp.q.set(state.quat[0], state.quat[1], state.quat[2], state.quat[3]); tmp.p.set(state.pos[0], state.pos[1], state.pos[2]);
      if (sim > 0) { tmp.v.copy(tmp.p).sub(tmp.prevP).divideScalar(sim); if (tmp.v.length() > 120) tmp.v.set(0, 0, 0); } tmp.prevP.copy(tmp.p);
      car.update(state, vin.brake > 0.1 && state.vf > 0.5 ? 1 : 0);
      // skids + tyre smoke at each wheel contact
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(tmp.q);
      state.wheels.forEach((w, i) => { const wp = car.wheels[i].pivot.getWorldPosition(new THREE.Vector3()); const contact = w.contact ? wp.clone().setY(wp.y - tuning.wheelRadius) : null;
        skids.add(i, contact, side, w.skid);
        if (contact && w.skid > 0.45 && sim > 0 && Math.random() < w.skid * 0.9) smoke.emit(contact.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5), 1.6 + Math.random(), 0.6, 3.5, env.night > 0.5 ? 0x4a4c52 : 0xd9d7d2, 0.35 * w.skid); });
      const [ldx, ldy] = input.lookDelta(); chase.orbit(ldx, ldy);
      chase.update(dt, tmp.p, tmp.q, tmp.v, input.held('lookBehind'));
      if (engine) engine.update(state.rpm, state.throttle, Math.max(...state.wheels.map((w) => w.skid)), state.speed, input.held('horn'));
      const speedBlur = R.comfort.motionBlur ? THREE.MathUtils.clamp((state.speed - 14) / 60, 0, 1) * 0.06 : 0;
      (R.speedBlur.uniforms.get('strength') as THREE.Uniform).value = speedBlur;
    }
    for (const [id, mesh] of vis.dyn) { const b = phys.body(id); if (b) { mesh.position.set(b.pos[0], b.pos[1], b.pos[2]); mesh.quaternion.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]); } }
    env.update(sim);
    car.setLights(env.night > 0.3 || env.cur.overcast > 0.8 || env.cur.fog > 0.6);
    vis.lampHeadMat.emissiveIntensity = env.night * 14; vis.buildingMat.emissiveIntensity = env.night * 2.5;
    pool.update(R.camera.position, env.night);
    rain.update(R.camera, env.night); smoke.update(sim, R.camera);
    R.ca.blendMode.opacity.value = R.comfort.lens ? 1 : 0; R.noise.blendMode.opacity.value = R.comfort.lens ? 0.06 : 0;
    // shot mode: simulate the warm-up without rendering (software GPU is slow); render only the final frames
    const dtSim = shot ? 1 / 30 : dt;
    if (!shot || frames >= (shot.frames ?? 30) - 4) R.render(dtSim);
    hud.update(dt, state && { speed: state.speed, vf: state.vf, gear: state.gear, rpm: state.rpm, boost: state.boost, redline: tuning.redlineRpm }, { draws: R.stats.drawCalls, tris: R.stats.triangles, phys: phys.lastStepMs.toFixed(1) + 'ms', tier: R.tier.name });
    input.endFrame();
    frames++; dbg.frames = frames; if (frames >= (shot?.frames ?? 30) && phys.snaps > 5) dbg.ready = true;
  }
  await phys.ready; frame();
}
