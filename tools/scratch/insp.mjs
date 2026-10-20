import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
for (const n of root.listNodes().slice(0,3)) console.log(n.getName(), 'T', n.getTranslation().map(v=>+v.toFixed(3)), 'S', n.getScale(), 'R', n.getRotation().map(v=>+v.toFixed(3)));
const a = root.listAnimations()[0];
for (const ch of a.listChannels()) { const nm = ch.getTargetNode().getName(); if (nm.endsWith('Hips')) { const o = ch.getSampler().getOutput().getArray(); console.log(ch.getTargetPath(), o.length, Array.from(o.slice(0,3)).map(v=>+v.toFixed(2)), Array.from(o.slice(-3)).map(v=>+v.toFixed(2))); } }
const paths = {}; for (const ch of a.listChannels()) paths[ch.getTargetPath()] = (paths[ch.getTargetPath()]||0)+1; console.log(paths);
