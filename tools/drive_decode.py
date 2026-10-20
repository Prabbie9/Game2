#!/usr/bin/env python3
"""Decode Google Drive download_file_content results (harness spill JSON: {content(base64), id, title, mimeType})
into assets/sources/<kind>/<title>. Verifies size against drive-index.json and the FBX binary header.
Usage: drive_decode.py [spill.txt ...]   (no args: scan the session tool-results dir for new download spills)
Keeps a ledger at assets/sources/.decoded.json so each spill is decoded once. Prints a one-line summary."""
import base64, glob, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/sources')
LEDGER = os.path.join(SRC, '.decoded.json')
idx = {f['id']: f for f in json.load(open(os.path.join(ROOT, 'assets/catalog/drive-index.json')))['files']}
CHAR_PARENT = '1UveBGlu6LtQbpjrmBTf2B43XRG0lNMDo'
paths = sys.argv[1:] or glob.glob('/root/.claude/projects/*/*/tool-results/*download_file_content*.txt')
done = json.load(open(LEDGER)) if os.path.exists(LEDGER) else {}
ok = bad = skip = 0; errs = []
for p in sorted(paths):
    if p in done: skip += 1; continue
    try:
        d = json.load(open(p)); raw = base64.b64decode(d['content'])
    except Exception as e:
        bad += 1; errs.append(f'{os.path.basename(p)}: {e}'); continue
    meta = idx.get(d.get('id'), {})
    kind = 'chars' if meta.get('parent') == CHAR_PARENT else 'clips'
    name = d.get('title') or meta.get('name') or d['id'] + '.fbx'
    want = meta.get('size')
    problems = []
    if want and len(raw) != want: problems.append(f'size {len(raw)}!={want}')
    if not raw.startswith(b'Kaydara FBX Binary'): problems.append('no FBX header')
    if problems: bad += 1; errs.append(f'{name}: ' + ', '.join(problems)); continue
    os.makedirs(os.path.join(SRC, kind), exist_ok=True)
    open(os.path.join(SRC, kind, name), 'wb').write(raw)
    done[p] = d['id']; ok += 1
json.dump(done, open(LEDGER, 'w'))
print(f'decoded {ok} bad {bad} already {skip} total-ok {len(done)}'); [print(' ERR', e) for e in errs[:10]]
