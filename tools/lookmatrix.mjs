#!/usr/bin/env node
// Look matrix for Phase 2: fixed cameras in Downtown (m3_golden camera) and Harbour (m8_harbour camera) x day / night /
// rain, rendered on one tier into shots/look/<label>/, plus a 3x2 contact sheet. Compare two labels side by side with
// tools/sheet.py. Usage: node tools/lookmatrix.mjs <label> [tier=high]
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [label = 'base', tier = 'high'] = process.argv.slice(2); const dir = path.join('shots/look', label); fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
const VIEWS = { downtown: 'm3_golden', harbour: 'm8_harbour' }; const LIGHT = { day: 't=14&w=clear', night: 't=22.5&w=clear', rain: 't=16&w=rain' };
const jobs = []; for (const [v, shot] of Object.entries(VIEWS)) for (const [l, q] of Object.entries(LIGHT))
  jobs.push({ url: `index.html?shot=${shot}&tier=${tier}&${q}`, out: `${dir}/${v}_${l}.png`, w: 1280, h: 720, timeout: 900000, ready: 'window.HARBOURLINE_DEBUG&&HARBOURLINE_DEBUG.ready' });
console.log(execFileSync('node', [path.join(ROOT, 'tools/shoot.mjs'), JSON.stringify(jobs)], { env: process.env, encoding: 'utf8', timeout: 7200000, cwd: ROOT }).trim());
console.log(execFileSync('python3', [path.join(ROOT, 'tools/sheet.py'), `${dir}/sheet.jpg`, '3', '640', ...jobs.map((j) => j.out)], { encoding: 'utf8', cwd: ROOT }).trim());
