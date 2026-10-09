"""Vendors, class/profession trainers and spirit healers from Questie's combined Forever data (fq2/*.json,
QuestieDB tools/export-forever.lua --include-authored): picks up Forever-only NPCs such as the Coldridge dwarf shaman trainer."""
import re, json
N=json.load(open('fq2/Npc.json')); I=json.load(open('fq2/Item.json'))
g=lambda r,i: r[i] if r and i<len(r) else None
def spawns(sp,nd=1):
    out=[]
    if isinstance(sp,list): sp={str(i+1):l for i,l in enumerate(sp) if l}
    for z,l in (sp or {}).items():
        for p in l or []:
            if isinstance(p,list) and len(p)>=2 and isinstance(p[0],(int,float)) and p[0]>=0: out.append([int(z),round(p[0],nd),round(p[1],nd)])
    return out
items={}; sells={}
for iid,r in I.items():
    v=g(r,13)
    if isinstance(v,list):
        for n in v:
            if isinstance(n,int): sells.setdefault(n,[]).append(int(iid))
        items[int(iid)]=g(r,0)
vend={}; trn={}; ptrn={}; gy=[]
CLS=('Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid')
PMAP=[('Alchemy',r'Alchem'),('Blacksmithing',r'Blacksmith|Armorsmith|Weaponsmith'),('Enchanting',r'Enchant'),('Engineering',r'Engineer'),('Leatherworking',r'Leather'),('Tailoring',r'Tailor'),('Herbalism',r'Herbal'),('Mining',r'Mining|Miner'),('Skinning',r'Skinn'),('Cooking',r'Cook|Chef'),('First Aid',r'First Aid|Physician|Doctor|Surgeon|Trauma'),('Fishing',r'Fishing|Fisherman|Angler')]
for nid,r in N.items():
    nid=int(nid); name=g(r,0); sub=g(r,13); fl=g(r,14) or 0; fr=g(r,12)
    if not isinstance(fl,int): fl=0
    sp=spawns(g(r,6))
    if not sp: continue
    if name=='Spirit Healer': gy+=spawns(g(r,6),2); continue
    if fl&4: vend[nid]=[name,sub,fr,sp[:4],sorted(sells.get(nid,[]))]
    if sub:
        m=re.match(r'^(?:\w+ )?(%s) Trainer$'%'|'.join(CLS), sub)
        if m: trn[nid]=[name,m.group(1),fr,sp[:4]]
        elif fl&16 and not re.search(r'Suppl|Merchant|Vendor|Promoter|League',sub):
            prof=next((p for p,rx in PMAP if re.search(rx,sub)),None)
            if prof: ptrn[nid]=[name,prof,fr,sp[:4],sub]
# Forever-only class trainers have no title in Questie yet: take them from the RestedXP Forever guides (".trainer" steps for one class with a ".target")
import glob
byname={}
for nid,r in N.items():
    if r and g(r,0): byname.setdefault(g(r,0),[]).append(int(nid))
added=[]
for f in glob.glob('/home/claude/RXPGuides/Guides/forever/*.lua'):
    txt=open(f,encoding='utf-8',errors='replace').read()
    for blk in re.split(r'\n\s*step\b',txt):
        head=blk.split('\n',1)[0]; m=re.match(r'\s*<<\s*([A-Za-z]+)\s*$',head)
        PROFSP={2259,2018,2550,7411,4036,3273,7620,2366,2108,2575,8613,3908,2580,2383,8388}
        trainedSpell=[int(x) for x in re.findall(r'^\s*\.train\s+(\d+)',blk,re.M)]
        if not m or m.group(1) not in CLS or not (re.search(r'^\s*\.trainer\b.*class spells',blk,re.M|re.I) or (trainedSpell and not set(trainedSpell)&PROFSP and not re.search(r'^\s*\.vendor',blk,re.M))): continue
        t=re.search(r'^\s*\.target\s+\+?([^\n:<]+?)(?:::(\d+))?\s*(?:<<.*)?$',blk,re.M)
        if not t: continue
        ids=[int(t.group(2))] if t.group(2) else byname.get(t.group(1).strip(),[])
        for nid in ids:
            r=N.get(str(nid)); sp=spawns(g(r,6)) if r else []
            if sp and nid not in trn and not g(r,13): trn[nid]=[g(r,0),m.group(1),g(r,12) or None,sp[:4]]; added.append((nid,g(r,0),m.group(1)))
print('class trainers from guides',added)
# Forever-only vendors (no flags in Questie yet): ".vendor" steps in the guides with a ".target"
vadd=[]
for f in glob.glob('/home/claude/RXPGuides/Guides/forever/*.lua'):
    txt=open(f,encoding='utf-8',errors='replace').read()
    for blk in re.split(r'\n\s*step\b',txt):
        if not re.search(r'^\s*\.vendor\b',blk,re.M): continue
        for t in re.finditer(r'^\s*\.target\s+\+?([^\n:<]+?)(?:::(\d+))?\s*(?:<<.*)?$',blk,re.M):
            for nid in ([int(t.group(2))] if t.group(2) else byname.get(t.group(1).strip(),[])):
                r=N.get(str(nid)); sp=spawns(g(r,6)) if r else []
                if sp and nid not in vend and not g(r,13): vend[nid]=[g(r,0),None,g(r,12) or None,sp[:4],sorted(sells.get(nid,[]))]; vadd.append(g(r,0))
print('vendors from guides',len(vadd),vadd[:12])
used={i for v in vend.values() for i in v[4]}
try:   # keep anything the older Questie export had that the combined data lacks
    O=json.load(open('vend.old.json')); P=json.load(open('ptrn.old.json'))
    for k,v in O['vend'].items(): vend.setdefault(int(k),v)
    for k,v in O['trn'].items(): trn.setdefault(int(k),v)
    for k,v in P.items(): ptrn.setdefault(int(k),v)
    used={i for v in vend.values() for i in v[4]}; items.update({int(k):v for k,v in O['vi'].items()})
except FileNotFoundError: pass
json.dump(dict(vend=vend,trn=trn,vi={i:items[i] for i in used}),open('vend.json','w'),separators=(',',':'))
json.dump(ptrn,open('ptrn.json','w'),separators=(',',':')); json.dump(gy,open('gy.json','w'))
print('vendors',len(vend),'class trainers',len(trn),'profession trainers',len(ptrn),'graveyards',len(gy))
