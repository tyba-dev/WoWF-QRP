"""Vendors (npcFlags & 4) and what they sell (Questie item 'vendors' field), from QuestieDB's Forever data."""
import re, json
Q='/home/claude/QuestieDB/data/Forever/'
def fields(t):
    out=[]; depth=0; cur=''; q=None; esc=False
    for ch in t:
        if q:
            cur+=ch
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch==q: q=None
            continue
        if ch in '"\'': q=ch; cur+=ch; continue
        if ch=='{': depth+=1
        elif ch=='}': depth-=1
        elif ch==',' and depth==0: out.append(cur.strip()); cur=''; continue
        cur+=ch
    out.append(cur.strip()); return out
def rows(p):
    for m in re.finditer(r'^\[(\d+)\] = \{(.*)\},$', open(p, encoding='utf-8', errors='replace').read(), re.M):
        yield int(m.group(1)), fields(m.group(2))
def s(x): return None if x in ('nil','') else x[1:-1].replace("\\'", "'").replace('\\"','"')
def ints(x): return [int(v) for v in re.findall(r'-?\d+', x or '')]
items={}; sells={}
for iid,f in rows(Q+'foreverItemDB.lua'):
    if len(f)>13 and f[13] not in ('nil',''):
        for v in ints(f[13]): sells.setdefault(v,[]).append(iid)
        items[iid]=s(f[0])
vend={}
for nid,f in rows(Q+'foreverNpcDB.lua'):
    fl=int(f[14]) if len(f)>14 and f[14].lstrip('-').isdigit() else 0
    if not fl&4: continue
    sp=[]
    for z,pts in re.findall(r'\[(\d+)\]=\{((?:\{[-\d.]+,[-\d.]+\},?)*)\}', f[6] or ''):
        for x,y in re.findall(r'\{([-\d.]+),([-\d.]+)\}', pts):
            if float(x)>=0: sp.append([int(z),round(float(x),1),round(float(y),1)])
    if not sp: continue
    vend[nid]=[s(f[0]), s(f[13]) if len(f)>13 else None, s(f[12]) if len(f)>12 else None, sp[:4], sorted(sells.get(nid,[]))]
CLS=('Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid')
trn={}
for nid,f in rows(Q+'foreverNpcDB.lua'):
    sub=s(f[13]) if len(f)>13 else None
    if not sub: continue
    m=re.match(r'^(?:\w+ )?(%s) Trainer$'%'|'.join(CLS), sub)
    if not m: continue
    sp=[]
    for z,pts in re.findall(r'\[(\d+)\]=\{((?:\{[-\d.]+,[-\d.]+\},?)*)\}', f[6] or ''):
        for x,y in re.findall(r'\{([-\d.]+),([-\d.]+)\}', pts):
            if float(x)>=0: sp.append([int(z),round(float(x),1),round(float(y),1)])
    if sp: trn[nid]=[s(f[0]), m.group(1), s(f[12]) if len(f)>12 else None, sp[:4]]
print('trainers',len(trn))
used={i for v in vend.values() for i in v[4]}
json.dump(dict(vend=vend, trn=trn, vi={i:items[i] for i in used}), open('vend.json','w'), separators=(',',':'))
print('vendors',len(vend),'with stock',sum(1 for v in vend.values() if v[4]),'items',len(used))
print(vend.get(2115))
