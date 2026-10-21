// Post-pass for tools/vehicle_prep.py output: re-encode textures (LOD0 1024, LOD1 256 WebP) and meshopt-compress the
// geometry (quantised + EXT_meshopt_compression). In place, skips files already packed. The runtime dequantises the body
// meshes before merging (carvisual.mergeByMaterial) so dents and the merge work on float positions.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/processed/vehicles');
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort()) {
  const file = path.join(DIR, f); const before = fs.statSync(file).size; const doc = await io.read(file);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) { console.log('skip', f); continue; }
  const size = f.includes('_lod1') ? 256 : 1024;
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 80 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc); console.log(f, (before / 1e6).toFixed(2), '->', (fs.statSync(file).size / 1e6).toFixed(2), 'MB');
}
