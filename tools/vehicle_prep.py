# VEHICLE PREP TOOL (Blender headless). Sourced car model -> game-ready GLB + metadata.
#   blender -b -P tools/vehicle_prep.py -- in.glb out_dir name target_length
# Steps: flatten hierarchy (apply transforms), detect the four wheels (node names, else geometry clusters near the
# bottom corners), orient forward = glTF +Z, normalise to target length, ground at y=0, wheel pivots at wheel centres,
# keep part names (lights/doors/hood/trunk/glass) for damage + lighting, decimate a LOD1, downsize textures (WebP 1024).
# Writes <name>.glb, <name>_lod1.glb and <name>.json {length,width,height, wheels:[{name,center,radius,width}], parts}.
import bpy, bmesh, sys, json, re, math, os
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]; src, out, name, target = a[0], a[1], a[2], float(a[3])
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects: o.select_set(False)
# flatten: unparent keeping world transform, apply transforms
for o in meshes:
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in [x for x in bpy.context.scene.objects if x.type != 'MESH']: bpy.data.objects.remove(o)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
WHEEL = re.compile(r'wheel|tire|tyre|rim', re.I)
def corner_rx(a, b):  # a = front/rear words, b = left/right words; tolerant of _ separators
    return re.compile(r'(?<![a-z])(' + a[0] + b[0] + r'|' + a[1] + r'[ _.-]?' + b[1] + r'|' + b[1] + r'[ _.-]?' + a[1] + r')(?![a-z])', re.I)
CORNER = {'FL': corner_rx(('f', 'front'), ('l', 'left')), 'FR': corner_rx(('f', 'front'), ('r', 'right')), 'RL': corner_rx(('r', 'rear'), ('l', 'left')), 'RR': corner_rx(('r', 'rear'), ('r', 'right')),
          'RL2': corner_rx(('b', 'back'), ('l', 'left')), 'RR2': corner_rx(('b', 'back'), ('r', 'right'))}
wheels = {}
for o in meshes:
    if not WHEEL.search(o.name) or re.search(r'steer', o.name, re.I): continue
    for k, rx in CORNER.items():
        if rx.search(o.name.split('.')[0]): wheels.setdefault(k[:2], []).append(o); break
lo, hi = bbox(meshes); size = hi - lo
fwd_axis = 0 if size.x >= size.y else 1  # Blender horizontal axis along the car length
if len(wheels) == 4:
    fc = (bbox(wheels['FL'])[0] + bbox(wheels['FL'])[1]) / 2
    rc = (bbox(wheels['RL'])[0] + bbox(wheels['RL'])[1]) / 2
    front_sign = 1 if (fc - rc)[fwd_axis] > 0 else -1
else:
    front_sign = 1; print('WARN wheels not found by name:', list(wheels))
# rotate so the car's front points to Blender -Y (= glTF +Z)
ang = {(0, 1): -math.pi / 2, (0, -1): math.pi / 2, (1, 1): math.pi, (1, -1): 0.0}[(fwd_axis, front_sign)]
R = Matrix.Rotation(ang, 4, 'Z')
lo, hi = bbox(meshes); c = (lo + hi) / 2
for o in meshes: o.matrix_world = R @ Matrix.Translation(-Vector((c.x, c.y, lo.z))) @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
lo, hi = bbox(meshes); s = target / (hi.y - lo.y) if target > 0 else 1.0
for o in meshes: o.matrix_world = Matrix.Scale(s, 4) @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
lo, hi = bbox(meshes)
# wheels: join each corner, origin at its bbox centre
meta_wheels = []
for k in ['FL', 'FR', 'RL', 'RR']:
    objs = wheels.get(k, [])
    if not objs: continue
    for o in bpy.context.scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    w = bpy.context.view_layer.objects.active; w.name = 'wheel_' + k
    wl, wh = bbox([w]); wc = (wl + wh) / 2
    bpy.context.scene.cursor.location = wc; bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    meta_wheels.append({'name': k, 'center': [round(wc.x, 4), round(wc.z, 4), round(-wc.y, 4)], 'radius': round((wh.z - wl.z) / 2, 4), 'width': round(wh.x - wl.x, 4)})
parts = sorted(o.name for o in bpy.context.scene.objects if o.type == 'MESH')
# texture budget: downscale images to <= 1024
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, max(1, int(img.size[1] * 1024 / img.size[0])))
def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='WEBP', export_apply=True, export_yup=True, export_animations=False)
export(os.path.join(out, name + '.glb'))
tris = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
# LOD1: decimate everything to ~35% (wheels to 50%)
for o in [x for x in bpy.context.scene.objects if x.type == 'MESH']:
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = 0.5 if o.name.startswith('wheel_') else 0.35
export(os.path.join(out, name + '_lod1.glb'))
meta = {'name': name, 'length': round(hi.y - lo.y, 3), 'width': round(hi.x - lo.x, 3), 'height': round(hi.z - lo.z, 3), 'wheels': meta_wheels, 'parts': parts, 'faces': tris, 'scale': round(s, 4)}
json.dump(meta, open(os.path.join(out, name + '.json'), 'w'), indent=1)
print('PREP', json.dumps({k: meta[k] for k in ['length', 'width', 'height', 'faces']}), 'wheels', [(w['name'], w['center'], w['radius']) for w in meta_wheels])
