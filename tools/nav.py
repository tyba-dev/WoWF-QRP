"""Build a walkability grid and refined coast/zone polygons from every Forever spawn and patrol path."""
import json, numpy as np
from scipy import ndimage
from skimage import measure
from shapely.geometry import Polygon
from shapely.ops import unary_union, polylabel

M = json.load(open('meta.json'))
N = json.load(open('raw_Npc.json')); O = json.load(open('raw_Object.json'))
Z = {int(k): v for k, v in M['zones'].items()}
OFF = {int(k): v for k, v in M['off'].items()}
CELL = 32
X0, Y0, X1, Y1 = -4800, -12000, 21000, 10200
W = int((X1 - X0) / CELL) + 1; H = int((Y1 - Y0) / CELL) + 1

def plane(z, px, py):
    zz = Z.get(z)
    if not zz or zz.get('city') is None: return None
    L, R, T, B = zz['b']; off = OFF[zz['m']]
    wy = L - px / 100 * (L - R); wx = T - py / 100 * (T - B)
    return (-wy + off[0], -wx + off[1])

def cell(p):
    return int((p[1] - Y0) / CELL), int((p[0] - X0) / CELL)

BG = {2597, 3277, 3358}
spawn = np.zeros((H, W), bool); spawnz = np.zeros((H, W), np.int32)
walk_seg = np.zeros((H, W), bool); road = np.zeros((H, W), bool)
from collections import Counter, defaultdict
zc = defaultdict(Counter)

def raster_line(a, b, grid):
    (r0, c0), (r1, c1) = cell(a), cell(b)
    n = max(abs(r1 - r0), abs(c1 - c0), 1)
    for t in range(n + 1):
        r = round(r0 + (r1 - r0) * t / n); c = round(c0 + (c1 - c0) * t / n)
        if 0 <= r < H and 0 <= c < W: grid[r, c] = True

def add_spawns(sp):
    if not isinstance(sp, dict): return
    for z, lst in sp.items():
        z = int(z)
        if z not in Z or z in BG: continue
        for p in lst:
            if not p or isinstance(p[0], list) or p[0] < 0: continue
            q = plane(z, p[0], p[1])
            if not q: continue
            r, c = cell(q)
            if 0 <= r < H and 0 <= c < W:
                spawn[r, c] = True; zc[(r, c)][z] += 1

def add_wps(wp, friendly):
    if not isinstance(wp, dict): return
    for z, paths in wp.items():
        z = int(z)
        if z not in Z or z in BG: continue
        for path in paths:
            if not path or not isinstance(path[0], list): continue
            pts = [plane(z, p[0], p[1]) for p in path if p[0] >= 0]
            pts = [p for p in pts if p]
            for a, b in zip(pts, pts[1:]):
                if (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 > 220 ** 2: continue
                raster_line(a, b, walk_seg)
                if friendly: raster_line(a, b, road)

for v in N.values():
    add_spawns(v['s']); add_wps(v['w'], bool(v.get('fr')))
for v in O.values():
    add_spawns(v['s'])
goto_road = np.zeros((H, W), bool)
print('grid', W, H, 'spawn cells', spawn.sum(), 'wp cells', walk_seg.sum(), 'road cells', road.sum())

def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]; return x * x + y * y <= r * r

# land (for coastline + rough fallback terrain)
land = ndimage.binary_dilation(spawn | walk_seg, disk(6))
land = ndimage.binary_closing(land, disk(9))
land = ndimage.binary_fill_holes(land)
land = ndimage.gaussian_filter(land.astype(float), 1.5) > 0.5
lab, n = ndimage.label(land); sz = ndimage.sum(land, lab, range(1, n + 1))
for i, s in enumerate(sz):
    if s < 150: land[lab == i + 1] = False

# walkable: close to real spawns/patrols, lightly closed so open fields join up without bridging ridges
walk = ndimage.binary_dilation(spawn, disk(2)) | ndimage.binary_dilation(walk_seg, disk(1))
walk = ndimage.binary_closing(walk, disk(2)) & land
rd = ndimage.binary_dilation(road, disk(1)) & land

code = np.zeros((H, W), np.uint8)
code[land] = 1; code[walk] = 2; code[rd] = 3
print('land', land.sum(), 'walk', walk.sum(), 'road', rd.sum())

# connectivity report between towns using walk/road only
wl, nw = ndimage.label(code >= 2, structure=np.ones((3, 3)))
comp = Counter()
towns = []
for z, x, y, name in M['towns']:
    q = plane(z, x, y)
    if not q: continue
    r, c = cell(q)
    towns.append((name, wl[r, c])); comp[wl[r, c]] += 1
main = comp.most_common(2)
iso = [t for t, l in towns if l not in (main[0][0], main[1][0] if len(main) > 1 else -1)]
print('walk components', nw, 'towns in top-2 comps', sum(v for k, v in main), '/', len(towns), 'isolated:', iso)

# refined zone polygons: nearest-spawn zone label constrained to the zone's exact map rectangle
CAPS = {1519: 12, 1537: 1, 1497: 85, 1637: 14, 1638: 215, 1657: 141}
zl = np.zeros((H, W), np.int32)
for (r, c), cnt in zc.items():
    zl[r, c] = CAPS.get(cnt.most_common(1)[0][0], cnt.most_common(1)[0][0])
