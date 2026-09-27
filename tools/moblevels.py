"""Average hostile mob level per 150-yard cell (normal + rare mobs, no elites/bosses/friendlies/vendors), for travel-kill XP."""
import json, re, math
from vendors import rows, s as lstr
Q='/home/claude/QuestieDB/data/Forever/'
M=json.load(open('meta_full.json')); Z=M['zones']; OFF=M['off']
def plane(z,px,py):
    zz=Z.get(str(z))
    if not zz or zz.get('city') is None: return None
    L,R,T,B=zz['b']; off=OFF[str(zz['m'])] if str(zz['m']) in OFF else OFF[zz['m']]
    wy=L-px/100*(L-R); wx=T-py/100*(T-B); return (-wy+off[0], -wx+off[1])
C=150; acc={}; n=0
for nid,f in rows(Q+'foreverNpcDB.lua'):
    if len(f)<15: continue
    fr=f[12].strip(); fl=f[14].strip()
    if fr not in ('nil','') : continue           # friendly to someone
    if fl not in ('nil','','0'): continue          # vendors, trainers, quest givers...
    try: lo,hi=int(f[3]),int(f[4]); rank=int(f[5]) if f[5] not in('nil','') else 0
    except ValueError: continue
    if rank in (1,2,3) or hi<1: continue           # elites / rare elites / bosses
    lv=(lo+hi)/2
    for z,pts in re.findall(r'\[(\d+)\]=\{((?:\{[-\d.]+,[-\d.]+\},?)*)\}', f[6] or ''):
        for x,y in re.findall(r'\{([-\d.]+),([-\d.]+)\}', pts):
            if float(x)<0: continue
            p=plane(int(z),float(x),float(y))
            if not p: continue
            k=f"{math.floor(p[0]/C)},{math.floor(p[1]/C)}"; a=acc.setdefault(k,[0,0]); a[0]+=lv; a[1]+=1; n+=1
cells={k:[round(v[0]/v[1],1),v[1]] for k,v in acc.items()}
json.dump({'c':C,'cells':cells},open('mobl.json','w'),separators=(',',':'))
print('spawns',n,'cells',len(cells))
