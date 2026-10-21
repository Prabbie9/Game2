// City traffic (M7): a pool of AI cars that live on the street grid around the player. Each car drives a lane by pure
// pursuit (right-hand traffic, lane centres from the road paint), obeys the shared signal phase at every intersection,
// picks straight / left / right at random (never off the map, into the underpass trench or onto the highway road),
// keeps its distance to anything ahead (other cars, the player's car, people on the road), and panics (faster, ignores
// signals) when it witnesses gunfire. Cars spawn out of view in a ring around the player and despawn far away.
// Police pursuit cars use the same slots with a different controller (see police.ts).
import * as THREE from 'three';
import type { PhysicsClient, VehState } from '../physics/client';
import { BLOCK, GRID, HWY, UNDER, line, roadW, groundAt } from '../world/citygen';

export type CarMode = 'drive' | 'abandoned' | 'pursuit' | 'parked';
export interface TrafficCar {
  id: number; cls: string; vis: { root: THREE.Object3D; update: (s: VehState, braking: number) => void; setLights: (on: boolean) => void };
  axis: number; dir: number; k: number; off: number; // road: axis 1 = along x on z = line(k); axis 0 = along z on x = line(k); off = lane offset from the centre line
  turn: { axis: number; dir: number; k: number; off: number; pts: THREE.Vector2[] } | null; nextI: number; mode: CarMode; panic: number; stuck: number; age: number; speed: number; why?: string; nudge?: number;
  pursue?: (s: VehState, q: THREE.Quaternion) => { steer: number; throttle: number; brake: number; handbrake: number; boost: number };
}
export interface TrafficHost {
  phys: PhysicsClient; spawnVis: (cls: string, id: number) => TrafficCar['vis']; removeVis: (c: TrafficCar) => void;
  readyAt: (x: number, z: number) => boolean; phase: (axis: number) => string; wrecked: (id: number) => boolean;
  /** world-space obstacles that cars should stop for (player car, player on foot, pedestrians) */
  obstacles: () => THREE.Vector3[]; camera: THREE.Camera; tuning: (cls: string) => any;
}
const CLASSES: [string, number][] = [['sedan2', 3], ['sedan3', 3], ['taxi', 2], ['compact', 2], ['sedan', 2], ['wagon', 1], ['pickup', 1.5], ['suv', 1.5], ['van', 1], ['sports', 0.6], ['muscle', 0.8], ['ambulance', 0.3], ['truck', 0.4]];
const pickClass = () => { const tot = CLASSES.reduce((a, c) => a + c[1], 0); let r = Math.random() * tot; for (const [c, w] of CLASSES) { if ((r -= w) <= 0) return c; } return 'sedan2'; };
const laneOffs = (k: number) => (roadW(k) > 16 ? [2.6, 6.2] : [2.1]);
const forbidden = (axis: number, k: number) => axis === 1 && line(k) === HWY.z; // ground road under the elevated highway (pillars)
const inTrenchRoad = (axis: number, k: number, along: number) => axis === 0 && line(k) === UNDER.x && along > UNDER.z0 - 30 && along < UNDER.z1 + 30;
/** Lane point at distance `a` along the road. */
function lanePt(axis: number, dir: number, k: number, off: number, a: number) { return axis ? new THREE.Vector2(a, line(k) + dir * off) : new THREE.Vector2(line(k) - dir * off, a); }

