#!/usr/bin/env node
// Dynamic quality scaler test. (1) Logic + wiring: feed the live scaler synthetic frame times in-page and check that the
// real render scale, traffic cap and crowd count follow (down under load, back up when it recovers). (2) Natural run:
// normal play on SwiftShader (frames really are slow) for 60 s: the scaler should step down on its own.
// Output: tools/out/scalertest.json
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ev = `(async()=>{const D=HARBOURLINE_DEBUG;const w=(ms)=>new Promise(r=>setTimeout(r,ms));const out={};out.start=D.scaler();
  D.forceFrameMs(1); out.idle=D.scaler(); /* hold the natural loop still while feeding */
  out.down=D.scalerFeed(80,400); out.recover=D.scalerFeed(10,4000); D.forceFrameMs(null);
  const s0=D.scaler().steps.length; await w(60000); out.natural=D.scaler(); out.naturalSteps=out.natural.steps.slice(s0);return JSON.stringify(out)})()`;
const job = [{ url: 'index.html?tier=low', w: 640, h: 360, timeout: 900000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready', eval: ev, evalMax: 6000 }];
const r = execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(job)], { env: process.env, encoding: 'utf8', timeout: 1200000 });
const m = r.match(/"(\{.*\})"/); const v = JSON.parse(JSON.parse('"' + m[1] + '"'));
const checks = { downRes: v.down.res === 0.5 && v.down.resScale === 0.5, downPop: v.down.pop === 0.25, recovered: v.recover.res === 1 && v.recover.pop === 1 && v.recover.resScale === 1, crowdFollows: v.down.crowd < v.start.crowd && v.recover.crowd === v.start.crowd, trafficFollows: v.down.traffic < v.start.traffic && v.recover.traffic === v.start.traffic, naturalStepsDown: v.naturalSteps.some((s) => s.dir === 'down') };
v.checks = checks; v.pass = Object.values(checks).every(Boolean); fs.writeFileSync(path.join(ROOT, 'tools/out/scalertest.json'), JSON.stringify(v, null, 1));
console.log(JSON.stringify({ checks, start: v.start.res + '/' + v.start.pop, down: v.down, recover: v.recover, natural: { res: v.natural.res, pop: v.natural.pop, ema: v.natural.ema, budget: v.natural.budget } }), v.pass ? 'PASS' : 'FAIL');
