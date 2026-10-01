"""Questie (QuestieDB master) Forever generated delta-base -> fqb.json (Forever quests for the planner)
and new/updated NPC + object spawns merged into db.json. Run from /home/claude/work."""
import re, json, subprocess
QD='/home/claude/QuestieDB'; REV='origin/master'
def show(p): return subprocess.run(['git','-C',QD,'show',f'{REV}:{p}'],capture_output=True,text=True,check=True).stdout
def enum(src, name):
    m=re.search(name+r'\s*=\s*\{(.*?)\n\s*\}',src,re.S); return {k:int(v) for k,v in re.findall(r'(\w+)\s*=\s*(-?\d+)',m.group(1))}
exp=show('src/corrections/enum/expansions.lua')
fev=exp[exp.index('Forever = {'):]
RACE=enum(fev,'raceKeys'); CLS=enum(exp,'classKeys')
ZONE={k:int(v) for k,v in re.findall(r'^\s*(\w+)\s*=\s*(-?\d+),',show('src/corrections/enum/zones.lua'),re.M)}
SORT=enum(show('src/corrections/enum/quests.lua'),'constants.sortKeys')
ENV={'raceIDs':RACE,'classIDs':CLS,'zoneIDs':ZONE,'sortKeys':SORT}
# --- tiny Lua literal parser ---
TOK=re.compile(r'\s*(?:(--[^\n]*)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?)|(\w+(?:\.\w+)*)|(\[|\]|\{|\}|=|,|\+|-))')
def toks(s):
    i=0; out=[]
    while i<len(s):
        m=TOK.match(s,i)
        if not m:
            if s[i:].strip()=='' : break
            raise ValueError(s[i:i+50])
        i=m.end()
        if m.group(1): continue
        if m.group(2) is not None: out.append(('s',json.loads(m.group(2))))
        elif m.group(3) is not None: out.append(('n',float(m.group(3)) if '.' in m.group(3) else int(m.group(3))))
        elif m.group(4) is not None: out.append(('id',m.group(4)))
        elif m.group(5): out.append(('p',m.group(5)))
    return out
class P:
    def __init__(s,t): s.t=t; s.i=0
    def pk(s): return s.t[s.i] if s.i<len(s.t) else (None,None)
    def nx(s): v=s.t[s.i]; s.i+=1; return v
    def expect(s,v): t=s.nx(); assert t==('p',v),(t,v,s.t[s.i-5:s.i+5])
    def val(s):
        v=s.term()
        while s.pk() in (('p','+'),('p','-')):
            op=s.nx()[1]; w=s.term(); v=v+w if op=='+' else v-w
        return v
    def term(s):
        k,v=s.nx()
        if k in('s','n'): return v
        if k=='id':
            if v=='nil': return None
            if v in('true','false'): return v=='true'
            a,b=v.split('.',1); return ENV[a][b]
        if v=='{': return s.table()
        if v=='-': return -s.term()
        raise ValueError((k,v))
    def table(s):
        arr=[]; d={}; n=1
        while s.pk()!=('p','}'):
            if s.pk()==('p','['):
                s.nx(); key=s.val(); s.expect(']'); s.expect('='); d[key]=s.val()
            elif s.pk()[0]=='id' and s.t[s.i+1]==('p','=') and '.' in s.pk()[1]:
                key=s.nx()[1]; s.nx(); d[key]=s.val()
            else: d[n]=s.val(); n+=1
            if s.pk()==('p',','): s.nx()
        s.nx(); return d
def load(t, keysName):
    src=show(f'src/corrections/Forever/generated/foreverBase{t}.lua')
    body=src[src.index('return {')+len('return '):]
    body=body[:body.rindex('end')]
    body=re.sub(keysName+r'\.(\w+)',lambda m:'"'+m.group(1)+'"',body)
    p=P(toks(body)); p.expect('{'); return p.table()
def arr(d):
    if not isinstance(d,dict): return d
    n=max([k for k in d if isinstance(k,int)],default=0); return [arr(d.get(i)) for i in range(1,n+1)]
CLASSIC=0xFFFF
D=json.load(open('db.json'))
# ---- NPCs / objects: names, levels, spawns
def spawns(sp):
    out=[]
    for z,lst in (sp or {}).items():
        for p in arr(lst) or []:
            if p and len(p)>=2 and p[0] is not None and p[0]>=0: out.append([int(z),round(p[0],1),round(p[1],1)])
    return out
