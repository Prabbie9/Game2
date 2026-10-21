// Physics simulation core (Rapier). Runs inside the physics worker (src/sim/worker.ts) and in Node for bot tests.
// Fixed 60Hz step. Static world geometry arrives as plain descriptors so the same data builds visuals and colliders.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { VehicleSim, type VehicleInput, type Tuning } from './vehicle';
import { CharacterSim, CHAR_STRIDE, type CharInput } from './charsim';
import { RagdollSim, type SegDesc } from './ragdoll';
type R = typeof RAPIER_NS;

export type StaticDesc =
  | { kind: 'box'; half: [number, number, number]; pos: [number, number, number]; rot?: [number, number, number, number]; friction?: number }
  | { kind: 'trimesh'; vertices: Float32Array; indices: Uint32Array; friction?: number }
  | { kind: 'heightfield'; nrows: number; ncols: number; heights: Float32Array; scale: [number, number, number]; pos: [number, number, number]; friction?: number };
export type DynamicDesc = { kind: 'box' | 'cylinder' | 'ball'; half: [number, number, number]; pos: [number, number, number]; rot?: [number, number, number, number]; mass: number; friction?: number; restitution?: number };

export const STEP = 1 / 60;
/** Floats per vehicle in a snapshot: chassis pos(3) quat(4) + 4 wheels x (suspLen, steer, rot, contact, skid) + telemetry(8) */
export const VEH_STRIDE = 7 + 4 * 5 + 8;
export const DYN_STRIDE = 7;

