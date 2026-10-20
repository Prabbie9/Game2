#!/usr/bin/env python3
"""Resolve a wave list (clean clip names) to Drive file IDs from clips.json.
Writes tools/waves/<wave>.json [{name,id,size}] and prints missing names + ID list for download calls."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
clips = json.load(open(os.path.join(ROOT, 'assets/catalog/clips.json')))
by = {}
for c in clips:
    k = c['name'].lower().strip()
    if k not in by or (by[k].get('dup') and not c['dup']): by[k] = c
w = sys.argv[1]
names = [l.strip() for l in open(os.path.join(ROOT, f'tools/waves/{w}.txt')) if l.strip() and not l.startswith('#')]
out, miss = [], []
for n in names:
    c = by.get(n.lower())
    (out.append(dict(name=c['name'], id=c['id'], size=c['size'])) if c else miss.append(n))
json.dump(out, open(os.path.join(ROOT, f'tools/waves/{w}.json'), 'w'), indent=0)
print('resolved', len(out), 'missing', miss, 'MB', round(sum(o['size'] for o in out) / 1e6, 1),
      'max KB', max(o['size'] for o in out) // 1000)