added={'n':0,'o':0,'nsp':0}
NPC=load('Npc','npcKeys')
for nid,r in NPC.items():
    k=str(nid); e=D['n'].get(k)
    sp=spawns(r.get('spawns'))
    if e is None:
        if not sp: continue
        e=D['n'][k]={'n':r.get('name') or f'NPC {nid}','p':sp}; added['n']+=1
        if r.get('minLevel'): e['l']=[r['minLevel'],r.get('maxLevel') or r['minLevel']]
        f=r.get('friendlyToFaction');
        if f: e['fr']=f
    else:
        if r.get('name'): e['n']=r['name']
        if sp: e['p']=sp; added['nsp']+=1
OBJ=load('Object','objectKeys')
for oid,r in OBJ.items():
    k=str(oid); sp=spawns(r.get('spawns'))
    if k not in D['o'] and sp: D['o'][k]={'n':r.get('name') or f'Object {oid}','p':sp}; added['o']+=1
    elif k in D['o'] and sp: D['o'][k]['p']=sp
# ---- quests
Q=load('Quest','questKeys'); fqb={}; upd=0
def grp(v):
    a=arr(v) or []; return [[x for x in (arr(g) or []) if x is not None] for g in (a+[None,None])[:2]]
for qid,r in Q.items():
    k=str(qid); q=D['q'].get(k)
    if q is not None:  # corrections to quests Questie already had
        if 'requiredLevel' in r: q['r']=r['requiredLevel']
        if 'questLevel' in r: q['l']=r['questLevel']
        if 'requiredRaces' in r and r['requiredRaces']: q['ra']=r['requiredRaces']&CLASSIC
        if 'requiredClasses' in r and r['requiredClasses']: q['cl']=r['requiredClasses']
        for key,f in (('startedBy','s'),('finishedBy','f')):
            if key in r: n,o=grp(r[key]); q[f]['n']=n; q[f]['o']=o
        if 'startedBy_add' in r: n,o=grp(r['startedBy_add']); q['s']['n']=sorted(set(q['s']['n']+n)); q['s']['o']=sorted(set(q['s']['o']+o))
        upd+=1; continue
    s=grp(r.get('startedBy')); f=grp(r.get('finishedBy'))
    ot=arr(r.get('objectivesText')) or []
    fqb[k]=[r.get('name') or f'Quest {qid}', r.get('questLevel') or 0, r.get('requiredLevel') or 0, ((r.get('requiredRaces') or 0)&CLASSIC) or (-1 if r.get('requiredRaces') else 0), r.get('requiredClasses') or 0, s[0], s[1], f[0], f[1], ' '.join(x for x in ot if x), r.get('zoneOrSort') or 0]
# NPCs/objects the Forever quests start/end at that db.json doesn't carry yet: name from the base DB, spawns from the raw dump
RN=json.load(open('raw_Npc.json')); RO=json.load(open('raw_Object.json'))
def names(path):
    out={}
    for m in re.finditer(r"^\[(\d+)\] = \{'((?:\\.|[^'\\])*)'(?:,(\w+),(\w+),(\w+),(\w+))?",open(QD+'/'+path,encoding='utf-8',errors='replace').read(),re.M):
        out[m.group(1)]=(m.group(2).replace("\\'","'"),m.group(5),m.group(6))
    return out
NN=names('data/Forever/foreverNpcDB.lua'); ON=names('data/Forever/foreverObjectDB.lua')
def rawp(r): return [[int(z),round(p[0],1),round(p[1],1)] for z,l in (r.get('s') or {}).items() for p in l if isinstance(p,list) and len(p)==2 and isinstance(p[0],(int,float))]
ext={'n':0,'o':0}
for v in fqb.values():
    for t,ids,R,NM in (('n',v[5]+v[7],RN,NN),('o',v[6]+v[8],RO,ON)):
        for i in ids:
            k=str(i)
            if D[t].get(k,{}).get('p'): continue
            r=R.get(k); p=rawp(r) if r else []
            if not p: continue
            e=D[t].setdefault(k,{'n':NM.get(k,(f'NPC {i}',))[0]}); e['p']=p
            if t=='n':
                nm=NM.get(k)
                if nm and nm[1] and nm[1].isdigit(): e['l']=[int(nm[1]),int(nm[2])]
                if r.get('fr'): e['fr']=r['fr']
            ext[t]+=1
print('extra spawns from raw dump',ext)
json.dump(D,open('db.json','w'),separators=(',',':'))
json.dump(fqb,open('fqb.json','w'),separators=(',',':'))
rev=subprocess.run(['git','-C',QD,'rev-parse','--short',REV],capture_output=True,text=True).stdout.strip()
json.dump({'rev':rev},open('fqb_rev.json','w'))
print('forever quests',len(fqb),'updated questie quests',upd,added,'rev',rev)
