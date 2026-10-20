// Pooled dynamic lights: many registered light anchors (street lamps, neon, shop windows), only the N nearest
// to the camera get a real PointLight (N = tier.maxLights). Emissive meshes + bloom carry the rest.
import * as THREE from 'three';
export interface LightAnchor { pos: THREE.Vector3; color: THREE.Color; intensity: number; distance: number; nightOnly: boolean }
export class LightPool {
  anchors: LightAnchor[] = []; lights: THREE.PointLight[] = [];
  constructor(scene: THREE.Scene, public max = 12) {
    for (let i = 0; i < 16; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 2); l.castShadow = false; scene.add(l); this.lights.push(l); }
  }
  add(a: LightAnchor) { this.anchors.push(a); }
  update(cam: THREE.Vector3, night: number) {
    const sorted = this.anchors.filter((a) => !a.nightOnly || night > 0.05).map((a) => [a.pos.distanceToSquared(cam), a] as const).sort((x, y) => x[0] - y[0]);
    this.lights.forEach((l, i) => { const e = i < this.max ? sorted[i] : undefined;
      if (!e) { l.intensity = 0; l.visible = false; return; }
      const a = e[1]; l.visible = true; l.position.copy(a.pos); l.color.copy(a.color); l.distance = a.distance;
      // fade the farthest pooled lights so swapping is invisible
      const fade = i >= this.max - 2 ? 0.5 : 1; l.intensity = a.intensity * (a.nightOnly ? night : 1) * fade; });
  }
}
