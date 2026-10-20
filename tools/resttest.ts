// REALISM GATE — rest test (props part): drop 200 mixed props on flat ground and a kerb step, simulate 12 s,
// then check that nothing floats or sinks (height vs analytic rest height) and nothing jitters (motion in the last 2 s).
// Ragdolls join this test in M4. npx tsx tools/resttest.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { SimCore, STEP } from '../src/sim/simcore';
await RAPIER.init();
const sim = new SimCore(RAPIER);
sim.addStatic({ kind: 'box', half: [100, 0.5, 100], pos: [0, -0.5, 0] });
sim.addStatic({ kind: 'box', half: [100, 0.075, 16], pos: [0, 0.075, 32] }); // 15 cm sidewalk slab
const kinds: any[] = [];
let id = 1;
for (let i = 0; i < 200; i++) {
  const k = i % 4 === 0 ? 'ball' : i % 4 === 1 ? 'cylinder' : 'box'; const hx = 0.2 + (i % 7) * 0.05, hy = 0.2 + (i % 5) * 0.06, hz = 0.2 + (i % 3) * 0.08;
  const onKerb = i % 2 === 0; const x = (i % 20) * 3 - 30, z = onKerb ? 20 + ((i / 20) | 0) * 2.5 : ((i / 20) | 0) * 2.5 - 12;
  const half: [number, number, number] = k === 'ball' ? [hy, hy, hy] : k === 'cylinder' ? [hx, hy, hx] : [hx, hy, hz];
  sim.addDynamic(id, { kind: k, half, pos: [x, 1 + (i % 3), z], rot: [Math.sin(i), 0, 0, Math.cos(i)].map((v, j, a) => v / Math.hypot(...a)) as any, mass: 5 + (i % 9) * 3, friction: 0.7, restitution: 0.1 });
  kinds.push({ id: id++, k, half, ground: onKerb ? 0.15 : 0 });
}
const hist = new Map<number, number[][]>();
for (let s = 0; s < 12 / STEP; s++) { sim.step(); if (s > 10 / STEP) for (const c of kinds) { const b = sim.dynamics.get(c.id)!; const p = b.translation(); (hist.get(c.id) ?? hist.set(c.id, []).get(c.id)!).push([p.x, p.y, p.z]); } }
let floating = 0, sinking = 0, jitter = 0, maxJit = 0, maxGap = 0, asleep = 0;
for (const c of kinds) {
  const b = sim.dynamics.get(c.id)!; const h = hist.get(c.id)!; const p = b.translation();
  // lowest point of the collider, analytically from its rotation (box / cylinder / ball)
  const q = b.rotation(); const R = [2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z - q.w * q.x)]; // world-Y row of the rotation matrix
  const bottom = c.k === 'ball' ? p.y - c.half[0] : c.k === 'box' ? p.y - (Math.abs(R[0]) * c.half[0] + Math.abs(R[1]) * c.half[1] + Math.abs(R[2]) * c.half[2])
    : p.y - (Math.abs(R[1]) * c.half[1] + Math.sqrt(Math.max(0, 1 - R[1] * R[1])) * c.half[0]);
  const gap = bottom - c.ground; maxGap = Math.max(maxGap, Math.abs(gap));
  if (gap > 0.01) floating++; if (gap < -0.01) sinking++;
  const d = Math.hypot(h[h.length - 1][0] - h[0][0], h[h.length - 1][1] - h[0][1], h[h.length - 1][2] - h[0][2]); maxJit = Math.max(maxJit, d); if (d > 0.005) jitter++;
  if (b.isSleeping()) asleep++;
}
console.log(JSON.stringify({ props: kinds.length, floating, sinking, jittering: jitter, maxGapCm: +(maxGap * 100).toFixed(2), maxDrift2sCm: +(maxJit * 100).toFixed(2), asleep, ragdolls: 'UNVERIFIED (M4)' }));
