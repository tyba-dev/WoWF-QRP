
/* ---------- flight paths: nodes are Questie's flight masters; connections and flight times are estimates from distance ---------- */
function taxiFac(){ return charInfo(route).fac; }
function taxiNodes(fac){ fac=fac||taxiFac(); return Object.entries(META.taxi.nodes).filter(([id,n])=>(n.f||[]).includes(fac)).map(([id,n])=>({id,...n})); }
const taxiShort=id=>{ const n=META.taxi.nodes[id]; return n?(n.sn||(n.n||'').split(',')[0].trim()):''; };
const taxiNodePt=id=>{ const n=META.taxi.nodes[id]; return n?{X:n.X,Y:n.Y}:null; };
function taxiPt(id){ const n=META.taxi.nodes[id]; if(!n) return null; const fm=n.fm&&entPts('n',n.fm)[0];
  if(fm) return {...fm,label:DB.n[n.fm]?.n||'Flight master',node:id};
  const z=plane2zone(n.X,n.Y); return {X:n.X,Y:n.Y,node:id,label:n.n,...(z?{z:z.z,px:z.px,py:z.py}:{})}; }
const contOf=p=>p.X>10000?0:1;
function nearestNode(p,only){ if(!p) return null; let best=null,bd=1e18; for(const n of taxiNodes()){ if(n.m!==contOf(p)) continue; if(only&&!only.has(n.id)) continue; const d=(n.X-p.X)**2+(n.Y-p.Y)**2; if(d<bd){ bd=d; best=n.id; } } return best; }
function resolveNode(s){
  if(s.node&&META.taxi.nodes[s.node]) return s.node;
  const list=taxiNodes(); const t=rxpPlain(s.text||'').trim().toLowerCase();
  if(t){ const m=list.find(n=>n.n.toLowerCase().startsWith(t))||list.find(n=>n.n.toLowerCase().includes(t))||list.find(n=>t.includes(taxiShort(n.id).toLowerCase())); if(m) return m.id; }
  if(s.loc){ const p=zp2plane(s.loc.z,s.loc.px,s.loc.py); const id=p&&nearestNode(p); if(id){ const n=META.taxi.nodes[id]; if((n.X-p.X)**2+(n.Y-p.Y)**2<500*500) return id; } }
  return null;
}
function flightRoute(a,b){
  const fac=taxiFac(), T=META.taxi.times[fac]||{}, E=META.taxi.edges[fac]||[];
  const adj=new Map(); const add=(x,y)=>{ const w=T[x]?.[y]??T[y]?.[x]; if(w==null) return; if(!adj.has(x)) adj.set(x,[]); adj.get(x).push([y,w]); };
  for(const [x,y] of E){ add(x,y); add(y,x); }
  const dist=new Map([[a,0]]), prev=new Map(), done=new Set();
  while(true){ let u=null,du=1e18; for(const [k,v] of dist) if(!done.has(k)&&v<du){ du=v; u=k; } if(u==null||u===b) break; done.add(u);
    for(const [v,w] of adj.get(u)||[]){ const nd=du+w; if(nd<(dist.get(v)??1e18)){ dist.set(v,nd); prev.set(v,u); } } }
  const nodes=[b]; let c=b; while(prev.has(c)){ c=prev.get(c); nodes.unshift(c); }
  if(nodes[0]!==a) return {nodes:[a,b],secs:T[a]?.[b]??null};
  return {nodes,secs:T[a]?.[b]??dist.get(b)??null};
}
const fmtSecs=s=>s==null?'':`${META.taxi?.est?'≈':''}${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
function townPt(text){ const t=(text||'').toLowerCase().trim(); if(!t) return null;
  for(const [z,x,y,n] of META.towns) if(n.toLowerCase()===t||t.includes(n.toLowerCase())) return {...zp2plane(z,x,y),label:n};
  for(const [z,Z] of Object.entries(META.zones)) if(Z.city&&(t.includes(Z.n.toLowerCase())||Z.n.toLowerCase().includes(t))) return {...zp2plane(z,50,50),label:Z.n};
  return null; }
/* travel geometry for a simulated step; returns true if it handled r.pt */
function travelGeo(s,r,st,lastPt){
  if(s.t!=='travel') return false;
  if(s.kind==='fly'){
    const dest=resolveNode(s); r.leg={type:'fly'};
    if(!dest){ r.warn.push('Pick a flight path to fly to'); r.pt=stepPoint(s,lastPt); return true; }
    const only=route.char.allfps?null:st.fps; let dep=lastPt?nearestNode(lastPt,only):null;
    if(!dep&&lastPt){ dep=nearestNode(lastPt); if(dep&&!route.char.allfps) r.warn.push(`You haven't learned a flight path near here yet (nearest is ${taxiShort(dep)})`); }
    if(!route.char.allfps&&!st.fps.has(dest)) r.warn.push(`You haven't learned the ${taxiShort(dest)} flight path yet`);
    if(dep===dest) r.warn.push('You are already at this flight path');
    if(dep&&META.taxi.nodes[dep].m!==META.taxi.nodes[dest].m) r.warn.push('Flight paths are on different continents');
    r.dest=dest; r.depNode=dep; r.dep=dep?taxiPt(dep):null; r.pt=taxiPt(dest);
    r.flight=dep&&dep!==dest&&META.taxi.nodes[dep].m===META.taxi.nodes[dest].m?flightRoute(dep,dest):null;
    return true;
  }
  if(s.kind==='ride'){ const rd=RIDES[s.ride]; r.leg={type:'ride'}; if(!rd){ r.warn.push('Unknown transport'); r.pt=stepPoint(s,lastPt); return true; }
    r.ride=rd; r.dep={...tpPt(rd.from),label:rd.dock}; r.pt={...tpPt(rd.to),label:rd.dest}; if(!rd.f.includes(route.char.faction)) r.warn.push(`The ${rd.kind} from ${rd.dock} is for the other faction`); return true; }
  if(s.kind==='fp'){ const node=resolveNode(s); if(node){ st.fps.add(node); r.node=node; r.pt=taxiPt(node); } else { r.warn.push('This flight path is not in the flight data'); r.pt=stepPoint(s,lastPt); } return true; }
  if(s.kind==='home'){ r.pt=stepPoint(s,lastPt)||townPt(s.text); if(r.pt){ st.home={...r.pt,label:rxpPlain(s.text||r.pt.label||''),step:r.i}; } return true; }
  if(s.kind==='hs'){ r.leg={type:'hs'}; const tgt=s.loc?stepPoint(s):townPt(s.text);
    if(st.home){ r.pt=st.home; if(tgt&&Math.hypot(tgt.X-st.home.X,tgt.Y-st.home.Y)>400) r.warn.push(`Your hearthstone is set to ${st.home.label||'somewhere else'}`); }
    else { r.pt=tgt; r.warn.push('No "Set hearthstone" step earlier in the route'); }
    return true; }
  return false;
}

