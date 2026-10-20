// Character animation state: a speed-matched, phase-synced locomotion blend tree (idle / walk / run / sprint, plus the
// crouch set) and a full-body one-shot slot (jump, land, vault, turn-in-place, enter/exit, hit reactions, get-ups) that
// cross-fades over it. Locomotion clips are driven by a shared gait phase (distance travelled / stride length), so foot
// speed equals ground speed and blends never cross the legs; each clip's phase is aligned on its left-foot strike.
import * as THREE from 'three';
import type { Character } from '../character/character';

interface Gait { a: THREE.AnimationAction; speed: number; stride: number; off: number; dur: number; rev?: boolean }
export interface OneShot { a: THREE.AnimationAction; fadeIn: number; fadeOut: number; w: number; t: number; dur: number; done: (() => void) | null; hold: boolean; yawRate: number }
export const LOCO = { idle: 'standard_idle', walk: 'walking_forwards', run: 'running_forwards', sprint: 'running_fast', crouchIdle: 'low_crouching_idle', crouchWalk: 'walking_backwards_while_crouched' };

export class Animator {
  idle!: THREE.AnimationAction; crouchIdle!: THREE.AnimationAction; gaits: Gait[] = []; crouchGait!: Gait;
  phase = 0; speed = 0; crouch = 0; scale = 1; shot: OneShot | null = null; ready = false; locoWeight = 1;
  constructor(public ch: Character) {}
  async init(idleKey = LOCO.idle) {
    const ch = this.ch; this.scale = ch.rig.hipsHeight / 0.99;
    this.idle = await ch.action('core', idleKey); this.crouchIdle = await ch.action('core', LOCO.crouchIdle);
    for (const a of [this.idle, this.crouchIdle]) { a.play(); a.setEffectiveWeight(0); }
    this.idle.setEffectiveWeight(1);
    const mk = async (key: string, rev = false): Promise<Gait> => { const a = await ch.action('core', key); const c = a.getClip(); const m = (c as any).meta;
      const g: Gait = { a, speed: m.speed * this.scale, stride: m.speed * this.scale * c.duration, off: 0, dur: c.duration, rev }; a.play(); a.timeScale = 0; a.setEffectiveWeight(0); g.off = this.strikePhase(g); return g; };
    this.gaits = [await mk(LOCO.walk), await mk(LOCO.run), await mk(LOCO.sprint)];
    this.crouchGait = await mk(LOCO.crouchWalk, true); // no forward crouch-walk in the library: the backward one reversed
    this.ready = true; return this;
  }
  /** Phase (0..1) of the left-foot strike: the sample where the left foot is furthest ahead of the right. */
  private strikePhase(g: Gait) {
    const ch = this.ch; const L = ch.bone('LeftFoot'), R = ch.bone('RightFoot'); if (!L || !R) return 0;
    const others = ch.mixer['_actions'] as THREE.AnimationAction[]; const saved = others.map((x) => x.getEffectiveWeight()); others.forEach((x) => x.setEffectiveWeight(0));
    g.a.setEffectiveWeight(1); let best = -1e9, bestT = 0; const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < 24; i++) { const t = (i / 24) * g.dur; g.a.time = g.rev ? g.dur - t : t; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
      const d = L.getWorldPosition(v).z - R.getWorldPosition(w).z; if (d > best) { best = d; bestT = i / 24; } }
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
  update(dt: number, speed: number, crouch: number) {
    if (!this.ready) return 0;
    this.speed = speed; this.crouch += (crouch - this.crouch) * Math.min(1, dt * 6); const c = this.crouch;
    let yaw = 0;
    // one-shot fade envelope
    let ow = 0; const s = this.shot;
    if (s) { s.t += dt; const out = s.hold ? 1 : THREE.MathUtils.clamp((s.dur - s.t) / Math.max(1e-3, s.fadeOut), 0, 1); s.w = Math.min(THREE.MathUtils.clamp(s.t / Math.max(1e-3, s.fadeIn), 0, 1), out); ow = s.w;
      if (s.t < s.dur) yaw = s.yawRate * dt; s.a.setEffectiveWeight(ow);
      if (!s.hold && s.t >= s.dur) { s.a.stop(); s.a.setEffectiveWeight(0); this.shot = null; s.done?.(); } }
    const base = 1 - ow; this.locoWeight = base;
    // locomotion: 1D blend over clip speeds; standing set vs crouch set by crouch weight
    const G = this.gaits; const pts = [0, ...G.map((g) => g.speed)]; const w = new Array(G.length + 1).fill(0);
    if (speed <= 0.05) w[0] = 1; else if (speed >= pts[pts.length - 1]) w[w.length - 1] = 1;
    else for (let i = 0; i < pts.length - 1; i++) if (speed >= pts[i] && speed < pts[i + 1]) { const f = (speed - pts[i]) / (pts[i + 1] - pts[i]); w[i] = 1 - f; w[i + 1] = f; }
    const cw = THREE.MathUtils.clamp(speed / this.crouchGait.speed, 0, 1);
    // shared gait phase: advance by distance / blended stride
    let strideSum = 0, wsum = 0; G.forEach((g, i) => { strideSum += g.stride * w[i + 1]; wsum += w[i + 1]; });
    const stride = (1 - c) * (wsum > 0 ? strideSum / wsum : G[0].stride) + c * this.crouchGait.stride;
    if (speed > 0.05) this.phase = (this.phase + (speed * dt) / stride) % 1;
    const setT = (g: Gait) => { const p = (this.phase + g.off) % 1; g.a.time = (g.rev ? 1 - p : p) * g.dur; };
    this.idle.setEffectiveWeight(base * (1 - c) * w[0]);
    G.forEach((g, i) => { setT(g); g.a.setEffectiveWeight(base * (1 - c) * w[i + 1]); });
    this.crouchIdle.setEffectiveWeight(base * c * (1 - cw)); setT(this.crouchGait); this.crouchGait.a.setEffectiveWeight(base * c * cw);
    this.ch.mixer.update(dt);
    return yaw;
  }
}
