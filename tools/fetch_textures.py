#!/usr/bin/env python3
"""Fetch CC0 PBR material sets from ambientCG (2K JPG zips) into assets/sources/textures/<id>/.
Usage: fetch_textures.py slot=query[:AssetId] ...   (explicit AssetId wins; otherwise top Popular match)
Writes assets/catalog/textures.json {slot: assetId} and appends CREDITS rows. Prints one line per slot."""
import json, os, sys, urllib.request, zipfile, io
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/sources/textures'); CAT = os.path.join(ROOT, 'assets/catalog/textures.json')
cat = json.load(open(CAT)) if os.path.exists(CAT) else {}
def api(q, n=8):
    u = f"https://ambientcg.com/api/v2/full_json?type=Material&q={urllib.parse.quote(q)}&limit={n}&sort=Popular&include=downloadData"
    return json.load(get(u, 30))['foundAssets']
import urllib.parse
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) HarbourlineBuild/1.0'}
get = lambda u, t=60: urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t)
credits = []
for arg in sys.argv[1:]:
    slot, rest = arg.split('=', 1); q, _, want = rest.partition(':')
    if slot in cat and os.path.isdir(os.path.join(OUT, cat[slot])): print(slot, 'cached', cat[slot]); continue
    try:
        assets = api(want or q)
        a = next((x for x in assets if x['assetId'] == want), None) if want else assets[0]
        if not a: print(slot, 'NOT FOUND', q, want); continue
        dl = [x for x in a['downloadFolders']['default']['downloadFiletypeCategories']['zip']['downloads'] if x['attribute'] == '2K-JPG']
        if not dl: print(slot, 'no 2K-JPG', a['assetId']); continue
        data = get(dl[0]['fullDownloadPath'], 120).read()
        d = os.path.join(OUT, a['assetId']); os.makedirs(d, exist_ok=True)
        zipfile.ZipFile(io.BytesIO(data)).extractall(d)
        cat[slot] = a['assetId']
        credits.append(f"| {a['assetId']} PBR material ({slot}) | ambientCG (Lennart Demes) | https://ambientcg.com/view?id={a['assetId']} | CC0 1.0 | GREEN |")
        print(slot, a['assetId'], len(data) // 1000, 'KB', sorted(f.split('_')[-1] for f in os.listdir(d))[:7])
    except Exception as e:
        print(slot, 'ERROR', e)
json.dump(cat, open(CAT, 'w'), indent=1)
if credits:
    with open(os.path.join(ROOT, 'CREDITS.md'), 'a') as f: f.write('\n'.join(credits) + '\n')
