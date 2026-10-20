#!/usr/bin/env node
// Smoke test: builds nothing; runs every named shot/page in tools/shots.json headless and fails on console errors.
import { execFileSync } from 'node:child_process';
try { execFileSync('node', [new URL('./shoot.mjs', import.meta.url).pathname, new URL('./shots.json', import.meta.url).pathname], { stdio: 'inherit' }); console.log('SMOKE PASS'); }
catch { console.log('SMOKE FAIL'); process.exit(1); }
