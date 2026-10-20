#!/usr/bin/env python3
"""Merge Google Drive search_files result pages (harness spill JSON files or saved inline JSON)
into assets/catalog/drive-index.json, deduped by file ID. Prints only counts + the last page's token.
Usage: drive_index.py [--parent-name NAME=ID ...] page.json [page.json ...]"""
import json, sys, os, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/catalog/drive-index.json')
args = sys.argv[1:]
idx = {}
if os.path.exists(OUT):
    for f in json.load(open(OUT))['files']:
        idx[f['id']] = f
last_tok = None; pages = 0
for p in args:
    for path in sorted(glob.glob(p)):
        try:
            d = json.load(open(path))
        except Exception as e:
            print('skip', path, e); continue
        if 'files' not in d: continue
        pages += 1
        for f in d['files']:
            idx[f['id']] = dict(id=f['id'], name=f.get('title'), size=int(f.get('fileSize', 0) or 0),
                                mime=f.get('mimeType'), parent=f.get('parentId'), modified=f.get('modifiedTime'))
        last_tok = d.get('nextPageToken')
files = sorted(idx.values(), key=lambda f: (f['parent'] or '', f['name'] or ''))
json.dump({'folder': 'Mixamo Animations', 'folderId': '1EEE9K89wnqsCae86tSGU-OfidZIGW-bW', 'files': files},
          open(OUT, 'w'), indent=0)
from collections import Counter
print('pages merged', pages, 'unique', len(files), 'by parent', dict(Counter(f['parent'][:8] for f in files)))
print('folders', [f['name'] for f in files if f['mime'] == 'application/vnd.google-apps.folder'])
if last_tok: open('/tmp/drive_next_token', 'w').write(last_tok); print('next token saved, len', len(last_tok))
