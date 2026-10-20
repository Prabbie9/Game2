// Synthesised vehicle audio (no samples needed): engine = detuned harmonic oscillators + filtered noise, pitch from RPM,
// load from throttle; tyre squeal = band-passed noise driven by skid; wind = high-passed noise by speed; horn.
// Audio starts only after a user gesture (browser policy) via AudioSys.resume().
export class AudioSys {
  ctx: AudioContext | null = null; master!: GainNode; muted = false;
  ensure() { if (!this.ctx) { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination); } return this.ctx; }
  resume() { this.ensure(); if (this.ctx!.state !== 'running') this.ctx!.resume(); }
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
}
