// Vehicle FUN GATE (bot-measured proxies), runs the real sim core in Node — no rendering.
// npx tsx tools/fungate.ts [class] [preset]   -> prints a table + writes tools/out/fungate_<class>_<preset>.json
import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import { SimCore, STEP } from '../src/sim/simcore';
import { resolveTuning, type PresetName } from '../src/vehicles/tuning';
import { buildTestArea } from '../src/world/testarea';
import { qrot } from '../src/sim/vehicle';

await RAPIER.init();
const cls = process.argv[2] || 'sedan', preset = (process.argv[3] || 'Balanced') as PresetName;
const T = resolveTuning(cls, preset);
const area = buildTestArea();
function fresh(pos: [number, number, number] = [0, 1.0, 0], yaw = 0) {
  const sim = new SimCore(RAPIER); for (const s of area.statics) sim.addStatic(s); for (const d of area.dynamics) sim.addDynamic(d.id, d);
  const v = sim.spawnVehicle(1, structuredClone(T), pos, yaw); for (let i = 0; i < 60; i++) sim.step(); return { sim, v };
}
const up = (v: any) => qrot(v.body.rotation(), 0, 1, 0)[1];
const yawOf = (v: any) => { const f = qrot(v.body.rotation(), 0, 0, 1); return Math.atan2(f[0], f[2]); };
const R: Record<string, any> = {};
// 1. acceleration 0 -> cruise, top speed
{ const { sim, v } = fresh([0, 1, -250]); v.input.throttle = 1; let t = 0, tc = -1; const cruise = T.cruiseKmh / 3.6;
  while (t < 40) { sim.step(); t += STEP; if (v.body.translation().z > 250) v.body.setTranslation({ x: 0, y: v.body.translation().y, z: -250 }, true); if (tc < 0 && v.telemetry.vf >= cruise) tc = t; }
  R.accel_0_cruise_s = +tc.toFixed(2); R.accel_band = T.accelBand; R.accel_ok = tc > 0 && tc >= T.accelBand[0] && tc <= T.accelBand[1]; R.top_speed_kmh = +(v.telemetry.vf * 3.6).toFixed(1); }
// 2. braking 100 -> 0 distance
{ const { sim, v } = fresh([0, 1, -250]); v.body.setLinvel({ x: 0, y: 0, z: 100 / 3.6 }, true); v.input.brake = 1; sim.step(); const z0 = v.body.translation().z; let t = 0;
  while (v.telemetry.vf > 0.3 && t < 20) { sim.step(); t += STEP; } R.brake_100_0_m = +(v.body.translation().z - z0).toFixed(1); R.brake_ok = R.brake_100_0_m > 30 && R.brake_100_0_m < 55; R.brake_upright = up(v) > 0.9; }
// 3. handbrake drift: at 75 km/h, steer full right + handbrake 0.5 s, then throttle 0.8 with bot countersteer holding the slide
{ const { sim, v } = fresh([0, 1, -250]); v.body.setLinvel({ x: 0, y: 0, z: 75 / 3.6 }, true); let t = 0, prevSd = 0; const slips: number[] = []; let spun = false;
  while (t < 5) { sim.step(); t += STEP;
    if (t < 0.5) Object.assign(v.input, { steer: 1, handbrake: 1, throttle: 0.4 });
    else { const sd = Math.abs(v.telemetry.slip) * 57.3; const rate = (sd - prevSd) / STEP; prevSd = sd; const e = 22 - sd;
      Object.assign(v.input, { handbrake: 0, throttle: Math.max(0.3, Math.min(1, 0.7 + 0.025 * e)), steer: Math.max(-1, Math.min(1, -0.25 + 0.05 * e - 0.012 * rate)) }); }
    if (t > 1.0 && t < 3.0) slips.push(Math.abs(v.telemetry.slip) * 57.3); if (Math.abs(v.telemetry.slip) > 1.4) spun = true; }
  const mean = slips.reduce((a, b) => a + b, 0) / slips.length; const sd = Math.sqrt(slips.reduce((a, b) => a + (b - mean) ** 2, 0) / slips.length);
  R.drift_slip_mean_deg = +mean.toFixed(1); R.drift_slip_sd_deg = +sd.toFixed(1); R.drift_spun = spun; R.drift_ok = mean > 10 && mean < 45 && sd < 12 && !spun; R.drift_upright = up(v) > 0.9; }
