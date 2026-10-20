// Visuals for the grey-box test area: meshes from the shared static/dynamic descriptors, lane paint, lamp heads.
import * as THREE from 'three';
import type { TestArea } from './testarea';
import { material } from '../materials/surface';
import type { Renderer } from '../renderer/renderer';
import type { LightPool } from '../lighting/lightpool';
export function buildTestVisuals(R: Renderer, area: TestArea, pool: LightPool) {
  const group = new THREE.Group(); const colliders: THREE.Object3D[] = []; const dyn = new Map<number, THREE.Object3D>();
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd6a0, emissiveIntensity: 0 });
  for (const s of area.statics) {
    if (s.kind !== 'box') continue;
    const m = R.setupMaterial(material(s.look) as THREE.MeshStandardMaterial);
    const geo = new THREE.BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2);
    if (s.look === 'building') { const uv = geo.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.half[0] / 6, uv.getY(i) * s.half[1] / 8); }
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(...s.pos); if (s.rot) mesh.quaternion.set(...s.rot);
    mesh.receiveShadow = true; mesh.castShadow = s.look !== 'asphalt'; group.add(mesh); if (s.look !== 'lamp') colliders.push(mesh);
    if (s.look === 'lamp') {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.12), m); arm.position.set(s.pos[0] - Math.sign(s.pos[0]) * 0.75, s.pos[1] * 2 - 0.1, s.pos[2]); group.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.3), lampHeadMat); head.position.set(s.pos[0] - Math.sign(s.pos[0]) * 1.5, s.pos[1] * 2 - 0.2, s.pos[2]); group.add(head);
      pool.add({ pos: head.position.clone().add(new THREE.Vector3(0, -0.4, 0)), color: new THREE.Color(1, 0.8, 0.55), intensity: 90, distance: 24, nightOnly: true });
    }
  }
  // painted lane markings along the main straight and the test pad grid
  const paint = R.setupMaterial(material('paint') as THREE.MeshStandardMaterial);
  for (let z = -320; z < 320; z += 9) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 4.5), paint); d.rotation.x = -Math.PI / 2; d.position.set(0, 0.005, z); d.receiveShadow = true; group.add(d); }
  for (const x of [-9.5, 9.5]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 640), paint); e.rotation.x = -Math.PI / 2; e.position.set(x, 0.005, 0); e.receiveShadow = true; group.add(e); }
  for (const d of area.dynamics) {
    const m = R.setupMaterial(material(d.look) as THREE.MeshStandardMaterial);
    const geo = d.kind === 'cylinder' ? new THREE.ConeGeometry(d.half[0] * 1.15, d.half[1] * 2, 16) : new THREE.BoxGeometry(d.half[0] * 2, d.half[1] * 2, d.half[2] * 2);
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; mesh.position.set(...d.pos); group.add(mesh); dyn.set(d.id, mesh);
  }
  R.scene.add(group);
  return { group, colliders, dyn, lampHeadMat, buildingMat: material('building') as THREE.MeshStandardMaterial };
}
