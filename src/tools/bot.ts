// Bot driver: pure-pursuit steering along a waypoint loop with a speed controller. Used for in-motion captures,
// automated route tests and the fun gate in the browser (Node tests use tools/fungate.ts).
import * as THREE from 'three';
import type { VehState } from '../physics/client';
export const ROUTES: Record<string, [number, number][]> = {
  loop: [[0, -200], [0, 250], [40, 290], [120, 260], [140, 150], [90, 40], [20, -60], [-20, -150], [0, -200]],
  straight: [[0, -250], [0, 300]],
  slalom: [[0, 300], [3, 340], [-3, 376], [3, 412], [-3, 448], [0, 480]],
  highway: [[-960, 388], [960, 388]],
  tunnel: [[-292.2, -320], [-292.2, 330]],
  downtown: [[-4.2, -150], [-4.2, 90], [-4.2, 250]],
};
export class BotDriver {
  i = 1;
  constructor(public pts: [number, number][], public speed: number) {}
  drive(s: VehState, q: THREE.Quaternion) {
    const p = new THREE.Vector2(s.pos[0], s.pos[2]); let tgt = new THREE.Vector2(...this.pts[this.i]);
    if (p.distanceTo(tgt) < 12) { this.i = (this.i + 1) % this.pts.length; tgt = new THREE.Vector2(...this.pts[this.i]); }
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const heading = Math.atan2(f.x, f.z);
    const want = Math.atan2(tgt.x - p.x, tgt.y - p.y); let err = want - heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const corner = Math.min(1, Math.abs(err) * 1.5); const v = this.speed * (1 - corner * 0.45);
    return { steer: THREE.MathUtils.clamp(-err * 2.2, -1, 1), throttle: s.vf < v ? 1 : 0, brake: s.vf > v + 4 ? 0.6 : 0, handbrake: 0, boost: 0 };
  }
}
