// Character animation state: a speed-matched, phase-synced locomotion blend tree (idle / walk / run / sprint, plus the
// crouch set) and a full-body one-shot slot (jump, land, vault, turn-in-place, enter/exit, hit reactions, get-ups) that
// cross-fades over it. Locomotion clips are driven by a shared gait phase (distance travelled / stride length), so foot
// speed equals ground speed and blends never cross the legs; each clip's phase is aligned on its left-foot strike.
import * as THREE from 'three';
import type { Character } from '../character/character';

interface Gait { a: THREE.AnimationAction; speed: number; stride: number; off: number; dur: number; rev?: boolean }
/** Armed stance: idle + directional gait lists (forward / back / left / right, each ascending by speed). */
export interface StanceDef { bundle: string; idle: string; idleAt?: number; f: string[]; b: string[]; l: string[]; r: string[] }
interface StanceSet { idle: THREE.AnimationAction; dirs: Gait[][] }
export const STANCES: Record<string, StanceDef> = {
  rifle: { bundle: 'rifle', idle: 'rifle_standing_idle', f: ['rifle_walk_forward', 'running_with_rifle_aimed'], b: ['walking_backwards_while_aiming_rifle', 'rifle_run_backward'], l: ['rifle_run_left'], r: ['rifle_run_right'] },
  pistol: { bundle: 'pistol', idle: 'firing_a_gun', idleAt: 0.05, f: ['walking_with_an_aimed_pistol', 'running_with_aimed_pistol'], b: ['walking_backward_with_an_aimed_pistol', 'running_backward_with_an_aimed_pistol'], l: ['strafe_left_with_an_aimed_pistol'], r: ['strafe_right_with_an_aimed_pistol'] },
};
export interface OneShot { a: THREE.AnimationAction; fadeIn: number; fadeOut: number; w: number; t: number; dur: number; done: (() => void) | null; hold: boolean; yawRate: number }
export const LOCO = { idle: 'standard_idle', walk: 'male_walk_forward_03', run: 'slow_run_forward', sprint: 'running_fast', crouchIdle: 'low_crouching_idle', crouchWalk: 'walking_backwards_while_crouched' };

