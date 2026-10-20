// Inspect candidate character GLBs: skins, joint names (mixamo check), triangles, materials, textures, height.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const NEED = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const bare = (n) => n.replace(/_\d+$/, '').replace(/^.*mixamorig\d*[:_]?/i, '').replace(/^.*:/, '');
for (const f of process.argv.slice(2)) {
  try {
    const doc = await io.read(f); const r = doc.getRoot();
    let tris = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
    const skins = r.listSkins(); const joints = skins.flatMap((s) => s.listJoints().map((j) => j.getName()));
    const names = new Set(joints.map(bare)); const miss = NEED.filter((n) => !names.has(n));
    const tex = r.listTextures().map((t) => { const s = t.getSize(); return s ? `${s[0]}` : '?'; });
    console.log(`${f.split('/').pop().padEnd(18)} tris=${String(tris | 0).padStart(6)} skins=${skins.length} joints=${joints.length} mixamo=${miss.length === 0 ? 'YES' : 'no(' + miss.slice(0, 4).join(',') + ')'} mats=${r.listMaterials().length} tex=${tex.length}[${[...new Set(tex)].join('/')}] anims=${r.listAnimations().length} j0=${joints[0] ?? '-'}`);
  } catch (e) { console.log(f, 'ERR', e.message.slice(0, 120)); }
}
