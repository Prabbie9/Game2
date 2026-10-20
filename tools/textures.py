#!/usr/bin/env python3
"""Process PBR sets (assets/catalog/textures.json) into KTX2 at 2K and 1K in assets/processed/tex/<slot>/:
albedo (ETC1S sRGB), normal (UASTC+zstd, GL convention), orm (ETC1S: R=AO G=roughness B=metalness), normal UASTC with RDO for small zstd size.
Skips outputs that already exist. Prints a size summary only."""
import json, os, subprocess, glob, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/sources/textures'); OUT = os.path.join(ROOT, 'assets/processed/tex')
KTX = '/opt/tools/KTX-Software-4.3.2-Linux-x86_64'; ENV = dict(os.environ, LD_LIBRARY_PATH=KTX + '/lib')
cat = json.load(open(os.path.join(ROOT, 'assets/catalog/textures.json')))
jobs = []
def find(d, key):
    m = [f for f in glob.glob(os.path.join(d, '*.jpg')) if f.endswith('_' + key + '.jpg')]; return m[0] if m else None
for slot, aid in cat.items():
    d = os.path.join(SRC, aid); o = os.path.join(OUT, slot); os.makedirs(o, exist_ok=True); tmp = os.path.join('/tmp/hl_tex', slot); os.makedirs(tmp, exist_ok=True)
    col, nrm = find(d, 'Color'), find(d, 'NormalGL')
    ao, rough, metal, disp = find(d, 'AmbientOcclusion'), find(d, 'Roughness'), find(d, 'Metalness'), find(d, 'Displacement')
    size = Image.open(col).size
    orm_png = os.path.join(tmp, 'orm.png')
    if not os.path.exists(orm_png):
        ch = lambda p, v: (Image.open(p).convert('L').resize(size) if p else Image.new('L', size, v))
        Image.merge('RGBA', (ch(ao, 255), ch(rough, 200), ch(metal, 0), ch(disp, 128))).save(orm_png)
    for res, tag in ((2048, '2k'), (1024, '1k')):
        rs = ['--resize', f'{res}x{res}'] if size[0] != res else []
        jobs.append((os.path.join(o, f'albedo_{tag}.ktx2'), ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '200', '--genmipmap', '--assign_oetf', 'srgb', *rs], col))
        jobs.append((os.path.join(o, f'normal_{tag}.ktx2'), ['--t2', '--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '3.5', '--uastc_rdo_d', '65536', '--zcmp', '19', '--genmipmap', '--assign_oetf', 'linear', '--assign_primaries', 'none', *rs], nrm))
        jobs.append((os.path.join(o, f'orm_{tag}.ktx2'), ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '220', '--genmipmap', '--assign_oetf', 'linear', '--assign_primaries', 'none', '--target_type', 'RGB', *rs], orm_png))
def run(j):
    out, args, src = j
    if os.path.exists(out) or not src: return None
    r = subprocess.run([KTX + '/bin/toktx', *args, out, src], env=ENV, capture_output=True, text=True)
    return None if r.returncode == 0 else f'{out}: {r.stderr[:200]}'
with ThreadPoolExecutor(4) as ex: errs = [e for e in ex.map(run, jobs) if e]
tot = {t: sum(os.path.getsize(f) for f in glob.glob(os.path.join(OUT, '*', f'*_{t}.ktx2'))) for t in ('2k', '1k')}
print('materials', len(cat), 'errors', len(errs), errs[:3], 'MB 2k', round(tot['2k'] / 1e6, 1), '1k', round(tot['1k'] / 1e6, 1))