export class SimCore {
  world: RAPIER_NS.World;
  vehicles = new Map<number, VehicleSim>();
  dynamics = new Map<number, RAPIER_NS.RigidBody>();
  chars = new Map<number, CharacterSim>();
  ragdolls = new Map<number, RagdollSim>();
  time = 0; steps = 0;
  constructor(public RAPIER: R, gravity = -9.81) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = STEP;
  }
  groups = new Map<string, RAPIER_NS.Collider[]>();
  /** Add a named group of static colliders (a streamed chunk); removeGroup drops them all. */
  addGroup(gid: string, list: StaticDesc[]) { this.removeGroup(gid); this.groups.set(gid, list.map((d) => this.addStatic(d))); }
  removeGroup(gid: string) { const g = this.groups.get(gid); if (g) { for (const c of g) this.world.removeCollider(c, false); this.groups.delete(gid); } }
  addStatic(d: StaticDesc) {
    const R = this.RAPIER; let cd: RAPIER_NS.ColliderDesc;
    if (d.kind === 'box') { cd = R.ColliderDesc.cuboid(...d.half).setTranslation(...d.pos); if (d.rot) cd.setRotation({ x: d.rot[0], y: d.rot[1], z: d.rot[2], w: d.rot[3] }); }
    else if (d.kind === 'trimesh') cd = R.ColliderDesc.trimesh(d.vertices, d.indices);
    else cd = R.ColliderDesc.heightfield(d.nrows, d.ncols, d.heights, { x: d.scale[0], y: d.scale[1], z: d.scale[2] }).setTranslation(...d.pos);
    cd.setFriction(d.friction ?? 0.9);
    return this.world.createCollider(cd);
  }
  addDynamic(id: number, d: DynamicDesc) {
    const R = this.RAPIER;
    const rb = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...d.pos).setRotation(d.rot ? { x: d.rot[0], y: d.rot[1], z: d.rot[2], w: d.rot[3] } : { x: 0, y: 0, z: 0, w: 1 }).setCanSleep(true).setAngularDamping(0.6).setLinearDamping(0.05));
    const cd = d.kind === 'box' ? R.ColliderDesc.cuboid(...d.half) : d.kind === 'ball' ? R.ColliderDesc.ball(d.half[0]) : R.ColliderDesc.cylinder(d.half[1], d.half[0]);
    cd.setMass(d.mass).setFriction(d.friction ?? 0.7).setRestitution(d.restitution ?? 0.1);
    this.world.createCollider(cd, rb);
    this.dynamics.set(id, rb);
  }
  spawnVehicle(id: number, tuning: Tuning, pos: [number, number, number], yaw = 0) {
    this.vehicles.get(id)?.dispose();
    const v = new VehicleSim(this.RAPIER, this.world, id, tuning, pos, yaw);
    this.vehicles.set(id, v); return v;
  }
  spawnChar(id: number, pos: number[]) { this.chars.get(id)?.dispose(); const c = new CharacterSim(this.RAPIER, this.world, id, pos); this.chars.set(id, c); return c; }
  spawnRagdoll(id: number, segs: SegDesc[], vel: number[], spin: number[]) { this.ragdolls.get(id)?.dispose(); this.ragdolls.set(id, new RagdollSim(this.RAPIER, this.world, id, segs, vel, spin)); }
  removeRagdoll(id: number) { this.ragdolls.get(id)?.dispose(); this.ragdolls.delete(id); }
  removeChar(id: number) { this.chars.get(id)?.dispose(); this.chars.delete(id); }
  setCharInput(id: number, inp: Partial<CharInput>) { const c = this.chars.get(id); if (c) Object.assign(c.input, inp); }
  /** Radial impulse (explosions): dynamic props, vehicles and ragdoll segments within radius, falloff to the edge. */
  explode(c: number[], radius: number, strength: number) {
    const hit = (b: RAPIER_NS.RigidBody, massK: number) => { const p = b.translation(); const d = [p.x - c[0], p.y - c[1] + 0.5, p.z - c[2]]; const L = Math.hypot(d[0], d[1], d[2]); if (L > radius) return;
      const k = strength * (1 - L / radius) * massK / Math.max(0.5, L); b.applyImpulse({ x: d[0] * k, y: Math.abs(d[1]) * k + strength * (1 - L / radius) * massK * 0.6, z: d[2] * k }, true); };
    for (const b of this.dynamics.values()) hit(b, b.mass()); for (const v of this.vehicles.values()) hit(v.body, v.body.mass() * 0.5);
    for (const r of this.ragdolls.values()) for (const b of r.bodies) hit(b, b.mass());
  }
  removeVehicle(id: number) { this.vehicles.get(id)?.dispose(); this.vehicles.delete(id); }
  setInput(id: number, inp: Partial<VehicleInput>) { const v = this.vehicles.get(id); if (v) Object.assign(v.input, inp); }
  setTuning(id: number, t: Tuning) { const v = this.vehicles.get(id); if (v) { Object.assign(v.t, t); v.applyTuning(); } }
  step() {
    for (const v of this.vehicles.values()) v.step(STEP);
    if (this.chars.size) { this.world.propagateModifiedBodyPositionsToColliders(); this.world.updateSceneQueries(); } // controller queries must see colliders added since the last step
    for (const c of this.chars.values()) c.step(STEP, this.world.gravity.y);
    this.world.step();
    this.time += STEP; this.steps++;
  }
  /** Pack vehicle + dynamic body state into one Float32Array (transferable). */
  snapshot(): { buf: Float32Array; vehIds: number[]; dynIds: number[]; charIds: number[]; rag: [number, number][] } {
    const vehIds = [...this.vehicles.keys()], dynIds = [...this.dynamics.keys()], charIds = [...this.chars.keys()];
    const rag = [...this.ragdolls].map(([id, r]) => [id, r.stride] as [number, number]); const ragLen = rag.reduce((a, [, n]) => a + n, 0);
    const buf = new Float32Array(vehIds.length * VEH_STRIDE + dynIds.length * DYN_STRIDE + charIds.length * CHAR_STRIDE + ragLen);
    let o = 0;
    for (const id of vehIds) {
      const v = this.vehicles.get(id)!, p = v.body.translation(), q = v.body.rotation(), c = v.ctrl;
      buf.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], o); o += 7;
      for (let i = 0; i < 4; i++) { buf.set([c.wheelSuspensionLength(i) ?? v.t.suspRest, c.wheelSteering(i) ?? 0, c.wheelRotation(i) ?? 0, c.wheelIsInContact(i) ? 1 : 0, v.wheelSkid[i]], o); o += 5; }
      const T = v.telemetry; buf.set([T.speed, T.vf, T.slip, T.rpm, T.gear, T.contacts, T.boost, T.throttle], o); o += 8;
    }
    for (const id of dynIds) { const b = this.dynamics.get(id)!, p = b.translation(), q = b.rotation(); buf.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], o); o += 7; }
    for (const id of charIds) { this.chars.get(id)!.pack(buf, o); o += CHAR_STRIDE; }
    for (const [id, n] of rag) { this.ragdolls.get(id)!.pack(buf, o); o += n; }
    return { buf, vehIds, dynIds, charIds, rag };
  }
}
