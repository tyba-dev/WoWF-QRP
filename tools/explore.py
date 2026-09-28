"""Subzone (AreaTable id) per 32-yard nav cell from the terrain export, plus names and an estimated exploration level per area."""
import json, re, math, numpy as np, gzip
from tload import load
M=json.load(open('meta_full.json')); OFF=M['off']; nav=M['nav']; X0,Y0,CELL,W,H=nav['x0'],nav['y0'],nav['cell'],nav['w'],nav['h']
C=33.333333; ORG=17066.667; N=1024
FILES={'0':'/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/f31004ba-azeroth_terrain.bin.gz','1':'/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/651cdfbf-kalimdor_terrain.bin.gz'}
G=np.zeros((H,W),np.int32)
yy,xx=np.mgrid[0:H,0:W]; PX=X0+(xx+.5)*CELL; PY=Y0+(yy+.5)*CELL
for MAP,FN in FILES.items():
    a,I,J=load(FN); area=np.zeros((N,N),np.int32); area[I,J]=a['area']
    off=OFF[MAP]; wy=off[0]-PX; wx=off[1]-PY
    ci=np.floor((ORG-wx)/C).astype(int); cj=np.floor((ORG-wy)/C).astype(int)
    inb=(ci>=0)&(ci<N)&(cj>=0)&(cj<N); ci=np.clip(ci,0,N-1); cj=np.clip(cj,0,N-1)
    cont=(PX>10000) if MAP=='0' else (PX<=10000)
    m=inb&cont; G[m]=area[ci,cj][m]
# names from Questie's subzone table (comments "Name -> Parent"), parents too
names={}; parent={}
for f in ['/home/claude/QuestieDB/support/Forever/Zones/subZoneToParentZone.lua','/home/claude/QuestieDB/support/Zones/subZoneToParentZone.lua']:
    for m in re.finditer(r'\[(\d+)\]\s*=\s*(\d+),\s*--\s*(.*?)\s*->\s*(.*)$',open(f,encoding='utf-8',errors='replace').read(),re.M):
        a_,p_=int(m.group(1)),int(m.group(2)); names.setdefault(a_,m.group(3).strip()); parent.setdefault(a_,p_); names.setdefault(p_,m.group(4).strip())
for k,z in M['zones'].items(): names.setdefault(int(k),z['n'])
# area level: average level of hostile mobs spawning inside the area; else parent zone's level range
mob=json.load(open('mobl.json')); mc=mob['c']
lv_sum={}; lv_n={}
ids=np.unique(G); ids=ids[ids>0]
cellarea={}
for key,(lv,cnt) in mob['cells'].items():
    x,y=map(int,key.split(',')); cx=(x+.5)*mc; cy=(y+.5)*mc
    gx=int((cx-X0)/CELL); gy=int((cy-Y0)/CELL)
    if 0<=gx<W and 0<=gy<H:
        a_=int(G[gy,gx])
        if a_>0: lv_sum[a_]=lv_sum.get(a_,0)+lv*cnt; lv_n[a_]=lv_n.get(a_,0)+cnt
def zrange(a_):
    p=a_
    for _ in range(5):
        z=M['zones'].get(str(p))
        if z and z.get('lv'):
            m=re.match(r'(\d+)\s*-\s*(\d+)',str(z['lv']))
            if m: return int(m.group(1)),int(m.group(2))
        if p not in parent: break
        p=parent[p]
    return None
def zlev(a_):
    r=zrange(a_); return r[0] if r else None
areas={}
for a_ in ids.tolist():
    lv=round(lv_sum[a_]/lv_n[a_]) if a_ in lv_n else zlev(a_)
    r=zrange(a_)
    if lv and r: lv=max(r[0],min(r[1],lv))
    areas[a_]=[names.get(a_,'Area %d'%a_), lv or 0]
# RLE rows
flat=G.ravel().tolist(); runs=[]; cur=flat[0]; ln=0
for v in flat:
    if v==cur: ln+=1
    else: runs+= [cur,ln]; cur=v; ln=1
runs+=[cur,ln]
json.dump({'rle':runs,'areas':areas},open('explore.json','w'),separators=(',',':'))
print('areas',len(areas),'named',sum(1 for v in areas.values() if not v[0].startswith('Area ')),'with level',sum(1 for v in areas.values() if v[1]),'runs',len(runs)//2)
print({k:areas[k] for k in (154,157,159,85,152,156) if k in areas})
