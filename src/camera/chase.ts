// Vehicle chase camera: critically-damped spring arm behind the car's velocity-blended heading, look-ahead,
// speed-based FOV, subtle speed shake, mouse orbit override that recentres, and collision-safe arm (raycast vs world).
import * as THREE from 'three';

export class ChaseCamera {
  pos = new THREE.Vector3(0, 3, -8); look = new THREE.Vector3(); vel = new THREE.Vector3();
  yawOff = 0; pitchOff = 0.12; idle = 0; mode = 0; // 0 = chase, 1 = far chase, 2 = bumper
  distance = 6.2; height = 2.0; baseFov = 62; shake = true;
  private ray = new THREE.Raycaster(); private heading = new THREE.Vector3(0, 0, 1);
  /** Optional custom ray cast (e.g. against streamed collider boxes); returns hit distance or null. */
  cast: ((o: THREE.Vector3, d: THREE.Vector3, far: number) => number | null) | null = null;
  constructor(public cam: THREE.PerspectiveCamera, public colliders: THREE.Object3D[]) {}
  cycle() { this.mode = (this.mode + 1) % 3; }
  orbit(dx: number, dy: number) { if (dx || dy) { this.yawOff -= dx; this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + dy, -0.2, 0.9); this.idle = 0; } }
  update(dt: number, target: THREE.Vector3, quat: THREE.Quaternion, velocity: THREE.Vector3, lookBehind = false) {
    const speed = velocity.length();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat); fwd.y = 0; fwd.normalize();
    // heading blends toward the velocity direction at speed so drifts are framed from behind the motion
    const vdir = velocity.clone().setY(0); const blend = THREE.MathUtils.clamp((speed - 4) / 20, 0, 0.55);
    const want = speed > 2 && vdir.dot(fwd) > 0 ? fwd.clone().lerp(vdir.normalize(), blend).normalize() : fwd;
    this.heading.lerp(want, 1 - Math.exp(-dt * 4)).normalize();
    this.idle += dt; if (this.idle > 1.6) { this.yawOff *= Math.exp(-dt * 2.2); this.pitchOff += (0.12 - this.pitchOff) * (1 - Math.exp(-dt * 2)); }
    const [dist, h] = this.mode === 1 ? [9.5, 2.9] : this.mode === 2 ? [-0.6, 1.05] : [this.distance + speed * 0.035, this.height + speed * 0.008];
    let yaw = Math.atan2(this.heading.x, this.heading.z) + this.yawOff + (lookBehind ? Math.PI : 0);
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const anchor = target.clone().add(new THREE.Vector3(0, this.mode === 2 ? 0 : 0.9, 0));
    let desired = anchor.clone().addScaledVector(back, dist * Math.cos(this.pitchOff)).add(new THREE.Vector3(0, h + dist * Math.sin(this.pitchOff), 0));
    if (this.mode === 2) desired = target.clone().addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, 1.05, 0));
    // collision: pull the camera in front of any world geometry between anchor and desired position
    if (this.mode !== 2) {
      const dir = desired.clone().sub(anchor); const len = dir.length(); dir.normalize();
      let hitD: number | null = null;
      if (this.cast) hitD = this.cast(anchor, dir, len + 0.3);
      else { this.ray.set(anchor, dir); this.ray.far = len + 0.3; const hit = this.ray.intersectObjects(this.colliders, false)[0]; if (hit) hitD = hit.distance; }
      if (hitD !== null) desired.copy(anchor).addScaledVector(dir, Math.max(0.8, hitD - 0.35));
    }
    // spring (critically damped) — stiffer when close to avoid lag through corners
    const k = this.mode === 2 ? 400 : 60, c = 2 * Math.sqrt(k);
    const acc = desired.clone().sub(this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
    this.vel.addScaledVector(acc, dt); this.pos.addScaledVector(this.vel, dt);
    if (this.pos.distanceTo(desired) > 25) { this.pos.copy(desired); this.vel.set(0, 0, 0); }
    if (this.pos.y < target.y - 0.3) this.pos.y = target.y - 0.3;
    // look-ahead: aim slightly ahead along velocity
    const ahead = target.clone().addScaledVector(velocity, this.mode === 2 ? 0.5 : 0.18).add(new THREE.Vector3(0, this.mode === 2 ? 1.0 : 1.0, 0));
    if (this.mode === 2) ahead.copy(target).addScaledVector(fwd, 20).add(new THREE.Vector3(0, 1, 0));
    this.look.lerp(ahead, 1 - Math.exp(-dt * 10));
    this.cam.position.copy(this.pos);
    if (this.shake && speed > 25) { const s = (speed - 25) * 0.0006; this.cam.position.x += (Math.random() - 0.5) * s; this.cam.position.y += (Math.random() - 0.5) * s; }
    this.cam.lookAt(this.look);
    const fov = this.baseFov + THREE.MathUtils.clamp((speed - 8) * 0.32, 0, 16);
    this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-dt * 3)); this.cam.updateProjectionMatrix();
  }
}
