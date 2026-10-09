"""Merge Questie's combined Forever data (QuestieDB tools/export-forever.lua --include-authored, converted to JSON by tojson.lua)
into db.json: new Forever quests become full quests (objectives, prerequisites, givers), with the entities they need.
Run from /home/claude/work after: lua tojson.lua for Quest/Npc/Object/Item into fq2/. Start from db.pre_fqb.json."""
import json, statistics, sys
D=json.load(open('db.pre_fqb.json')); F='fq2/'
Q=json.load(open(F+'Quest.json')); N=json.load(open(F+'Npc.json')); O=json.load(open(F+'Object.json')); I=json.load(open(F+'Item.json'))
CL=0xFFFF
def g(r,i): return r[i] if i<len(r) else None
def arr(v): return [x for x in (v or []) if x is not None] if isinstance(v,list) else ([v] if isinstance(v,(int,float)) else [])
def grp(v,n=3):
    v=v if isinstance(v,list) else []; return [arr(v[k]) if k<len(v) else [] for k in range(n)]
def spawns(sp):
    out=[]
    if isinstance(sp,list): sp={str(i+1):l for i,l in enumerate(sp) if l}
    if isinstance(sp,dict):
        for z,l in sp.items():
            for p in l or []:
                if isinstance(p,list) and len(p)>=2 and isinstance(p[0],(int,float)) and p[0]>=0: out.append([int(z),round(p[0],1),round(p[1],1)])
    return out
# XP estimate per quest level (median of Questie's Classic XP), Forever XP isn't in Questie yet
by={}
for q in D['q'].values():
    if q.get('xp') and q['xp'][1]: by.setdefault(q['xp'][0],[]).append(q['xp'][1])
med={L:int(statistics.median(v)) for L,v in by.items()}
need={'n':set(),'o':set(),'i':set()}
def objs(o):
    if not isinstance(o,list): return None
    out={}
    c=[[x[0],g(x,1)] for x in (g(o,0) or []) if isinstance(x,list) and x]
    ob=[[x[0],g(x,1)] for x in (g(o,1) or []) if isinstance(x,list) and x]
    it=[[x[0],g(x,1)] for x in (g(o,2) or []) if isinstance(x,list) and x]
    rp=g(o,3); kc=[[arr(x[0]),g(x,1),g(x,2)] for x in (g(o,4) or []) if isinstance(x,list) and x]
    if c: out['c']=c
    if ob: out['o']=ob
    if it: out['i']=it
    if isinstance(rp,list) and rp: out['r']=rp
    if kc: out['k']=kc
    for x in c: need['n'].add(x[0])
    for x in ob: need['o'].add(x[0])
    for x in it: need['i'].add(x[0])
    for x in kc: need['n'].update(x[0])
    return out or None
new=0; upd=0; sky=0
for k,r in Q.items():
    if k in D['q']:
        q=D['q'][k]; ch=False
        for idx,key in ((12,'ps'),(11,'pg'),(15,'ex')):
            v=arr(g(r,idx))
            if v and v!=q.get(key): q[key]=v; ch=True
        nx=g(r,21)
        if isinstance(nx,int) and nx and nx!=q.get('nx'): q['nx']=nx; ch=True
        sn,so,si=grp(g(r,1)); fn,fo,_=grp(g(r,2))
        for lst,key in ((sn,('s','n')),(so,('s','o')),(fn,('f','n')),(fo,('f','o'))):
            cur=q[key[0]][key[1]]; add=[x for x in lst if x not in cur]
            if add: q[key[0]][key[1]]=cur+add; ch=True; need['n' if key[1]=='n' else 'o'].update(add)
        upd+=ch; continue
    name=g(r,0)
    if not name: continue
    ra=g(r,5) or 0; rac=(ra&CL) if ra else 0
    if ra and not rac: rac=1<<20; sky+=1   # Skyborne-only: no classic race can take it
    sn,so,si=grp(g(r,1)); fn,fo,_=grp(g(r,2)); ql=g(r,4) or g(r,3) or 1; rl=g(r,3) or max(1,ql-4)
    q={'n':name,'l':ql,'r':rl,'s':{'n':sn,'o':so,'i':si},'f':{'n':fn,'o':fo},'z':g(r,16) or 0,'fv':1}
    if rac: q['ra']=rac
    if g(r,6): q['cl']=g(r,6)
    t=' '.join(x for x in arr(g(r,7)) if isinstance(x,str) and x.strip())
    if t: q['t']=t
    o=objs(g(r,9))
    if o: q['o']=o
    te=g(r,8)
    if isinstance(te,list) and te and isinstance(te[0],str): q['te']=[te[0],spawns(g(te,1))]
    for idx,key in ((12,'ps'),(11,'pg'),(15,'ex'),(20,'rs')):
        v=arr(g(r,idx))
        if v: q[key]=v
    if isinstance(g(r,21),int) and g(r,21): q['nx']=g(r,21)
    if isinstance(g(r,17),list) and g(r,17): q['sk']=g(r,17)
    if isinstance(g(r,22),int) and g(r,22)&8: q['sh']=1
    if g(r,23): q['sf']=g(r,23)
    if g(r,26): q['bc']=g(r,26)
    if g(r,31): q['mx']=g(r,31)
    if ql in med: q['xp']=[ql,med[ql]]; q['xe']=1
    D['q'][k]=q; new+=1
    need['n'].update(sn+fn); need['o'].update(so+fo); need['i'].update(si)
# items -> their drop sources
for iid in list(need['i']):
    r=I.get(str(iid))
    if not r: continue
    e=D['i'].setdefault(str(iid),{'n':g(r,0) or f'Item {iid}'})
    d=arr(g(r,1)); od=arr(g(r,2)); v=arr(g(r,13))
    if d: e['d']=d; need['n'].update(d)
    if od: e['od']=od; need['o'].update(od)
    if v and 'v' not in e: e['v']=v; need['n'].update(v)
    if isinstance(g(r,4),int) and g(r,4): e['sq']=g(r,4)
added={'n':0,'o':0}
for nid in need['n']:
    k=str(nid); r=N.get(k)
    if not r: continue
    sp=spawns(g(r,6)); e=D['n'].get(k)
    if e is None:
        if not sp: continue
        e=D['n'][k]={'n':g(r,0) or f'NPC {nid}','p':sp}; added['n']+=1
        if g(r,3): e['l']=[g(r,3),g(r,4) or g(r,3)]
        if g(r,12): e['fr']=g(r,12)
        if g(r,13): e['sn']=g(r,13)
    elif sp and not e.get('p'): e['p']=sp
for oid in need['o']:
    k=str(oid); r=O.get(k)
    if not r: continue
    sp=spawns(g(r,3))
    if k not in D['o'] and sp: D['o'][k]={'n':g(r,0) or f'Object {oid}','p':sp}; added['o']+=1
    elif k in D['o'] and sp and not D['o'][k].get('p'): D['o'][k]['p']=sp
json.dump(D,open('db.json','w'),separators=(',',':'))
print('new forever quests',new,'(skyborne-only',sky,') updated',upd,'added',added)
