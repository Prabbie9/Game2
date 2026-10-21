// Synthesised vehicle audio (no samples needed): engine = detuned harmonic oscillators + filtered noise, pitch from RPM,
// load from throttle; tyre squeal = band-passed noise driven by skid; wind = high-passed noise by speed; horn.
// Audio starts only after a user gesture (browser policy) via AudioSys.resume().
export class AudioSys {
  ctx: AudioContext | null = null; master!: GainNode; muted = false;
  ensure() { if (!this.ctx) { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination); } return this.ctx; }
  resume() { this.ensure(); if (this.ctx!.state !== 'running') this.ctx!.resume(); }
  private nb: AudioBuffer | null = null; private amb: { g: GainNode; lp: BiquadFilterNode; gull: number } | null = null;
  /** One-shot noise burst through a filter with an exponential decay (gunshots, explosions, impacts). gain falls with distance. */
  burst(dist: number, o: { gain: number; decay: number; freq: number; q?: number; type?: BiquadFilterType; thump?: number }) {
    if (!this.ctx || this.ctx.state !== 'running') return; const c = this.ctx, t = c.currentTime; const g0 = o.gain / (1 + (dist / 18) ** 1.6); if (g0 < 0.004) return;
    const src = c.createBufferSource(); src.buffer = this.nb ??= this.noise(2); const f = c.createBiquadFilter(); f.type = o.type ?? 'lowpass'; f.frequency.value = o.freq * (1 - Math.min(0.7, dist / 300)); f.Q.value = o.q ?? 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(0.0005, t + o.decay); src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random() * 1.5); src.stop(t + o.decay + 0.05);
    if (o.thump) { const os = c.createOscillator(); os.frequency.setValueAtTime(o.thump, t); os.frequency.exponentialRampToValueAtTime(o.thump * 0.35, t + o.decay * 0.6); const og = c.createGain(); og.gain.setValueAtTime(g0 * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0005, t + o.decay * 0.7); os.connect(og); og.connect(this.master); os.start(t); os.stop(t + o.decay); } }
  gun(dist: number, heavy = false) { this.burst(dist, heavy ? { gain: 0.9, decay: 0.45, freq: 2600, thump: 90 } : { gain: 0.55, decay: 0.22, freq: 3800, thump: 140 }); }
  boom(dist: number) { this.burst(dist * 0.6, { gain: 1.4, decay: 2.2, freq: 700, thump: 55 }); }
  /** City bed: brown-ish noise low-passed; louder by day, a hint of distant traffic. Call each frame. */
  ambience(level: number) { if (!this.ctx || this.ctx.state !== 'running') return; const c = this.ctx;
    if (!this.amb) { const src = c.createBufferSource(); src.buffer = this.noise(4); src.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; const g = c.createGain(); g.gain.value = 0; src.connect(lp); lp.connect(g); g.connect(this.master); src.start(); this.amb = { g, lp, gull: 0 }; }
    this.amb.g.gain.setTargetAtTime(0.05 * level, c.currentTime, 0.5); }
  noise(seconds = 2) { const c = this.ensure(); const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
}
export class EngineSound {
  oscs: OscillatorNode[] = []; gains: GainNode[] = []; out: GainNode; lp: BiquadFilterNode; squeal: GainNode; squealBp: BiquadFilterNode; wind: GainNode; horn: GainNode; hornOsc: OscillatorNode[] = [];
  constructor(public A: AudioSys, profile: 'v6' | 'v8' | 'i4' = 'v6') {
    const c = A.ensure(); this.out = c.createGain(); this.out.gain.value = 0; this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 0.8;
    this.out.connect(this.lp); this.lp.connect(A.master);
    const harmonics = profile === 'v8' ? [0.5, 1, 1.5, 2, 3] : profile === 'i4' ? [1, 2, 4] : [0.5, 1, 1.5, 3];
    harmonics.forEach((h, i) => { const o = c.createOscillator(); o.type = i === 0 ? 'sawtooth' : i % 2 ? 'square' : 'triangle'; const g = c.createGain(); g.gain.value = 0.3 / (i + 1); o.connect(g); g.connect(this.out); o.start(); (o as any).h = h; this.oscs.push(o); this.gains.push(g); });
    const n = c.createBufferSource(); n.buffer = A.noise(); n.loop = true; const ng = c.createGain(); ng.gain.value = 0.15; const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 400; n.connect(nb); nb.connect(ng); ng.connect(this.out); n.start();
    const s = c.createBufferSource(); s.buffer = A.noise(); s.loop = true; this.squealBp = c.createBiquadFilter(); this.squealBp.type = 'bandpass'; this.squealBp.frequency.value = 1700; this.squealBp.Q.value = 9;
    this.squeal = c.createGain(); this.squeal.gain.value = 0; s.connect(this.squealBp); this.squealBp.connect(this.squeal); this.squeal.connect(A.master); s.start();
    const w = c.createBufferSource(); w.buffer = A.noise(); w.loop = true; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; this.wind = c.createGain(); this.wind.gain.value = 0; w.connect(hp); hp.connect(this.wind); this.wind.connect(A.master); w.start();
    this.horn = c.createGain(); this.horn.gain.value = 0; this.horn.connect(A.master);
    for (const f of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; const hb = c.createBiquadFilter(); hb.type = 'lowpass'; hb.frequency.value = 1800; o.connect(hb); hb.connect(this.horn); o.start(); this.hornOsc.push(o); }
  }
  update(rpm: number, throttle: number, skid: number, speed: number, horn: boolean) {
    const c = this.A.ctx!; const t = c.currentTime; const f = rpm / 60;
    this.oscs.forEach((o) => o.frequency.setTargetAtTime(f * (o as any).h, t, 0.03));
    this.out.gain.setTargetAtTime(0.08 + throttle * 0.16, t, 0.05);
    this.lp.frequency.setTargetAtTime(500 + throttle * 1800 + rpm * 0.15, t, 0.05);
    this.squeal.gain.setTargetAtTime(Math.min(0.22, Math.max(0, skid - 0.25) * 0.35), t, 0.04);
    this.squealBp.frequency.setTargetAtTime(1400 + skid * 600, t, 0.1);
    this.wind.gain.setTargetAtTime(Math.min(0.18, speed * speed * 0.00006), t, 0.2);
    this.horn.gain.setTargetAtTime(horn ? 0.12 : 0, t, 0.01);
  }
  /** Fade out and disconnect (vehicle swap: the next class builds its own harmonic profile). */
  dispose() { const t = this.A.ctx!.currentTime; for (const g of [this.out, this.squeal, this.wind, this.horn]) g.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { for (const g of [this.lp, this.squeal, this.wind, this.horn]) g.disconnect(); for (const o of [...this.oscs, ...this.hornOsc]) { try { o.stop(); } catch { /* already stopped */ } } }, 400); }
}