export class Animator {
  idle!: THREE.AnimationAction; crouchIdle!: THREE.AnimationAction; gaits: Gait[] = []; crouchGait!: Gait;
  phase = 0; speed = 0; crouch = 0; scale = 1; shot: OneShot | null = null; ready = false; locoWeight = 1;
  stances = new Map<string, StanceSet>(); stance: string | null = null; private sw = new Map<string, number>(); dir = 0;
  constructor(public ch: Character) {}
  async init(idleKey = LOCO.idle, set: Partial<typeof LOCO> = {}) {
    const L = { ...LOCO, ...set };
    const ch = this.ch; this.scale = ch.rig.hipsHeight / 0.99;
    this.idle = await ch.action('core', idleKey); this.crouchIdle = await ch.action('core', L.crouchIdle);
    for (const a of [this.idle, this.crouchIdle]) { a.play(); a.setEffectiveWeight(0); }
    this.idle.setEffectiveWeight(1);
    const mk = async (key: string, rev = false): Promise<Gait> => { const a = await ch.action('core', key); const c = a.getClip(); const m = (c as any).meta;
      const g: Gait = { a, speed: m.speed * this.scale, stride: m.speed * this.scale * c.duration, off: 0, dur: c.duration, rev }; a.play(); a.timeScale = 0; a.setEffectiveWeight(0); g.off = this.strikePhase(g); return g; };
    this.gaits = [await mk(L.walk), await mk(L.run), await mk(L.sprint)];
    this.crouchGait = await mk(L.crouchWalk, true); // no forward crouch-walk in the library: the backward one reversed
    this.ready = true; return this;
  }
  /** Load an armed stance set (idempotent). */
  async addStance(name: string) {
    if (this.stances.has(name)) return; const d = STANCES[name]; const ch = this.ch;
    const idle = await ch.action(d.bundle, d.idle, { name: `stance/${name}/idle` }); idle.play(); idle.setEffectiveWeight(0); if (d.idleAt !== undefined) { idle.timeScale = 0; idle.time = d.idleAt; }
    const dirVec = [[0, 1], [0, -1], [1, 0], [-1, 0]]; const dirs: Gait[][] = [];
    for (const [k, keys] of [d.f, d.b, d.l, d.r].entries()) { const list: Gait[] = [];
      for (const key of keys) { const a = await ch.action(d.bundle, key); const c = a.getClip(); const m = (c as any).meta; if (!m.speed) continue;
        const g: Gait = { a, speed: m.speed * this.scale, stride: m.speed * this.scale * c.duration, off: 0, dur: c.duration }; a.play(); a.timeScale = 0; a.setEffectiveWeight(0); g.off = this.strikePhase(g, dirVec[k]); list.push(g); }
      dirs.push(list.sort((x, y) => x.speed - y.speed)); }
    this.stances.set(name, { idle, dirs }); this.sw.set(name, 0);
  }
  /** Phase (0..1) of the left-foot strike: the sample where the left foot is furthest ahead of the right along the gait's direction. */
  private strikePhase(g: Gait, dv = [0, 1]) {
    const ch = this.ch; const L = ch.bone('LeftFoot'), R = ch.bone('RightFoot'); if (!L || !R) return 0;
    const others = ch.mixer['_actions'] as THREE.AnimationAction[]; const saved = others.map((x) => x.getEffectiveWeight()); others.forEach((x) => x.setEffectiveWeight(0));
    g.a.setEffectiveWeight(1); let best = -1e9, bestT = 0; const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < 24; i++) { const t = (i / 24) * g.dur; g.a.time = g.rev ? g.dur - t : t; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
      L.getWorldPosition(v); R.getWorldPosition(w); const d = (v.x - w.x) * dv[0] + (v.z - w.z) * dv[1]; if (d > best) { best = d; bestT = i / 24; } }
    others.forEach((x, i) => x.setEffectiveWeight(saved[i])); g.a.setEffectiveWeight(0); return bestT;
  }
  /** Full-body one-shot over locomotion. Resolves when it finishes (or is replaced). hold = keep last frame until stop(). */
  async play(bundle: string, key: string, o: { fadeIn?: number; fadeOut?: number; timeScale?: number; hold?: boolean; removeYaw?: boolean; from?: number; reverse?: boolean } = {}) {
    const a = await this.ch.action(bundle, key, { loop: false, removeYaw: o.removeYaw, name: `${bundle}/${key}${o.removeYaw ? '#ny' : ''}` });
    if (this.shot && this.shot.a !== a) { this.shot.a.fadeOut(0.15); this.shot.done?.(); }
    const dur = a.getClip().duration; a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = (o.reverse ? -1 : 1) * (o.timeScale ?? 1);
    a.time = o.reverse ? dur - (o.from ?? 0) : (o.from ?? 0); a.play(); a.setEffectiveWeight(0);
    const yawTotal = (a.getClip() as any).yawTotal ?? 0;
    return new Promise<void>((res) => { this.shot = { a, fadeIn: o.fadeIn ?? 0.18, fadeOut: o.fadeOut ?? 0.25, w: 0, t: o.from ?? 0, dur: dur / Math.abs(a.timeScale), done: res, hold: !!o.hold, yawRate: o.removeYaw ? yawTotal / dur * a.timeScale : 0 }; });
  }
  stop(fade = 0.25) { if (this.shot) { this.shot.hold = false; this.shot.t = Math.max(this.shot.t, this.shot.dur - fade); this.shot.fadeOut = fade; } }
  get busy() { return !!this.shot && this.shot.w > 0.5; }
  /** speed: ground speed m/s; crouch 0/1. Returns the one-shot's procedural root yaw delta for this frame. */
  update(dt: number, speed: number, crouch: number, dir = 0) {
    if (!this.ready) return 0; this.dir = dir;
    this.speed = speed; this.crouch += (crouch - this.crouch) * Math.min(1, dt * 6); const c = this.crouch;
    let yaw = 0;
    // one-shot fade envelope
    let ow = 0; const s = this.shot;
    if (s) { s.t += dt; const out = s.hold ? 1 : THREE.MathUtils.clamp((s.dur - s.t) / Math.max(1e-3, s.fadeOut), 0, 1); s.w = Math.min(THREE.MathUtils.clamp(s.t / Math.max(1e-3, s.fadeIn), 0, 1), out); ow = s.w;
      if (s.t < s.dur) yaw = s.yawRate * dt; s.a.setEffectiveWeight(ow);
      if (!s.hold && s.t >= s.dur) { s.a.stop(); s.a.setEffectiveWeight(0); this.shot = null; s.done?.(); } }
    const base = 1 - ow; this.locoWeight = base;
    // armed stance cross-fade (crouch stays on the unarmed set)
    let armed = 0; for (const [n, v] of this.sw) { const t = n === this.stance && crouch < 0.5 ? 1 : 0; const nv = v + (t - v) * Math.min(1, dt * 7); this.sw.set(n, nv); armed += nv; }
    armed = Math.min(1, armed); const ub = base * (1 - armed); // unarmed share
    // locomotion: 1D blend over clip speeds; standing set vs crouch set by crouch weight
    const G = this.gaits; const pts = [0, ...G.map((g) => g.speed)]; const w = new Array(G.length + 1).fill(0);
    if (speed <= 0.05) w[0] = 1; else if (speed >= pts[pts.length - 1]) w[w.length - 1] = 1;
    else for (let i = 0; i < pts.length - 1; i++) if (speed >= pts[i] && speed < pts[i + 1]) { const f = (speed - pts[i]) / (pts[i + 1] - pts[i]); w[i] = 1 - f; w[i + 1] = f; }
    const cw = THREE.MathUtils.clamp(speed / this.crouchGait.speed, 0, 1);
    // shared gait phase: advance by distance / blended stride
    let strideSum = 0, wsum = 0; G.forEach((g, i) => { strideSum += g.stride * w[i + 1]; wsum += w[i + 1]; });
    let stride = (1 - c) * (wsum > 0 ? strideSum / wsum : G[0].stride) + c * this.crouchGait.stride;
    // armed sets: direction weights (f, b, l, r) from the move angle relative to facing (0 = forward, +pi/2 = left)
    const cs = Math.cos(dir), sn = Math.sin(dir); const dw = [Math.max(0, cs), Math.max(0, -cs), Math.max(0, sn), Math.max(0, -sn)]; const dsum = dw[0] + dw[1] + dw[2] + dw[3] || 1;
    const armedW: [Gait, number][] = []; let aStride = 0, aw = 0;
    for (const [n, set] of this.stances) { const k = this.sw.get(n)!; if (k < 1e-3) { set.idle.setEffectiveWeight(0); for (const l of set.dirs) for (const g of l) g.a.setEffectiveWeight(0); continue; }
      let idleW = speed <= 0.05 ? 1 : 0;
      set.dirs.forEach((list0, di) => { const list = list0.length ? list0 : set.dirs[0]; const wd = dw[di] / dsum; if (wd < 1e-4 || speed <= 0.05) { for (const g of list0) g.a.setEffectiveWeight(0); return; }
        // 1D speed blend within the direction (idle below the slowest gait)
        const sp = [0, ...list.map((g) => g.speed)]; const ws = new Array(sp.length).fill(0);
        if (speed >= sp[sp.length - 1]) ws[ws.length - 1] = 1; else for (let i = 0; i < sp.length - 1; i++) if (speed >= sp[i] && speed < sp[i + 1]) { const f = (speed - sp[i]) / (sp[i + 1] - sp[i]); ws[i] = 1 - f; ws[i + 1] = f; }
        idleW += ws[0] * wd; list.forEach((g, i) => { armedW.push([g, base * k * wd * ws[i + 1]]); aStride += g.stride * wd * ws[i + 1] * k; aw += wd * ws[i + 1] * k; }); });
      set.idle.setEffectiveWeight(base * k * Math.min(1, idleW)); }
    if (aw > 1e-3) stride = stride * (1 - armed) + (aStride / aw) * armed;
    if (speed > 0.05) this.phase = (this.phase + (speed * dt) / stride) % 1;
    const setT = (g: Gait) => { const p = (this.phase + g.off) % 1; g.a.time = (g.rev ? 1 - p : p) * g.dur; };
    this.idle.setEffectiveWeight(ub * (1 - c) * w[0]);
    G.forEach((g, i) => { setT(g); g.a.setEffectiveWeight(ub * (1 - c) * w[i + 1]); });
    this.crouchIdle.setEffectiveWeight(ub * c * (1 - cw)); setT(this.crouchGait); this.crouchGait.a.setEffectiveWeight(ub * c * cw);
    const seen = new Map<Gait, number>(); for (const [g, wg] of armedW) seen.set(g, (seen.get(g) ?? 0) + wg); for (const [g, wg] of seen) { setT(g); g.a.setEffectiveWeight(wg); }
    this.ch.mixer.update(dt);
    return yaw;
  }
}
