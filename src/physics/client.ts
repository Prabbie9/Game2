// Main-thread side of the physics worker: fixed-step accumulator, command channel, and snapshot interpolation.
import { STEP, VEH_STRIDE, DYN_STRIDE, type StaticDesc, type DynamicDesc } from '../sim/simcore';
import type { VehicleInput } from '../sim/vehicle';
export interface VehState { pos: number[]; quat: number[]; wheels: { susp: number; steer: number; rot: number; contact: number; skid: number }[]; speed: number; vf: number; slip: number; rpm: number; gear: number; contacts: number; boost: number; throttle: number }
export class PhysicsClient {
  worker: Worker; ready: Promise<void>; acc = 0; pending = false; timeScale = 1;
  prev: Map<number, Float32Array> = new Map(); curr: Map<number, Float32Array> = new Map();
  inputs: Record<number, Partial<VehicleInput>> = {}; simTime = 0; lastStepMs = 0; snaps = 0;
  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((res) => { const h = (e: MessageEvent) => { if (e.data.type === 'ready') { res(); } }; this.worker.addEventListener('message', h); });
    this.worker.addEventListener('message', (e) => { if (e.data.type === 'snap') this.onSnap(e.data); });
    this.worker.postMessage({ type: 'init' });
  }
  private t0 = 0;
  private onSnap(d: { buf: Float32Array; vehIds: number[]; dynIds: number[]; time: number }) {
    this.pending = false; this.lastStepMs = performance.now() - this.t0; this.snaps++;
    this.prev = this.curr; this.curr = new Map(); let o = 0;
    for (const id of d.vehIds) { this.curr.set(id, d.buf.subarray(o, o + VEH_STRIDE)); o += VEH_STRIDE; }
    for (const id of d.dynIds) { this.curr.set(id, d.buf.subarray(o, o + DYN_STRIDE)); o += DYN_STRIDE; }
    this.simTime = d.time;
  }
  addStatics(list: StaticDesc[]) { this.worker.postMessage({ type: 'static', list }); }
  addDynamics(list: (DynamicDesc & { id: number })[]) { this.worker.postMessage({ type: 'dynamic', list }); }
  spawnVehicle(id: number, tuning: any, pos: number[], yaw = 0) { this.worker.postMessage({ type: 'spawnVehicle', id, tuning, pos, yaw }); }
  setTuning(id: number, tuning: any) { this.worker.postMessage({ type: 'tuning', id, tuning }); }
  teleportVehicle(id: number, pos: number[], yaw: number) { this.worker.postMessage({ type: 'teleportVehicle', id, pos, yaw }); }
  setVelocity(id: number, v: number[]) { this.worker.postMessage({ type: 'velocity', id, v }); }
  setGravity(g: number) { this.worker.postMessage({ type: 'gravity', g }); }
  /** Advance the accumulator; posts a step request when at least one fixed step is due and no request is in flight. */
  update(dt: number) {
    this.acc += Math.min(dt, 0.1) * this.timeScale;
    if (this.pending) return;
    const n = Math.min(4, Math.floor(this.acc / STEP));
    if (n > 0) { this.acc -= n * STEP; this.pending = true; this.t0 = performance.now(); this.worker.postMessage({ type: 'step', n, inputs: this.inputs }); }
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
