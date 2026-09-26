import json, numpy as np, re, gzip, base64, sys
M = json.load(open('meta_full.json')); D = json.load(open('db.json'))
code = np.load('code.npy')
for m in ('0', '1'):
    try: t = np.load(f'code_t{m}.npy')
    except FileNotFoundError: continue
    cont = np.zeros_like(code, bool); X = M['nav']['x0'] + (np.arange(code.shape[1]) + .5) * M['nav']['cell']
    cont[:, (X > 10000) if m == '0' else (X <= 10000)] = True
    old = code.copy(); code[cont] = t[cont]
    G = json.load(open(f'terr_geo_{m}.json')); OG = M['geo']['cont'][m]; OL = dict(M['labels'])
    # zones missing from the client terrain (Forever-only, approximate): keep the old estimate
    for k, z in M['zones'].items():
        if str(z['m']) != m or not z.get('ap') or k in G['geo']['zones'] or k not in OG['zones']: continue
        L, R, T, B = z['b']; off = M['off'][m]; n = M['nav']
        yy, xx = np.mgrid[0:code.shape[0], 0:code.shape[1]]; px = n['x0'] + (xx + .5) * n['cell']; py = n['y0'] + (yy + .5) * n['cell']
        e = (px >= -L + off[0]) & (px <= -R + off[0]) & (py >= -T + off[1]) & (py <= -B + off[1]) & (old > 0)
        code[e] = np.maximum(code[e], old[e])
        G['geo']['zones'][k] = OG['zones'][k]; G['labels'][k] = OL[k]
        for r in OG['coast']:
            xs, ys = r[0::2], r[1::2]; cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            if -L <= cx <= -R and -T <= cy <= -B: G['geo']['coast'].append(r)
        print('kept approximate zone', z['n'])
    M['geo']['cont'][m] = G['geo']
    for k in [k for k, z in M['zones'].items() if str(z['m']) == m]: M['labels'].pop(k, None)
    M['labels'].update(G['labels'])
M['zones']['16591'].update(b=[-2208, -6758, -6533, -9566], ap=0)
M['relief'] = json.load(open('relief.json'))
try: M['fqw'] = json.load(open('fqw.json'))  # optional local Wowhead lookups, not shipped
except FileNotFoundError: pass
V = json.load(open('vend.json')); M['vend'] = V['vend']; M['vi'] = V['vi']
M['taxi'] = json.load(open('taxi_q.json')); M['taxiMig'] = json.load(open('taxi_mig.json'))
flat = code.ravel().astype(int); ch = np.flatnonzero(np.diff(flat)) + 1
st = np.r_[0, ch]; ln = np.diff(np.r_[st, len(flat)])
M['nav']['rle'] = [int(v) for p in zip(flat[st], ln) for v in p]
print('rle', len(M['nav']['rle']))
b = base64.b64encode(gzip.compress(json.dumps(dict(db=D, meta=M), separators=(',', ':')).encode(), 9)).decode()
p = '/home/claude/build/shell_part1.html'; s = open(p).read()
s = re.sub(r'(<script id="bundle"[^>]*>)[^<]*', lambda m: m.group(1) + b, s, 1)
open(p, 'w').write(s); print('bundle', len(b))
