// Grey-box vehicle test area (M1): a 700 m asphalt pad with a wall line, kerb strips, a ramp, a slope,
// a slalom of cones and painted lane markings. Pure data so physics (worker/Node) and visuals share it.
import type { StaticDesc, DynamicDesc } from '../sim/simcore';
const yawQ = (a: number): [number, number, number, number] => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const pitchQ = (a: number): [number, number, number, number] => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export interface TestArea { statics: (StaticDesc & { look: string })[]; dynamics: (DynamicDesc & { id: number; look: string })[]; spawn: [number, number, number]; spawnYaw: number }
export function buildTestArea(): TestArea {
  const s: (StaticDesc & { look: string })[] = [];
  s.push({ kind: 'box', half: [350, 0.5, 350], pos: [0, -0.5, 0], look: 'asphalt' });
  // long wall along x = -40 (wall-slide test), concrete
  s.push({ kind: 'box', half: [0.4, 1.2, 120], pos: [-40, 1.2, 60], friction: 0.2, look: 'concrete' });
  // kerb strips (0.15 m) crossing the main straight
  for (const z of [140, 150]) s.push({ kind: 'box', half: [8, 0.075, 0.25], pos: [0, 0.075, z], look: 'kerb' });
  // jump ramp: 12 m long, 1.6 m tall, at z=230
  const rampA = Math.atan2(1.6, 12);
  s.push({ kind: 'box', half: [3.5, 0.3, 6.06], pos: [30, 0.8 - 0.3 * Math.cos(rampA), 230], rot: pitchQ(-rampA), look: 'concrete' });
  // a broad 8% slope hill
  const hillA = Math.atan(0.08);
  s.push({ kind: 'box', half: [12, 0.5, 30], pos: [80, 30 * Math.sin(hillA) - 0.5, 100], rot: pitchQ(-hillA), look: 'asphalt' });
  // perimeter blocks to give the horizon some shape
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = 300; const h = 6 + ((i * 7) % 5) * 5;
    s.push({ kind: 'box', half: [12, h, 12], pos: [Math.cos(a) * r, h, Math.sin(a) * r], rot: yawQ(-a), friction: 0.3, look: 'building' }); }
  // street lamps (thin poles) along the main straight, both sides
  for (let z = -60; z <= 300; z += 30) for (const x of [-11, 11]) s.push({ kind: 'box', half: [0.12, 4, 0.12], pos: [x, 4, z], look: 'lamp' });
  const d: (DynamicDesc & { id: number; look: string })[] = [];
  let id = 1000;
  for (let i = 0; i < 10; i++) d.push({ id: id++, kind: 'cylinder', half: [0.17, 0.36, 0.17], pos: [i % 2 ? 2.5 : -2.5, 0.37, 330 + i * 18], mass: 3, look: 'cone' });
  for (let i = 0; i < 6; i++) d.push({ id: id++, kind: 'box', half: [0.5, 0.5, 0.5], pos: [-20, 0.5 + 1.0 * (i % 3), 40 + Math.floor(i / 3) * 1.05], mass: 25, look: 'crate' });
  return { statics: s, dynamics: d, spawn: [0, 1.2, 0], spawnYaw: 0 };
}
