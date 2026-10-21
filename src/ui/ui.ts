// HUD, frame-time overlay, tuning panel (presets + copy settings), time/weather panel, pause menu with key cheat sheet.
import GUI from 'lil-gui';
import { PRESETS, resolveTuning, classLabel, type PresetName } from '../vehicles/tuning';
import { glyph, type Input, type Action } from '../input/input';
import data from '../data/vehicle_tuning.json';

const el = (tag: string, cls: string, parent: HTMLElement, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; parent.append(e); return e; };

export class HUD {
  root: HTMLElement; speed: HTMLElement; gear: HTMLElement; rpm: HTMLElement; boost: HTMLElement; hint: HTMLElement; overlay: HTMLElement; toast: HTMLElement;
  frames: number[] = []; overlayOn = false; private toastT = 0;
  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    const dash = el('div', 'dash', this.root);
    this.rpm = el('div', 'rpm', dash, '<i></i>'); this.speed = el('div', 'spd', dash, '0'); el('div', 'unit', dash, 'km/h'); this.gear = el('div', 'gear', dash, '1');
    this.boost = el('div', 'boost', dash, '<i></i>');
    this.hint = el('div', 'hint', this.root); this.overlay = el('pre', 'overlay', this.root); this.overlay.hidden = true;
    this.toast = el('div', 'toast', this.root); this.toast.hidden = true;
  }
  private lastHint = ""; setHint(s: string) { if (s !== this.lastHint) { this.lastHint = s; this.hint.innerHTML = s; } }
  say(s: string, sec = 2.5) { this.toast.textContent = s; this.toast.hidden = false; this.toastT = sec; }
  update(dt: number, v: { speed: number; vf: number; gear: number; rpm: number; boost: number; redline: number } | null, stats: Record<string, number | string>) {
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.toast.hidden = true;
    this.frames.push(dt * 1000); if (this.frames.length > 240) this.frames.shift();
    for (const e of [this.speed, this.gear, this.rpm, this.boost]) { const par = e.parentElement; if (par && par !== this.root) par.hidden = !v; else e.hidden = !v; }
    if (v) { this.speed.textContent = String(Math.round(Math.abs(v.vf) * 3.6)); this.gear.textContent = v.vf < -0.5 ? 'R' : String(v.gear);
      (this.rpm.firstChild as HTMLElement).style.width = `${Math.min(100, (v.rpm / v.redline) * 100)}%`; (this.boost.firstChild as HTMLElement).style.width = `${v.boost * 100}%`; }
    if (this.overlayOn) { const s = [...this.frames].sort((a, b) => a - b); const p = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))]?.toFixed(1);
      this.overlay.textContent = `frame ${(this.frames.at(-1) ?? 0).toFixed(1)} ms  avg ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)}  p50 ${p(0.5)}  p99 ${p(0.99)}\n` + Object.entries(stats).map(([k, x]) => `${k} ${x}`).join('  '); }
  }
  toggleOverlay() { this.overlayOn = !this.overlayOn; this.overlay.hidden = !this.overlayOn; }
}

/** Live vehicle tuning panel: every numeric value from the data file, preset picker, copy/reset. */
export class TuningPanel {
  gui: GUI; values: Record<string, any>; preset: PresetName = 'Balanced';
  constructor(public cls: string, public onChange: (t: Record<string, any>) => void, private say: (s: string) => void) {
    this.values = resolveTuning(cls, this.preset);
    this.gui = new GUI({ title: `Tuning: ${classLabel(cls)} (K)` }); this.gui.domElement.classList.add('tuning'); this.gui.hide();
    this.build();
  }
  private build() {
    const g = this.gui; g.folders.slice().forEach((f) => f.destroy()); g.controllers.slice().forEach((c) => c.destroy());
    const st = { preset: this.preset };
    g.add(st, 'preset', PRESETS).name('Preset').onChange((p: PresetName) => { this.preset = p; this.values = resolveTuning(this.cls, p); this.build(); this.onChange(this.values); this.say(`Preset: ${p}`); });
    const groups: Record<string, RegExp> = { Handling: /steer|countersteer|yaw|drift|handbrake|frictionSlip|rearGrip|sideStiffness/, Engine: /power|maxDrive|boost|topSpeed|brake|drag|roll|downforce|driveSplit/, Suspension: /susp|wheel|track|wheelbase|antiFlip|airDamp|mass/ };
    for (const [name, rx] of Object.entries(groups)) {
      const f = g.addFolder(name); if (name !== 'Handling') f.close();
      for (const k of Object.keys(this.values)) { const v = this.values[k]; if (typeof v !== 'number' || !rx.test(k)) continue;
        const max = Math.max(Math.abs(v) * 3, 1), step = Math.abs(v) >= 100 ? 10 : Math.abs(v) >= 10 ? 0.5 : 0.01;
        f.add(this.values, k, Math.min(0, v * 3), max, step).onFinishChange(() => this.onChange(this.values)); }
    }
    g.add({ copy: () => this.copy() }, 'copy').name('Copy my settings');
    g.add({ reset: () => { this.values = resolveTuning(this.cls, this.preset); this.build(); this.onChange(this.values); this.say('Reset to preset'); } }, 'reset').name('Reset to preset');
  }
  /** Copies the difference from the class base as JSON (paste into src/data/vehicle_tuning.json). */
  copy() {
    const base = (data.classes as any)[this.cls].base; const diff: Record<string, any> = { _preset: this.preset };
    for (const k of Object.keys(this.values)) if (typeof this.values[k] === 'number' && this.values[k] !== base[k]) diff[k] = +this.values[k].toFixed(4);
    const text = JSON.stringify({ [this.cls]: diff }, null, 1);
    navigator.clipboard?.writeText(text).then(() => this.say('Settings copied to clipboard'), () => { prompt('Copy your settings:', text); });
  }
  toggle() { this.gui._hidden ? this.gui.show() : this.gui.hide(); return !this.gui._hidden; }
}

