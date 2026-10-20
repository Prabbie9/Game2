import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const pr = (n, d) => { if (d > 3) return; console.log(' '.repeat(d * 2) + n.getName(), 'T', n.getTranslation().map((v) => +v.toFixed(2)), 'R', n.getRotation().map((v) => +v.toFixed(3)), 'S', n.getScale().map((v) => +v.toFixed(3))); for (const c of n.listChildren()) pr(c, d + 1); };
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) pr(n, 0);
