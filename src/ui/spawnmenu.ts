// Sandbox spawn menu (B): vehicles by class, weapons, world controls (traffic density, wanted level, god mode,
// time of day, weather, teleports). Opening it pauses the game and releases the pointer. Pure DOM, no framework.
export interface SpawnActions {
  vehicles: { id: string; label: string }[]; weapons: string[]; places: { id: string; label: string }[];
  spawnVehicle: (cls: string) => void; giveWeapon: (id: string) => void; teleport: (id: string) => void;
  setTraffic: (n: number) => void; addStar: () => void; clearWanted: () => void; setGod: (on: boolean) => boolean; setNeverWanted: (on: boolean) => boolean;
  setTime: (h: number) => void; setWeather: (w: string) => void; weathers: string[]; onClose: () => void;
}
export class SpawnMenu {
  root: HTMLDivElement; open = false;
  constructor(parent: HTMLElement, a: SpawnActions) {
    const r = (this.root = document.createElement('div')); r.className = 'hl-spawn'; r.hidden = true; parent.append(r);
    const sec = (title: string) => { const s = document.createElement('section'); s.innerHTML = `<h3>${title}</h3>`; const g = document.createElement('div'); g.className = 'grid'; s.append(g); r.append(s); return g; };
    const btn = (g: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(b); g.append(b); return b; };
    const head = document.createElement('header'); head.innerHTML = '<b>Sandbox</b><span>B or Esc to close</span>'; r.append(head);
    const v = sec('Vehicles'); for (const c of a.vehicles) btn(v, c.label, () => { a.spawnVehicle(c.id); this.show(false); });
    const w = sec('Weapons'); for (const id of a.weapons) btn(w, id, () => { a.giveWeapon(id); this.show(false); });
    const p = sec('Teleport'); for (const pl of a.places) btn(p, pl.label, () => { a.teleport(pl.id); this.show(false); });
    const world = sec('World');
    for (const [n, l] of [[0, 'No traffic'], [8, 'Light traffic'], [16, 'Normal traffic'], [28, 'Heavy traffic']] as [number, string][]) btn(world, l, () => a.setTraffic(n));
    btn(world, '+1 wanted star', () => a.addStar()); btn(world, 'Clear wanted', () => a.clearWanted());
    btn(world, 'God mode: off', (b) => { b.textContent = 'God mode: ' + (a.setGod(!b.textContent!.endsWith('on')) ? 'on' : 'off'); });
    btn(world, 'Never wanted: off', (b) => { b.textContent = 'Never wanted: ' + (a.setNeverWanted(!b.textContent!.endsWith('on')) ? 'on' : 'off'); });
    const t = sec('Time & weather'); for (const h of [6, 9, 12.5, 17.5, 19.2, 22, 2]) btn(t, `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : '00'}`, () => a.setTime(h));
    for (const wn of a.weathers) btn(t, wn, () => a.setWeather(wn));
    this.onClose = a.onClose;
  }
  private onClose: () => void;
  show(on: boolean) { this.open = on; this.root.hidden = !on; if (!on) this.onClose(); }
  toggle() { this.show(!this.open); return this.open; }
}