// 4. flip test: violent slalom at 110 km/h, 4 s
{ const { sim, v } = fresh([0, 1, -250]); v.body.setLinvel({ x: 0, y: 0, z: 110 / 3.6 }, true); let t = 0, minUp = 1;
  while (t < 6) { sim.step(); t += STEP; Object.assign(v.input, { throttle: 1, steer: Math.sign(Math.sin(t * 3.2)) }); minUp = Math.min(minUp, up(v)); }
  R.slalom_min_up = +minUp.toFixed(2); R.slalom_no_flip = minUp > 0.5; }
// 5. wall hit at 30 degrees, 60 km/h: should slide, not dead-stop
{ const yaw = -Math.PI / 6; const { sim, v } = fresh([-30, 1, 40], yaw); const sp = 60 / 3.6; v.body.setLinvel({ x: Math.sin(yaw) * sp, y: 0, z: Math.cos(yaw) * sp }, true);
  let t = 0, hit = -1, after = 0, minUp = 1; v.input.throttle = 0.5;
  while (t < 4) { sim.step(); t += STEP; const x = v.body.translation().x; if (hit < 0 && x < -38.3) hit = t; if (hit > 0 && t - hit > 0.5 && after === 0) after = v.telemetry.speed; minUp = Math.min(minUp, up(v)); }
  R.wall_hit = hit > 0; R.wall_speed_after_kmh = +(after * 3.6).toFixed(1); R.wall_slide_ok = hit > 0 && after > sp * 0.4; R.wall_upright = minUp > 0.6; }
// 6. kerbs at 50 km/h
{ const { sim, v } = fresh([0, 1, 110]); v.body.setLinvel({ x: 0, y: 0, z: 50 / 3.6 }, true); v.input.throttle = 0.3; let t = 0, minUp = 1;
  while (t < 4) { sim.step(); t += STEP; minUp = Math.min(minUp, up(v)); } R.kerb_min_up = +minUp.toFixed(3); R.kerb_ok = minUp > 0.9 && v.telemetry.vf > 8; }
// 7. ramp jump at 70 km/h: lands upright
{ const { sim, v } = fresh([30, 1, 160]); v.body.setLinvel({ x: 0, y: 0, z: 70 / 3.6 }, true); v.input.throttle = 0.6; let t = 0, air = 0, maxY = 0;
  while (t < 6) { sim.step(); t += STEP; if (v.telemetry.contacts === 0) air += STEP; maxY = Math.max(maxY, v.body.translation().y); }
  R.ramp_air_s = +air.toFixed(2); R.ramp_max_y = +maxY.toFixed(2); R.ramp_land_upright = up(v) > 0.9; R.ramp_speed_after_kmh = +(v.telemetry.vf * 3.6).toFixed(0); }
// 8. stuck/recover: spawn upside down, must self-right within 4 s
{ const { sim, v } = fresh([60, 2, -200]); v.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); let t = 0;
  while (t < 5) { sim.step(); t += STEP; } R.recover_upright = up(v) > 0.9; }
// 9. turning circle-ish: full lock at 30 km/h, measure yaw rate & no spin
{ const { sim, v } = fresh([0, 1, -200]); v.body.setLinvel({ x: 0, y: 0, z: 30 / 3.6 }, true); let t = 0, y0 = yawOf(v), turned = 0, prev = y0;
  while (t < 4) { sim.step(); t += STEP; Object.assign(v.input, { throttle: 0.35, steer: 1 }); const y = yawOf(v); let d = y - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turned += d; prev = y; }
  R.lock_turn_deg_4s = +(turned * 57.3).toFixed(0); R.lock_slip_deg = +(v.telemetry.slip * 57.3).toFixed(1); R.lock_ok = Math.abs(turned) > 2.5; }
if (preset === 'Grippy') R.drift_ok = R.drift_ok || (!R.drift_spun && R.drift_slip_sd_deg < 12); // grippy resists drift by design
const pass = ['accel_ok', 'brake_ok', 'drift_ok', 'slalom_no_flip', 'wall_slide_ok', 'wall_upright', 'kerb_ok', 'ramp_land_upright', 'recover_upright', 'lock_ok'].filter((k) => !R[k]);
R.failed = pass; R.class = cls; R.preset = preset;
fs.mkdirSync('tools/out', { recursive: true }); fs.writeFileSync(`tools/out/fungate_${cls}_${preset}.json`, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R));
