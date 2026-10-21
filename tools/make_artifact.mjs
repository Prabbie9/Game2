#!/usr/bin/env node
// Post-build: derive the Artifact-hosted variant from dist/.
// - dist/artifact.html: the game page without doctype/html/head/body (the Artifact host wraps it).
// - dist/delivery.html: standalone delivery test (own doctype, paths relative to the artifact root).
// - dist/artifact-files.json: { publishedPath: localPath } for every file the page needs (excludes test pages).
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const D = path.join(ROOT, 'dist');
let html = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
const title = (html.match(/<title>.*?<\/title>/s) || ['<title>Harbourline</title>'])[0];
const head = (html.match(/<head>(.*?)<\/head>/s) || ['', ''])[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>|<title>.*?<\/title>/gs, '');
const body = (html.match(/<body>(.*?)<\/body>/s) || ['', ''])[1];
fs.writeFileSync(path.join(D, 'artifact.html'), `${title}\n<script>window.HL_B64=true</script>\n<style>html,body{height:100%;margin:0;background:#05070a}:root{padding:0!important}</style>\n${head.trim()}\n${body.trim()}\n`);
let del = fs.readFileSync(path.join(ROOT, 'tests/delivery/index.html'), 'utf8').replaceAll('../../test/', 'test/').replace('<script type="module">', '<script>window.HL_B64=true</script><script type="module">');
fs.writeFileSync(path.join(D, 'delivery.html'), del);
// Artifact hosting serves only web media types; other binaries ship as base64 JSON ({b64}) next to the original path.
const SERVED = /\.(html|css|js|mjs|wasm|json|map|txt|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm|pdf)$/i;
const files = {}; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const rel = path.relative(D, p); if (/_2k\.ktx2/.test(rel)) continue;
  if (fs.statSync(p).isDirectory()) { if (!/^(tests|protob)$/.test(rel)) walk(p); } else if (!/^(index|artifact)\.html$|artifact-files\.json$|\.b64\.json$/.test(rel)) {
    if (SERVED.test(rel)) files[rel] = path.relative(ROOT, p);
    else { const out = p + '.b64.json'; fs.writeFileSync(out, JSON.stringify({ b64: fs.readFileSync(p).toString('base64') })); files[rel + '.b64.json'] = path.relative(ROOT, out); }
  } } };
walk(D); for (const k of Object.keys(files)) if (/(^|\/)proto/.test(k) || /_2k\.ktx2/.test(k) || /^test\//.test(k) || k === 'delivery.html') delete files[k]; // delivery test retired after M0
fs.writeFileSync(path.join(D, 'artifact-files.json'), JSON.stringify(files, null, 1));
// publish map: current files + null for anything the last publish had that no longer exists (keeps the artifact tidy)
const manPath = path.join(ROOT, 'tools/artifact_manifest.json'); const prev = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : [];
const pub = { ...files }; for (const k of prev) if (!(k in pub)) pub[k] = null;
fs.writeFileSync(path.join(D, 'artifact-publish.json'), JSON.stringify(pub));
// one publish call carries at most 64 MB: split into batches (characters separately) for consecutive publishes to the same URL
const split = (pred) => Object.fromEntries(Object.entries(pub).filter(([k]) => pred(k)));
const big = (k) => /^data\/(chars|vehicles|props)\//.test(k);
fs.writeFileSync(path.join(D, 'artifact-publish-a.json'), JSON.stringify(split((k) => !big(k))));
fs.writeFileSync(path.join(D, 'artifact-publish-c.json'), JSON.stringify(split((k) => /^data\/(vehicles|props)\//.test(k))));
fs.writeFileSync(path.join(D, 'artifact-publish-b.json'), JSON.stringify(split((k) => k.startsWith('data/chars/'))));
const bytes = Object.values(files).reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0);
console.log('artifact files', Object.keys(files).length, 'MB', (bytes / 1e6).toFixed(1));
