"""Add Questie's requiredSourceItems (items you must loot before an objective can be done, e.g. Samuel's Remains)
to db.json as q['rs'], plus the items' drop sources and those NPCs/objects if they're missing."""
import json, re
from vendors import rows, fields, s as lstr, ints
Q='/home/claude/QuestieDB/data/Forever/'
D=json.load(open('db.json'))
items={i:f for i,f in rows(Q+'foreverItemDB.lua')}
npcs={i:f for i,f in rows(Q+'foreverNpcDB.lua')}
objs={i:f for i,f in rows(Q+'foreverObjectDB.lua')}
def spawns(txt):
    out=[]
    for z,pts in re.findall(r'\[(\d+)\]=\{((?:\{[-\d.]+,[-\d.]+\},?)*)\}', txt or ''):
        for x,y in re.findall(r'\{([-\d.]+),([-\d.]+)\}', pts):
            if float(x)>=0: out.append([int(z),round(float(x),1),round(float(y),1)])
    return out
added=dict(q=0,i=0,n=0,o=0)
for qid,f in rows(Q+'foreverQuestDB.lua'):
    q=D['q'].get(str(qid))
    if not q or len(f)<21 or f[20] in ('nil',''): continue
    rs=[i for i in ints(f[20]) if i in items]
    if not rs: continue
    q['rs']=rs; added['q']+=1
    for i in rs:
        it=items[i]; e=D['i'].setdefault(str(i),{'n':lstr(it[0])})
        if 'n' not in e: e['n']=lstr(it[0])
        dn=ints(it[1]) if len(it)>1 else []; do=ints(it[2]) if len(it)>2 else []
        if dn and not e.get('d'): e['d']=dn
        if do and not e.get('od'): e['od']=do
        added['i']+=1
        for n in dn:
            if str(n) in D['n'] or n not in npcs: continue
            nf=npcs[n]; sp=spawns(nf[6])
            if sp: D['n'][str(n)]={'n':lstr(nf[0]),'l':[int(nf[3]) if nf[3].isdigit() else 1,int(nf[4]) if nf[4].isdigit() else 1],'p':sp}; added['n']+=1
        for o in do:
            if str(o) in D['o'] or o not in objs: continue
            of=objs[o]; sp=spawns(of[3] if len(of)>3 else '')
            if sp: D['o'][str(o)]={'n':lstr(of[0]),'p':sp}; added['o']+=1
json.dump(D,open('db.json','w'),separators=(',',':'))
print(added, D['q']['6395'].get('rs'), D['i']['16333'], D['n'].get('1919'))
# shareable quests (questFlags & 8 = QUEST_FLAGS_SHARABLE)
D=json.load(open('db.json')); n=0
for qid,f in rows(Q+'foreverQuestDB.lua'):
    q=D['q'].get(str(qid))
    if not q or len(f)<23 or f[22] in ('nil',''): continue
    try: fl=int(f[22])
    except ValueError: continue
    if fl&8: q['sh']=1; n+=1
json.dump(D,open('db.json','w'),separators=(',',':')); print('shareable',n)
