// Action-based input. Game code reads ACTIONS only (never keys). Bindings map physical inputs to actions;
// analog axes return -1..1. Look input goes through one interface (lookDelta) with an empty aim-assist hook.
// Extension points for controllers: add a Source that writes into `analog`/`digital` (see INPUT.md).
export type Action =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'sprint' | 'jump' | 'crouch' | 'fire' | 'aim' | 'aimToggle' | 'reload'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'weapon5' | 'weaponPrev' | 'weaponNext' | 'throwable' | 'melee' | 'interact'
  | 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake' | 'boost' | 'camera' | 'horn'
  | 'map' | 'spawnMenu' | 'timeWeather' | 'frameOverlay' | 'pause' | 'photoMode' | 'tuning' | 'lookBehind';

/** Default bindings: KeyboardEvent.code values and mouse buttons (Mouse0 = left, Mouse2 = right). No Ctrl/Alt/Meta/F-keys. */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], crouch: ['KeyC'], fire: ['Mouse0', 'KeyF'], aim: ['Mouse2'], aimToggle: ['KeyX'], reload: ['KeyR'],
  weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'], weapon5: ['Digit5'], weaponPrev: ['BracketLeft'], weaponNext: ['BracketRight'],
  throwable: ['KeyG'], melee: ['KeyV'], interact: ['KeyE'],
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], steerLeft: ['KeyA', 'ArrowLeft'], steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], camera: ['KeyV'], horn: ['KeyH'], lookBehind: ['KeyQ'],
  map: ['KeyM'], spawnMenu: ['KeyB'], timeWeather: ['KeyT'], frameOverlay: ['KeyL'], pause: ['Escape'], photoMode: ['KeyP'], tuning: ['KeyK'],
};
/** Gamepad (standard mapping) codes merged into the defaults: Pad<n> buttons, PadLX-/+, PadLY-/+ stick halves, PadLT/PadRT triggers. */
const PAD: Partial<Record<Action, string[]>> = { moveForward: ['PadLY-'], moveBack: ['PadLY+'], moveLeft: ['PadLX-'], moveRight: ['PadLX+'], sprint: ['Pad10'], jump: ['Pad0'], crouch: ['Pad11'],
  fire: ['PadRT'], aim: ['PadLT'], reload: ['Pad2'], weaponPrev: ['Pad14'], weaponNext: ['Pad15'], throwable: ['Pad13'], melee: ['Pad1'], interact: ['Pad3'],
  throttle: ['PadRT'], brake: ['PadLT'], steerLeft: ['PadLX-'], steerRight: ['PadLX+'], handbrake: ['Pad5'], boost: ['Pad0'], camera: ['Pad8'], horn: ['Pad11'], lookBehind: ['Pad4'],
  spawnMenu: ['Pad12'], pause: ['Pad9'] };
