// On-foot character physics (worker side): kinematic capsule driven by Rapier's KinematicCharacterController
// (autostep for kerbs and stairs, snap-to-ground, slope limit, sliding along walls), gravity and jumps, crouch capsule,
// per-foot ground rays for foot IK and a forward obstacle probe (vault / climb heights). Position = feet.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
type R = typeof RAPIER_NS;

export interface CharInput { vx: number; vz: number; jump: number; crouch: number; feet: number[]; yaw: number; mode: number; target?: number[] }
/** pos(3) vel(3) grounded crouch footY(2) footN(2x3) obstacleDist obstacleTop obstacleDepth groundY */
export const CHAR_STRIDE = 3 + 3 + 1 + 1 + 2 + 6 + 3 + 1;
export const CHAR_MODE = { walk: 0, scripted: 1, disabled: 2 } as const;
const RADIUS = 0.28, HALF_STAND = 0.58, HALF_CROUCH = 0.28, SKIN = 0.02; // SKIN = controller offset (gap kept to the ground)

export class CharacterSim {
  body: RAPIER_NS.RigidBody; col: RAPIER_NS.Collider; ctrl: RAPIER_NS.KinematicCharacterController;
  input: CharInput = { vx: 0, vz: 0, jump: 0, crouch: 0, feet: [], yaw: 0, mode: 0 };
  vy = 0; grounded = false; crouched = false; vel = [0, 0, 0]; feet = [0, 0, 0, 1, 0, 0, 1, 0]; obstacle = [9, 0, 0]; groundY = 0;
  private jumpLatch = 0;
  constructor(public RAPIER: R, public world: RAPIER_NS.World, public id: number, pos: number[]) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1] + HALF_STAND + RADIUS, pos[2]));
    this.col = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_STAND, RADIUS).setFriction(0), this.body);
    const c = (this.ctrl = world.createCharacterController(0.02));
    c.setUp({ x: 0, y: 1, z: 0 }); c.setMaxSlopeClimbAngle((50 * Math.PI) / 180); c.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    c.enableAutostep(0.36, 0.18, false); c.enableSnapToGround(0.32); c.setApplyImpulsesToDynamicBodies(true); c.setCharacterMass(80); c.setSlideEnabled(true);
  }
  get half() { return this.crouched ? HALF_CROUCH : HALF_STAND; }
  feetPos() { const t = this.body.translation(); return [t.x, t.y - this.half - RADIUS - SKIN, t.z]; }
  private ray(o: number[], d: number[], len: number) {
    const hit = this.world.castRayAndGetNormal(new this.RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] }), len, true, undefined, undefined, this.col, this.body);
    return hit ? { toi: hit.timeOfImpact, n: [hit.normal.x, hit.normal.y, hit.normal.z] } : null;
  }
  setCrouch(on: boolean) {
    if (on === this.crouched) return; const f = this.feetPos();
    if (!on) { const up = this.ray([f[0], f[1] + 0.3, f[2]], [0, 1, 0], 1.5); if (up && up.toi < 1.35) return; } // no room to stand
    this.crouched = on; this.col.setHalfHeight(this.half); this.body.setTranslation({ x: f[0], y: f[1] + this.half + RADIUS, z: f[2] }, true);
  }
  teleport(p: number[]) { const y = p[1] + this.half + RADIUS + SKIN; this.body.setTranslation({ x: p[0], y, z: p[2] }, true); this.body.setNextKinematicTranslation({ x: p[0], y, z: p[2] }); this.vy = 0; }
  step(dt: number, g: number) {
    const inp = this.input; const t = this.body.translation(); const off = this.half + RADIUS + SKIN;
    this.col.setEnabled(inp.mode === CHAR_MODE.walk); // scripted moves (vault, seat) pass through: no shoving cars or props
    if (inp.mode !== CHAR_MODE.walk) { // scripted (vault, seat, get-up) or disabled (in a vehicle): follow the target, no collision response
      const p = inp.target ?? [t.x, t.y - off, t.z]; this.vel = [(p[0] - t.x) / dt, (p[1] + off - t.y) / dt, (p[2] - t.z) / dt];
      this.body.setNextKinematicTranslation({ x: p[0], y: p[1] + off, z: p[2] }); this.vy = 0; this.grounded = inp.mode === CHAR_MODE.scripted ? this.grounded : false;
    } else {
      this.setCrouch(inp.crouch > 0.5);
      if (inp.jump > 0.5 && !this.jumpLatch && this.grounded && !this.crouched) { this.vy = 4.3; this.grounded = false; } this.jumpLatch = inp.jump > 0.5 ? 1 : 0;
      this.vy = this.grounded && this.vy <= 0 ? -1.5 : this.vy + g * dt; // small down push keeps snap-to-ground engaged on slopes
      this.ctrl.computeColliderMovement(this.col, { x: inp.vx * dt, y: this.vy * dt, z: inp.vz * dt }, this.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      const m = this.ctrl.computedMovement(); const wasAir = !this.grounded; this.grounded = this.ctrl.computedGrounded();
      if (this.grounded && this.vy < 0) this.vy = 0; if (!this.grounded && m.y > this.vy * dt + 1e-4 && this.vy > 0) this.vy = 0; // bonk
      void wasAir; this.vel = [m.x / dt, this.grounded ? 0 : this.vy, m.z / dt];
      this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    }
    // sensing (from this step's start position; one step of latency is invisible at 60Hz)
    const fy = t.y - off; const gr = this.ray([t.x, fy + 0.5, t.z], [0, -1, 0], 3); this.groundY = gr ? fy + 0.5 - gr.toi : fy - 9;
    if (inp.feet.length === 4) for (let i = 0; i < 2; i++) { const h = this.ray([inp.feet[i * 2], fy + 0.65, inp.feet[i * 2 + 1]], [0, -1, 0], 1.6);
      this.feet[i] = h ? fy + 0.65 - h.toi : fy - 1; const n = h ? h.n : [0, 1, 0]; this.feet[2 + i * 3] = n[0]; this.feet[3 + i * 3] = n[1]; this.feet[4 + i * 3] = n[2]; }
    const dx = Math.sin(inp.yaw), dz = Math.cos(inp.yaw); let near = 9;
    for (const hgt of [0.35, 0.75, 1.15, 1.6]) { const h = this.ray([t.x, fy + hgt, t.z], [dx, 0, dz], 1.4); if (h) near = Math.min(near, h.toi); }
    if (near < 1.4) { const px = t.x + dx * (near + 0.3), pz = t.z + dz * (near + 0.3); const top = this.ray([px, fy + 2.6, pz], [0, -1, 0], 3);
      const topH = top ? 2.6 - top.toi : 0; const far = this.ray([t.x + dx * (near + 1.4), fy + topH + 0.1, t.z + dz * (near + 1.4)], [-dx, 0, -dz], 1.1); // thickness from the back
      this.obstacle = [near, topH, far ? 1.1 - far.toi + 0.3 : 1.5]; } else this.obstacle = [9, 0, 0];
  }
  pack(buf: Float32Array, o: number) { const f = this.feetPos(); buf.set([f[0], f[1], f[2], ...this.vel, this.grounded ? 1 : 0, this.crouched ? 1 : 0, ...this.feet, ...this.obstacle, this.groundY], o); }
  dispose() { this.world.removeCharacterController(this.ctrl); this.world.removeRigidBody(this.body); }
}
