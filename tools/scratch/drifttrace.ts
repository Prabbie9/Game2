import RAPIER from '@dimforge/rapier3d-compat';
import { SimCore, STEP } from '../../src/sim/simcore';
import { resolveTuning } from '../../src/vehicles/tuning';
import { buildTestArea } from '../../src/world/testarea';
await RAPIER.init();
const sim = new SimCore(RAPIER); for (const s of buildTestArea().statics) sim.addStatic(s);
const v = sim.spawnVehicle(1, resolveTuning('sedan', (process.argv[2] || 'Balanced') as any), [0, 1, -250]); for (let i = 0; i < 60; i++) sim.step();
v.body.setLinvel({ x: 0, y: 0, z: 75 / 3.6 }, true); let t = 0, prevSd = 0, line = '';
while (t < 4) { sim.step(); t += STEP;
  if (t < 0.5) Object.assign(v.input, { steer: 1, handbrake: 1, throttle: 0.4 });
  else { const sd = Math.abs(v.telemetry.slip) * 57.3; const rate = (sd - prevSd) / STEP; prevSd = sd; const e = 22 - sd;
    Object.assign(v.input, { handbrake: 0, throttle: Math.max(0.3, Math.min(1, 0.7 + 0.025 * e)), steer: Math.max(-1, Math.min(1, -0.25 + 0.05 * e - 0.012 * rate)) }); }
  if (sim.steps % 6 === 0) line += `${t.toFixed(1)}:${(v.telemetry.slip * 57.3).toFixed(0)}/${v.input.steer.toFixed(1)}/${(v.telemetry.speed * 3.6).toFixed(0)}/${v.drift.toFixed(1)} `; }
console.log(line);
