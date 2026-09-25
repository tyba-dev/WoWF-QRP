#!/usr/bin/env python3
"""
Shrink exported WoW ADT terrain tiles into a small terrain summary for the Forever Route Planner.

Usage:
    python adt_to_terrain.py "C:\\path\\to\\wow.export\\maps"

Also writes <MapName>_heights.bin.gz: every terrain vertex the game has (145 per chunk: a 9x9 grid
4.2 yards apart plus the 8x8 centre points), to 1/16 yard, and the fine 8x8 hole mask. This is the
full native resolution of the ground mesh (a few tens of MB per continent).

Reads every root tile (e.g. Kalimdor_32_48.adt; *_obj0/_tex0/_lod files are skipped) and writes one
<MapName>_terrain.bin.gz per continent into the current folder. Each 33-yard terrain chunk becomes a
44-byte record: zone (AreaTable) id, position, height range, how much of it is too steep to walk,
terrain holes, and water type/level. Needs only Python 3, no extra packages.
"""
import gzip, math, os, re, struct, sys
from collections import defaultdict

REC = struct.Struct('<BBBBIIfffffBBHHfBB')   # 44 bytes per chunk
HHEAD = struct.Struct('<HHiQ')               # chunk row, chunk col, base height (1/16 yd), 8x8 hole bits; then 145 int16 residuals
QUAD = 33.3333333 / 8                         # yards between terrain vertices
T50, T35 = math.tan(math.radians(50)), math.tan(math.radians(35))

def chunks(buf, start, end):
    o = start
    while o + 8 <= end:
        magic = buf[o:o + 4][::-1].decode('ascii', 'replace'); size = struct.unpack_from('<I', buf, o + 4)[0]
        yield magic, o + 8, size
        o += 8 + size