for (const [a, codes] of Object.entries(PAD)) DEFAULT_BINDINGS[a as Action].push(...codes!);
/** Prompt glyphs for UI hints (lookup table; controller glyphs plug in here). */
export const GLYPHS: Record<string, string> = { Mouse0: 'LMB', Mouse2: 'RMB', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Esc', BracketLeft: '[', BracketRight: ']', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
Object.assign(GLYPHS, { Pad0: 'A', Pad1: 'B', Pad2: 'X', Pad3: 'Y', Pad4: 'LB', Pad5: 'RB', Pad8: 'View', Pad9: 'Menu', Pad10: 'L3', Pad11: 'R3', Pad12: 'D↑', Pad13: 'D↓', Pad14: 'D←', Pad15: 'D→', PadLT: 'LT', PadRT: 'RT', 'PadLX-': 'LS←', 'PadLX+': 'LS→', 'PadLY-': 'LS↑', 'PadLY+': 'LS↓' });
export const glyph = (code: string) => GLYPHS[code] ?? code.replace(/^Key|^Digit/, '');

const STORE = 'harbourline.bindings.v1';
export class Input {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  down = new Set<string>(); pressedEdge = new Set<string>();
  mouse = { dx: 0, dy: 0 }; sensitivity = 1; invertY = false; holdAim = true; holdCrouch = true; holdSprint = true;
  aimAssist: ((dx: number, dy: number) => [number, number]) | null = null; // intentionally empty hook
  enabled = true; private listeners: ((code: string) => void)[] = [];
  constructor(public el: HTMLElement) {
    try { const s = localStorage.getItem(STORE); if (s) { const saved = JSON.parse(s); for (const k of Object.keys(saved) as Action[]) this.bindings[k] = [...new Set([...saved[k], ...DEFAULT_BINDINGS[k].filter((c) => c.startsWith('Pad'))])]; } } catch { /* storage unavailable */ }
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never treat browser shortcuts as gameplay
      if (!e.repeat) { this.pressedEdge.add(e.code); this.listeners.forEach((l) => l(e.code)); }
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code) && document.activeElement === document.body) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    el.addEventListener('mousedown', (e) => { const c = 'Mouse' + e.button; this.down.add(c); this.pressedEdge.add(c); this.listeners.forEach((l) => l(c)); });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
  }
  analog = new Map<string, number>(); private padDown = new Set<string>(); pad: { id: string; connected: boolean } = { id: '', connected: false }; private look = [0, 0];
  /** Poll the first connected gamepad (call once per frame): buttons -> digital codes with edges, sticks/triggers -> analog codes. */
  poll() { const gp = (navigator.getGamepads?.() ?? []).find((g) => g && g.connected) ?? null; this.pad.connected = !!gp; if (!gp) { for (const c of this.padDown) this.down.delete(c); this.padDown.clear(); this.analog.clear(); return; }
    this.pad.id = gp.id; const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82); const now = new Set<string>();
    gp.buttons.forEach((b, i) => { if (b.pressed) now.add('Pad' + i); }); const [lx, ly, rx, ry] = [0, 1, 2, 3].map((i) => dz(gp.axes[i] ?? 0));
    const set = (k: string, v: number) => { this.analog.set(k, v); if (v > 0.5) now.add(k); }; set('PadLX-', Math.max(0, -lx)); set('PadLX+', Math.max(0, lx)); set('PadLY-', Math.max(0, -ly)); set('PadLY+', Math.max(0, ly));
    set('PadLT', gp.buttons[6]?.value ?? 0); set('PadRT', gp.buttons[7]?.value ?? 0); this.look = [rx, ry];
    for (const c of now) if (!this.padDown.has(c)) { this.pressedEdge.add(c); this.listeners.forEach((l) => l(c)); } for (const c of this.padDown) if (!now.has(c)) this.down.delete(c); for (const c of now) this.down.add(c); this.padDown = now; }
  /** Digital action held. */
  held(a: Action) { return this.enabled && this.bindings[a].some((c) => this.down.has(c)); }
  /** Digital action pressed this frame (edge). */
  pressed(a: Action) { return this.enabled && this.bindings[a].some((c) => this.pressedEdge.has(c)); }
  /** Analog value 0..1 for a single action (keyboard gives 0/1; controllers can give fractions). */
  value(a: Action) { if (!this.enabled) return 0; let v = 0; for (const c of this.bindings[a]) v = Math.max(v, this.down.has(c) && !c.startsWith('Pad') ? 1 : this.analog.get(c) ?? (this.down.has(c) ? 1 : 0)); return v; }
  /** Analog axis -1..1 from a negative/positive action pair. */
  axis(neg: Action, pos: Action) { return this.value(pos) - this.value(neg); }
  /** The single look interface: returns radians-ish deltas scaled by sensitivity, acceleration off. */
  lookDelta(): [number, number] {
    let dx = this.mouse.dx * 0.0022 * this.sensitivity, dy = this.mouse.dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0; dx += this.look[0] * 0.045 * this.sensitivity; dy += this.look[1] * 0.035 * this.sensitivity * (this.invertY ? -1 : 1);
    if (this.aimAssist) [dx, dy] = this.aimAssist(dx, dy);
    return [dx, dy];
  }
  endFrame() { this.pressedEdge.clear(); }
  rebind(a: Action, slot: number, code: string) { this.bindings[a][slot] = code; this.save(); }
  resetBindings() { this.bindings = structuredClone(DEFAULT_BINDINGS); this.save(); }
  onAnyPress(f: (code: string) => void) { this.listeners.push(f); return () => { this.listeners = this.listeners.filter((x) => x !== f); }; }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.bindings)); } catch { /* ignore */ } }
}