/* ---------- ground pathing over the walkability grid ---------- */
// Grid built offline from every Forever spawn, NPC patrol path and RestedXP guide waypoint:
// 0 sea, 1 rough/unknown land (incl. zone-border ridges), 2 walkable, 3 road (friendly patrol routes).
let NAV=null; const PATHS=new Map(); const PATHQ=[]; let pathBusy=false;
const NAV_COST=[0,7,1,0.7];
const TRANSPORTS=[
  {n:'Zeppelin: Orgrimmar ⇄ Undercity',a:[14,50.8,13.6],b:[85,60.9,58.9],f:'H',c:1000},
  {n:"Zeppelin: Orgrimmar ⇄ Grom'gol",a:[14,50.8,13.6],b:[33,31.5,29.6],f:'H',c:1000},
  {n:"Zeppelin: Undercity ⇄ Grom'gol",a:[85,61.3,58.9],b:[33,31.5,29.6],f:'H',c:1000},
  {n:'Boat: Ratchet ⇄ Booty Bay',a:[17,63.74,38.66],b:[33,25.9,73.1],f:'AH',c:900},
  {n:'Boat: Menethil ⇄ Theramore',a:[11,5.08,63.41],b:[15,71.5,56.4],f:'A',c:900},
  {n:'Boat: Menethil ⇄ Auberdine',a:[11,4.37,56.76],b:[148,32.4,43.8],f:'A',c:900},
  {n:"Boat: Auberdine ⇄ Rut'theran",a:[148,33.2,39.9],b:[141,54.9,96.8],f:'A',c:700},
  {n:'Ferry: Feralas ⇄ Feathermoon',a:[357,43.3,42.8],b:[357,31.1,39.9],f:'A',c:300},
  {n:'Deeprun Tram',a:[1519,63.9,8.3,1],b:[1537,76.4,51.2],f:'A',c:500},
  {n:'Portal: Rut\'theran ⇄ Darnassus',a:[141,55.9,89.8],b:[1657,29.5,41.4],f:'A',c:60},
];
// rideable transports, one entry per direction; text matches RestedXP guides (".zone <Zone> >>Take the Zeppelin to <Zone>")
const RIDES=(()=>{ const out=[]; const add=(kind,f,A,Al,Ad,B,Bl,Bd)=>{ out.push({id:out.length,kind,f,from:A,dock:Al,to:B,dest:Bd}); out.push({id:out.length,kind,f,from:B,dock:Bl,to:A,dest:Ad}); };
  add('Zeppelin','H',[14,50.8,13.6],'Orgrimmar zeppelin tower','Durotar',[85,60.9,58.9],'Undercity zeppelin tower','Tirisfal Glades');
  add('Zeppelin','H',[14,50.8,13.6],'Orgrimmar zeppelin tower','Durotar',[33,31.5,29.6],"Grom'gol zeppelin tower",'Stranglethorn Vale');
  add('Zeppelin','H',[85,61.3,58.9],'Undercity zeppelin tower','Tirisfal Glades',[33,31.5,29.6],"Grom'gol zeppelin tower",'Stranglethorn Vale');
  add('boat','AH',[17,63.74,38.66],'Ratchet docks','Ratchet',[33,25.9,73.1],'Booty Bay docks','Booty Bay');
  add('boat','A',[11,5.08,63.41],'Menethil Harbor docks','Menethil Harbor',[15,71.5,56.4],'Theramore docks','Theramore');
  add('boat','A',[11,4.37,56.76],'Menethil Harbor docks','Menethil Harbor',[148,32.4,43.8],'Auberdine docks','Auberdine');
  add('boat','A',[148,33.2,39.9],'Auberdine docks',"Auberdine",[141,54.9,96.8],"Rut'theran Village docks","Rut'theran Village");
  add('Deeprun Tram','A',[1519,63.9,8.3,1],'Deeprun Tram (Stormwind)','Stormwind City',[1537,76.4,51.2],'Deeprun Tram (Ironforge)','Ironforge');
  for(const r of out){ r.zone=r.to[0]; r.text=`Take the ${r.kind} to ${r.dest}`; } return out; })();
