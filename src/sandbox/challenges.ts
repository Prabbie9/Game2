// Challenge playlist (M10, Phase 3): five short timed challenges played in order from the spawn menu, or one at a time.
//   race     Downtown street sprint through ring checkpoints
//   highway  elevated highway run, end to end
//   boat     Harbour boat slalom around the piers
//   smash    wreck 3 cars before the clock runs out
//   evade    take 3 stars, then lose the police
// Checkpoints are two meshes (the active ring and a dimmer preview of the next). Best times are kept in localStorage
// (per viewer; missing storage just means no bests). Pure logic + two meshes: no per-frame allocation.
import * as THREE from 'three';
import { line, HWY, PIERS, QUAY_Z } from '../world/citygen';

export interface ChallengeHost {
  scene: THREE.Scene; playerPos(): THREE.Vector3; mode(): 'foot' | 'drive' | 'boat';
  start(def: ChallengeDef): void; // put the player at the start (vehicle/boat as the challenge needs)
  groundAt(x: number, z: number): number; wrecks(): number; stars(): number; setStars(n: number): void;
  say(s: string, sec?: number): void; banner(s: string): void;
}
export type ChallengeKind = 'race' | 'highway' | 'boat' | 'smash' | 'evade';
export interface ChallengeDef { id: ChallengeKind; label: string; time: number; need: 'drive' | 'boat' | 'any'; start: { p: [number, number, number]; yaw: number; vehicle?: string }; cps?: [number, number, number?][]; target?: number }

const R = (k: number) => line(k);
export const CHALLENGES: ChallengeDef[] = [
  { id: 'race', label: 'Downtown sprint', time: 75, need: 'drive', start: { p: [R(0), 0, -200], yaw: 0, vehicle: 'sedan2' },
    cps: [[R(0), -96], [R(0), 0 + 40], [R(0), R(1)], [R(1), R(1)], [R(2), R(1)], [R(2), R(2)], [R(1), R(2)], [R(1), R(3)]] },
  { id: 'highway', label: 'Highway run', time: 70, need: 'drive', start: { p: [-930, 0, HWY.z], yaw: Math.PI / 2, vehicle: 'sports' },
    cps: [[-700, HWY.z, HWY.y], [-350, HWY.z, HWY.y], [0, HWY.z, HWY.y], [350, HWY.z, HWY.y], [700, HWY.z, HWY.y]] },
  { id: 'boat', label: 'Harbour slalom', time: 80, need: 'boat', start: { p: [PIERS[0][0] + PIERS[0][1] + 1.45, 0, QUAY_Z + 38], yaw: 0 },
    cps: [[PIERS[0][0] + 20, QUAY_Z + 130], [PIERS[1][0] - 25, QUAY_Z + 40], [PIERS[1][0] + 25, QUAY_Z + 110], [PIERS[2][0] - 30, QUAY_Z + 40], [PIERS[2][0] + 30, QUAY_Z + 150], [PIERS[1][0], QUAY_Z + 200]] },
  { id: 'smash', label: 'Wreck 3 cars', time: 90, need: 'any', start: { p: [R(0) - 4, 0, -150], yaw: 0 }, target: 3 },
  { id: 'evade', label: 'Lose 3 stars', time: 120, need: 'any', start: { p: [R(0) - 4, 0, -150], yaw: 0, vehicle: 'muscle' }, target: 3 },
];