# approximate new zones: fill their rect ellipse as before
for aid, z in Z.items():
    if not z.get('ap'): continue
    L, R, T, B = z['b']; off = OFF[z['m']]
    cx = (-(L + R) / 2 + off[0]); cy = (-(T + B) / 2 + off[1]); rx = abs(L - R) / 2 * .8; ry = abs(T - B) / 2 * .8
    yy, xx = np.mgrid[0:H, 0:W]; px = X0 + (xx + .5) * CELL; py = Y0 + (yy + .5) * CELL
    e = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1
    land |= e; zl[e & (zl == 0)] = aid
    code[e & (code == 0)] = 1
empty = zl == 0
_, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
zl = zl[iy, ix]
# constrain to rects: a cell may only belong to a zone whose map rectangle contains it
rect = {}
yy, xx = np.mgrid[0:H, 0:W]; PX = X0 + (xx + .5) * CELL; PY = Y0 + (yy + .5) * CELL
for aid, z in Z.items():
    if z.get('city') or aid in BG: continue
    L, R, T, B = z['b']; off = OFF[z['m']]
    rect[aid] = (PX >= -L + off[0]) & (PX <= -R + off[0]) & (PY >= -T + off[1]) & (PY <= -B + off[1])
bad = np.zeros((H, W), bool)
for aid, m in rect.items():
    bad |= (zl == aid) & ~m
bad &= land
print('cells reassigned by rect constraint', bad.sum())
if bad.any():
    # reassign to the nearest correctly-placed cell of a zone whose rect contains it
    good = land & ~bad
    for aid, m in rect.items():
        pass
    lab2 = zl.copy(); lab2[bad] = 0
    _, (iy2, ix2) = ndimage.distance_transform_edt(lab2 == 0, return_indices=True)
    cand = lab2[iy2, ix2]
    zl[bad] = cand[bad]
zl[~land] = 0
code[(code == 0) & land] = 1

# zone borders are mostly ridges: make a 2-cell band rough unless a road or patrol crosses it
from scipy.ndimage import maximum_filter, minimum_filter
zb = zl.copy(); zb[~land] = -1
bd = (maximum_filter(zb, 3) != minimum_filter(zb, 3)) & land & (minimum_filter(zb, 3) >= 0)
bd = ndimage.binary_dilation(bd, disk(1)) & land
trail = ndimage.binary_dilation(walk_seg, disk(1))
code[bd & (code == 2) & ~trail] = 1
print('border cells made rough', int((bd & (code == 1)).sum()))
# RLE encode codes row-major
flat = code.ravel(); runs = []
cur = int(flat[0]); ln = 0
for v in flat:
    v = int(v)
    if v == cur: ln += 1
    else: runs += [cur, ln]; cur = v; ln = 1
runs += [cur, ln]
nav = dict(x0=X0, y0=Y0, cell=CELL, w=W, h=H, rle=runs)
print('rle length', len(runs))

def to_uv(cc):
    return [(round(X0 + (x + .5) * CELL), round(Y0 + (y + .5) * CELL)) for y, x in cc]

geo = {'cont': {}}
for m in (0, 1):
    off = OFF[m]
    mzones = [a for a, z in Z.items() if z['m'] == m]
    zones = {}
    for a in np.unique(zl):
        if a == 0 or Z.get(int(a), {}).get('m') != m: continue
        mk = ndimage.gaussian_filter((zl == a).astype(float), 0.9)
        polys = []
        for cc in measure.find_contours(np.pad(mk, 1), 0.5):
            cc = cc - 1
            if len(cc) < 8: continue
            p = Polygon(to_uv(cc)).buffer(0)
            if p.area < CELL * CELL * 40: continue
            polys.append(p)
        if not polys: continue
        g = unary_union(polys).simplify(12)
        rings = []
        for p in ([g] if g.geom_type == 'Polygon' else list(g.geoms)):
            if p.geom_type == 'Polygon' and not p.is_empty:
                rings.append([c - (off[0] if i % 2 == 0 else off[1]) for xy in p.exterior.coords for i, c in enumerate(xy)])
        zones[int(a)] = rings
    # coast for this continent: land cells whose zone belongs to this continent
    cm = land & np.isin(zl, mzones)
    lm = ndimage.gaussian_filter(cm.astype(float), 0.9)
    coast = []
    for cc in measure.find_contours(np.pad(lm, 1), 0.5):
        cc = cc - 1
        if len(cc) < 8: continue
        p = Polygon(to_uv(cc)).buffer(0).simplify(8)
        for g in ([p] if p.geom_type == 'Polygon' else list(p.geoms)):
            if g.area > CELL * CELL * 40:
                coast.append([c - (off[0] if i % 2 == 0 else off[1]) for xy in g.exterior.coords for i, c in enumerate(xy)])
    geo['cont'][str(m)] = dict(zones=zones, coast=coast)
    print('cont', m, 'zones', len(zones), 'coast rings', len(coast), 'pts', sum(len(r) for r in coast) // 2)

labels = {}
for m, c in geo['cont'].items():
    for z, rings in c['zones'].items():
        best = max(rings, key=lambda r: Polygon(list(zip(r[0::2], r[1::2]))).area)
        p = polylabel(Polygon(list(zip(best[0::2], best[1::2]))).buffer(0), tolerance=20)
        labels[str(z)] = [round(p.x), round(p.y)]

json.dump(dict(nav=nav, geo=geo, labels=labels), open('nav_out.json', 'w'), separators=(',', ':'))
np.save('code.npy', code)
import os; print('nav_out bytes', os.path.getsize('nav_out.json'))
