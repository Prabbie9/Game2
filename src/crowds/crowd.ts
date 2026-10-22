// Mid/far crowd: instanced VAT pedestrians (src/crowds/vat.ts) walking loops around the sidewalks of blocks near the
// camera, beyond the nearest skinned pedestrians. Agents are cheap JS records (position along a block perimeter,
// direction, speed); each frame writes instance matrices; the vertex shader animates the gait. Density per tier.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import { Character, loadCast } from '../character/character';
import { bakeVAT, mergeVatParts, vatMaterial, type VatBody } from './vat';
import { blockRect, BLOCK, KERB, GRID } from '../world/citygen';

const CLOTH = [0xffffff, 0xffffff, 0xd2dae8, 0xb8c4d6, 0xe6d6bc, 0xc8d8c0, 0xecc8c0, 0xc4c4cc, 0xdcc8a4, 0xa8b4c8, 0xd8b0b0]; // multipliers over the albedo: tints, never near-black
interface Agent { body: number; bi: number; bj: number; s: number; dir: number; speed: number; fear?: number; lane: number; phase: number; tint: THREE.Color }
export class Crowd {
  bodies: VatBody[] = []; meshes: THREE.InstancedMesh[][] = []; agents: Agent[] = []; time = { value: 0 }; ready = false; minDist = 26; maxDist = 230;
  constructor(public R: Renderer, public count: number, public ids: string[]) {}
  async load() {
    const cast = await loadCast();
    for (const id of this.ids) { const ch = await new Character(this.R, id, { lod: 1, shadows: false }).load(); const female = cast[id]?.sex === 'f';
      const clip = await ch.clip('core', female ? 'female_walk_forward' : 'male_walk_forward_03'); if (!clip) continue; const meta = (clip as any).meta; const scale = ch.rig.hipsHeight / 0.99;
      const baked = bakeVAT(ch, clip); const parts = this.R.tier.name === 'Lite' || this.R.tier.name === 'Low' ? [mergeVatParts(baked)] : baked; /* Lite/Low: one draw per body */ this.bodies.push({ id, parts, speed: meta.speed * scale, stride: meta.speed * scale * clip.duration, height: ch.height }); }
    const per = Math.ceil(this.count / Math.max(1, this.bodies.length));
    this.meshes = this.bodies.map((b) => b.parts.map((p) => { const { mat, depth } = vatMaterial(this.R, p, this.time); const im = new THREE.InstancedMesh(p.geo, mat, per);
      im.geometry = p.geo.clone(); im.geometry.setAttribute('aVat', new THREE.InstancedBufferAttribute(new Float32Array(per * 2), 2)); im.customDepthMaterial = depth;
      im.castShadow = this.R.tier.name !== 'Low' && this.R.tier.name !== 'Lite'; im.receiveShadow = true; im.frustumCulled = false; im.count = 0; for (let i = 0; i < per; i++) im.setColorAt(i, new THREE.Color(1, 1, 1)); this.R.scene.add(im); return im; }));
    this.ready = true; return this;
  }
  private spawn(cx: number, cz: number, r: () => number): Agent {
    const ang = r() * Math.PI * 2, d = this.minDist + 10 + r() * (this.maxDist - this.minDist - 20); const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
    const bi = THREE.MathUtils.clamp(Math.floor(x / BLOCK), -GRID, GRID - 1), bj = THREE.MathUtils.clamp(Math.floor(z / BLOCK), -GRID, GRID - 1); const body = Math.floor(r() * this.bodies.length);
    return { body, bi, bj, s: r(), dir: r() < 0.5 ? 1 : -1, speed: this.bodies[body].speed * (0.9 + r() * 0.1), lane: 1.2 + r() * 2.6, phase: r(), tint: new THREE.Color(CLOTH[Math.floor(r() * CLOTH.length)]) };
  }
  /** Perimeter walk around a block's sidewalk: s in [0,1) -> world position + heading. */
  private place(a: Agent) { const rc = blockRect(a.bi, a.bj); const x0 = rc.x0 + a.lane, x1 = rc.x1 - a.lane, z0 = rc.z0 + a.lane, z1 = rc.z1 - a.lane; const w = x1 - x0, h = z1 - z0, P = 2 * (w + h);
    let d = (((a.s % 1) + 1) % 1) * P; let x: number, z: number, yaw: number;
    if (d < w) { x = x0 + d; z = z0; yaw = Math.PI / 2; } else if ((d -= w) < h) { x = x1; z = z0 + d; yaw = 0; } else if ((d -= h) < w) { x = x1 - d; z = z1; yaw = -Math.PI / 2; } else { d -= w; x = x0; z = z1 - d; yaw = Math.PI; }
    return { x, z, yaw: a.dir > 0 ? yaw : yaw + Math.PI, P }; }
  /** Gunfire / explosion: walkers within r turn away from p and hurry (VAT gait rate follows the speed) for a few seconds. */
  scare(p: THREE.Vector3, r = 40) { for (const a of this.agents) { const pl = this.place(a); const d = Math.hypot(pl.x - p.x, pl.z - p.z); if (d > r) continue;
      const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw); if (fx * (pl.x - p.x) + fz * (pl.z - p.z) < 0) a.dir = -a.dir; a.fear = 6 + Math.random() * 4; } }
  /** Population scale (dynamic quality scaler): trims or regrows the walkers. */
  base = -1; setPopulation(k: number) { if (this.base < 0) this.base = this.count; this.count = Math.max(1, Math.round(this.base * k)); if (this.agents.length > this.count) this.agents.length = this.count; }
  update(dt: number, cam: THREE.Vector3) {
    if (!this.ready) return; this.time.value += dt; let seed = (this.agents.length * 7919 + Math.floor(this.time.value * 13)) % 2147483647 || 1; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (this.agents.length < this.count) this.agents.push(this.spawn(cam.x, cam.z, r));
    const counts = this.meshes.map(() => 0); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < this.agents.length; i++) { const a = this.agents[i]; let pl = this.place(a); const run = a.fear && a.fear > 0 ? 2.6 : 1; if (a.fear) a.fear -= dt; a.s += (a.dir * a.speed * run * dt) / pl.P; pl = this.place(a);
      const dist = Math.hypot(pl.x - cam.x, pl.z - cam.z); if (dist > this.maxDist + 20) { this.agents[i] = this.spawn(cam.x, cam.z, r); continue; }
      if (dist < this.minDist) continue; // the nearest pedestrians are full skinned characters
      const b = this.bodies[a.body]; const k = counts[a.body]++; if (k >= this.meshes[a.body][0].instanceMatrix.count) continue;
      m.compose(p.set(pl.x, KERB, pl.z), q.setFromAxisAngle(Y, pl.yaw), one);
      for (const [pi, im] of this.meshes[a.body].entries()) { im.setMatrixAt(k, m); const at = im.geometry.getAttribute('aVat') as THREE.InstancedBufferAttribute; at.setXY(k, a.phase, (a.speed * (a.fear && a.fear > 0 ? 2.6 : 1)) / b.stride);
        if ((b.parts[pi].role === 'cloth' || b.parts[pi].role === 'merged') && !(window as any).HL_NOTINT) im.setColorAt(k, a.tint); } }
    this.meshes.forEach((parts, bi) => parts.forEach((im) => { im.count = Math.min(counts[bi], im.instanceMatrix.count); /* bodies are picked at random, so one can get more walkers than its buffer holds: never draw past it (garbage matrices made screen-filling triangles) */ im.instanceMatrix.needsUpdate = true; (im.geometry.getAttribute('aVat') as THREE.InstancedBufferAttribute).needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }));
  }
}