export interface ChallengeResult { id: ChallengeKind; ok: boolean; time: number; reason?: string }
export class Challenges {
  def: ChallengeDef | null = null; t = 0; cp = 0; wrecks0 = 0; hadStars = false; results: ChallengeResult[] = []; playlist: ChallengeKind[] = []; best: Record<string, number> = {};
  private ring: THREE.Mesh; private next: THREE.Mesh; private hud: HTMLDivElement;
  constructor(public host: ChallengeHost, parent: HTMLElement) {
    const g = new THREE.TorusGeometry(4.6, 0.28, 8, 40);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.next = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
    this.ring.visible = this.next.visible = false; this.ring.renderOrder = this.next.renderOrder = 5; host.scene.add(this.ring, this.next);
    this.hud = document.createElement('div'); this.hud.className = 'hl-challenge'; this.hud.hidden = true; parent.append(this.hud);
    try { this.best = JSON.parse(localStorage.getItem('hl.challengeBest') ?? '{}'); } catch { this.best = {}; }
  }
  get active() { return !!this.def; }
  /** Start the whole playlist (all five in order). */
  startPlaylist() { this.results = []; this.playlist = CHALLENGES.map((c) => c.id); this.startNext(); }
  start(id: ChallengeKind) { const d = CHALLENGES.find((c) => c.id === id)!; this.def = d; this.t = 0; this.cp = 0; this.wrecks0 = this.host.wrecks(); this.hadStars = false; this.host.start(d);
    if (d.id === 'evade') this.host.setStars(d.target ?? 3); this.place(); this.hud.hidden = false; this.host.say(d.label + ' — go!', 2); }
  private startNext() { const id = this.playlist.shift(); if (id) this.start(id); else this.finishPlaylist(); }
  cancel() { if (!this.def) return; this.end(false, 'cancelled'); this.playlist = []; }
  private cpPos(i: number, out: THREE.Vector3) { const c = this.def!.cps![i]; const y = c[2] ?? (this.def!.need === 'boat' ? 0 : this.host.groundAt(c[0], c[1])); return out.set(c[0], y + 2.6, c[1]); }
  private place() { const d = this.def!; const n = d.cps?.length ?? 0; this.ring.visible = this.cp < n; this.next.visible = this.cp + 1 < n;
    if (this.ring.visible) this.cpPos(this.cp, this.ring.position); if (this.next.visible) this.cpPos(this.cp + 1, this.next.position);
    // face each ring along the route
    for (const [m, i] of [[this.ring, this.cp], [this.next, this.cp + 1]] as [THREE.Mesh, number][]) if (m.visible) { const a = d.cps![Math.max(0, i - 1)], b = d.cps![i]; const from = i === 0 ? d.start.p : [a[0], 0, a[1]];
      m.rotation.set(0, Math.atan2(b[0] - from[0], b[1] - from[2]), 0); } }
  private tmp = new THREE.Vector3();
  update(dt: number) {
    const d = this.def; if (!d) return; this.t += dt; const left = d.time - this.t; const p = this.host.playerPos();
    if (d.cps) { if (d.need !== 'any' && this.host.mode() !== d.need) { /* out of the vehicle: the clock keeps running */ }
      const c = this.cpPos(this.cp, this.tmp); if (Math.hypot(p.x - c.x, p.z - c.z) < 6 && Math.abs(p.y - (c.y - 2.6)) < 6 && (d.need === 'any' || this.host.mode() === d.need)) { this.cp++; this.place(); if (this.cp >= d.cps.length) return this.end(true); this.host.say(`Checkpoint ${this.cp}/${d.cps.length}`, 1.2); } }
    if (d.id === 'smash' && this.host.wrecks() - this.wrecks0 >= (d.target ?? 3)) return this.end(true);
    if (d.id === 'evade') { if (this.host.stars() > 0) this.hadStars = true; else if (this.hadStars) return this.end(true); }
    if (left <= 0) return this.end(false, 'time');
    this.hud.textContent = `${d.label} · ${this.fmt(Math.max(0, left))}` + (d.cps ? ` · ${this.cp}/${d.cps.length}` : d.id === 'smash' ? ` · ${this.host.wrecks() - this.wrecks0}/${d.target}` : d.id === 'evade' ? ` · ${this.host.stars()}★` : '');
  }
  private end(ok: boolean, reason?: string) {
    const d = this.def!; const time = +this.t.toFixed(2); this.results.push({ id: d.id, ok, time, reason }); this.def = null; this.ring.visible = this.next.visible = false; this.hud.hidden = true;
    if (ok && (!this.best[d.id] || time < this.best[d.id])) { this.best[d.id] = time; try { localStorage.setItem('hl.challengeBest', JSON.stringify(this.best)); } catch { /* no storage */ } }
    this.host.banner(ok ? `COMPLETE ${this.fmt(time)}` : reason === 'cancelled' ? '' : 'FAILED'); setTimeout(() => this.host.banner(''), 2500);
    if (this.playlist.length && reason !== 'cancelled') setTimeout(() => this.startNext(), 3000); else if (!this.playlist.length && this.results.length > 1) this.finishPlaylist();
  }
  private finishPlaylist() { const done = this.results.filter((r) => r.ok).length; this.host.say(`Playlist: ${done}/${this.results.length} complete`, 5); }
  fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; }
}
