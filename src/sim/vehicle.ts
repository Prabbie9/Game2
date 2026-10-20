// Wheeled vehicle simulation on Rapier's ray-cast vehicle controller, plus arcade assists:
// speed-sensitive steering, countersteer help, yaw stability, handbrake drift, anti-flip, air damping,
// downforce, power-limited drive, simple gearbox (for RPM/audio). Pure sim code: runs in the physics
// worker and in Node bot tests. Car local axes: +Z forward, +Y up, +X left.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
type R = typeof RAPIER_NS;

export interface VehicleInput { steer: number; throttle: number; brake: number; handbrake: number; boost: number }
export type Tuning = Record<string, any>;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Rotate vector v by quaternion q (x,y,z,w). */
export function qrot(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number): [number, number, number] {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
}

export class VehicleSim {
  body: RAPIER_NS.RigidBody;
  ctrl: RAPIER_NS.DynamicRayCastVehicleController;
  input: VehicleInput = { steer: 0, throttle: 0, brake: 0, handbrake: 0, boost: 0 };
  steerAngle = 0; drift = 0; gear = 1; rpm = 800; boostLeft = 0; upsideTime = 0; stuckTime = 0;
  telemetry = { speed: 0, vf: 0, slip: 0, drift: 0, rpm: 0, gear: 1, contacts: 0, yawRate: 0, boost: 1, throttle: 0 };
  wheelSkid = [0, 0, 0, 0];
  constructor(public RAPIER: R, public world: RAPIER_NS.World, public id: number, public t: Tuning, pos: [number, number, number], yaw = 0) {
    const [hx, hy, hz] = t.halfExtents;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setRotation(q).setCcdEnabled(true).setAngularDamping(0.15).setLinearDamping(0.0));
    const m = t.mass, ix = (m / 12) * (4 * hy * hy + 4 * hz * hz), iy = (m / 12) * (4 * hx * hx + 4 * hz * hz), iz = (m / 12) * (4 * hx * hx + 4 * hy * hy);
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMassProperties(m, { x: t.comOffset[0], y: t.comOffset[1], z: t.comOffset[2] }, { x: ix, y: iy * 1.1, z: iz }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(0.2).setRestitution(0.05).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), this.body);
    this.ctrl = world.createVehicleController(this.body);
    (this.ctrl as any).indexUpAxis = 1; (this.ctrl as any).setIndexForwardAxis = 2;
    const halfTrack = t.track / 2, halfWb = t.wheelbase / 2;
    const pts: [number, number][] = [[halfTrack, halfWb + t.frontOffset], [-halfTrack, halfWb + t.frontOffset], [halfTrack, -halfWb + t.frontOffset], [-halfTrack, -halfWb + t.frontOffset]];
    for (const [x, z] of pts) this.ctrl.addWheel({ x, y: t.wheelY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, t.suspRest, t.wheelRadius);
    this.applyTuning();
    this.boostLeft = t.boostSeconds;
  }
  /** Push tuning values into the controller (called at spawn and whenever the panel changes them). */
  applyTuning() {
    const t = this.t;
    for (let i = 0; i < 4; i++) {
      this.ctrl.setWheelSuspensionStiffness(i, t.suspStiffness); this.ctrl.setWheelSuspensionCompression(i, t.suspCompression);
      this.ctrl.setWheelSuspensionRelaxation(i, t.suspRelaxation); this.ctrl.setWheelMaxSuspensionTravel(i, t.suspTravel);
      this.ctrl.setWheelMaxSuspensionForce(i, t.suspMaxForce); this.ctrl.setWheelSuspensionRestLength(i, t.suspRest); this.ctrl.setWheelRadius(i, t.wheelRadius);
      this.ctrl.setWheelSideFrictionStiffness(i, t.sideStiffness);
    }
  }
  step(dt: number) {
    const t = this.t, b = this.body, inp = this.input, c = this.ctrl;
    const q = b.rotation(), v = b.linvel(), w = b.angvel();
    const fwd = qrot(q, 0, 0, 1), left = qrot(q, 1, 0, 0), up = qrot(q, 0, 1, 0);
    const vf = v.x * fwd[0] + v.y * fwd[1] + v.z * fwd[2], vl = v.x * left[0] + v.y * left[1] + v.z * left[2];
    const speed = Math.hypot(v.x, v.y, v.z);
    const yawRate = w.x * up[0] + w.y * up[1] + w.z * up[2];
    let contacts = 0; for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    // --- steering: speed-sensitive max angle, rate limited, plus countersteer toward the velocity vector
    const maxA = lerp(t.steerMax, t.steerMinAtSpeed, clamp(Math.abs(vf) / t.steerSpeedRef, 0, 1));
    let target = -inp.steer * maxA;
    const velAngle = Math.abs(vf) > 2 ? Math.atan2(vl, Math.abs(vf)) * Math.sign(vf) : 0;
    if (vf > 3) target += clamp(velAngle * t.countersteer, -0.45, 0.45) * clamp((speed - 3) / 6, 0, 1);
    target = clamp(target, -t.steerMax - 0.1, t.steerMax + 0.1);
    const rate = (Math.abs(target) < Math.abs(this.steerAngle) ? t.steerReturn : t.steerRate) * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    c.setWheelSteering(0, this.steerAngle); c.setWheelSteering(1, this.steerAngle);
    // --- drift state: entered by handbrake at speed or a power slide; held while sliding under throttle
    const slipDeg = Math.abs(velAngle) * 57.3;
    const trigger = (inp.handbrake > 0.5 && speed > 8) || (slipDeg > 14 && inp.throttle > 0.6 && speed > 8);
    const sustain = slipDeg > 6 && inp.throttle > 0.2 && speed > 6 && contacts >= 2;
    this.drift = clamp(this.drift + (trigger ? 4 : sustain ? 0 : -2.5) * dt, 0, 1);
    if (!sustain && !trigger) this.drift = Math.max(0, this.drift - 1.5 * dt);
    // --- drive: power-limited force, split front/rear; reverse when braking at standstill
    let drive = 0, brake = 0;
    const boosting = inp.boost > 0.5 && this.boostLeft > 0 && inp.throttle > 0.1;
    if (boosting) this.boostLeft = Math.max(0, this.boostLeft - dt); else this.boostLeft = Math.min(t.boostSeconds, this.boostLeft + dt * 0.25);
    if (inp.throttle > 0.01) drive = inp.throttle * Math.min(t.maxDriveForce, t.powerW / Math.max(Math.abs(vf), 1)) * (vf > t.topSpeed ? 0 : 1) + (boosting ? t.boostForce : 0);
    if (inp.brake > 0.01) { if (vf > 1.0) brake = inp.brake * t.brakeForce; else if (vf > -12) drive = -inp.brake * t.maxDriveForce * 0.45; }
    if (inp.throttle > 0.01 && vf < -1.0) brake = inp.throttle * t.brakeForce;
    const fr = t.driveSplitFront;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      c.setWheelEngineForce(i, (drive * (front ? fr : 1 - fr)) / 2);
      let br = brake * (front ? 0.6 : 0.4) / 0.5;
      let grip = t.frictionSlip * (front ? 1 : t.rearGrip * lerp(1, t.driftRearGrip * (1 - 0.2 * inp.throttle), this.drift));
      if (!front && inp.handbrake > 0.5) { br += t.handbrakeForce; grip *= t.handbrakeRearGrip; }
      // rolling resistance as a tiny brake when coasting keeps the car from creeping forever
      if (inp.throttle < 0.01 && inp.brake < 0.01 && Math.abs(vf) < 0.6) br += 8;
      c.setWheelBrake(i, br);
      c.setWheelFrictionSlip(i, grip);
    }
    // --- aero, rolling resistance, downforce (impulses = force * dt)
    const k = 0.6 * t.dragCdA;
    const imp = { x: -k * v.x * speed * dt, y: -k * v.y * speed * dt, z: -k * v.z * speed * dt };
    const rr = -t.rollResist * clamp(vf, -1, 1) * dt; imp.x += fwd[0] * rr; imp.y += fwd[1] * rr; imp.z += fwd[2] * rr;
    if (contacts > 0) { const df = -t.downforce * speed * speed * dt; imp.x += up[0] * df; imp.y += up[1] * df; imp.z += up[2] * df; }
    b.applyImpulse(imp, true);
    // --- yaw stability: damp yaw rate beyond what the steering asks for (not while handbraking)
    const izz = t.mass * (t.halfExtents[0] ** 2 + t.halfExtents[2] ** 2) / 3;
    if (contacts >= 3 && Math.abs(vf) > 4 && inp.handbrake < 0.5) {
      const desired = (vf * Math.tan(this.steerAngle)) / t.wheelbase;
      const err = yawRate - desired;
      const corr = -t.yawAssist * (1 - 0.85 * this.drift) * err * izz * 0.12;
      b.applyTorqueImpulse({ x: up[0] * corr, y: up[1] * corr, z: up[2] * corr }, true);
    }
    // --- drift angle limiter: inside a drift, damp yaw rate in proportion to how far slip exceeds the target angle.
    // Steering into the slide allows a deeper angle, countersteering pulls it in (arcade drift control).
    if (this.drift > 0.2 && contacts >= 3 && speed > 5) {
      const into = Math.sign(inp.steer) === Math.sign(velAngle) && Math.abs(inp.steer) > 0.2;
      const counter = Math.sign(inp.steer) === -Math.sign(velAngle) && Math.abs(inp.steer) > 0.2;
      const target = (t.driftAngle / 57.3) * (into ? 1.0 : counter ? 0.45 : 0.75);
      const excess = Math.abs(velAngle) - target;
      if (excess > 0) { const k = t.driftControl * clamp(excess / 0.15, 0, 2.5) * this.drift; const corr = -yawRate * izz * k * dt * 8;
        b.applyTorqueImpulse({ x: up[0] * corr, y: up[1] * corr, z: up[2] * corr }, true); }
    }
    // --- anti-flip: righting torque when tilted; air damping of roll/pitch; auto-recover if upside down & slow
    const tilt = up[1];
    if (tilt < 0.75 && t.antiFlip > 0) {
      // axis = up x worldUp = (-up.z, 0, up.x): rotates the car's up vector back toward world up
      const s = t.antiFlip * t.mass * 1.4 * (0.75 - tilt) * dt;
      b.applyTorqueImpulse({ x: -up[2] * s, y: 0, z: up[0] * s }, true);
    }
    if (contacts === 0) { const d = 1 - t.airDamp * dt; b.setAngvel({ x: w.x * d, y: w.y, z: w.z * d }, true); }
    if (tilt < 0.2 && speed < 2) this.upsideTime += dt; else this.upsideTime = 0;
    if (this.upsideTime > 1.5) this.recover();
    // --- gearbox (telemetry/audio only)
    const wheelRpm = (Math.abs(vf) / (2 * Math.PI * t.wheelRadius)) * 60;
    let rpm = wheelRpm * t.gears[this.gear - 1] * t.finalDrive;
    if (rpm > t.shiftUpRpm && this.gear < t.gears.length) this.gear++;
    else if (rpm < t.shiftDownRpm && this.gear > 1) this.gear--;
    rpm = Math.max(t.idleRpm + inp.throttle * (contacts ? 0 : 3000), wheelRpm * t.gears[this.gear - 1] * t.finalDrive);
    const slipping = this.wheelSkid[2] + this.wheelSkid[3] > 0.6 && inp.throttle > 0.5;
    this.rpm = lerp(this.rpm, clamp(rpm + (slipping ? 1200 : 0), t.idleRpm, t.redlineRpm), 0.2);
    c.updateVehicle(dt);
    // skid metric: lateral slip speed at each wheel, normalised
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      this.wheelSkid[i] = c.wheelIsInContact(i) ? clamp((Math.abs(Math.sin(velAngle - (front ? this.steerAngle : 0))) * speed - 1.5) / 4 + (inp.handbrake > 0.5 && !front && speed > 3 ? 0.5 : 0) + (brake > 0 && speed > 8 && inp.brake > 0.9 ? 0.2 : 0), 0, 1) : 0;
    }
    Object.assign(this.telemetry, { speed, vf, slip: velAngle, rpm: this.rpm, gear: this.gear, contacts, yawRate, drift: this.drift, boost: this.boostLeft / t.boostSeconds, throttle: inp.throttle });
  }
  /** Put the car back on its wheels a little above where it is. */
  recover() {
    const p = this.body.translation(), q = this.body.rotation();
    const f = qrot(q, 0, 0, 1); const yaw = Math.atan2(f[0], f[2]);
    this.body.setTranslation({ x: p.x, y: p.y + 1.5, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideTime = 0;
  }
  dispose() { this.world.removeVehicleController(this.ctrl); this.world.removeRigidBody(this.body); }
}