export class TimeWeatherPanel {
  gui: GUI;
  constructor(env: { hours: number; timeSpeed: number; weatherName: string; setWeather: (w: any) => void; setTime: (h: number) => void }) {
    this.gui = new GUI({ title: 'Time & weather (T)' }); this.gui.domElement.classList.add('tw'); this.gui.hide();
    const st = { weather: env.weatherName, get hour() { return env.hours; }, set hour(h: number) { env.setTime(h); } };
    this.gui.add(st, 'hour', 0, 23.99, 0.05).name('Time of day').listen();
    this.gui.add(env, 'timeSpeed', 0, 0.2, 0.001).name('Time speed (h/s)');
    this.gui.add(st, 'weather', ['clear', 'overcast', 'rain', 'fog', 'storm']).name('Weather').onChange((w: string) => env.setWeather(w));
  }
  toggle() { this.gui._hidden ? this.gui.show() : this.gui.hide(); return !this.gui._hidden; }
}

const CHEAT: [string, Action[]][] = [
  ['Throttle / brake-reverse', ['throttle', 'brake']], ['Steer', ['steerLeft', 'steerRight']], ['Handbrake', ['handbrake']], ['Boost', ['boost']],
  ['Camera', ['camera']], ['Look behind', ['lookBehind']], ['Horn', ['horn']], ['Tuning panel', ['tuning']], ['Time & weather', ['timeWeather']], ['Frame-time overlay', ['frameOverlay']], ['Pause', ['pause']],
];
import creditsMd from '../../CREDITS.md?raw';
/** Credits screen: the table rows of CREDITS.md (what, author, licence) as a scrolling list. */
function creditsHTML() { const rows = creditsMd.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| What') && !l.startsWith('|---'));
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
  return rows.map((r) => { const c = r.split('|').map((x) => x.trim()); return `<li><b>${esc(c[1])}</b><span>${esc(c[2])} · ${esc(c[4])}</span></li>`; }).join(''); }
export class PauseMenu {
  root: HTMLElement; open = false;
  constructor(parent: HTMLElement, input: Input, actions: { resume: () => void; tier: (t: string) => void; tiers: string[]; current: () => string; sensitivity: (v: number) => void; comfort: Record<string, boolean>; onComfort: () => void }) {
    this.root = el('div', 'pause', parent); this.root.hidden = true;
    const keys = CHEAT.map(([n, a]) => `<tr><td>${n}</td><td>${a.map((x) => input.bindings[x].map((c) => `<kbd>${glyph(c)}</kbd>`).join(' ')).join(' / ')}</td></tr>`).join('');
    this.root.innerHTML = `<div class="panel"><h1>Harbourline</h1><p class="sub">Paused</p>
      <button id="hl-resume">Resume</button> <button id="hl-credits">Credits</button>
      <label>Graphics quality <select id="hl-tier">${actions.tiers.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Mouse sensitivity <input id="hl-sens" type="range" min="0.2" max="3" step="0.05" value="1"></label>
      <fieldset><legend>Comfort</legend>${Object.keys(actions.comfort).map((k) => `<label class="ck"><input type="checkbox" data-k="${k}" ${actions.comfort[k] ? 'checked' : ''}> ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}</label>`).join('')}</fieldset>
      <table class="keys">${keys}</table></div><div class="panel credits" hidden><h1>Credits</h1><p class="sub">Harbourline is built from free and openly licensed work. Thank you.</p><ul>${creditsHTML()}</ul><button id="hl-credits-back">Back</button></div>`;
    this.root.querySelector('#hl-resume')!.addEventListener('click', actions.resume);
    const [main, cred] = this.root.querySelectorAll<HTMLElement>('.panel'); this.root.querySelector('#hl-credits')!.addEventListener('click', () => { main.hidden = true; cred.hidden = false; });
    this.root.querySelector('#hl-credits-back')!.addEventListener('click', () => { main.hidden = false; cred.hidden = true; });
    const tier = this.root.querySelector('#hl-tier') as HTMLSelectElement; tier.value = actions.current(); tier.addEventListener('change', () => actions.tier(tier.value));
    this.root.querySelector('#hl-sens')!.addEventListener('input', (e) => actions.sensitivity(+(e.target as HTMLInputElement).value));
    this.root.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((c) => c.addEventListener('change', () => { actions.comfort[c.dataset.k!] = c.checked; actions.onComfort(); }));
  }
  show(on: boolean) { this.open = on; this.root.hidden = !on; }
}
