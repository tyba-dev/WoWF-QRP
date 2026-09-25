"""Merge ADT terrain summary into nav grid + zone polygons for one continent."""
import json, sys, numpy as np, collections
from scipy import ndimage
from tload import load
M = json.load(open('meta_full.json')); Z = M['zones']; OFF = M['off']
par = {int(k): v for k, v in json.load(open('par.json')).items()}
nav = M['nav']; X0, Y0, CELL, W, H = nav['x0'], nav['y0'], nav['cell'], nav['w'], nav['h']
code = np.load('code.npy')
MAP = sys.argv[1] if len(sys.argv) > 1 else '0'
FN = sys.argv[2] if len(sys.argv) > 2 else '/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/f31004ba-azeroth_terrain.bin.gz'
off = OFF[MAP]; C = 33.333333; ORG = 17066.667
a, I, J = load(FN)
def top(x):
    s = set()
    while x in par and x not in s: s.add(x); x = par[x]
    return x
# chunk grids
N = 1024
has = np.zeros((N, N), bool); area = np.zeros((N, N), np.int32)
s50 = np.zeros((N, N), np.uint8); sub = np.zeros((N, N), bool); sea = np.zeros((N, N), bool)
has[I, J] = True; area[I, J] = [top(int(x)) for x in a['area']]; s50[I, J] = a['s50']
dep = a['ll'] - a['hmax']
sub[I, J] = (a['lt'] > 0) & (dep > 1.5)
sea[I, J] = (a['lt'] == 1250) & (dep > 1.5)
# grid cell -> chunk
yy, xx = np.mgrid[0:H, 0:W]
PX = X0 + (xx + .5) * CELL; PY = Y0 + (yy + .5) * CELL
wy = off[0] - PX; wx = off[1] - PY
ci = np.floor((ORG - wx) / C).astype(int); cj = np.floor((ORG - wy) / C).astype(int)
inb = (ci >= 0) & (ci < N) & (cj >= 0) & (cj < N)
ci = np.clip(ci, 0, N - 1); cj = np.clip(cj, 0, N - 1)
cont = (PX > 10000) if MAP == '0' else (PX <= 10000)
g_has = inb & has[ci, cj] & cont
g_sea = g_has & sea[ci, cj]; g_sub = g_has & sub[ci, cj] & ~g_sea
g_s = s50[ci, cj]; g_area = np.where(g_has, area[ci, cj], 0)
# ocean: large connected sea component; small sea pockets count as swim
lab, n = ndimage.label(g_sea); sz = ndimage.sum(g_sea, lab, range(1, n + 1))
big = np.isin(lab, 1 + np.flatnonzero(sz > 400))
t = np.full((H, W), 2, np.uint8)
t[g_s >= 12] = 1; t[g_s >= 36] = 0
t[g_sub & (t > 0)] = 1
t[g_sub & (t == 0)] = 1
t[g_sea & ~big] = 1
t[big] = 0; t[~g_has] = 0
# evidence from spawns/trails (old grid walk) rescues steep chunks; roads survive where terrain is passable
old = code.copy(); R = np.load('raw_masks.npz')
trail = (R['walk_seg'] | R['goto'] | R['road']) & cont
ev = (R['spawn'] | trail) & g_has
t[R['spawn'] & (t == 0) & ~big] = 1
t[trail & (t <= 1)] = 2
t[(old == 3) & (t >= 1) & ~g_sub] = 3
# unknown top-level areas without evidence -> rough
known = np.isin(g_area, [int(k) for k in Z]) 
unk = g_has & ~known & ~big
labu, nu = ndimage.label(unk)
for k in range(1, nu + 1):
    m = labu == k
    if m.sum() > 150 and ev[m].mean() < .02: t[m & (t == 2)] = 1
new = code.copy(); new[cont] = t[cont]
print('cells', cont.sum(), 'terrain', g_has.sum(), 'sea', big.sum(), 'old/new walk', ((old >= 2) & cont).sum(), ((new >= 2) & cont).sum(),
      'cliff', ((t == 0) & g_has & ~big).sum(), 'rough', (t == 1).sum())
np.save(f'code_t{MAP}.npy', new)
np.save(f'garea_{MAP}.npy', np.where(big | ~g_has, -1, g_area))
# ---- zones & coast from terrain area ids
from skimage import measure
from shapely.geometry import Polygon
from shapely.ops import unary_union, polylabel
CAPS = {1519: 12, 1537: 1, 1497: 85, 1637: 14, 1638: 215, 1657: 141}
ga = np.where(big | ~g_has | ~cont, -1, g_area)
ga = np.vectorize(lambda v: CAPS.get(v, v))(ga)
land = ga >= 0
known = np.isin(ga, [int(k) for k, z in Z.items() if z['m'] == int(MAP) and not z.get('city')])
zl = np.where(known, ga, 0)
# unknown pockets: big evidence-free ones stay unzoned, the rest join the nearest zone
lu, nu = ndimage.label(land & ~known)
keep0 = np.zeros_like(land)
for k in range(1, nu + 1):
    m = lu == k
    if m.sum() > 150 and ev[m].mean() < .02: keep0 |= m
_, (iy, ix) = ndimage.distance_transform_edt(zl == 0, return_indices=True)
land = ndimage.binary_dilation(land, np.ones((3, 3)), iterations=2)  # generous: fine coast comes from the relief mask
_, (iy, ix) = ndimage.distance_transform_edt(zl == 0, return_indices=True)
zl = np.where(land & ~keep0, zl[iy, ix], 0)
def to_uv(cc):
    return [(round(X0 + (x + .5) * CELL), round(Y0 + (y + .5) * CELL)) for y, x in cc]
def rings_of(mask, simp, minA):
    mk = ndimage.gaussian_filter(mask.astype(float), 0.8); out = []
    for cc in measure.find_contours(np.pad(mk, 1), 0.5):
        cc = cc - 1
        if len(cc) < 6: continue
        p = Polygon(to_uv(cc)).buffer(0)
        for g in ([p] if p.geom_type == 'Polygon' else list(p.geoms)):
            if g.area >= minA: out.append(g)
    return out
def flat(g, s):
    g = g.simplify(s)
    return [round(c - (off[0] if i % 2 == 0 else off[1])) for xy in g.exterior.coords for i, c in enumerate(xy)]
zones = {}
for z in np.unique(zl):
    if z <= 0: continue
    ps = rings_of(zl == z, 10, CELL * CELL * 30)
    if not ps: continue
    u = unary_union(ps)
    zones[str(z)] = [flat(g, 10) for g in ([u] if u.geom_type == 'Polygon' else u.geoms) if not g.is_empty]
lo = ndimage.binary_opening(land, np.ones((3, 3))) | (land & ndimage.binary_dilation(R['spawn'], np.ones((3, 3))))
coast = [flat(g, 6) for g in rings_of(lo, 6, CELL * CELL * 8)]
labels = {}
for z, rings in zones.items():
    best = max(rings, key=lambda r: Polygon(list(zip(r[0::2], r[1::2]))).area)
    p = polylabel(Polygon(list(zip(best[0::2], best[1::2]))).buffer(0), tolerance=20)
    labels[z] = [round(p.x), round(p.y)]
print('zones', len(zones), 'coast rings', len(coast), 'pts', sum(len(r) for r in coast) // 2 + sum(len(r) for v in zones.values() for r in v) // 2)
json.dump(dict(geo=dict(zones=zones, coast=coast), labels=labels), open(f'terr_geo_{MAP}.json', 'w'))
