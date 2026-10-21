// FUN / REALISM GATE — on-foot controller (Node, real Rapier world): kerb step-up, stairs, walkable vs too-steep slopes,
// jump apex, wall slide (no dead-stop on a glancing hit), obstacle probe heights for vault/climb, crouch capsule.
// npx tsx tools/footgate.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { SimCore, STEP } from '../src/sim/simcore';
async function main() {
  await RAPIER.init();
  const run = (setup: (s: SimCore) => void, start: number[], inp: any, secs: number, each?: (c: any, t: number) => void) => {
    const sim = new SimCore(RAPIER); sim.addStatic({ kind: 'box', half: [60, 0.5, 60], pos: [0, -0.5, 0] }); setup(sim);
    const c = sim.spawnChar(1, start); Object.assign(c.input, { mode: 0, feet: [], yaw: 0, ...inp });
    for (let i = 0; i < secs / STEP; i++) { if (i === 2 && inp.jumpOnce) c.input.jump = 1; if (i === 4) c.input.jump = 0; sim.step(); each?.(c, i * STEP); }
    return c;
  };
  const r: any = {};
  // kerb 0.15 m at z=3
  let c = run((s) => s.addStatic({ kind: 'box', half: [10, 0.075, 5], pos: [0, 0.075, 8] }), [0, 0, 0], { vx: 0, vz: 1.6 }, 4);
  r.kerb_up = +c.feetPos()[1].toFixed(3); r.kerb_ok = Math.abs(c.feetPos()[1] - 0.15) < 0.03 && c.feetPos()[2] > 4;
  // stairs 0.17 rise / 0.30 run, 8 steps
  let topY = 0; c = run((s) => { for (let i = 0; i < 8; i++) { const z0 = 2 + 0.3 * i, z1 = 5.4; s.addStatic({ kind: 'box', half: [2, 0.085 * (i + 1), (z1 - z0) / 2], pos: [0, 0.085 * (i + 1), (z0 + z1) / 2] }); } }, [0, 0, 0], { vx: 0, vz: 1.4 }, 6, (ch) => (topY = Math.max(topY, ch.feetPos()[1])));
  r.stairs_top_y = +topY.toFixed(2); r.stairs_ok = topY > 1.3; // 8 x 0.17 m risers = 1.36 m
  // slopes: 25 deg walkable, 60 deg blocked
  const slope = (deg: number) => run((s) => { const a = (deg * Math.PI) / 180; s.addStatic({ kind: 'box', half: [3, 0.2, 6], pos: [0, 6 * Math.sin(a) - 0.2 * Math.cos(a), 3 + 6 * Math.cos(a)], rot: [Math.sin(-a / 2), 0, 0, Math.cos(-a / 2)] }); }, [0, 0, 0], { vx: 0, vz: 2 }, 5);
  c = slope(25); r.slope25_y = +c.feetPos()[1].toFixed(2); r.slope25_ok = c.feetPos()[1] > 1.2;
  c = slope(60); r.slope60_y = +c.feetPos()[1].toFixed(2); r.slope60_blocked = c.feetPos()[1] < 0.6;
  // jump apex from standing
  let apex = 0; c = run(() => {}, [0, 0, 0], { vx: 0, vz: 0, jumpOnce: true }, 2, (ch) => (apex = Math.max(apex, ch.feetPos()[1])));
  r.jump_apex_m = +apex.toFixed(2); r.jump_ok = apex > 0.7 && apex < 1.2;
  // wall at z=3 hit at 30 deg: tangential speed survives
  let vt = 0; c = run((s) => s.addStatic({ kind: 'box', half: [20, 2, 0.2], pos: [0, 2, 3] }), [0, 0, 0], { vx: 1.85, vz: 3.2 }, 3, (ch, t) => { if (t > 2.5) vt = Math.max(vt, Math.abs(ch.vel[0])); });
  r.wall_slide_ms = +vt.toFixed(2); r.wall_ok = vt > 1.2 && c.feetPos()[2] < 2.9;
  // obstacle probe: 0.9 m box 1 m ahead
  c = run((s) => s.addStatic({ kind: 'box', half: [2, 0.45, 0.25], pos: [0, 0.45, 1.25] }), [0, 0, 0], { vx: 0, vz: 0 }, 1.0);
  r.probe_feet_y = +c.feetPos()[1].toFixed(3); r.probe_dist = +c.obstacle[0].toFixed(2); r.probe_top = +c.obstacle[1].toFixed(2); r.probe_depth = +c.obstacle[2].toFixed(2); r.probe_ok = Math.abs(c.obstacle[1] - 0.9) < 0.05 && c.obstacle[0] <= 1.01;
  // crouch under a 1.3 m ceiling: can enter crouched, cannot stand up underneath
  c = run((s) => s.addStatic({ kind: 'box', half: [2, 0.5, 2], pos: [0, 1.85, 4] }), [0, 0, 0], { vx: 0, vz: 1.2, crouch: 1 }, 4);
  const inside = c.feetPos()[2]; c.input.crouch = 0; for (let i = 0; i < 30; i++) c.step(STEP, -9.81);
  r.crouch_z = +inside.toFixed(2); r.crouch_ok = inside > 3 && c.crouched;
  // grounded flag at rest (drives fall/land animation)
  c = run(() => {}, [0, 0, 0], { vx: 0, vz: 0 }, 1.5); let g = 0; for (let i = 0; i < 60; i++) { c.step(STEP, -9.81); if (c.grounded) g++; } r.rest_grounded_frac = +(g / 60).toFixed(2); r.rest_ok = g > 55;
  r.failed = Object.keys(r).filter((k) => k.endsWith('_ok') || k.endsWith('_blocked')).filter((k) => !r[k]);
  console.log(JSON.stringify(r));
}
main();
