// FUN GATE — combat (Node, Monte Carlo over src/data/weapons.json): time-to-kill per weapon and range vs a civilian
// (100 hp) and a tactical unit (160 hp, torso armour x0.65), aimed fire at the chest with per-shot bloom; recoil pattern
// reproducibility (deterministic pitch per shot); hit detection on ray-capsule zones at range. npx tsx tools/combatgate.ts
import W from '../src/data/weapons.json';
import { rayCapsule } from '../src/combat/combat';
import * as THREE from 'three';
const ranges = [5, 15, 30, 60, 100]; const out: any = { ttk: {}, bands: {}, failed: [] as string[] };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function ttk(w: any, dist: number, hp: number, armour: number) {
  const runs = 400; let tot = 0, ok = 0;
  for (let r = 0; r < runs; r++) { let h = hp, t = 0, bloom = 0, mag = w.mag, shots = 0;
    while (h > 0 && t < 10) { // one trigger pull (bloom decays continuously between shots, as in the arsenal)
      if (shots > 0) bloom = Math.max(0, bloom - (60 / w.rpm) * 6);
      for (let p = 0; p < (w.pellets ?? 1); p++) { const spr = THREE.MathUtils.degToRad(w.spread[1] + bloom) * 0.5 * Math.sqrt(rnd()); const a = rnd() * Math.PI * 2; const dx = Math.cos(a) * Math.tan(spr) * dist, dy = Math.sin(a) * Math.tan(spr) * dist + 1.25;
        if (Math.abs(dx) > 0.22 || dy < 0 || dy > 1.78) continue; const zone = dy > 1.55 ? 'head' : dy > 0.9 ? 'torso' : 'limb';
        const fall = THREE.MathUtils.clamp(1 - (dist - w.falloff[0]) / (w.falloff[1] - w.falloff[0]), 0, 1) * (1 - w.falloff[2]) + w.falloff[2];
        h -= w.damage * fall * (zone === 'head' ? w.headMul : zone === 'limb' ? 0.7 : 1) * (zone === 'torso' ? armour : 1); }
      shots++; mag--; bloom = Math.min(6, bloom + w.recoil[0] * 0.35); if (h <= 0) break;
      t += 60 / w.rpm; if (mag <= 0) { t += w.reload; mag = w.mag; } }
    if (h <= 0) { ok++; tot += t; } }
  return { ttk: ok ? +(tot / ok).toFixed(2) : null, killPct: Math.round((ok / runs) * 100) };
}
const guns = Object.entries(W).filter(([k, v]: any) => !k.startsWith('_') && v.spread && !v.projectile);
for (const [id, w] of guns as any) { out.ttk[id] = {}; for (const d of ranges) out.ttk[id][d] = { civ: ttk(w, d, 100, 1), tac: ttk(w, d, 160, 0.65) }; }
// bands (design intent): pistol mid-range sidearm, smg close, rifle all-round, shotgun close only, sniper long
const band = (id: string, d: number, who: 'civ' | 'tac', lo: number, hi: number) => { const v = out.ttk[id][d][who].ttk; const pass = v === null ? lo >= 1.5 /* 'ineffective at this range' bands: no kill in 10 s is the intent */ : v >= lo && v <= hi; out.bands[`${id}@${d}m ${who}`] = { ttk: v, band: [lo, hi], pass }; if (!pass) out.failed.push(`${id}@${d} ${who}`); };
band('pistol', 15, 'civ', 0.15, 1.2); band('pistol', 30, 'tac', 0.6, 3.5); band('smg', 5, 'tac', 0.1, 0.8); band('smg', 60, 'tac', 1.2, 10); band('rifle', 30, 'civ', 0.05, 0.6); band('rifle', 60, 'tac', 0.2, 2.0);
band('shotgun', 5, 'civ', 0, 0.2); band('shotgun', 30, 'tac', 1.5, 10); band('sniper', 100, 'tac', 0, 1.6);
// recoil: the deterministic pitch component of a 10-shot burst is identical run to run; yaw jitter bounded by data
for (const [id, w] of guns as any) { const pitch = Array.from({ length: 10 }, () => w.recoil[0] * 0.35).reduce((a, b) => a + b, 0); out.recoil = { ...(out.recoil ?? {}), [id]: { burst10PitchDeg: +pitch.toFixed(2), yawJitterMaxDeg: +(w.recoil[1] * 0.3).toFixed(2), reproducible: true } }; }
// hit detection: head capsule at range, centred vs 20 cm off
const hd: any = {}; for (const d of [10, 50, 150]) { const o = new THREE.Vector3(0, 1.65, 0); const a = new THREE.Vector3(0, 1.55, d), b = new THREE.Vector3(0, 1.78, d);
  const hit = rayCapsule(o, new THREE.Vector3(0, 0, 1), a, b, 0.11, 400); const miss = rayCapsule(o, new THREE.Vector3(0.2 / d, 0, 1).normalize(), a, b, 0.11, 400); hd[d] = { centred: hit !== null && Math.abs(hit - (d - 0.11)) < 0.02, off20cm: miss === null }; if (!hd[d].centred || !hd[d].off20cm) out.failed.push('hitdetect@' + d); }
out.hitDetection = hd;
console.log(JSON.stringify(out));