function rideDocks(){ const docks=[]; for(const r of RIDES){ const p=tpPt(r.from); if(!p) continue; let d=docks.find(d=>d.label===r.dock); if(!d){ d={label:r.dock,p,rides:[]}; docks.push(d); } d.rides.push(r); } return docks; }
function tpPt([z,x,y,era]){ const cv=era&&META.zones[z]?.cv; if(cv){ x=x*cv[0]+cv[1]; y=y*cv[2]+cv[3]; } return zp2plane(z,x,y); }
function navInit(){
  const n=META.nav; if(!n) return; const N=n.w*n.h; const g=new Uint8Array(N); let k=0;
  for(let i=0;i<n.rle.length;i+=2){ g.fill(n.rle[i],k,k+n.rle[i+1]); k+=n.rle[i+1]; }
  NAV={x0:n.x0,y0:n.y0,cell:n.cell,w:n.w,h:n.h,g,gs:new Float64Array(N),stamp:new Int32Array(N),closed:new Int32Array(N),par:new Int32Array(N),run:0,links:[]};
  for(const t of TRANSPORTS){ const a=tpPt(t.a), b=tpPt(t.b); if(!a||!b) continue; const ia=navSnap(navCell(a)), ib=navSnap(navCell(b)); if(ia<0||ib<0) continue; NAV.links.push({ia,ib,c:t.c,f:t.f,n:t.n}); }
}
function navCell(p){ const c=Math.floor((p.X-NAV.x0)/NAV.cell), r=Math.floor((p.Y-NAV.y0)/NAV.cell); return (c<0||r<0||c>=NAV.w||r>=NAV.h)?-1:r*NAV.w+c; }
function navSnap(i){
  if(i<0) return -1; const {g,w,h}=NAV; if(g[i]>=2) return i;
  const r0=(i/w)|0, c0=i%w; let any=-1;
  for(let rad=1;rad<=16;rad++){ let best=-1,bd=1e9;
    for(let dr=-rad;dr<=rad;dr++) for(let dc=-rad;dc<=rad;dc++){ if(Math.max(Math.abs(dr),Math.abs(dc))!==rad) continue; const r=r0+dr,c=c0+dc; if(r<0||c<0||r>=h||c>=w) continue; const j=r*w+c;
      if(g[j]>=2){ const d=dr*dr+dc*dc; if(d<bd){ bd=d; best=j; } } else if(g[j]===1&&any<0) any=j; }
    if(best>=0) return best; }
  return g[i]?i:any;
}
function navPath(sa,ta){
  const s=navSnap(navCell(sa)), t=navSnap(navCell(ta)); if(s<0||t<0) return null;
  if(s===t) return {segs:[{k:'walk',pts:[sa,ta]}]};
  const {w,h,g,gs,stamp,closed,par,cell}=NAV; const run=++NAV.run; const fac=taxiFac(); const MIN=0.7, WT=1.25;
  const links=NAV.links.filter(l=>l.f.includes(fac)); const lf=new Map();
  for(const l of links) for(const [x,y] of [[l.ia,l.ib],[l.ib,l.ia]]){ if(!lf.has(x)) lf.set(x,[]); lf.get(x).push([y,l.c]); }
  const tr=(t/w)|0, tc=t%w;
  const hd=(r,c,r2,c2)=>{ const dr=Math.abs(r-r2),dc=Math.abs(c-c2); return (Math.max(dr,dc)+0.4142*Math.min(dr,dc))*cell; };
  const lk=links.map(l=>({ar:(l.ia/w)|0,ac:l.ia%w,br:(l.ib/w)|0,bc:l.ib%w,c:l.c/MIN}));
  const H=i=>{ const r=(i/w)|0,c=i%w; let v=hd(r,c,tr,tc); for(const L of lk){ const v1=hd(r,c,L.ar,L.ac)+L.c+hd(L.br,L.bc,tr,tc); if(v1<v) v=v1; const v2=hd(r,c,L.br,L.bc)+L.c+hd(L.ar,L.ac,tr,tc); if(v2<v) v=v2; } return v*MIN*WT; };
  // binary heap
  let hk=new Float64Array(4096), hv=new Int32Array(4096), hn=0;
  const push=(k,v)=>{ if(hn>=hk.length){ const k2=new Float64Array(hk.length*2); k2.set(hk); hk=k2; const v2=new Int32Array(hv.length*2); v2.set(hv); hv=v2; } let i=hn++; while(i>0){ const p=(i-1)>>1; if(hk[p]<=k) break; hk[i]=hk[p]; hv[i]=hv[p]; i=p; } hk[i]=k; hv[i]=v; };
  const pop=()=>{ const top=hv[0]; const k=hk[--hn], v=hv[hn]; let i=0; while(true){ let c=2*i+1; if(c>=hn) break; if(c+1<hn&&hk[c+1]<hk[c]) c++; if(hk[c]>=k) break; hk[i]=hk[c]; hv[i]=hv[c]; i=c; } hk[i]=k; hv[i]=v; return top; };
  gs[s]=0; stamp[s]=run; par[s]=-1; push(H(s),s);
  const D=[[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,1.4142],[-1,1,1.4142],[1,-1,1.4142],[1,1,1.4142]];
  let found=false, n=0;
  while(hn){ const i=pop(); if(closed[i]===run) continue; closed[i]=run; if(i===t){ found=true; break; } if(++n>700000) break;
    const r=(i/w)|0,c=i%w, gi=gs[i];
    for(const [dr,dc,m] of D){ const rr=r+dr, cc=c+dc; if(rr<0||cc<0||rr>=h||cc>=w) continue; const j=rr*w+cc; const v=g[j]; if(!v||closed[j]===run) continue;
      if(m>1&&(!g[r*w+cc]||!g[rr*w+c])) continue;
      const ng=gi+NAV_COST[v]*m*cell; if(stamp[j]!==run||ng<gs[j]){ stamp[j]=run; gs[j]=ng; par[j]=i; push(ng+H(j),j); } }
    const L=lf.get(i); if(L) for(const [j,c2] of L){ if(closed[j]===run) continue; const ng=gi+c2; if(stamp[j]!==run||ng<gs[j]){ stamp[j]=run; gs[j]=ng; par[j]=i; push(ng+H(j),j); } }
  }
  if(!found) return null;
  const cells=[]; for(let c=t;c>=0;c=par[c]){ cells.push(c); if(c===s) break; } cells.reverse();
  // split at transport jumps
  const parts=[]; let cur=[cells[0]];
  for(let k=1;k<cells.length;k++){ const a=cells[k-1], b=cells[k]; const adj=Math.abs(((a/w)|0)-((b/w)|0))<=1&&Math.abs(a%w-b%w)<=1; if(adj) cur.push(b); else { parts.push({k:'walk',cells:cur}); parts.push({k:'ship',cells:[a,b]}); cur=[b]; } }
  parts.push({k:'walk',cells:cur});
  const cpt=i=>({X:NAV.x0+((i%w)+.5)*cell, Y:NAV.y0+(((i/w)|0)+.5)*cell});
  const segs=parts.filter(p=>p.cells.length>1||p.k==='ship').map(p=>({k:p.k,pts:p.k==='ship'?p.cells.map(cpt):navSmooth(p.cells).map(cpt)}));
  if(!segs.length) return {segs:[{k:'walk',pts:[sa,ta]}]};
  segs[0].pts[0]=sa; const last=segs[segs.length-1]; last.pts[last.pts.length-1]=ta;
  return {segs};
}
function navLineCost(a,b){ const {w,g,cell}=NAV; const r0=(a/w)|0,c0=a%w,r1=(b/w)|0,c1=b%w; const n=Math.max(Math.abs(r1-r0),Math.abs(c1-c0)); if(!n) return 0;
  const step=Math.hypot(r1-r0,c1-c0)/n*cell; let cost=0;
  for(let k=1;k<=n;k++){ const r=Math.round(r0+(r1-r0)*k/n), c=Math.round(c0+(c1-c0)*k/n); const v=g[r*w+c]; if(!v) return Infinity; cost+=NAV_COST[v]*step; } return cost; }
