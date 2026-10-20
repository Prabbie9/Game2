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
/** Prompt glyphs for UI hints (lookup table; controller glyphs plug in here). */
export const GLYPHS: Record<string, string> = { Mouse0: 'LMB', Mouse2: 'RMB', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Esc', BracketLeft: '[', BracketRight: ']', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
export const glyph = (code: string) => GLYPHS[code] ?? code.replace(/^Key|^Digit/, '');

const STORE = 'harbourline.bindings.v1';
export class Input {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  down = new Set<string>(); pressedEdge = new Set<string>();
  mouse = { dx: 0, dy: 0 }; sensitivity = 1; invertY = false; holdAim = true; holdCrouch = true; holdSprint = true;
  aimAssist: ((dx: number, dy: number) => [number, number]) | null = null; // intentionally empty hook
  enabled = true; private listeners: ((code: string) => void)[] = [];
  constructor(public el: HTMLElement) {
    try { const s = localStorage.getItem(STORE); if (s) Object.assign(this.bindings, JSON.parse(s)); } catch { /* storage unavailable */ }
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
  /** Digital action held. */
  held(a: Action) { return this.enabled && this.bindings[a].some((c) => this.down.has(c)); }
  /** Digital action pressed this frame (edge). */
  pressed(a: Action) { return this.enabled && this.bindings[a].some((c) => this.pressedEdge.has(c)); }
  /** Analog value 0..1 for a single action (keyboard gives 0/1; controllers can give fractions). */
  value(a: Action) { return this.held(a) ? 1 : 0; }
  /** Analog axis -1..1 from a negative/positive action pair. */
  axis(neg: Action, pos: Action) { return this.value(pos) - this.value(neg); }
  /** The single look interface: returns radians-ish deltas scaled by sensitivity, acceleration off. */
  lookDelta(): [number, number] {
    let dx = this.mouse.dx * 0.0022 * this.sensitivity, dy = this.mouse.dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0;
    if (this.aimAssist) [dx, dy] = this.aimAssist(dx, dy);
    return [dx, dy];
  }
  endFrame() { this.pressedEdge.clear(); }
  rebind(a: Action, slot: number, code: string) { this.bindings[a][slot] = code; this.save(); }
  resetBindings() { this.bindings = structuredClone(DEFAULT_BINDINGS); this.save(); }
  onAnyPress(f: (code: string) => void) { this.listeners.push(f); return () => { this.listeners = this.listeners.filter((x) => x !== f); }; }
  save() { try { localStorage.setItem(STORE, JSON.stringify(this.bindings)); } catch { /* ignore */ } }
}
