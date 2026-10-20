# Blender headless: FBX -> GLB, animation range taken from the imported action (fixes clips whose FBX take span is wrong).
# blender -b -P tools/blender_fbx2glb.py -- in.fbx out.glb
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=a[0], automatic_bone_orientation=False, ignore_leaf_bones=True)
acts = list(bpy.data.actions)
if acts:
    s, e = acts[0].frame_range; bpy.context.scene.frame_start, bpy.context.scene.frame_end = int(s), int(e)
bpy.context.scene.render.fps = 30
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', export_animations=True, export_force_sampling=True, export_frame_range=True, export_anim_single_armature=True, export_skins=False)
print('FRAMES', bpy.context.scene.frame_start, bpy.context.scene.frame_end)