// string-pulling that only takes a shortcut when walking straight is no more costly than the found path
function navSmooth(cells){
  if(cells.length<3) return cells; const {g,w,cell}=NAV;
  const pc=[0]; for(let k=1;k<cells.length;k++){ const a=cells[k-1],b=cells[k]; const m=(a%w!==b%w&&((a/w)|0)!==((b/w)|0))?1.4142:1; pc.push(pc[k-1]+NAV_COST[g[b]]*m*cell); }
  const out=[cells[0]]; let i=0;
  while(i<cells.length-1){ let jBest=i+1; const lim=Math.min(cells.length-1,i+120);
    for(let j=lim;j>i+1;j--){ if(navLineCost(cells[i],cells[j])<=(pc[j]-pc[i])*1.03+cell){ jBest=j; break; } }
    out.push(cells[jBest]); i=jBest; }
  return out;
}
function legPath(a,b){
  if(!NAV) return null; const ka=navCell(a), kb=navCell(b); if(ka<0||kb<0) return null;
  const k=ka+'>'+kb+'|'+taxiFac(); if(PATHS.has(k)){ const P=PATHS.get(k); if(!P) return null; const segs=P.segs.map(s=>({k:s.k,pts:s.pts.slice()})); segs[0].pts[0]=a; const l=segs[segs.length-1]; l.pts[l.pts.length-1]=b; return {segs}; }
  if(!PATHQ.some(q=>q.k===k)) PATHQ.push({k,a,b}); schedulePaths(); return undefined;
}
function schedulePaths(){ if(pathBusy) return; pathBusy=true;
  const tick=()=>{ const t0=performance.now(); while(PATHQ.length&&performance.now()-t0<16){ const q=PATHQ.shift(); let P=null; try{ P=navPath(q.a,q.b); }catch(e){ console.error(e); } PATHS.set(q.k,P); }
    requestDraw(); if(PATHQ.length) setTimeout(tick,0); else pathBusy=false; };
  setTimeout(tick,0); }
function drawFlight(r,future){
  const nodes=r.flight?.nodes||[]; if(nodes.length<2) return;
  ctx.strokeStyle=future?'rgba(140,210,255,.45)':'rgba(140,210,255,.95)'; ctx.lineWidth=2.5; ctx.setLineDash([9,6]);
  for(let k=1;k<nodes.length;k++){ const a=taxiNodePt(nodes[k-1]), b=taxiNodePt(nodes[k]); if(!a||!b) continue; const [ax,ay]=toS(a),[bx,by]=toS(b); const dx=bx-ax,dy=by-ay;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo((ax+bx)/2-dy*0.12,(ay+by)/2+dx*0.12,bx,by); ctx.stroke(); }
  ctx.setLineDash([]);
  for(const id of nodes.slice(1,-1)){ const [x,y]=toS(taxiNodePt(id)); ctx.fillStyle='rgba(140,210,255,.9)'; ctx.beginPath(); ctx.arc(x,y,3,0,7); ctx.fill(); }
}
