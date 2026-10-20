#!/usr/bin/env python3
"""Sketchfab helper (auth injected by the environment proxy; no key handled here).

  sketchfab.py search "query" [--lic by,cc0] [--n 24] [--anim]   -> table of candidates (licence-filtered)
  sketchfab.py info UID                                           -> licence + stats
  sketchfab.py get UID NAME [--role char]                         -> download GLB to assets/sources/sketchfab/<NAME>.glb,
                                                                     record in ledger + CREDITS.md (refuses RED / duplicates)
Ledger (committed): assets/catalog/sketchfab-ledger.json — never fetch the same uid twice, cap 150 downloads.
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request, zipfile, io

API = 'https://api.sketchfab.com/v3'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(ROOT, 'assets/catalog/sketchfab-ledger.json')
OUT = os.path.join(ROOT, 'assets/sources/sketchfab')
CAP = 150
GREEN = {'cc0', 'by'}; AMBER = {'by-sa', 'by-nc', 'by-nc-sa'}
CTX = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or ('/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None))


def req(url, raw=False, tries=5):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'harbourline-assets/1.0'}), context=CTX, timeout=120)
            data = r.read(); return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500: time.sleep(2 ** (i + 1)); continue
            raise
    raise RuntimeError('backoff exhausted: ' + url)


def ledger():
    return json.load(open(LEDGER)) if os.path.exists(LEDGER) else {'downloads': []}


def lic_slug(m):
    l = m.get('license') or {}
    if isinstance(l, dict) and l.get('slug'): return l['slug'].lower()
    t = (l.get('label') if isinstance(l, dict) else str(l) or '').lower()
    if 'cc0' in t or 'public domain' in t: return 'cc0'
    if 'attribution' not in t: return t or '?'
    return 'by' + ('-nc' if 'noncommercial' in t.replace('-', '').replace(' ', '') else '') + ('-sa' if 'sharealike' in t.replace('-', '').replace(' ', '') else '') + ('-nd' if 'noderiv' in t.replace('-', '').replace(' ', '') else '')


def tier(slug):
    return 'GREEN' if slug in GREEN else 'AMBER' if slug in AMBER else 'RED'


def search(q, lic='by,cc0', n=24, anim=False):
    out = []
    for l in lic.split(','):
        p = {'type': 'models', 'q': q, 'downloadable': 'true', 'license': l, 'count': n, 'sort_by': '-likeCount'}
        if anim: p['animated'] = 'true'
        r = req(API + '/search?' + urllib.parse.urlencode(p))
        out += r.get('results', [])
    seen = {d['uid'] for d in ledger()['downloads']}
    for m in out:
        print(f"{m['uid']}  {lic_slug(m):6} f={m.get('faceCount', 0):>7} anim={m.get('animationCount', 0):<3} {'GOT ' if m['uid'] in seen else ''}{m['name'][:60]}  @{m['user']['username']}")


def info(uid):
    m = req(f'{API}/models/{uid}')
    print(json.dumps({k: m.get(k) for k in ('uid', 'name', 'faceCount', 'vertexCount', 'animationCount', 'isDownloadable', 'viewerUrl')} | {'license': lic_slug(m), 'tier': tier(lic_slug(m)), 'author': m['user']['username'], 'tags': [t['name'] for t in m.get('tags', [])][:12]}, indent=1))
    return m


def get(uid, name, role='asset'):
    L = ledger()
    if any(d['uid'] == uid for d in L['downloads']): sys.exit(f'already fetched {uid}')
    if len(L['downloads']) >= CAP: sys.exit('download cap reached')
    m = req(f'{API}/models/{uid}'); slug = lic_slug(m); t = tier(slug)
    if t == 'RED': sys.exit(f'refused: licence {slug} is RED')
    d = req(f'{API}/models/{uid}/download')
    os.makedirs(OUT, exist_ok=True); dst = os.path.join(OUT, name + '.glb')
    if 'glb' in d:
        open(dst, 'wb').write(req(d['glb']['url'], raw=True))
    else:  # gltf zip fallback: keep the zip; conversion happens in prep
        dst = os.path.join(OUT, name + '.zip'); open(dst, 'wb').write(req(d['gltf']['url'], raw=True))
    url = m.get('viewerUrl') or f'https://sketchfab.com/3d-models/{uid}'; author = m['user']['username']
    L['downloads'].append({'uid': uid, 'name': m['name'], 'file': os.path.basename(dst), 'author': author, 'licence': slug, 'tier': t, 'url': url, 'role': role, 'date': time.strftime('%Y-%m-%d')})
    json.dump(L, open(LEDGER, 'w'), indent=1)
    with open(os.path.join(ROOT, 'CREDITS.md'), 'a') as f:
        f.write(f"| {m['name']} (uid {uid}) — {role} | {author} | {url} | {slug.upper()} | {t} |\n")
    print(f'ok {dst} {os.path.getsize(dst) / 1e6:.1f}MB {slug} {t}  ({len(L["downloads"])}/{CAP})')


if __name__ == '__main__':
    a = sys.argv[1:]; opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    if a[0] == 'search': search(a[1], opt('--lic', 'by,cc0'), int(opt('--n', 24)), '--anim' in a)
    elif a[0] == 'info': info(a[1])
    elif a[0] == 'get': get(a[1], a[2], opt('--role', 'asset'))