def pack_heights(row, col, pz, heights, flags, hi_holes, lo_holes):
    # outer 9x9 predicted from left (or above for column 0); inner 8x8 predicted from its 4 corners
    q = [round((pz + h) * 16) for h in heights]
    O = lambda r, c: q[r * 17 + c]
    res = []
    for r in range(9):
        for c in range(9):
            pred = O(r, c - 1) if c else (O(r - 1, 0) if r else O(0, 0))
            res.append(O(r, c) - pred)
    for r in range(8):
        for c in range(8):
            pred = (O(r, c) + O(r, c + 1) + O(r + 1, c) + O(r + 1, c + 1) + 2) // 4
            res.append(q[r * 17 + 9 + c] - pred)
    res = [max(-32768, min(32767, v)) for v in res]
    if flags & 0x10000: holes = hi_holes
    else:
        holes = 0
        for b in range(16):
            if lo_holes >> b & 1:
                r, c = (b // 4) * 2, (b % 4) * 2
                for rr in (r, r + 1):
                    for cc in (c, c + 1): holes |= 1 << (rr * 8 + cc)
    return HHEAD.pack(row, col, O(0, 0), holes) + struct.pack('<145h', *res)

def parse_mh2o(buf, data):
    out = {}
    for i in range(256):
        ofs_inst, layers, _ = struct.unpack_from('<III', buf, data + i * 12)
        if not layers or not ofs_inst: continue
        ltype, lvf, hmin, hmax, xo, yo, w, h, _, _ = struct.unpack_from('<HHffBBBBII', buf, data + ofs_inst)
        out[i] = (ltype, hmax if abs(hmax) < 1e5 else hmin, min(64, w * h))
    return out

def parse_tile(path, tx, ty):
    buf = open(path, 'rb').read(); recs = []; water = {}; hts = []
    for magic, data, size in chunks(buf, 0, len(buf)):
        if magic == 'MH2O' and size >= 256 * 12:
            try: water = parse_mh2o(buf, data)
            except struct.error: water = {}
        elif magic == 'MCNK':
            flags, cx, cy = struct.unpack_from('<III', buf, data)
            hi_holes = struct.unpack_from('<Q', buf, data + 0x14)[0]
            area = struct.unpack_from('<I', buf, data + 0x34)[0]
            lo_holes = struct.unpack_from('<H', buf, data + 0x3C)[0]
            size_liq = struct.unpack_from('<I', buf, data + 0x64)[0]
            px, py, pz = struct.unpack_from('<fff', buf, data + 0x68)
            holes = 0 if flags & 0x10000 else lo_holes
            if flags & 0x10000 and hi_holes:   # fold 8x8 high-res holes into the 4x4 low-res mask
                holes = 0
                for r in range(8):
                    row = (hi_holes >> (r * 8)) & 0xFF
                    for c in range(8):
                        if row >> c & 1: holes |= 1 << ((r // 2) * 4 + c // 2)
            heights = None
            for sm, sd, ss in chunks(buf, data + 128, data + size):
                if sm == 'MCVT' and ss >= 145 * 4: heights = struct.unpack_from('<145f', buf, sd)
            steep50 = steep35 = 0; hmin = hmax = pz
            if heights:
                outer = [[pz + heights[r * 17 + c] for c in range(9)] for r in range(9)]
                flat = [h for row in outer for h in row]; hmin, hmax = min(flat), max(flat)
                for r in range(8):
                    for c in range(8):
                        dx = (outer[r][c + 1] - outer[r][c] + outer[r + 1][c + 1] - outer[r + 1][c]) / 2 / QUAD
                        dy = (outer[r + 1][c] - outer[r][c] + outer[r + 1][c + 1] - outer[r][c + 1]) / 2 / QUAD
                        g = math.hypot(dx, dy)
                        if g > T50: steep50 += 1
                        if g > T35: steep35 += 1
            lt, lh, cov = water.get(cy * 16 + cx, (0, 0.0, 0))
            if not lt and size_liq > 8: lt, cov = 255, 64      # old-style MCLQ water
            recs.append(REC.pack(tx, ty, cx, cy, area, flags, px, py, pz, hmin, hmax, steep50, steep35, holes, lt, lh, cov, 0))
            if heights:
                hts.append(pack_heights(ty * 16 + cy, tx * 16 + cx, pz, heights, flags, hi_holes, lo_holes))
    return recs, hts

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    pat = re.compile(r'^(.+?)_(\d+)_(\d+)\.adt$', re.I)
    by_map = defaultdict(list); bad = 0
    for d, _, files in os.walk(root):
        for f in files:
            m = pat.match(f)
            if not m or re.search(r'_(obj|tex|lod)\d*\.adt$', f, re.I): continue
            try: by_map[m.group(1)].append((int(m.group(2)), int(m.group(3)), os.path.join(d, f)))
            except ValueError: pass
    if not by_map: print('No root .adt files found under', root); return
    for name, tiles in by_map.items():
        out = []; hout = []; n = 0
        for i, (tx, ty, path) in enumerate(sorted(tiles)):
            try: recs, hts = parse_tile(path, tx, ty); out += recs; hout += hts; n += 1
            except Exception as e: bad += 1; print('  could not read', os.path.basename(path), '-', e)
            if i % 50 == 0: print(f'{name}: {i}/{len(tiles)} tiles', end='\r')
        fn = f'{name}_terrain.bin.gz'
        with gzip.open(fn, 'wb', 9) as fh: fh.write(b''.join(out))
        print(f'{name}: {n} tiles, {len(out)} chunks -> {fn} ({os.path.getsize(fn) // 1024} KB)')
        fh2 = f'{name}_heights.bin.gz'
        with gzip.open(fh2, 'wb', 9) as fh: fh.write(b'HGT2' + b''.join(hout))
        print(f'{name}: heights -> {fh2} ({os.path.getsize(fh2) // 1024} KB)')
    if bad: print(bad, 'tiles could not be read')

if __name__ == '__main__':
    main()
