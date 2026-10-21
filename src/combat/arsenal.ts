// Player arsenal: every weapon available (sandbox), slot keys 1-5 / [ ] cycling (incl. melee and unarmed), aim (hold RMB
// or toggle X) with an over-the-shoulder zoom, semi/auto fire from the hand-held muzzle toward the crosshair point,
// bloom, recoil (weapon spring + camera kick), shells, reload (R or empty mag) with the procedural magazine swap,
// melee swings and thrown grenades/molotovs. Crosshair, hit marker and ammo readout are drawn here.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { Player } from '../character/player';
import type { Input } from '../input/input';
import type { FollowCamera } from '../camera/follow';
import { WeaponRig } from '../weapons/rig';
import { weaponModel } from '../weapons/models';
import { Combat, WDATA, type WeaponId } from './combat';

const ORDER: (WeaponId | null)[] = [null, 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rpg', 'bat', 'knife', 'crowbar'];
export class Arsenal {
  rig: WeaponRig; cur: WeaponId | null = null; ammo = new Map<WeaponId, { mag: number; reserve: number }>(); cool = 0; aiming = false; aimToggle = false; bloom = 0; reloadEnd = 0; t = 0;
  ui: HTMLDivElement; cross: HTMLDivElement; marker: HTMLDivElement; info: HTMLDivElement; hitT = 0; lastFire = { hits: 0, shots: 0 }; aimPoint = new THREE.Vector3();
  constructor(public R: Renderer, public player: Player, public combat: Combat, public input: Input, public follow: FollowCamera, host: HTMLElement) {
    this.rig = new WeaponRig(R, player.ch);
    for (const id of Object.keys(WDATA) as WeaponId[]) { const w = WDATA[id]; this.ammo.set(id, { mag: w.mag ?? 1, reserve: (w.mag ?? 1) * 6 }); }
    this.ui = document.createElement('div'); this.ui.className = 'hl-arsenal';
    this.ui.innerHTML = '<div class="hl-cross"><i></i><i></i><i></i><i></i></div><div class="hl-hitmark">✕</div><div class="hl-ammo"></div>'; host.append(this.ui);
    this.cross = this.ui.querySelector('.hl-cross')!; this.marker = this.ui.querySelector('.hl-hitmark')!; this.info = this.ui.querySelector('.hl-ammo')!;
    player.afterAnim = (dt) => this.rig.update(dt, this.aimDirFromMuzzle(), this.aiming, player.speed);
  }
  async equip(id: WeaponId | null) { if (id === this.cur) return; this.cur = id; this.rig.reloadT = -1; const w = id ? WDATA[id] : null;
    if (w?.stance) await this.player.an.addStance(w.stance); this.player.an.stance = w?.stance ?? null; await this.rig.equip(id); }
  get data() { return this.cur ? WDATA[this.cur] : null; }
  private aimDirFromMuzzle() { if (!this.rig.model || !this.rig.meta) return new THREE.Vector3(0, 0, 1); const g = this.rig.socketWorld('grip'); return this.aimPoint.clone().sub(g).normalize(); }
  /** Per frame while on foot. */
  update(dt: number, cam: THREE.PerspectiveCamera, enabled: boolean) {
    const inp = this.input; const p = this.player; this.t += dt; this.cool -= dt; this.hitT -= dt; this.bloom = Math.max(0, this.bloom - dt * 6);
    if (!enabled) { this.aiming = false; p.aimYaw = null; this.rig.holstered = true; this.ui.hidden = true; this.follow.aim = 0; return; }
    this.rig.holstered = false; this.ui.hidden = false;
    for (let s = 1; s <= 5; s++) if (inp.pressed(('weapon' + s) as any)) { const ids = ORDER.filter((id) => id && WDATA[id].slot === s) as WeaponId[]; const i = ids.indexOf(this.cur as WeaponId); this.equip(ids[(i + 1) % ids.length]); }
    if (inp.pressed('weaponNext') || inp.pressed('weaponPrev')) { const i = ORDER.indexOf(this.cur); this.equip(ORDER[(i + (inp.pressed('weaponNext') ? 1 : ORDER.length - 1)) % ORDER.length]); }
    const w = this.data; const gun = !!w && !w.melee && !w.throw;
    if (inp.pressed('aimToggle')) this.aimToggle = !this.aimToggle;
    this.aiming = gun && (inp.held('aim') || this.aimToggle) && p.onFoot;
    // aim point: what the crosshair (screen centre) covers
    const ray = this.follow.aimRay(); const eye = ray.o; const fwd = ray.d; void cam; const hit = this.combat.trace(eye, fwd, 400, 'player'); this.aimPoint.copy(eye).addScaledVector(fwd, hit ? Math.max(2, hit.t) : 400);
    p.aimYaw = gun && (this.aiming || this.t - this.lastShotT < 1.2) ? Math.atan2(fwd.x, fwd.z) : null;
    this.follow.aim += ((this.aiming ? 1 : 0) - this.follow.aim) * Math.min(1, dt * 10); this.follow.aimFov = w?.aimFov ?? 46;
    // reload
    const am = this.cur ? this.ammo.get(this.cur)! : null;
    if (gun && am && this.rig.reloadT < 0 && am.mag < (w!.mag ?? 1) && (inp.pressed('reload') || am.mag === 0) && am.reserve > 0) { this.rig.startReload(w!.reload ?? 2); this.reloadEnd = this.t + (w!.reload ?? 2); }
    if (gun && am && this.reloadEnd && this.t >= this.reloadEnd) { const need = (w!.mag ?? 1) - am.mag; const take = Math.min(need, am.reserve); am.mag += take; am.reserve -= take; this.reloadEnd = 0; }
    // fire
    const trig = w ? (w.auto ? inp.held('fire') : inp.pressed('fire')) : false;
    if (gun && trig && this.cool <= 0 && this.rig.reloadT < 0 && am!.mag > 0 && p.onFoot && this.rig.model) { this.cool = 60 / w!.rpm; am!.mag--; this.lastShotT = this.t;
      const muzzle = this.rig.socketWorld('muzzle'); const dir = this.aimPoint.clone().sub(eye).normalize();
      const hits = this.combat.fire('player', w!, muzzle, eye, dir, this.aiming, this.bloom); if (hits.some((h) => h.target)) this.hitT = 0.18;
      this.rig.fireKick(w!.recoil![0]); this.follow.kick(THREE.MathUtils.degToRad(w!.recoil![0] * 0.35), THREE.MathUtils.degToRad((Math.random() - 0.5) * w!.recoil![1] * 0.6)); this.bloom = Math.min(6, this.bloom + w!.recoil![0] * 0.35);
      if (!w!.projectile && this.cur !== 'shotgun') this.combat.fx.shell(this.rig.socketWorld('eject'), new THREE.Vector3(-Math.cos(p.yaw), 0, Math.sin(p.yaw)).negate()); }
    // melee (bat / knife / crowbar, or fists when unarmed): V or fire
    if (((w?.melee && inp.pressed('fire')) || inp.pressed('melee')) && this.cool <= 0 && p.onFoot) { const mw = w?.melee ? w : { damage: 18, range: 1.2, arc: 60, impulse: 2, rpm: 90 } as any; this.cool = 60 / mw.rpm;
      p.an.play(this.cur === 'bat' || this.cur === 'crowbar' ? 'react' : 'melee', this.cur === 'bat' || this.cur === 'crowbar' ? 'overhead_bashing_swing' : this.cur === 'knife' ? 'male_knife_stab_with_the_rear_hand_and_reverse_grip' : 'hook_punch_with_the_rear_hand', { fadeIn: 0.08, fadeOut: 0.2, timeScale: 1.4 }).catch(() => {});
      setTimeout(() => { const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)); if (this.combat.melee('player', mw, p.position, f).length) this.hitT = 0.18; }, 280); }
    // throwables
    if (inp.pressed('throwable') && this.cool <= 0 && p.onFoot) { this.cool = 1.0; const id: WeaponId = this.throwId; p.an.play('melee', 'throwing_a_grenade_while_walking', { fadeIn: 0.1, fadeOut: 0.25, timeScale: 1.6, from: 0.6 }).catch(() => {});
      setTimeout(async () => { const hand = p.ch.bone('RightHand')!.getWorldPosition(new THREE.Vector3()); const d = this.aimPoint.clone().sub(hand).normalize(); d.y = Math.max(d.y, 0.15); const mesh = await weaponModel(this.R, id); this.R.scene.add(mesh); this.combat.throwItem('player', id, hand, d.normalize(), mesh); }, 380); }
    // HUD
    const spreadPx = 6 + (w?.spread ? (this.aiming ? w.spread[1] : w.spread[0]) + this.bloom : 2) * 6; this.cross.style.setProperty('--s', spreadPx + 'px'); this.cross.hidden = !gun;
    this.marker.style.opacity = this.hitT > 0 ? '1' : '0';
    this.info.textContent = this.cur ? `${(w as any) && this.cur.toUpperCase()}  ${gun ? `${am!.mag} / ${am!.reserve}` : ''}${this.rig.reloadT >= 0 ? '  reloading' : ''}` : 'UNARMED';
  }
  lastShotT = -9; throwId: WeaponId = 'grenade';
}
