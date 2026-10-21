// On-foot third-person camera: mouse orbit (yaw/pitch) around a shoulder pivot, spring-damped follow, collision-safe
// boom (custom cast against streamed geometry), sprint FOV kick, and a recentre behind the movement when idle-looking.
import * as THREE from 'three';

export class FollowCamera {
  yaw = 0; pitch = 0.18; dist = 3.3; shoulder = 0.42; height = 1.55; baseFov = 60; idle = 0; aim = 0; aimFov = 46; private kickP = 0; private kickY = 0;
  private pivot = new THREE.Vector3(); private cur = new THREE.Vector3(); private boom = 3.3; private init = false;
  cast: ((o: THREE.Vector3, d: THREE.Vector3, far: number) => number | null) | null = null;
  constructor(public cam: THREE.PerspectiveCamera) {}
  orbit(dx: number, dy: number) { if (dx || dy) { this.yaw -= dx; this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.95, 1.2); this.idle = 0; } }
  /** Recoil: pitch up / yaw jitter, recovering over ~0.2 s (the recovered part is applied, so aim drifts back down). */
  kick(p: number, y: number) { this.kickP += p; this.kickY += y; }
  snapBehind(yaw: number) { this.yaw = yaw; this.init = false; }
  /** Gameplay aim ray (independent of whatever camera renders the frame). */
  aimRay() { return { o: this.cur.clone(), d: new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).normalize() }; }
  update(dt: number, target: THREE.Vector3, moveYaw: number | null, speed: number, crouch = 0, apply = true) {
    this.idle += dt; const kp = this.kickP * Math.min(1, dt * 30), ky = this.kickY * Math.min(1, dt * 30); this.pitch = THREE.MathUtils.clamp(this.pitch - kp, -0.95, 1.2); this.yaw += ky; this.kickP -= kp; this.kickY -= ky;
    // drift behind the direction of travel when the player isn't steering the camera
    if (moveYaw !== null && this.idle > 1.2 && speed > 2.5) { let d = moveYaw - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; this.yaw += d * Math.min(1, dt * 0.8); }
    const h = this.height - crouch * 0.45 + this.aim * 0.08; const dist = THREE.MathUtils.lerp(this.dist, 1.45, this.aim), shoulder = THREE.MathUtils.lerp(this.shoulder, 0.62, this.aim); const want = target.clone().add(new THREE.Vector3(0, h, 0));
    if (!this.init) { this.pivot.copy(want); this.init = true; } else this.pivot.lerp(want, 1 - Math.exp(-dt * (14 + this.aim * 20)));
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); // pivot -> camera
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); // +Z forward, Y up: right = -X at yaw 0
    const shoulderPt = this.pivot.clone().addScaledVector(right, shoulder);
    let len = dist; if (this.cast) { const hit = this.cast(shoulderPt, dir, dist + 0.25); if (hit !== null) len = Math.max(0.35, hit - 0.25); }
    this.boom = len < this.boom ? len : this.boom + (len - this.boom) * Math.min(1, dt * 3); // pull in instantly, ease back out
    this.cur.copy(shoulderPt).addScaledVector(dir, this.boom); if (!apply) return;
    this.cam.position.copy(this.cur); this.cam.lookAt(shoulderPt.clone().addScaledVector(dir, -4));
    const fov = THREE.MathUtils.lerp(this.baseFov + THREE.MathUtils.clamp((speed - 4) * 1.6, 0, 6), this.aimFov, this.aim); this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-dt * 4)); this.cam.updateProjectionMatrix();
  }
  /** Camera forward yaw (for camera-relative movement). */
  get headingYaw() { return this.yaw; }
}
