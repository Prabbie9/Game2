#!/usr/bin/env python3
"""Build assets/catalog/clips.json + chars.json from drive-index.json with category guesses.
Merges fetched metadata (assets/catalog/clipmeta.json, written by ingest) when present.
Prints counts and a category summary only. `catalog.py grep REGEX` lists matching clean names."""
import json, os, re, sys
from collections import Counter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = lambda *p: os.path.join(ROOT, 'assets/catalog', *p)
idx = json.load(open(C('drive-index.json')))['files']
CHAR_PARENT = '1UveBGlu6LtQbpjrmBTf2B43XRG0lNMDo'
THEMED = re.compile(r'zombie|torch|bow\b|sword|axe\b|magic|spell|fantasy|mutant|monster|great ?sword|shield|wizard|orc|ninja|katana|spear|staff|hammer|archer', re.I)
RULES = [  # first match wins
 ('vehicle', r'\bcar\b|driv|steer|vehicle|seat'),
 ('death', r'death|dying|\bdie|\bdead|killed'),
 ('getup', r'get(ting)? ?up|stand(ing)? up|getting up'),
 ('hit', r'hit|impact|react|stagger|knock|flinch|shot\b|getting shot'),
 ('swim', r'swim|tread|wad'),
 ('climb', r'climb|vault|ledge|hang|braced|parkour|wall run|over obstacle|jump over'),
 ('jump', r'jump|fall|land|leap'),
 ('throw', r'throw|toss|grenade'),
 ('melee', r'punch|kick|melee|bat\b|stab|knife|combo|boxing|fight|uppercut|hook|jab|elbow|knee|block|dodge'),
 ('pistol', r'pistol|handgun'),
 ('rifle', r'rifle|gun|shoot|firing|reload|aim|sniper|shotgun'),
 ('crouch', r'crouch|sneak|prone|crawl'),
 ('panic', r'panic|flee|terrified|scared|cower|run away'),
 ('turn', r'turn'),
 ('strafe', r'strafe'),
 ('loco', r'walk|run|jog|sprint|stop|start|idle|step'),
 ('civil', r'talk|wave|clap|cheer|phone|text|sit|lean|look|point|argu|dance|wait|yell|laugh|shrug|stretch|salute|bored|thinking|nod|agree|greet'),
]
def clean(n): return re.sub(r'\.fbx$', '', n)
def cat(n):
    for c, r in RULES:
        if re.search(r, n, re.I): return c
    return 'misc'
meta = json.load(open(C('clipmeta.json'))) if os.path.exists(C('clipmeta.json')) else {}
clips, chars = [], []
for f in idx:
    if f['mime'] == 'application/vnd.google-apps.folder': continue
    e = dict(name=clean(f['name']), id=f['id'], size=f['size'])
    if f['parent'] == CHAR_PARENT: chars.append(e); continue
    e['category'] = cat(e['name']); e['themed'] = bool(THEMED.search(e['name']))
    e['dup'] = bool(re.search(r'\(\d+\)$', e['name']))
    e.update(meta.get(f['id'], {}))
    clips.append(e)
if len(sys.argv) > 2 and sys.argv[1] == 'grep':
    rx = re.compile(sys.argv[2], re.I)
    out = [c['name'] for c in clips if rx.search(c['name']) and not c['themed'] and not c['dup']]
    print(len(out), '|', '; '.join(sorted(out))); sys.exit()
json.dump(clips, open(C('clips.json'), 'w'), indent=0)
json.dump(chars, open(C('chars.json'), 'w'), indent=0)
print('clips', len(clips), 'chars', len(chars), 'themed', sum(c['themed'] for c in clips), 'dup', sum(c['dup'] for c in clips))
print(dict(Counter(c['category'] for c in clips if not c['themed']).most_common()))
