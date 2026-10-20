// Procedural car visual (baseline until sourced models replace it): bevelled extruded body with wheel arches,
// glass greenhouse with a visible interior, clearcoat paint, lathed tyres + spoked rims + brake discs,
// emissive head/tail lights with headlight spot beams. Local axes match the physics chassis: +Z forward, +Y up.
import * as THREE from 'three';
import type { Renderer } from '../renderer/renderer';
import type { VehState } from '../physics/client';

export interface CarVisualOpts { color?: number; wheelRadius: number; wheelWidth: number; track: number; wheelbase: number; wheelY: number; frontOffset: number }
const S = (pts: [number, number][]) => { const s = new THREE.Shape(); s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); return s; };

export class CarVisual {
  root = new THREE.Group(); body = new THREE.Group(); wheels: { pivot: THREE.Group; spin: THREE.Group }[] = [];
  paint: THREE.MeshPhysicalMaterial; tail: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial; beams: THREE.SpotLight[] = [];
  braking = 0; lightsOn = false;
  constructor(R: Renderer, public o: CarVisualOpts) {
    this.paint = R.setupMaterial(new THREE.MeshPhysicalMaterial({ color: o.color ?? 0x8a1620, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }));
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.6, clearcoat: 1 });
    const trim = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.55, metalness: 0.2 }));
    const chrome = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.18, metalness: 1 }));
    const interior = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.9 }));
    this.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e0, emissiveIntensity: 0.4, roughness: 0.1 });
    this.tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 0.5, roughness: 0.2 });
    const W = 1.82, CW = 1.42, wz = o.wheelbase / 2, ar = o.wheelRadius + 0.07, ay = o.wheelY - 0.27;
    // lower body side profile (z, y) with wheel arches cut into the bottom edge
    const lower = new THREE.Shape(); lower.moveTo(-2.36, -0.5);
    lower.lineTo(-wz - ar - 0.02, -0.5); lower.absarc(-wz, ay, ar, Math.PI, 0, true); lower.lineTo(wz - ar, -0.5);
    lower.absarc(wz, ay, ar, Math.PI, 0, true); lower.lineTo(2.3, -0.5);
    [[2.4, -0.32], [2.36, -0.06], [2.12, 0.06], [1.0, 0.16], [-1.45, 0.17], [-2.15, 0.14], [-2.38, 0.02], [-2.42, -0.3]].forEach(([z, y]) => lower.lineTo(z, y));
    const bodyGeo = new THREE.ExtrudeGeometry(lower, { depth: W - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 18 });
    bodyGeo.rotateY(-Math.PI / 2); bodyGeo.translate((W - 0.12) / 2, 0, 0);
    const bodyMesh = new THREE.Mesh(bodyGeo, this.paint); bodyMesh.castShadow = bodyMesh.receiveShadow = true; this.body.add(bodyMesh);
    // greenhouse: glass band + painted roof + pillars
    const cabin = S([[1.0, 0.15], [0.05, 0.64], [-0.95, 0.66], [-1.62, 0.18]]);
    const cabGeo = new THREE.ExtrudeGeometry(cabin, { depth: CW, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
    cabGeo.rotateY(-Math.PI / 2); cabGeo.translate(CW / 2, 0, 0);
    const cab = new THREE.Mesh(cabGeo, glass); this.body.add(cab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.02, 0.05, 0.95), this.paint); roof.position.set(0, 0.68, -0.45); roof.castShadow = true; this.body.add(roof);
    for (const x of [-1, 1]) for (const [z0, y0, z1, y1] of [[1.0, 0.15, 0.05, 0.64], [-0.95, 0.66, -1.62, 0.18]]) {
      const len = Math.hypot(z1 - z0, y1 - y0); const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, len), this.paint);
      p.position.set(x * (CW / 2 + 0.03), (y0 + y1) / 2, (z0 + z1) / 2); p.rotation.x = -Math.atan2(y1 - y0, z1 - z0); p.castShadow = true; this.body.add(p);
    }
    // interior: seats + dash, visible through tinted glass
    for (const [x, z] of [[0.38, 0.0], [-0.38, 0.0], [0.38, -0.85], [-0.38, -0.85]]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.45), interior); seat.position.set(x, 0.12, z); this.body.add(seat); }
    const dash = new THREE.Mesh(new THREE.BoxGeometry(CW - 0.1, 0.18, 0.35), interior); dash.position.set(0, 0.24, 0.72); this.body.add(dash);
    // bumpers, grille, mirrors, lights
    const fb = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.16, 0.12), trim); fb.position.set(0, -0.38, 2.4); this.body.add(fb);
    const rb = fb.clone(); rb.position.z = -2.44; this.body.add(rb);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.04), trim); grille.position.set(0, -0.12, 2.43); this.body.add(grille);
    for (const x of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.06), this.head); hl.position.set(x * 0.62, -0.06, 2.37); hl.rotation.y = x * 0.18; this.body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.05), this.tail); tl.position.set(x * 0.6, 0.04, -2.43); this.body.add(tl);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.12), this.paint); mir.position.set(x * 0.98, 0.25, 0.85); this.body.add(mir);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.14), chrome); handle.position.set(x * 0.92, 0.07, -0.1); this.body.add(handle);
      const beam = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.55, 1.6); beam.position.set(x * 0.62, -0.06, 2.3); beam.target.position.set(x * 0.9, -0.6, 22);
      this.body.add(beam, beam.target); this.beams.push(beam);
    }
    // wheels: lathe tyre, rim with 5 spokes, brake disc
    const r = o.wheelRadius, w = o.wheelWidth;
    const prof: THREE.Vector2[] = []; for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; prof.push(new THREE.Vector2(r - 0.055 + Math.sin(a) * 0.055, -w / 2 + (i / 12) * w)); }
    const tyreGeo = new THREE.LatheGeometry([new THREE.Vector2(r * 0.66, -w / 2), ...prof, new THREE.Vector2(r * 0.66, w / 2)], 32); tyreGeo.rotateZ(Math.PI / 2);
    const tyreMat = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }));
    const rimMat = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xb9bcc1, roughness: 0.25, metalness: 1 }));
    const discMat = R.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x5a5856, roughness: 0.4, metalness: 0.9 }));
    const hw = o.track / 2, wb = o.wheelbase / 2;
    [[hw, wb], [-hw, wb], [hw, -wb], [-hw, -wb]].forEach(([x, z], i) => {
      const pivot = new THREE.Group(), spin = new THREE.Group(); pivot.position.set(x, o.wheelY - 0.3, z + o.frontOffset); pivot.add(spin);
      const tyre = new THREE.Mesh(tyreGeo, tyreMat); tyre.castShadow = true; spin.add(tyre);
      const side = x > 0 ? 1 : -1;
      const rimFace = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.02, 24), rimMat); rimFace.rotation.z = Math.PI / 2; rimFace.position.x = side * (w / 2 - 0.05); spin.add(rimFace);
      for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 1.2, 0.07), rimMat); sp.rotation.x = (k / 5) * Math.PI * 2; sp.position.x = side * (w / 2 - 0.035); spin.add(sp); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), chrome); hub.rotation.z = Math.PI / 2; hub.position.x = side * (w / 2 - 0.02); spin.add(hub);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.03, 24), discMat); disc.rotation.z = Math.PI / 2; disc.position.x = side * 0.02; pivot.add(disc);
      void i; this.root.add(pivot); this.wheels.push({ pivot, spin });
    });
    this.root.add(this.body);
    this.root.traverse((m) => { if ((m as THREE.Mesh).isMesh) { (m as THREE.Mesh).castShadow = true; } });
    cab.castShadow = false;
  }
  setLights(on: boolean) { this.lightsOn = on; for (const b of this.beams) b.intensity = on ? 60 : 0; this.head.emissiveIntensity = on ? 6 : 0.4; }
  /** Apply interpolated physics state; wheel centre = hardpoint pushed down by suspension length. */
  update(s: VehState, braking: number) {
    this.root.position.set(s.pos[0], s.pos[1], s.pos[2]); this.root.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
    s.wheels.forEach((w, i) => { const v = this.wheels[i]; v.pivot.position.y = this.o.wheelY - w.susp; v.pivot.rotation.y = w.steer; v.spin.rotation.x = w.rot; });
    this.braking += (braking - this.braking) * 0.3;
    this.tail.emissiveIntensity = (this.lightsOn ? 2.2 : 0.4) + this.braking * 9;
  }
}
