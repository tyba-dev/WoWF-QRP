"""Class-trainer spell lists from the CMaNGOS classic-db (Full_DB): trainer npc -> template; template -> [[reqlevel, name, rank, cost(copper)],...]
-> tspells.json {t:{tpl:[...]}, n:{npcId:tpl}}. Classic 1.12 baseline (Forever changes not included)."""
import gzip, re, json, sys
from npcstats import rows
src=sys.argv[1] if len(sys.argv)>1 else '/tmp/claude-0/cdb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz'
sql=gzip.open(src,'rt',encoding='utf-8',errors='replace').read()
def table(name):
    m=re.search(r'CREATE TABLE `'+name+r'` \((.*?)\n\)',sql,re.S); cols=re.findall(r'^\s*`(\w+)`',m.group(1),re.M); ix={c:i for i,c in enumerate(cols)}
    for im in re.finditer(r'INSERT INTO `'+name+r'` VALUES (.*?);\n',sql,re.S):
        for r in rows(im.group(1)): yield {c:r[i] for c,i in ix.items() if i<len(r)}
uq=lambda v:(v or '').strip("'").replace("\\'","'") if v not in (None,'NULL') else ''
SP={}
for r in table('spell_template'):
    SP[int(r['Id'])]=(uq(r['SpellName']),uq(r.get('Rank1')),int(r['Effect1']),int(r['EffectTriggerSpell1']))
def name(sid):
    n,rk,eff,trig=SP.get(sid,('','',0,0))
    if eff==36 and trig in SP: n2,rk2,_,_=SP[trig]; return n2 or n, rk2 or rk   # 36 = learn spell
    return n,rk
TPL={}; NPC={}
for r in table('npc_trainer_template'):
    TPL.setdefault('t'+r['entry'],[]).append(r)
for r in table('npc_trainer'):
    TPL.setdefault('n'+r['entry'],[]).append(r); NPC[r['entry']]='n'+r['entry']
for r in table('creature_template'):
    if int(r.get('TrainerType') or 0)==0 and int(r.get('TrainerClass') or 0)>0 and int(r.get('TrainerTemplateId') or 0)>0 and r['Entry'] not in NPC: NPC[r['Entry']]='t'+r['TrainerTemplateId']
V=json.load(open('vend.json')); want=set(V['trn'])
out={'t':{},'n':{}}
for nid in want:
    t=NPC.get(nid)
    if not t: continue
    out['n'][nid]=t
    if t in out['t']: continue
    L=[]
    for r in TPL.get(t,[]):
        n,rk=name(int(r['spell'])); 
        if not n: continue
        L.append([int(r['reqlevel']),n,rk,int(r['spellcost'])])
    out['t'][t]=sorted(L)
uniq={}; T={}; N={}
for nid,t in out['n'].items():
    key=json.dumps(out['t'][t]); k=uniq.setdefault(key,str(len(uniq))); T[k]=out['t'][t]; N[nid]=k
out={'t':T,'n':N}
json.dump(out,open('tspells.json','w'),separators=(',',':'))
print('trainers',len(out['n']),'of',len(want),'templates',len(out['t']))
