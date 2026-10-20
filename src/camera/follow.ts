// On-foot third-person camera: mouse orbit (yaw/pitch) around a shoulder pivot, spring-damped follow, collision-safe
// boom (custom cast against streamed geometry), sprint FOV kick, and a recentre behind the movement when idle-looking.
import * as THREE from 'three';

export class FollowCamera {
  yaw = 0; pitch = 0.18; dist = 3.3; shoulder = 0.42; height = 1.55; baseFov = 60; idle = 0;
  private pivot = new THREE.Vector3(); private cur = new THREE.Vector3(); private boom = 3.3; private init = false;
  cast: ((o: THREE.Vector3, d: THREE.Vector3, far: number) => number | null) | null = null;
  constructor(public cam: THREE.PerspectiveCamera) {}
  orbit(dx: number, dy: number) { if (dx || dy) { this.yaw -= dx; this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.95, 1.2); this.idle = 0; } }
  snapBehind(yaw: number) { this.yaw = yaw; this.init = false; }
  update(dt: number, target: THREE.Vector3, moveYaw: number | null, speed: number, crouch = 0) {
    this.idle += dt;
    // drift behind the direction of travel when the player isn't steering the camera
    if (moveYaw !== null && this.idle > 1.2 && speed > 2.5) { let d = moveYaw - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; this.yaw += d * Math.min(1, dt * 0.8); }
    const h = this.height - crouch * 0.45; const want = target.clone().add(new THREE.Vector3(0, h, 0));
    if (!this.init) { this.pivot.copy(want); this.init = true; } else this.pivot.lerp(want, 1 - Math.exp(-dt * 14));
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); // pivot -> camera
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); // +Z forward, Y up: right = -X at yaw 0
    const shoulderPt = this.pivot.clone().addScaledVector(right, this.shoulder);
    let len = this.dist; if (this.cast) { const hit = this.cast(shoulderPt, dir, this.dist + 0.25); if (hit !== null) len = Math.max(0.35, hit - 0.25); }
    this.boom = len < this.boom ? len : this.boom + (len - this.boom) * Math.min(1, dt * 3); // pull in instantly, ease back out
    this.cur.copy(shoulderPt).addScaledVector(dir, this.boom);
    this.cam.position.copy(this.cur); this.cam.lookAt(shoulderPt.clone().addScaledVector(dir, -4));
    const fov = this.baseFov + THREE.MathUtils.clamp((speed - 4) * 1.6, 0, 6); this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-dt * 4)); this.cam.updateProjectionMatrix();
  }
  /** Camera forward yaw (for camera-relative movement). */
  get headingYaw() { return this.yaw; }
}
