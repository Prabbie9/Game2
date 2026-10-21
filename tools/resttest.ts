// REALISM GATE — rest test (props part): drop 200 mixed props on flat ground and a kerb step, simulate 12 s,
// then check that nothing floats or sinks (height vs analytic rest height) and nothing jitters (motion in the last 2 s).
// Plus 20 ragdolls (same segment layout as src/character/ragdoll.ts) thrown onto road and kerb. npx tsx tools/resttest.ts
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
// ragdolls: a standing human layout (pelvis, chest, head, arms, forearms, thighs, shins), random pitch/yaw/throw
const rags: { id: number; ground: number; segs: any[] }[] = [];
const layout = [[0, 0.98, 0, 0.1, 0.12, 11, -1, 0.92], [0, 1.3, 0, 0.12, 0.13, 15, 0, 1.12], [0, 1.62, 0, 0.08, 0.095, 5, 1, 1.5], [0.2, 1.33, 0, 0.12, 0.05, 2.2, 1, 1.42], [0.2, 1.05, 0, 0.12, 0.045, 1.6, 3, 1.2], [-0.2, 1.33, 0, 0.12, 0.05, 2.2, 1, 1.42], [-0.2, 1.05, 0, 0.12, 0.045, 1.6, 5, 1.2],
  [0.1, 0.72, 0, 0.16, 0.075, 8, 0, 0.92], [0.1, 0.27, 0, 0.17, 0.055, 4, 7, 0.5], [-0.1, 0.72, 0, 0.16, 0.075, 8, 0, 0.92], [-0.1, 0.27, 0, 0.17, 0.055, 4, 9, 0.5]];
for (let r = 0; r < 20; r++) { const onKerb = r % 2 === 0; const ox = r * 2.6 - 26, oz = onKerb ? 26 : -4, oy = 0.4 + (r % 4) * 0.4; const yaw = r * 1.3;
  const rot = (x: number, z: number) => [ox + x * Math.cos(yaw) - z * Math.sin(yaw), oz + x * Math.sin(yaw) + z * Math.cos(yaw)];
  const segs = layout.map(([x, y, z, half, rad, mass, parent, ay], i) => { const [wx, wz] = rot(x, z); const [ax, az] = rot(x, z); const hinge = i === 4 || i === 6 || i === 8 || i === 10;
    return { pos: [wx, y + oy, wz], quat: [0, 0, 0, 1], half, radius: rad, mass, parent, anchor: [ax, ay + oy, az], hinge: hinge ? [Math.cos(yaw), 0, Math.sin(yaw)] : undefined, lim: hinge ? (i >= 8 ? [-0.05, 2.4] : [-2.4, 0.05]) : undefined }; });
  sim.spawnRagdoll(1000 + r, segs as any, [Math.sin(r) * 3, 1.5, Math.cos(r) * 3], [r % 3, 0, (r % 5) - 2]); rags.push({ id: 1000 + r, ground: onKerb ? 0.15 : 0, segs }); }
const ragHist = new Map<number, number[][]>();
const hist = new Map<number, number[][]>();
for (let s = 0; s < 12 / STEP; s++) { sim.step(); if (s > 10 / STEP) for (const r of rags) { const b = sim.ragdolls.get(r.id)!.bodies[0].translation(); (ragHist.get(r.id) ?? ragHist.set(r.id, []).get(r.id)!).push([b.x, b.y, b.z]); }
  if (s > 10 / STEP) for (const c of kinds) { const b = sim.dynamics.get(c.id)!; const p = b.translation(); (hist.get(c.id) ?? hist.set(c.id, []).get(c.id)!).push([p.x, p.y, p.z]); } }
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
// ragdolls: lowest capsule point must touch its ground (|gap| <= 2 cm, the body rests on something), no segment sinks
// below its ground by more than 1 cm, and the pelvis moves < 0.5 cm over the last 2 s
let rFloat = 0, rSink = 0, rJit = 0, rMaxSink = 0, rMaxLow = 0, rMaxDrift = 0;
for (const r of rags) { const rd = sim.ragdolls.get(r.id)!; let low = 9;
  rd.bodies.forEach((b, i) => { const p = b.translation(), q = b.rotation(); const ay = 1 - 2 * (q.x * q.x + q.z * q.z); const bottom = p.y - Math.abs(ay) * r.segs[i].half - r.segs[i].radius;
    const g = Math.abs(p.z - 32) < 16 ? 0.15 : 0; const gap = bottom - g; low = Math.min(low, gap); rMaxSink = Math.min(rMaxSink, gap); });
  if (low > 0.02) rFloat++; if (low < -0.01) rSink++; rMaxLow = Math.max(rMaxLow, Math.abs(low));
  const h = ragHist.get(r.id)!; const d = Math.hypot(h[h.length - 1][0] - h[0][0], h[h.length - 1][1] - h[0][1], h[h.length - 1][2] - h[0][2]); rMaxDrift = Math.max(rMaxDrift, d); if (d > 0.005) rJit++; }
console.log(JSON.stringify({ props: kinds.length, floating, sinking, jittering: jitter, maxGapCm: +(maxGap * 100).toFixed(2), maxDrift2sCm: +(maxJit * 100).toFixed(2), asleep,
  ragdolls: rags.length, ragFloating: rFloat, ragSinking: rSink, ragJittering: rJit, ragMaxSinkCm: +(-rMaxSink * 100).toFixed(2), ragMaxContactGapCm: +(rMaxLow * 100).toFixed(2), ragMaxDrift2sCm: +(rMaxDrift * 100).toFixed(2) }));
