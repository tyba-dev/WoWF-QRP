"""Flight network from Questie flight-master NPCs only (no RestedXP data): nodes, estimated edges and times."""
import json, math, heapq
M=json.load(open('meta_full.json')); D=json.load(open('db.json'))
Z=M['zones']; OFF=M['off']
def plane(z,px,py):
    zz=Z[str(z)]; L,R,T,B=zz['b']; off=OFF[str(zz['m'])]; wy=L-px/100*(L-R); wx=T-py/100*(T-B); return (-wy+off[0],-wx+off[1],zz['m'])
towns=[(plane(z,x,y),n) for z,x,y,n in M['towns']]
nodes={}
for nid,n in D['n'].items():
    if not n.get('fp') or not n.get('p'): continue
    z,px,py=n['p'][0]; X,Y,m=plane(z,px,py)
    best=min(towns,key=lambda t:(t[0][0]-X)**2+(t[0][1]-Y)**2 if t[0][2]==m else 1e18)
    d=math.hypot(best[0][0]-X,best[0][1]-Y)
    zn=Z[str(z)]['n']; city=Z[str(z)].get('city')
    place=zn if city else (best[1] if d<700 else zn)
    name=place if (city or place==zn) else f"{place}, {zn}"
    fr=n.get('fr') or 'AH'; f=[c for c in 'AH' if c in fr]
    import re as _re
    sn=_re.sub(r'^The ','',name.split(',')[0].strip()); sn=_re.sub(r' (City|Base Camp|Isle|Stronghold)$','',sn)
    nodes[nid]={'m':m,'X':round(X,1),'Y':round(Y,1),'fm':int(nid),'n':name,'sn':sn,'f':f,'est':1}
SPEED=30.0; CURVE=1.18   # yards per second along a gently curved path; estimate only
def secs(a,b): A,B=nodes[a],nodes[b]; return math.hypot(A['X']-B['X'],A['Y']-B['Y'])*CURVE/SPEED
edges={}; times={}
for fac in 'AH':
    E=set()
    for m in (0,1):
        ids=[k for k,v in nodes.items() if fac in v['f'] and v['m']==m]
        for a in ids:  # 3 nearest neighbours
            for b in sorted([x for x in ids if x!=a],key=lambda x:secs(a,x))[:3]: E.add(tuple(sorted((a,b))))
        # make sure everything is connected (minimum spanning tree over the rest)
        if ids:
            inn={ids[0]}; 
            while len(inn)<len(ids):
                a,b=min(((x,y) for x in inn for y in ids if y not in inn),key=lambda e:secs(*e)); E.add(tuple(sorted((a,b)))); inn.add(b)
    edges[fac]=[list(e) for e in sorted(E)]
    adj={}
    for a,b in E: w=secs(a,b)+4; adj.setdefault(a,[]).append((b,w)); adj.setdefault(b,[]).append((a,w))
    T={}
    for s in adj:
        dist={s:0}; pq=[(0,s)]
        while pq:
            d,u=heapq.heappop(pq)
            if d>dist[u]: continue
            for v,w in adj[u]:
                if d+w<dist.get(v,1e18): dist[v]=d+w; heapq.heappush(pq,(d+w,v))
        T[s]={k:round(v) for k,v in dist.items() if k!=s}
    times[fac]=T
json.dump({'nodes':nodes,'edges':edges,'times':times,'est':1},open('taxi_q.json','w'))
print(len(nodes),'nodes; edges',{f:len(e) for f,e in edges.items()})
