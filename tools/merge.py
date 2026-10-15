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
# Zephras Isle (Skyborne start, Forever, uiMap 2521): not in the client map data. Its own landmass west of Kalimdor; size estimated (~5500 yd map)
M['off']['2'] = [0, 0]
ZL, ZR, ZT, ZB = 12500, 7000, 1833, -1834
M['zones']['16593'] = {'n': 'Zephras Isle', 'm': 2, 'b': [ZL, ZR, ZT, ZB], 'lv': '1-12', 'ap': 1, 'city': 0, 'ui': 2521}
zc = lambda px, py: [round(-(ZL - px / 100 * (ZL - ZR)), 1), round(-(ZT - py / 100 * (ZT - ZB)), 1)]
zring = [v for pt in [(47,15),(52,22),(58,26),(68,30),(70,38),(72,48),(72,55),(70,62),(70,75),(68,85),(62,88),(52,88),(45,85),(40,75),(38,62),(32,55),(31,48),(34,38),(35,28),(40,20)] for v in zc(*pt)]
M['geo']['cont']['2'] = {'zones': {'16593': [zring]}, 'coast': [zring]}
M['labels']['16593'] = zc(51, 52)
M['towns'] += [[16593, 42.8, 23.4, 'Thendal Village'], [16593, 41.7, 44.8, "Shen'dar Village"], [16593, 60.0, 81.0, 'Valanaar']]
# Forever dungeons (entrances approximate)
M['dungeons'].update({'16611':{'n':'Ruins of Lordaeron','l':[[85,61.6,69.5]]},'16919':{'n':'The Hall of Thanes','l':[[1537,40.0,56.0]]},'exc':{'n':'Excavation Site: Wetlands','l':[[11,53.2,65.8]]}})
M['dgAreas']=sorted(set(M['dgAreas'])|{16611,16919})
M['fqb'] = json.load(open('fqb.json')); M['fqbRev'] = 'QuestieDB '+json.load(open('fqb_rev.json'))['rev']
try: M['fqw'] = json.load(open('fqw.json'))  # optional local Wowhead lookups, not shipped
except FileNotFoundError: pass
V = json.load(open('vend.json')); M['vend'] = V['vend']; M['trn'] = V['trn']; M['vi'] = V['vi']
M['mobl'] = json.load(open('mobl.json')); M['expl'] = json.load(open('explore.json')); M['gy'] = json.load(open('gy.json')); M['ptrn'] = json.load(open('ptrn.json')); M['tsp'] = json.load(open('tspells.json')); M['money'] = json.load(open('money.json'))
# Camping 101 quests end at a profession trainer: add the ones missing from the trainer list (Zephras Isle etc.)
for qid, q in D['q'].items():
    if not q['n'].startswith('Camping 101: '): continue
    prof = q['n'][13:]
    for nid in q['f']['n']:
        n = D['n'].get(str(nid))
        if n and n.get('p') and str(nid) not in M['ptrn']: M['ptrn'][str(nid)] = [n['n'], prof, n.get('fr') or 'AH', n['p'][:3], n.get('sn') or prof + ' Trainer']
M['taxi'] = json.load(open('taxi_q.json')); M['taxiMig'] = json.load(open('taxi_mig.json'))
flat = code.ravel().astype(int); ch = np.flatnonzero(np.diff(flat)) + 1
st = np.r_[0, ch]; ln = np.diff(np.r_[st, len(flat)])
M['nav']['rle'] = [int(v) for p in zip(flat[st], ln) for v in p]
print('rle', len(M['nav']['rle']))
b = base64.b64encode(gzip.compress(json.dumps(dict(db=D, meta=M), separators=(',', ':')).encode(), 9)).decode()
p = '/home/claude/build/shell_part1.html'; s = open(p).read()
s = re.sub(r'(<script id="bundle"[^>]*>)[^<]*', lambda m: m.group(1) + b, s, 1)
open(p, 'w').write(s); print('bundle', len(b))
