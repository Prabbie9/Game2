// Physics worker: owns the Rapier world (SimCore). Main thread sends commands + "step n" ticks; worker replies with snapshots.
import RAPIER from '@dimforge/rapier3d-compat';
import { SimCore } from './simcore';
let sim: SimCore | null = null;
const queue: any[] = [];
async function boot(gravity: number) { await RAPIER.init(); sim = new SimCore(RAPIER, gravity); for (const m of queue.splice(0)) handle(m); postMessage({ type: 'ready' }); }
function handle(m: any) {
  if (!sim) { queue.push(m); return; }
  switch (m.type) {
    case 'static': for (const s of m.list) sim.addStatic(s); break;
    case 'group': sim.addGroup(m.gid, m.list); break;
    case 'removeGroup': sim.removeGroup(m.gid); break;
    case 'dynamic': for (const d of m.list) sim.addDynamic(d.id, d); break;
    case 'spawnVehicle': sim.spawnVehicle(m.id, m.tuning, m.pos, m.yaw); break;
    case 'removeVehicle': sim.removeVehicle(m.id); break;
    case 'spawnChar': sim.spawnChar(m.id, m.pos); break;
    case 'removeChar': sim.removeChar(m.id); break;
    case 'teleportChar': sim.chars.get(m.id)?.teleport(m.pos); break;
    case 'tuning': sim.setTuning(m.id, m.tuning); break;
    case 'teleportVehicle': { const v = sim.vehicles.get(m.id); if (v) { v.body.setTranslation({ x: m.pos[0], y: m.pos[1], z: m.pos[2] }, true); v.body.setRotation({ x: 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2) }, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true); } break; }
    case 'velocity': { const v = sim.vehicles.get(m.id); v?.body.setLinvel({ x: m.v[0], y: m.v[1], z: m.v[2] }, true); break; }
    case 'gravity': sim.world.gravity = { x: 0, y: m.g, z: 0 }; break;
    case 'step': {
      if (m.inputs) for (const id in m.inputs) sim.setInput(+id, m.inputs[id]);
      if (m.charInputs) for (const id in m.charInputs) sim.setCharInput(+id, m.charInputs[id]);
      for (let i = 0; i < m.n; i++) sim.step();
      const s = sim.snapshot(); postMessage({ type: 'snap', ...s, time: sim.time }, [s.buf.buffer] as any); break;
    }
  }
}
onmessage = (e) => { const m = e.data; if (m.type === 'init') boot(m.gravity ?? -9.81); else handle(m); };
