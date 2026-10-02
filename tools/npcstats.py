"""Creature unit class + armor from the CMaNGOS classic-db (github.com/cmangos/classic-db, Full_DB) -> npcstats.json {entry:[unitClass, armor]}.
UnitClass: 1 warrior (no mana), 2 paladin, 8 mage."""
import gzip, re, json, sys
src=sys.argv[1] if len(sys.argv)>1 else '/tmp/claude-0/cdb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz'
cols=None; out={}
def rows(vals):
    # split "(a,'b',..),(..)" respecting quotes
    i=0; n=len(vals); row=[]; cur=''; inq=False; depth=0
    while i<n:
        c=vals[i]
        if inq:
            if c=='\\': cur+=vals[i:i+2]; i+=2; continue
            if c=="'": inq=False
            cur+=c
        elif c=="'": inq=True; cur+=c
        elif c=='(' and depth==0: depth=1; row=[]; cur=''
        elif c==')' and depth==1: row.append(cur); yield row; depth=0; cur=''
        elif c==',' and depth==1: row.append(cur); cur=''
        elif depth==1: cur+=c
        i+=1
with gzip.open(src,'rt',encoding='utf-8',errors='replace') as f:
    sql=f.read()
m=re.search(r'CREATE TABLE `creature_template` \((.*?)\n\)',sql,re.S)
cols=[c for c in re.findall(r'^\s*`(\w+)`',m.group(1),re.M)]
ix={c:i for i,c in enumerate(cols)}
for im in re.finditer(r'INSERT INTO `creature_template` VALUES (.*?);\n',sql,re.S):
    for r in rows(im.group(1)):
        try: out[int(r[ix['Entry']])]=[int(r[ix['UnitClass']]),int(r[ix['Armor']])]
        except (ValueError,IndexError): pass
json.dump(out,open('npcstats.json','w'),separators=(',',':'))
import collections; print(len(out),collections.Counter(v[0] for v in out.values()))
