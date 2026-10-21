// Main-thread side of the physics worker: fixed-step accumulator, command channel, and snapshot interpolation.
import { STEP, VEH_STRIDE, DYN_STRIDE, type StaticDesc, type DynamicDesc } from '../sim/simcore';
import type { VehicleInput } from '../sim/vehicle';
import { CHAR_STRIDE, type CharInput } from '../sim/charsim';
export interface CharState { pos: number[]; vel: number[]; grounded: boolean; crouched: boolean; footY: number[]; footN: number[][]; obstacle: { dist: number; top: number; depth: number }; groundY: number }
export interface VehState { pos: number[]; quat: number[]; wheels: { susp: number; steer: number; rot: number; contact: number; skid: number }[]; speed: number; vf: number; slip: number; rpm: number; gear: number; contacts: number; boost: number; throttle: number }
export class PhysicsClient {
  worker: Worker; ready: Promise<void>; acc = 0; pending = false; timeScale = 1;
  prev: Map<number, Float32Array> = new Map(); curr: Map<number, Float32Array> = new Map();
  inputs: Record<number, Partial<VehicleInput>> = {}; charInputs: Record<number, Partial<CharInput>> = {}; simTime = 0; lastStepMs = 0; snaps = 0;
  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((res) => { const h = (e: MessageEvent) => { if (e.data.type === 'ready') { res(); } }; this.worker.addEventListener('message', h); });
    this.worker.addEventListener('message', (e) => { if (e.data.type === 'snap') this.onSnap(e.data); });
    this.worker.postMessage({ type: 'init' });
  }
  private t0 = 0;
  rag = new Map<number, Float32Array>(); ragPrev = new Map<number, Float32Array>();
  private onSnap(d: { buf: Float32Array; vehIds: number[]; dynIds: number[]; charIds: number[]; rag: [number, number][]; time: number }) {
    this.pending = false; this.lastStepMs = performance.now() - this.t0; this.snaps++;
    this.prev = this.curr; this.curr = new Map(); let o = 0;
    for (const id of d.vehIds) { this.curr.set(id, d.buf.subarray(o, o + VEH_STRIDE)); o += VEH_STRIDE; }
    for (const id of d.dynIds) { this.curr.set(id, d.buf.subarray(o, o + DYN_STRIDE)); o += DYN_STRIDE; }
    for (const id of d.charIds) { this.curr.set(-id, d.buf.subarray(o, o + CHAR_STRIDE)); o += CHAR_STRIDE; } // characters keyed by -id
    this.ragPrev = this.rag; this.rag = new Map(); for (const [id, n] of d.rag) { this.rag.set(id, d.buf.subarray(o, o + n)); o += n; }
    this.simTime = d.time;
  }
  addStatics(list: StaticDesc[]) { this.worker.postMessage({ type: 'static', list }); }
  addGroup(gid: string, list: StaticDesc[]) { this.worker.postMessage({ type: 'group', gid, list }); }
  removeGroup(gid: string) { this.worker.postMessage({ type: 'removeGroup', gid }); }
  addDynamics(list: (DynamicDesc & { id: number })[]) { this.worker.postMessage({ type: 'dynamic', list }); }
  spawnVehicle(id: number, tuning: any, pos: number[], yaw = 0) { this.worker.postMessage({ type: 'spawnVehicle', id, tuning, pos, yaw }); }
  removeVehicle(id: number) { this.worker.postMessage({ type: 'removeVehicle', id }); delete this.inputs[id]; }
  setTuning(id: number, tuning: any) { this.worker.postMessage({ type: 'tuning', id, tuning }); }
  teleportVehicle(id: number, pos: number[], yaw: number) { this.worker.postMessage({ type: 'teleportVehicle', id, pos, yaw }); }
  setVelocity(id: number, v: number[]) { this.worker.postMessage({ type: 'velocity', id, v }); }
  spawnChar(id: number, pos: number[]) { this.worker.postMessage({ type: 'spawnChar', id, pos }); }
  removeChar(id: number) { this.worker.postMessage({ type: 'removeChar', id }); }
  spawnRagdoll(id: number, segs: any[], vel: number[], spin: number[] = [0, 0, 0]) { this.worker.postMessage({ type: 'spawnRagdoll', id, segs, vel, spin }); }
  removeRagdoll(id: number) { this.worker.postMessage({ type: 'removeRagdoll', id }); }
  explode(c: number[], radius: number, strength: number) { this.worker.postMessage({ type: 'explode', c, radius, strength }); }
  ragImpulse(id: number, seg: number, imp: number[]) { this.worker.postMessage({ type: 'ragImpulse', id, seg, imp }); }
  /** Ragdoll segment transforms (interpolated): [x,y,z,qx,qy,qz,qw] per segment, then mean speed. */
  ragdoll(id: number): { segs: number[][]; speed: number } | null {
    const c = this.rag.get(id); if (!c) return null; const p = this.ragPrev.get(id); const a = p && p.length === c.length ? this.alpha : 1; const n = (c.length - 1) / 7; const segs: number[][] = [];
    for (let i = 0; i < n; i++) { const o = i * 7; const P = p && a < 1 ? p : c; segs.push([P[o] + (c[o] - P[o]) * a, P[o + 1] + (c[o + 1] - P[o + 1]) * a, P[o + 2] + (c[o + 2] - P[o + 2]) * a, ...slerp([P[o + 3], P[o + 4], P[o + 5], P[o + 6]], [c[o + 3], c[o + 4], c[o + 5], c[o + 6]], a)]); }
    return { segs, speed: c[c.length - 1] };
  }
  teleportChar(id: number, pos: number[]) { this.worker.postMessage({ type: 'teleportChar', id, pos }); }
  /** Interpolated on-foot character state (feet position, velocity, ground + foot rays, obstacle probe). */
  char(id: number): CharState | null {
    const c = this.curr.get(-id); if (!c) return null; const p = this.prev.get(-id) ?? c; const a = this.alpha; const L = (i: number) => p[i] + (c[i] - p[i]) * a;
    return { pos: [L(0), L(1), L(2)], vel: [c[3], c[4], c[5]], grounded: c[6] > 0.5, crouched: c[7] > 0.5, footY: [c[8], c[9]], footN: [[c[10], c[11], c[12]], [c[13], c[14], c[15]]], obstacle: { dist: c[16], top: c[17], depth: c[18] }, groundY: c[19] };
  }
  setGravity(g: number) { this.worker.postMessage({ type: 'gravity', g }); }
  /** Advance the accumulator; posts a step request when at least one fixed step is due and no request is in flight. */
  update(dt: number) {
    this.acc += Math.min(dt, 0.1) * this.timeScale;
    if (this.pending) return;
    const n = Math.min(4, Math.floor(this.acc / STEP));
    if (n > 0) { this.acc -= n * STEP; this.pending = true; this.t0 = performance.now(); this.worker.postMessage({ type: 'step', n, inputs: this.inputs, charInputs: this.charInputs }); }
  }
  /** Interpolation factor between the previous and current snapshot. */
  get alpha() { return Math.min(1, this.acc / STEP); }
  vehicle(id: number): VehState | null {
    const c = this.curr.get(id); if (!c) return null; const p = this.prev.get(id) ?? c; const a = this.alpha;
    const L = (i: number) => p[i] + (c[i] - p[i]) * a;
    const q = slerp([p[3], p[4], p[5], p[6]], [c[3], c[4], c[5], c[6]], a);
    const wheels = [0, 1, 2, 3].map((i) => { const o = 7 + i * 5; return { susp: L(o), steer: L(o + 1), rot: c[o + 2], contact: c[o + 3], skid: c[o + 4] }; });
    const o = 27; return { pos: [L(0), L(1), L(2)], quat: q, wheels, speed: c[o], vf: c[o + 1], slip: c[o + 2], rpm: c[o + 3], gear: c[o + 4], contacts: c[o + 5], boost: c[o + 6], throttle: c[o + 7] };
  }
  body(id: number): { pos: number[]; quat: number[] } | null {
    const c = this.curr.get(id); if (!c) return null; const p = this.prev.get(id) ?? c; const a = this.alpha;
    return { pos: [p[0] + (c[0] - p[0]) * a, p[1] + (c[1] - p[1]) * a, p[2] + (c[2] - p[2]) * a], quat: slerp([p[3], p[4], p[5], p[6]], [c[3], c[4], c[5], c[6]], a) };
  }
}
function slerp(a: number[], b: number[], t: number) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d *= s;
  if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] * s - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), sn = Math.sin(th), wa = Math.sin((1 - t) * th) / sn, wb = (Math.sin(t * th) / sn) * s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