export class TrafficSystem {
  cars: TrafficCar[] = []; max: number; nextId = 100; spawnT = 0; stats = { spawned: 0, despawned: 0, active: 0, stoppedAtRed: 0 };
  constructor(public host: TrafficHost, max = 16) { this.max = max; }
  private freeId() { const used = new Set(this.cars.map((c) => c.id)); while (used.has(this.nextId)) this.nextId = this.nextId >= 199 ? 100 : this.nextId + 1; return this.nextId; }
  /** Spawn a car on a lane at `along` (world coordinate along the road axis). */
  spawn(axis: number, dir: number, k: number, along: number, cls = pickClass(), mode: CarMode = 'drive') {
    const off = laneOffs(k)[Math.floor(Math.random() * laneOffs(k).length)]; const p = lanePt(axis, dir, k, off, along); const id = this.freeId();
    const t = this.host.tuning(cls); const yaw = axis ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    this.host.phys.spawnVehicle(id, t, [p.x, groundAt(p.x, p.y) + 0.9, p.y], yaw);
    const c: TrafficCar = { id, cls, vis: this.host.spawnVis(cls, id), axis, dir, k, off, turn: null, nextI: 0, mode, panic: 0, stuck: 0, age: 0, speed: roadW(k) > 16 ? 15 : 12.5 };
    c.nextI = this.nextIntersection(c, along); this.cars.push(c); this.stats.spawned++; return c;
  }
  /** Take over an existing visual as a driverless car (the player's previous car after a carjack or a spawn). */
  adopt(cls: string, vis: TrafficCar['vis'], pos: number[], yaw: number) { const id = this.freeId(); this.host.phys.spawnVehicle(id, this.host.tuning(cls), [pos[0], pos[1] + 0.05, pos[2]], yaw);
    const c: TrafficCar = { id, cls, vis, axis: 1, dir: 1, k: 0, off: 2.1, turn: null, nextI: 0, mode: 'abandoned', panic: 0, stuck: 0, age: 0, speed: 0 }; this.cars.push(c); return c; }
  remove(c: TrafficCar) { this.host.phys.removeVehicle(c.id); this.host.removeVis(c); this.cars = this.cars.filter((x) => x !== c); this.stats.despawned++; }
  private nextIntersection(c: { axis: number; dir: number }, along: number) { return c.dir > 0 ? Math.floor(along / BLOCK) + 1 : Math.ceil(along / BLOCK) - 1; }
  /** Try to place a new car out of view in a ring around the player. */
  private filled = false;
  private trySpawn(center: THREE.Vector3, initial = false) {
    const cam = this.host.camera; const camF = new THREE.Vector3(); cam.getWorldDirection(camF);
    for (let tries = 0; tries < 6; tries++) {
      const axis = Math.random() < 0.5 ? 1 : 0; const across = axis ? center.z : center.x; const along0 = axis ? center.x : center.z;
      const k = Math.round(across / BLOCK) + Math.floor(Math.random() * 3) - 1; if (Math.abs(k) > GRID - 1 || forbidden(axis, k)) continue;
      const along = along0 + (Math.random() < 0.5 ? -1 : 1) * (initial ? 15 + Math.random() * 150 : 55 + Math.random() * 110); if (Math.abs(along) > (GRID - 1) * BLOCK) continue;
      const m = ((along % BLOCK) + BLOCK) % BLOCK; if (m < 26 || m > BLOCK - 26) continue; // not inside an intersection
      const dir = Math.random() < 0.5 ? 1 : -1; if (inTrenchRoad(axis, k, along)) continue;
      const p = lanePt(axis, dir, k, 2.1, along); const w = new THREE.Vector3(p.x, 1, p.y); const d = w.clone().sub(center); const dist = d.length();
      if (dist < (initial ? 18 : 50) || dist > 200 || !this.host.readyAt(p.x, p.y)) continue;
      if (!initial && dist < 115 && d.clone().normalize().dot(camF) > 0.35) continue; // in view and close: try elsewhere (far spawns hide in the haze)
      if (this.cars.some((c) => { const s = this.host.phys.vehicle(c.id); return s && Math.hypot(s.pos[0] - p.x, s.pos[2] - p.y) < 16; })) continue;
      return this.spawn(axis, dir, k, along);
    }
    return null;
  }
  /** Turn choice at intersection i of the car's road: returns the new road + a polyline through the junction. */
  private chooseTurn(c: TrafficCar) {
    const opts: { axis: number; dir: number; k: number; w: number }[] = []; const i = c.nextI; if (Math.abs(i) > GRID) return null;
    const nAxis = 1 - c.axis; const crossAt = line(c.k); // the crossing road index is i; our road is at line(c.k)
    const straightOk = Math.abs(i + c.dir) <= GRID - 1 && !(c.axis === 0 && line(c.k) === UNDER.x && line(i) > UNDER.z0 - 40 && line(i) < UNDER.z1 + 40);
    if (straightOk) opts.push({ axis: c.axis, dir: c.dir, k: c.k, w: 5 });
    const trench = (nAxis === 0 && line(i) === UNDER.x) || (c.axis === 0 && line(c.k) === UNDER.x && crossAt > UNDER.z0 - 40 && crossAt < UNDER.z1 + 40) || (nAxis === 1 && line(i) === HWY.z) || forbidden(nAxis, i);
    if (!trench) for (const nd of [1, -1]) { const k2 = c.k + nd; if (Math.abs(k2) > GRID - 1) continue;
      // right turn = turning to the driver's right; with right-hand traffic: axis1 dir+1 (east) right -> south? compute from cross product
      opts.push({ axis: nAxis, dir: nd, k: i, w: 2 }); }
    if (!opts.length) return null; const tot = opts.reduce((a, o) => a + o.w, 0); let r = Math.random() * tot; let o = opts[0]; for (const x of opts) { if ((r -= x.w) <= 0) { o = x; break; } }
    const off = laneOffs(o.k)[0]; const ctr = c.axis ? new THREE.Vector2(line(i), line(c.k)) : new THREE.Vector2(line(c.k), line(i));
    const wIn = roadW(i), wOut = roadW(c.k); void wOut;
    const entry = lanePt(c.axis, c.dir, c.k, c.off, (c.axis ? ctr.x : ctr.y) - c.dir * (wIn / 2 + 1));
    const exitAlong = (o.axis ? ctr.x : ctr.y) + o.dir * (roadW(c.k) / 2 + 3);
    const exit = lanePt(o.axis, o.dir, o.k, off, exitAlong); const beyond = lanePt(o.axis, o.dir, o.k, off, exitAlong + o.dir * 20);
    if (o.axis === c.axis) return { ...o, off: c.off, pts: [entry, lanePt(o.axis, o.dir, o.k, c.off, exitAlong), lanePt(o.axis, o.dir, o.k, c.off, exitAlong + o.dir * 20)] };
    const mid = entry.clone().lerp(exit, 0.5).lerp(ctr, 0.35);
    return { ...o, off, pts: [entry, mid, exit, beyond] };
  }
  update(dt: number, center: THREE.Vector3, gunfireAt: THREE.Vector3 | null) {
    this.spawnT -= dt; const driving = this.cars.filter((c) => c.mode === 'drive').length; this.stats.active = this.cars.length; this.stats.stoppedAtRed = 0;
    if (!this.filled && this.host.readyAt(center.x, center.z)) { this.filled = true; for (let n = 0; n < this.max * 3 && this.cars.length < this.max; n++) this.trySpawn(center, true); }
    if (this.spawnT <= 0 && driving < this.max) { this.spawnT = 0.25; this.trySpawn(center); }
    const obst = this.host.obstacles(); const states = new Map<number, VehState>(); for (const c of this.cars) { const s = this.host.phys.vehicle(c.id); if (s) states.set(c.id, s); }
    for (const c of [...this.cars]) {
      const s = states.get(c.id); c.age += dt; if (!s) { if (c.age > 3) this.remove(c); continue; }
      const p = new THREE.Vector3(...s.pos); const dist = p.distanceTo(center); const q = new THREE.Quaternion(...s.quat);
      const far = c.mode === 'pursuit' ? 320 : c.mode === 'drive' ? 260 : 200; if (dist > far || (this.host.wrecked(c.id) && dist > 140)) { this.remove(c); continue; }
      if (gunfireAt && p.distanceTo(gunfireAt) < 45) c.panic = 8; c.panic = Math.max(0, c.panic - dt);
      let inp = { steer: 0, throttle: 0, brake: 0, handbrake: 0, boost: 0 };
      if (this.host.wrecked(c.id) || c.mode === 'abandoned' || c.mode === 'parked') inp.brake = c.mode === 'parked' ? 1 : 0.3;
      else if (c.mode === 'pursuit' && c.pursue) inp = c.pursue(s, q);
      else inp = this.drive(c, s, q, obst, states);
      this.host.phys.inputs[c.id] = inp; c.vis.update(s, inp.brake > 0.1 ? 1 : 0);
      // stuck (blocked by a wreck, flipped): give up when out of view
      // stuck (blocked by a wreck, flipped, deadlocked): creep past after a while, give up when out of view
      c.stuck = c.mode === 'drive' && Math.abs(s.vf) < 0.5 && c.why !== 'signal' ? c.stuck + dt : 0; if (c.stuck > 6) c.nudge = 3; if (c.stuck > 20 && dist > 50) this.remove(c);
    }
  }
  private drive(c: TrafficCar, s: VehState, q: THREE.Quaternion, obst: THREE.Vector3[], states: Map<number, VehState>) {
    const p = new THREE.Vector2(s.pos[0], s.pos[2]); const f3 = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const f = new THREE.Vector2(f3.x, f3.z).normalize(); const heading = Math.atan2(f.x, f.y);
    const along = c.axis ? p.x : p.y; const ctrAlong = line(c.nextI); const toCtr = (ctrAlong - along) * c.dir; const wCross = roadW(c.nextI);
    let target: THREE.Vector2; let v = c.speed * (c.panic > 0 ? 1.45 : 1);
    if (c.turn) { // following the junction polyline; pop points as we reach them, finish onto the new road
      while (c.turn.pts.length > 1 && p.distanceTo(c.turn.pts[0]) < 6) c.turn.pts.shift(); target = c.turn.pts[0];
      if (c.turn.axis !== c.axis) v = Math.min(v, 7.5);
      if (c.turn.pts.length <= 1) { const t = c.turn; c.axis = t.axis; c.dir = t.dir; c.k = t.k; c.off = t.off; c.turn = null; c.nextI = this.nextIntersection(c, c.axis ? p.x : p.y); c.speed = roadW(c.k) > 16 ? 15 : 12.5; }
    } else {
      target = lanePt(c.axis, c.dir, c.k, c.off, along + c.dir * Math.max(8, s.vf * 0.9));
      if (toCtr < wCross / 2 + 9 && toCtr > -wCross / 2) { const t = this.chooseTurn(c); if (t) c.turn = t; else { c.dir = -c.dir; c.nextI = this.nextIntersection(c, along); } } // dead end: U-turn (rare, map edge)
      // signals: stop before the stop line on red / late amber (panicking drivers run them)
      const ph = this.host.phase(c.axis); const stopD = toCtr - (wCross / 2 + 8.5);
      if (c.panic <= 0 && ph !== 'g' && stopD > -1.5 && stopD < 40 && !(ph === 'a' && stopD < 6)) { v = Math.min(v, Math.max(0, stopD * 0.55)); if (stopD < 25) this.stats.stoppedAtRed++; }
    }
    // keep distance: nearest thing ahead in the lane corridor
    const right = new THREE.Vector2(f.y, -f.x); let gap = 99;
    const check = (x: number, z: number, half = 1.6) => { const d = new THREE.Vector2(x - p.x, z - p.y); const a = d.dot(f), l = Math.abs(d.dot(right)); if (a > 0.5 && a < 40 && l < half) gap = Math.min(gap, a); };
    for (const [id, o] of states) if (id !== c.id) check(o.pos[0], o.pos[2]); for (const o of obst) check(o.x, o.z, 1.8);
    c.why = v < 1 ? 'signal' : ''; c.nudge = Math.max(0, (c.nudge ?? 0) - 1 / 60);
    if (gap < 40 && !(c.nudge! > 0)) { const vg = Math.max(0, (gap - 6.5) * 0.7); if (vg < v) { v = vg; c.why = 'gap' + gap.toFixed(1); } }
    const want = Math.atan2(target.x - p.x, target.y - p.y); let err = want - heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    if (Math.abs(err) > 0.5) v = Math.min(v, 8);
    const dv = v - s.vf; return { steer: THREE.MathUtils.clamp(-err * 2.4, -1, 1), throttle: dv > 0.3 ? Math.min(1, dv * 0.5) : 0, brake: dv < -1 ? Math.min(1, -dv * 0.25) : v < 0.3 && s.vf < 1 ? 1 : 0, handbrake: 0, boost: 0 };
  }
  /** The car nearest to a point (for carjacking). */
  nearest(p: THREE.Vector3, maxD: number) { let best: TrafficCar | null = null, bd = maxD; for (const c of this.cars) { const s = this.host.phys.vehicle(c.id); if (!s) continue; const d = Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z); if (d < bd) { bd = d; best = c; } } return best; }
}
