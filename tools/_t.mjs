import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const d = await io.read(process.argv[2]);
for (const m of d.getRoot().listMaterials()) { const t = m.getBaseColorTexture(); if (!t) { console.log(m.getName(), 'no tex', m.getBaseColorFactor()); continue; }
  const img = sharp(Buffer.from(t.getImage())); const meta = await img.metadata(); const st = await img.stats();
  console.log(m.getName(), t.getMimeType(), meta.width, 'ch', meta.channels, 'alpha', meta.hasAlpha, 'meanA', st.channels[3]?.mean?.toFixed(1), 'meanRGB', st.channels.slice(0,3).map(c=>c.mean.toFixed(0)).join(','), 'factor', m.getBaseColorFactor().map(x=>+x.toFixed(2)));
}
