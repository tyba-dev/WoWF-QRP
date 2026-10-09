"""Money estimates from the CMaNGOS classic-db Full_DB: expected copper per kill (coins + vendor value of drops)
and quest money rewards -> money.json {kill:{npc:c}, killL:{lvl:c}, quest:{q:c}, questL:{lvl:c}}."""
import gzip, re, json, sys, statistics
from npcstats import rows
src=sys.argv[1] if len(sys.argv)>1 else '/tmp/claude-0/cdb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz'
sql=gzip.open(src,'rt',encoding='utf-8',errors='replace').read()
def table(name):
    m=re.search(r'CREATE TABLE `'+name+r'` \((.*?)\n\)',sql,re.S); cols=re.findall(r'^\s*`(\w+)`',m.group(1),re.M); ix={c:i for i,c in enumerate(cols)}
    for im in re.finditer(r'INSERT INTO `'+name+r'` VALUES (.*?);\n',sql,re.S):
        for r in rows(im.group(1)): yield {c:r[i] for c,i in ix.items() if i<len(r)}
num=lambda v:float(v) if v not in (None,'NULL','') else 0.0
sell={}; buyp={}
for r in table('item_template'): e=int(r['entry']); sell[e]=int(num(r['SellPrice'])); buyp[e]=int(num(r['BuyPrice']))
def load(name):
    T={}
    for r in table(name): T.setdefault(int(r['entry']),[]).append((int(r['item']),num(r['ChanceOrQuestChance']),int(num(r['groupid'])),int(num(r['mincountOrRef'])),int(num(r['maxcount']))))
    return T
CL=load('creature_loot_template'); RL=load('reference_loot_template')
memo={}
def ev(T,e,depth=0):
    key=(id(T),e)
    if key in memo: return memo[key]
    if depth>6: return 0
    rows_=T.get(e,[]); tot=0; groups={}
    for it,ch,g,mn,mx in rows_:
        if mn<0: v=ev(RL,-mn,depth+1)*max(1,mx)
        else: v=sell.get(it,0)*(mn+max(mn,mx))/2
        if ch<0: continue   # quest-only drop
        if g==0: tot+=ch/100*v
        else: groups.setdefault(g,[]).append((ch,v))
    for g,L in groups.items():
        ex=sum(c for c,_ in L if c>0)/100; eq=[v for c,v in L if c==0]; share=max(0,1-ex)/len(eq) if eq else 0
        tot+=sum(c/100*v for c,v in L if c>0)+sum(share*v for v in eq)
    memo[key]=tot; return tot
kill={}; byL={}
for r in table('creature_template'):
    e=int(r['Entry']); coins=(num(r['MinLootGold'])+num(r['MaxLootGold']))/2; lid=int(num(r['LootId']))
    v=coins+(ev(CL,lid) if lid else 0)
    if v<=0: continue
    kill[e]=round(v); L=int((num(r['MinLevel'])+num(r['MaxLevel']))/2)
    if int(num(r.get('Rank') or 0))==0: byL.setdefault(L,[]).append(v)
quest={}; qL={}; qitem={}; qiL={}
for r in table('quest_template'):
    e=int(r['entry']); m=int(num(r['RewOrReqMoney']))
    if m>0: quest[e]=m; qL.setdefault(int(num(r['QuestLevel'])),[]).append(m)
    fixed=sum(sell.get(int(num(r[f'RewItemId{k}'])),0)*max(1,int(num(r[f'RewItemCount{k}']))) for k in range(1,5) if int(num(r[f'RewItemId{k}'])))
    ch=[sell.get(int(num(r[f'RewChoiceItemId{k}'])),0)*max(1,int(num(r[f'RewChoiceItemCount{k}']))) for k in range(1,7) if int(num(r[f'RewChoiceItemId{k}']))]
    v=fixed+(max(ch) if ch else 0)   # you pick one choice reward: counted at the best sell value
    if v>0: qitem[e]=v; qiL.setdefault(int(num(r['QuestLevel'])),[]).append(v)
vend=set(int(r['item']) for r in table('npc_vendor'))
D=json.load(open('db.json')); keepN=set(int(k) for k in D['n'])
G=json.load(open('mobl.json'))['g']; keepN|={x[5] for v in G.values() for x in v}
out={'kill':{k:v for k,v in kill.items() if k in keepN},'killL':{L:round(statistics.median(v)) for L,v in byL.items() if L>0},
     'quest':{k:v for k,v in quest.items() if str(k) in D['q']},'questL':{L:round(statistics.median(v)) for L,v in qL.items() if L>0},
     'qitem':{k:v for k,v in qitem.items() if str(k) in D['q']},'qitemL':{L:round(statistics.median(v)) for L,v in qiL.items() if L>0},
     'buy':{k:buyp[k] for k in vend if buyp.get(k)}}
json.dump(out,open('money.json','w'),separators=(',',':'))
print('qitem',len(out['qitem']),'buy',len(out['buy']),'kill',len(out['kill']),'quest',len(out['quest']),'L20 kill',out['killL'].get(20),'q20',out['questL'].get(20))
