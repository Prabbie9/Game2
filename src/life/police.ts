// Wanted level + police (M7). Crimes the police (or civilians) witness raise heat -> 1-5 stars. Each star level asks
// for more pursuit cars (spawned out of view on the street grid through the traffic system, driving at the player and
// ramming from 3 stars) and, when a cruiser reaches a player on foot, officers who get out and fight (pistol -> smg ->
// rifle by level). Evading = no officer or cruiser has line of sight for 8 + 3 s per star; then the stars clear and the
// units return to traffic. Death -> WASTED, an arrest at 1 star -> BUSTED; both respawn the player and clear the level.
import * as THREE from 'three';
import type { TrafficSystem, TrafficCar } from './traffic';
import type { VehState } from '../physics/client';
import type { AudioSys } from '../audio/engine';
import { BLOCK, GRID, line, roadW } from '../world/citygen';

export type Crime = 'shot' | 'hitPed' | 'killPed' | 'hitCop' | 'killCop' | 'jack' | 'carBomb' | 'runOver';
const HEAT: Record<Crime, [number, number]> = { shot: [1, 0.5], hitPed: [2, 1], killPed: [2, 1.6], hitCop: [3, 1.5], killCop: [3, 2.2], jack: [1, 0.6], carBomb: [2, 1.2], runOver: [2, 1] }; // [min stars, heat added]
export interface Officer { pos: () => THREE.Vector3; dead: boolean; dispose: () => void; update: (dt: number) => void; setArrest: (on: boolean) => void }
export interface PoliceHost {
  traffic: TrafficSystem; audio: AudioSys; los: (a: THREE.Vector3, b: THREE.Vector3) => boolean;
  player: () => { pos: THREE.Vector3; inCar: boolean; carState: VehState | null; onFoot: boolean; speed: number };
  spawnOfficer: (at: THREE.Vector3, weapon: 'pistol' | 'smg' | 'rifle', yaw: number) => Officer; onBusted: () => void;
}
export class Wanted {
  stars = 0; heat = 0; unseen = 0; seenBy = 0; lastSeen = new THREE.Vector3(); // where the police last saw the player (pursuit and dispatch use it once the player is out of sight)
   units: TrafficCar[] = []; officers: Officer[] = []; dispatchT = 0; arrestT = 0; deployed = new Set<number>();
  ui: HTMLDivElement; private siren: { osc: OscillatorNode; gain: GainNode } | null = null; t = 0; stats: { crimes: number; maxStars: number; unitsSpawned: number; officers: number; evaded: number; spawnRejected?: number } = { crimes: 0, maxStars: 0, unitsSpawned: 0, officers: 0, evaded: 0 };
  /** Per-tier caps on live pursuit cars and officers (Lite/Low keep draw calls and AI cost down). */
  caps = { units: 5, officers: 6 };
  constructor(public host: PoliceHost, parent: HTMLElement) { this.ui = document.createElement('div'); this.ui.className = 'hl-wanted'; parent.append(this.ui); this.render(); }
  disabled = false;
  setStars(n: number) { if (n <= 0) return this.clear(); this.heat = Math.min(5.99, n); this.stars = Math.min(5, n); this.unseen = 0; this.lastSeen.copy(this.host.player().pos); this.stats.maxStars = Math.max(this.stats.maxStars, this.stars); this.render(); }
  crime(kind: Crime, witnessed = true) { if (!witnessed || this.disabled) return; const [min, h] = HEAT[kind]; this.heat = Math.min(5.99, Math.max(this.heat + h, min)); this.stars = Math.max(this.stars, Math.floor(this.heat)); this.unseen = 0; this.lastSeen.copy(this.host.player().pos); this.stats.crimes++; this.stats.maxStars = Math.max(this.stats.maxStars, this.stars); this.render(); }
  clear() { this.stars = 0; this.heat = 0; this.unseen = 0; for (const u of this.units) { u.mode = 'drive'; u.pursue = undefined; } this.units = []; for (const o of this.officers) o.dispose(); this.officers = []; this.deployed.clear(); this.render(); }
  private render() { const flash = this.stars > 0 && this.unseen > 0 && Math.floor(this.t * 3) % 2 === 0; this.ui.innerHTML = this.stars ? Array.from({ length: 5 }, (_, i) => `<i class="${i < this.stars ? (flash ? 'on dim' : 'on') : ''}">★</i>`).join('') : ''; }
  /** Pursuit controller for a cruiser: drive at the player (or a point ahead of their car); ram from 3 stars, stop near a player on foot. */
  private pursuer(u: TrafficCar) {
    return (s: VehState, q: THREE.Quaternion) => {
      const pl = this.host.player(); const p = new THREE.Vector2(s.pos[0], s.pos[2]); const hidden = this.unseen > 0.5; const ppos = hidden ? this.lastSeen : pl.pos; let tgt = new THREE.Vector2(ppos.x, ppos.z);
      if (!hidden && pl.carState && this.stars < 3) { const v = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...pl.carState.quat)).multiplyScalar(Math.min(25, pl.carState.vf * 0.8)); tgt.add(new THREE.Vector2(v.x, v.z)); }
      const d = tgt.distanceTo(p); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const heading = Math.atan2(f.x, f.z);
      // far away: follow the street grid toward the player (cut through intersections), close: straight at them
      if (d > 45) { const nearRoadX = line(Math.round(p.x / BLOCK)), nearRoadZ = line(Math.round(p.y / BLOCK)); const onX = Math.abs(p.x - nearRoadX) < Math.abs(p.y - nearRoadZ);
        tgt = onX ? new THREE.Vector2(nearRoadX, THREE.MathUtils.clamp(tgt.y, p.y - 60, p.y + 60)) : new THREE.Vector2(THREE.MathUtils.clamp(tgt.x, p.x - 60, p.x + 60), nearRoadZ);
        if (tgt.distanceTo(p) < 8) tgt = new THREE.Vector2(ppos.x, ppos.z); }
      let err = Math.atan2(tgt.x - p.x, tgt.y - p.y) - heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
      const footStop = (pl.onFoot || hidden) && d < 14; const reverse = Math.abs(err) > 2.2 && d < 25 && s.vf < 3; // behind us and close: back up and turn
      const vWant = footStop ? 0 : this.stars >= 3 || d > 40 ? 38 : Math.max(8, d * 0.6); const dv = vWant - s.vf;
      return { steer: THREE.MathUtils.clamp((reverse ? err : -err) * 2.2, -1, 1), throttle: reverse ? 0 : dv > 0 ? 1 : 0, brake: reverse ? 0.8 : footStop ? 1 : dv < -3 ? 0.6 : 0, handbrake: Math.abs(err) > 1.2 && s.vf > 10 ? 1 : 0, boost: this.stars >= 4 && d > 60 ? 1 : 0 };
    };
  }
  /** New cruisers spawn 90-140 m from `center` (the player while seen, the last-seen point once hidden) and never where they would see the player. */
  private dispatch(center: THREE.Vector3, player: THREE.Vector3, hidden: boolean) {
    const tr = this.host.traffic;
    for (let tries = 0; tries < 8; tries++) { const axis = Math.random() < 0.5 ? 1 : 0; const across = axis ? center.z : center.x; const k = Math.round(across / BLOCK) + (Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 1 : -1);
      if (Math.abs(k) > GRID - 1) continue; const along = (axis ? center.x : center.z) + (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 50); const m = ((along % BLOCK) + BLOCK) % BLOCK; if (m < 26 || m > BLOCK - 26) continue;
      const x = axis ? along : line(k), z = axis ? line(k) : along; if (!tr.host.readyAt(x, z)) continue; void roadW;
      if (hidden) { const sp = new THREE.Vector3(x, 1.2, z); const ds = sp.distanceTo(player); if (ds < 90 || (ds < 160 && this.host.los(sp, player.clone().setY(player.y + 1.2)))) { this.stats.spawnRejected = (this.stats.spawnRejected ?? 0) + 1; continue; } }
      const dir = (axis ? center.x - along : center.z - along) > 0 ? 1 : -1; const u = tr.spawn(axis, dir, k, along, 'police', 'pursuit'); u.pursue = this.pursuer(u); this.units.push(u); this.stats.unitsSpawned++; return u; }
    return null;
  }
  update(dt: number) {
    this.t += dt; const pl = this.host.player(); const tr = this.host.traffic;
    this.units = this.units.filter((u) => tr.cars.includes(u)); this.officers = this.officers.filter((o) => { if (o.dead && o.pos().distanceTo(pl.pos) > 120) { o.dispose(); return false; } return true; });
    // any cop car on the street near a crime-scene reacts too (police class cars in ambient traffic)
    if (this.stars > 0) for (const c of tr.cars) if (c.cls === 'police' && c.mode === 'drive' && !this.units.includes(c)) { const s = tr.host.phys.vehicle(c.id); if (s && Math.hypot(s.pos[0] - pl.pos.x, s.pos[2] - pl.pos.z) < 90) { c.mode = 'pursuit'; c.pursue = this.pursuer(c); this.units.push(c); } }
    if (this.stars === 0) { this.updateSiren(pl.pos); this.render(); return; }
    // line of sight from any unit/officer
    let seen = false; for (const u of this.units) { const s = tr.host.phys.vehicle(u.id); if (!s) continue; const p = new THREE.Vector3(s.pos[0], s.pos[1] + 1, s.pos[2]); if (p.distanceTo(pl.pos) < 80 && this.host.los(p, pl.pos.clone().setY(pl.pos.y + 1.2))) { seen = true; break; } }
    if (!seen) for (const o of this.officers) { if (o.dead) continue; const p = o.pos().clone().setY(o.pos().y + 1.6); if (p.distanceTo(pl.pos) < 70 && this.host.los(p, pl.pos.clone().setY(pl.pos.y + 1.2))) { seen = true; break; } }
    this.unseen = seen ? 0 : this.unseen + dt; this.seenBy = seen ? 1 : 0; if (seen) this.lastSeen.copy(pl.pos);
    if (this.unseen > 8 + this.stars * 3) { this.stats.evaded++; this.clear(); return; }
    // dispatch: wanted cars per level
    const want = Math.min(this.caps.units, [0, 1, 2, 3, 4, 5][this.stars]); this.dispatchT -= dt; if (this.units.length < want && this.dispatchT <= 0) { this.dispatchT = 2.5; const hidden = this.unseen > 2; this.dispatch(hidden ? this.lastSeen : pl.pos, pl.pos, hidden); }
    // officers get out when the player is on foot near a stopped cruiser
    for (const u of this.units) { const s = tr.host.phys.vehicle(u.id); if (!s || this.deployed.has(u.id)) continue; const d = Math.hypot(s.pos[0] - pl.pos.x, s.pos[2] - pl.pos.z);
      if (d < 22 && Math.abs(s.vf) < 2.5 && (pl.onFoot || this.stars >= 2)) { this.deployed.add(u.id); const q = new THREE.Quaternion(...s.quat); const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q); const yaw = Math.atan2(pl.pos.x - s.pos[0], pl.pos.z - s.pos[2]);
        const w = this.stars >= 4 ? 'rifle' : this.stars >= 3 ? 'smg' : 'pistol'; for (const sd of [1, -1]) { if (this.officers.filter((o) => !o.dead).length >= this.caps.officers) break; const at = new THREE.Vector3(s.pos[0], 0, s.pos[2]).addScaledVector(side, sd * 1.7); this.officers.push(this.host.spawnOfficer(at, w, yaw)); this.stats.officers++; } } }
    for (const o of this.officers) { o.setArrest(this.stars <= 1 && pl.onFoot); o.update(dt); }
    // arrest at 1 star: an officer next to a slow player on foot
    const near = this.officers.some((o) => !o.dead && o.pos().distanceTo(pl.pos) < 2.4); this.arrestT = this.stars <= 1 && pl.onFoot && pl.speed < 1.5 && near ? this.arrestT + dt : 0;
    if (this.arrestT > 1.6) { this.arrestT = 0; this.host.onBusted(); this.clear(); return; }
    this.heat = Math.max(this.stars, this.heat - dt * 0.02); this.updateSiren(pl.pos); this.render();
  }
  /** One wailing siren voice, loudness from the nearest pursuing cruiser. */
  private updateSiren(at: THREE.Vector3) {
    const tr = this.host.traffic; let near = 1e9; for (const u of this.units) { const s = tr.host.phys.vehicle(u.id); if (s) near = Math.min(near, Math.hypot(s.pos[0] - at.x, s.pos[2] - at.z)); }
    const A = this.host.audio; if (!A.ctx) return; const c = A.ctx;
    if (!this.siren && near < 200) { const osc = c.createOscillator(); osc.type = 'sawtooth'; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; const gain = c.createGain(); gain.gain.value = 0; osc.connect(lp); lp.connect(gain); gain.connect(A.master); osc.start(); this.siren = { osc, gain }; }
    if (!this.siren) return; const t = c.currentTime; const wail = 0.5 + 0.5 * Math.sin(this.t * Math.PI * 2 / (this.stars >= 3 ? 0.7 : 2.6));
    this.siren.osc.frequency.setTargetAtTime(650 + wail * 750, t, 0.05); this.siren.gain.gain.setTargetAtTime(near < 200 ? 0.07 * Math.min(1, 25 / Math.max(25, near)) : 0, t, 0.2);
  }
  /** Light-bar flash colour for cruisers in pursuit (0 = off, 1 = red, 2 = blue). */
  flash(id: number) { return this.units.some((u) => u.id === id) ? (Math.floor(this.t * 6 + id) % 2 ? 1 : 2) : 0; }
}
