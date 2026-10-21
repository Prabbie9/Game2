// Chunk worker: builds a city chunk (citygen + kit) and merges its geometry per material key into transferable buffers.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildChunk } from './citygen';
onmessage = (e: MessageEvent) => {
  const { id, cx, cz, lod, seed, lean } = e.data; const t0 = performance.now();
  const B = buildChunk(cx, cz, lod, seed, !!lean); const meshes: any[] = []; const transfer: ArrayBuffer[] = [];
  for (const [key, list] of B.geos) { if (!list.length) continue; const g = mergeGeometries(list); if (!g) continue;
    const pos = g.attributes.position.array as Float32Array, nrm = g.attributes.normal.array as Float32Array, uv = g.attributes.uv.array as Float32Array;
    const col = g.attributes.color ? (g.attributes.color.array as Float32Array) : null;
    meshes.push({ key, pos, nrm, uv, col }); transfer.push(pos.buffer as ArrayBuffer, nrm.buffer as ArrayBuffer, uv.buffer as ArrayBuffer); if (col) transfer.push(col.buffer as ArrayBuffer); }
  postMessage({ id, cx, cz, lod, meshes, colliders: B.colliders, lights: B.lights, parked: B.parked, trees: B.trees, steam: B.steam, tlights: B.tlights, ms: performance.now() - t0 }, transfer as any);
};
