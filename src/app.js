'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
let DB, META;

const XP_TABLE=[0,400,900,1400,2100,2800,3600,4500,5400,6500,7600,8800,10100,11400,12900,14400,16000,17700,19400,21300,23200,25200,27300,29400,31700,34000,36400,38900,41400,44300,47400,50800,54500,58600,62800,67100,71600,76100,80800,85700,90700,95800,101000,106300,111800,117500,123200,129100,135100,141200,147500,153900,160400,167100,173900,180800,187900,195000,202300,209800];
const MAXLVL=60;
const START={Human:[12,48.2,42.5],Dwarf:[1,29.9,71.2],Gnome:[1,29.9,71.2],'Night Elf':[141,58.6,44.2],Orc:[14,43.3,68.5],Troll:[14,43.3,68.5],Undead:[85,30.8,66.2],Tauren:[215,44.2,76.7]};
const RACES={Human:[1,'A'],Dwarf:[4,'A'],'Night Elf':[8,'A'],Gnome:[64,'A'],Orc:[2,'H'],Undead:[16,'H'],Tauren:[32,'H'],Troll:[128,'H'],Skyborne:[0,null]};
const CLASSES={Warrior:1,Paladin:2,Hunter:4,Rogue:8,Priest:16,Shaman:64,Mage:128,Warlock:256,Druid:1024};
const FMASK={A:77,H:178};
const PROF_SORTS=new Set([-324,-304,-264,-201,-182,-181,-121,-101,-24]);
const EVENT_SORTS=new Set([-22,-364,-366,-369,-370,-1002,-1003,-1004,-41,-25]);
const CLASS_SORT_NAME={'-263':'Druid','-262':'Priest','-261':'Hunter','-162':'Rogue','-161':'Mage','-141':'Paladin','-82':'Shaman','-81':'Warrior','-61':'Warlock'};

async function loadData(){
  const b64=document.getElementById('bundle').textContent.trim();
  const bin=atob(b64); const u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  const stream=new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  const o=JSON.parse(await new Response(stream).text());
  DB=o.db; META=o.meta;
  labelChains();
}
/* quests that share a name and form a chain get "(part k/n)" so follow-ups are distinguishable */
function labelChains(){
  const byName=new Map();
  for(const [id,q] of Object.entries(DB.q)){ q.on=q.n; const k=q.n+'|'+(q.ra||0); if(!byName.has(k)) byName.set(k,[]); byName.get(k).push(+id); }
  for(const ids of byName.values()){
    if(ids.length<2) continue; const set=new Set(ids);
    const pre=id=>[...(DB.q[id].ps||[]),...(DB.q[id].pg||[])].filter(p=>set.has(p));
    if(!ids.some(id=>pre(id).length)) continue;
    const memo=new Map(); const depth=(id,seen=new Set())=>{ if(memo.has(id)) return memo.get(id); if(seen.has(id)) return 0; seen.add(id); const p=pre(id); const d=p.length?1+Math.max(...p.map(x=>depth(x,seen))):0; memo.set(id,d); return d; };
    const sorted=[...ids].sort((a,b)=>depth(a)-depth(b)||a-b);
    sorted.forEach((id,i)=>{ DB.q[id].n=`${DB.q[id].on} (${i+1}/${sorted.length})`; });
  }
}

/* ---------- geometry ---------- */
function zp2plane(z,px,py){
  const Z=META.zones[z]; if(!Z) return null;
  const [L,R,T,B]=Z.b; const off=META.off[Z.m];
  const wy=L-px/100*(L-R), wx=T-py/100*(T-B);
  return {X:-wy+off[0], Y:-wx+off[1], z:+z, px, py};
}
function plane2zone(X,Y){
  let best=null;
  for(const [z,Z] of Object.entries(META.zones)){
    const off=META.off[Z.m]; const [L,R,T,B]=Z.b;
    const wy=-(X-off[0]), wx=-(Y-off[1]);
    const px=(L-wy)/(L-R)*100, py=(T-wx)/(T-B)*100;
    if(px<0||px>100||py<0||py>100) continue;
    const area=Math.abs((L-R)*(T-B));
    let inPoly=false; const P=zonePaths.get(+z);
    if(P && mctx.isPointInPath(P,X,Y)) inPoly=true;
    const score=(Z.city?0:1e9)+(inPoly?0:1e10)+area;
    if(!best||score<best.score) best={z:+z,px:+px.toFixed(1),py:+py.toFixed(1),score};
  }
  return best;
}
const zoneName=z=>META.zones[z]?.n || META.areas[z]?.[0] || ('Zone '+z);
function areaLabel(q){
  const z=q.z; if(!z) return 'Unknown';
  if(z<0) return META.sorts[z]||'Special';
  const a=META.areas[z]; if(!a) return zoneName(z);
  const parent=META.areas[a[1]]; return (a[1]!==z && META.zones[a[1]]) ? META.zones[a[1]].n : a[0];
}

/* ---------- entities & quests ---------- */
const ptCache=new Map();
function entPts(type,id){
  const key=type+id; if(ptCache.has(key)) return ptCache.get(key);
  const rec=(type==='n'?DB.n:DB.o)[id]; const out=[];
  if(rec&&rec.p) for(const [z,x,y,d] of rec.p){ const p=zp2plane(z,x,y); if(p){ p.dg=!!d; p.ent=type+id; out.push(p);} }
  ptCache.set(key,out); return out;
}
const entName=(type,id)=>((type==='n'?DB.n:DB.o)[id]?.n)||(type==='n'?'NPC ':'Object ')+id;
const Q=id=>DB.q[id];
function starterPts(qid){
  const q=Q(qid); const out=[];
  for(const id of q.s.n) out.push(...entPts('n',id).map(p=>({...p,label:entName('n',id)})));
  for(const id of q.s.o) out.push(...entPts('o',id).map(p=>({...p,label:entName('o',id)})));
  return out;
}
function finisherPts(qid){
  const q=Q(qid); const out=[];
  for(const id of q.f.n) out.push(...entPts('n',id).map(p=>({...p,label:entName('n',id)})));
  for(const id of q.f.o) out.push(...entPts('o',id).map(p=>({...p,label:entName('o',id)})));
  return out;
}
function itemSourcePts(iid,kind){
  const it=DB.i[iid]; const out=[]; if(!it) return out;
  for(const id of it.d||[]) out.push(...entPts('n',id).map(p=>({...p,kind,label:entName('n',id)})));
  for(const id of it.od||[]) out.push(...entPts('o',id).map(p=>({...p,kind,label:entName('o',id)})));
  if(!out.length) for(const id of it.v||[]) out.push(...entPts('n',id).map(p=>({...p,kind:'buy',label:entName('n',id)+' (vendor)'})));
  return out;
}
const objCache=new Map();
function objectives(qid){
  if(objCache.has(qid)) return objCache.get(qid);
  const q=Q(qid); const o=q.o||{}; const list=[];
  for(const [id,txt] of o.c||[]) list.push({kind:'kill',text:txt||('Slay '+entName('n',id)),pts:entPts('n',id).map(p=>({...p,kind:'kill',label:entName('n',id)}))});
  for(const [id,txt] of o.o||[]) list.push({kind:'obj',text:txt||entName('o',id),pts:entPts('o',id).map(p=>({...p,kind:'obj',label:entName('o',id)}))});
  for(const [id,txt] of o.i||[]) list.push({kind:'loot',text:txt||(DB.i[id]?.n||('Item '+id)),pts:itemSourcePts(id,'loot')});
  for(const [ids,base,txt] of o.k||[]){ const pts=[]; for(const id of [...ids,...(base?[base]:[])]) pts.push(...entPts('n',id).map(p=>({...p,kind:'kill',label:entName('n',id)}))); list.push({kind:'kill',text:txt||entName('n',base||ids[0]),pts}); }
  for(const s of o.s||[]) list.push({kind:'event',text:s,pts:[]});
  if(o.r) list.push({kind:'rep',text:'Reach reputation '+o.r[1]+' with faction '+o.r[0],pts:[]});
  if(q.te){ const pts=q.te[1].map(([z,x,y])=>zp2plane(z,x,y)).filter(Boolean).map(p=>({...p,kind:'event',label:q.te[0]})); list.push({kind:'event',text:q.te[0],pts}); }
  { let n=1; for(const ob of list){ if(ob.kind==='rep'||(ob.kind==='event'&&!ob.pts.length&&!q.te)) continue; ob.rx=n++; } }
  for(const ob of list){ if(ob.pts.length>160){ const st=ob.pts.length/160; ob.pts=Array.from({length:160},(_,i)=>ob.pts[Math.floor(i*st)]); } }
  objCache.set(qid,list); return list;
}
const dqCache=new Map();
function isDungeonQuest(qid){ if(dqCache.has(qid)) return dqCache.get(qid); const q=Q(qid); let v=false;
  if(q){ if(q.z>0 && META.dgAreas.includes(q.z)) v=true; else { const pts=objectives(qid).flatMap(o=>o.pts); if(pts.length && pts.filter(p=>p.dg).length>=pts.length/2) v=true; } }
  dqCache.set(qid,v); return v; }
function objNums(qid){ return objectives(qid).filter(o=>o.rx).map(o=>o.rx); }
const hasObjectives=qid=>{ const q=Q(qid); return !!(q.o||q.te); };
function objPoint(qid,rx,ref){
  let all=objectives(qid).filter(o=>!rx||o.rx===rx).flatMap(o=>o.pts); if(!all.length) return rx?objPoint(qid,null,ref):null;
  let pts=all.filter(p=>!p.dg); if(!pts.length) pts=all;
  // cluster points ~300 yd grid, pick the densest cluster weighted by distance from the previous step
  const cl=new Map(); for(const p of pts){ const k=Math.round(p.X/300)+','+Math.round(p.Y/300); if(!cl.has(k)) cl.set(k,[]); cl.get(k).push(p); }
  let best=null,bs=-1e18; for(const g of cl.values()){ const mx=g.reduce((s,p)=>s+p.X,0)/g.length, my=g.reduce((s,p)=>s+p.Y,0)/g.length; const d=ref?Math.hypot(mx-ref.X,my-ref.Y):0; const sc=g.length*400-d; if(sc>bs){ bs=sc; best={g,mx,my}; } }
  let bp=best.g[0],bd=1e18; for(const p of best.g){ const d=(p.X-best.mx)**2+(p.Y-best.my)**2; if(d<bd){bd=d;bp=p;} }
  return {...bp,wp:true};
}
function objCentroid(qid){
  const all=objectives(qid).flatMap(o=>o.pts); let pts=all.filter(p=>!p.dg); if(!pts.length) pts=all;
  if(!pts.length) return null;
  const byZ={}; for(const p of pts) (byZ[p.z]=byZ[p.z]||[]).push(p);
  const zs=Object.values(byZ).sort((a,b)=>b.length-a.length)[0];
  const mx=zs.reduce((s,p)=>s+p.X,0)/zs.length, my=zs.reduce((s,p)=>s+p.Y,0)/zs.length;
  let best=zs[0],bd=1e18; for(const p of zs){ const d=(p.X-mx)**2+(p.Y-my)**2; if(d<bd){bd=d;best=p;} }
  return best;
}

/* ---------- xp ---------- */
function questXP(qid,level){
  const q=Q(qid); if(!q||!q.xp||level>=MAXLVL) return 0;
  const [ql,b0]=q.xp; const base=isDungeonQuest(qid)?b0*dqMult():b0; let mult=2*(ql-level)+20; mult=Math.max(1,Math.min(10,mult));
  let xp=base*mult/10;
  if(xp<=100) xp=5*Math.floor((xp+2)/5); else if(xp<=500) xp=10*Math.floor((xp+5)/10); else if(xp<=1000) xp=25*Math.floor((xp+12)/25); else xp=50*Math.floor((xp+25)/50);
  return Math.floor(xp);
}
function dqMult(){ const m=+route?.char?.dqmult; return m>0?m:3.5; }
function addXP(st,amt){
  st.xp+=amt;
  while(st.level<MAXLVL && st.xp>=XP_TABLE[st.level]){ st.xp-=XP_TABLE[st.level]; st.level++; }
  if(st.level>=MAXLVL){ st.level=MAXLVL; st.xp=0; }
}
const totalXP=(level,xp)=>{ let t=xp; for(let l=1;l<level;l++) t+=XP_TABLE[l]; return t; };
function grayLevel(l){ return l<=5?0 : l<=39? l-5-Math.floor(l/10) : l-1-Math.floor(l/5); }
function diffClass(ql,l){ const d=ql-l; if(d>=5) return 'red'; if(d>=3) return 'orange'; if(d>=-2) return 'yellow'; if(ql>grayLevel(l)) return 'green'; return 'grey'; }
function zeroDiff(l){ return l<8?5:l<10?6:l<12?7:l<16?8:l<20?9:l<30?11:l<40?12:l<45?13:l<50?14:l<55?15:16; }
function mobXP(player,mob,elite,party,dgFactor){
  if(player>=MAXLVL) return 0;
  const base=player*5+45; let xp;
  if(mob>=player) xp=base*(1+0.05*Math.min(mob-player,4));
  else { if(mob<=grayLevel(player)) return 0; xp=base*(1-(player-mob)/zeroDiff(player)); }
  if(dgFactor) xp*=dgFactor; else if(elite) xp*=2;
  const bonus=[1,1,1,1.166,1.3,1.4][party]||1;
  return Math.max(0,Math.round(xp*bonus/party));
}

/* ---------- availability ---------- */
function charInfo(r){ const c=r.char; const [rb,fac]=RACES[c.race]||[0,c.faction]; return {rb,fac:fac||c.faction,cb:CLASSES[c.cls]||0,opts:c}; }
function whyUnavailable(qid,st,route){
  const q=Q(qid); const ci=charInfo(route);
  if(q.ra){ if(ci.rb){ if(!(q.ra&ci.rb)) return {hard:true,why:'Not available to your race'}; } else if((q.ra&FMASK[ci.fac])!==FMASK[ci.fac]) return {hard:true,why:'Restricted to specific races'}; }
  if(q.cl && !(q.cl&ci.cb)) return {hard:true,why:'Class quest for another class'};
  if(q.z<0 && CLASS_SORT_NAME[q.z] && CLASS_SORT_NAME[q.z]!==route.char.cls) return {hard:true,why:'Class quest for another class'};
  for(const nid of q.s.n){ const fr=DB.n[nid]?.fr; if(fr && !fr.includes(ci.fac)) return {hard:true,why:'Quest giver is hostile to your faction'}; }
  if(q.sk && !ci.opts.prof) return {hard:true,filter:true,why:'Profession quest (enable in Settings)'};
  if(q.z<0 && PROF_SORTS.has(q.z) && !ci.opts.prof) return {hard:true,filter:true,why:'Profession quest (enable in Settings)'};
  if((q.ev || (q.z<0&&EVENT_SORTS.has(q.z))) && !ci.opts.event) return {hard:true,filter:true,why:'Seasonal or event quest (enable in Settings)'};
  if((q.sf||0)&1 && !ci.opts.rep) return {hard:true,filter:true,why:'Repeatable quest (enable in Settings)'};
  if(st.turned.has(qid)) return {why:'Already turned in'};
  if(st.log.has(qid)) return {why:'Already in your quest log'};
  if(q.pg){ const miss=q.pg.filter(p=>!st.turned.has(p)&&Q(p)); if(miss.length) return {why:'Requires: '+miss.map(p=>Q(p).n).join(', '),pre:miss}; }
  if(q.ps){ const have=q.ps.some(p=>st.turned.has(p)||!Q(p)); if(!have) return {why:'Requires one of: '+q.ps.filter(Q).map(p=>Q(p).n).join(', '),pre:q.ps}; }
  if(q.ex){ const hit=q.ex.find(p=>st.turned.has(p)||st.log.has(p)); if(hit) return {why:'Exclusive with '+(Q(hit)?.n||hit)}; }
  if(q.nx && (st.turned.has(q.nx)||st.log.has(q.nx))) return {why:'Later quest in this chain already taken'};
  if(q.bc && (st.turned.has(q.bc)||st.log.has(q.bc))) return {why:'Breadcrumb target already taken'};
  if(q.pa && !st.log.has(q.pa)) return {why:'Parent quest '+(Q(q.pa)?.n||q.pa)+' must be in your log'};
  if(q.mx && st.level>q.mx) return {why:'Only available up to level '+q.mx};
  const req=q.r>1?q.r:Math.max(1,(q.l||1)-6);
  if(st.level<req) return {why:'Requires level '+req,level:req};
  return null;
}

/* ---------- routes & simulation ---------- */
const LS='frp.v1';
let store={routes:[],cur:null};
let route=null, cursor=-1, SIM=null, selQuest=null;
function uid(){ return Math.random().toString(36).slice(2,9); }
function newRoute(base){
  return {id:uid(),name:'New route',char:{faction:'H',race:'Tauren',cls:'Druid',level:1,xp:0,party:1,rep:false,prof:false,event:false,dungeons:{}},steps:[],guides:[],guide:{group:'Forever Routes',next:'',extra:''},...(base||{})};
}
let saveT=null;
function save(){ store.cur=route.id; clearTimeout(saveT); saveT=setTimeout(saveNow,250); }
function saveNow(){ store.savedAt=Date.now(); if(route) route.savedAt=store.savedAt;
  for(const r of store.routes){ const used=new Set((r.steps||[]).filter(s=>s.src&&!s.src.auto).map(s=>s.src.g)); for(const g of r.guides||[]){ if(used.has(g.id)){ if(!g.raw&&rawCache.has(g.id)) g.raw=rawCache.get(g.id); } else if(g.raw){ if(!rawCache.has(g.id)) rawCache.set(g.id,g.raw); delete g.raw; } } }
  const txt=JSON.stringify(store); let lsOK=false;
  try{ localStorage.setItem(LS,txt); lsOK=true; }catch(e){ // too big for browser storage: keep a copy without the guide text (that also lives in the database); never delete the old copy
    try{ localStorage.setItem(LS,JSON.stringify(store,(k,v)=>k==='raw'?undefined:v)); lsOK=true; }catch(_){ } }
  for(const r of store.routes) if(r.savedAt) kvPut('route:'+r.id,JSON.stringify(r)); // each route also on its own, so one bad load can never wipe the others
  kvPut('store',txt).then(ok=>{ const bad=!ok&&!lsOK; const b=document.getElementById('saveWarn'); if(b) b.hidden=!bad; }); }
addEventListener('pagehide',()=>{ if(saveT){ clearTimeout(saveT); saveNow(); } });
async function loadStore(){
  let a=null,b=null; try{ a=JSON.parse(localStorage.getItem(LS)||'null'); }catch(e){} try{ b=JSON.parse(await kvGet('store')||'null'); }catch(e){}
  const ok=s=>s&&Array.isArray(s.routes)&&s.routes.length; const s=ok(a)&&ok(b)?((b.savedAt||0)>=(a.savedAt||0)?b:a):(ok(b)?b:ok(a)?a:null); if(s) store=s;
  // merge in every route saved on its own (newest copy of each wins; routes you deleted stay deleted)
  try{ const del=new Set([...(a?.deleted||[]),...(b?.deleted||[]),...(store.deleted||[])]); store.deleted=[...del]; const byId=new Map();
    for(const r of [...(a?.routes||[]),...(b?.routes||[])]) if(r&&r.id&&!del.has(r.id)&&(!byId.has(r.id)||(r.savedAt||0)>(byId.get(r.id).savedAt||0))) byId.set(r.id,r);
    for(const k of (await kvKeys()).filter(k=>String(k).startsWith('route:'))){ let r=null; try{ r=JSON.parse(await kvGet(k)); }catch(e){} if(r&&r.id&&!del.has(r.id)&&(!byId.has(r.id)||(r.savedAt||0)>(byId.get(r.id).savedAt||0))) byId.set(r.id,r); }
    const order=store.routes.map(r=>r.id); const merged=[...byId.values()].sort((x,y)=>{ const i=order.indexOf(x.id), j=order.indexOf(y.id); return (i<0?1e9:i)-(j<0?1e9:j); });
    const full=merged.filter(r=>(r.steps||[]).length||(r.guides||[]).length), empty=merged.filter(r=>!full.includes(r)); if(merged.length) store.routes=[...full,...empty.slice(0,full.length?1:1)]; if(!store.routes.some(r=>r.id===store.cur)&&full[0]) store.cur=full[0].id; }catch(e){}
  // daily backups of what was loaded (last 7 kept), restorable from Settings
  if(s){ try{ const day=new Date().toISOString().slice(0,10); const keys=(await kvKeys()).filter(k=>String(k).startsWith('backup:')).sort(); if(!keys.includes('backup:'+day)) await kvPut('backup:'+day,JSON.stringify(s)); const db=await rawDB(); for(const k of keys.slice(0,Math.max(0,keys.length-7))) db.transaction('kv','readwrite').objectStore('kv').delete(k); }catch(e){} }
  for(const r of store.routes) for(const g of r.guides||[]) if(g.raw) rawCache.set(g.id,g.raw);
  if(!store.routes.length){ const r=newRoute({name:'Mulgore start'}); store.routes.push(r); store.cur=r.id; }
  route=store.routes.find(r=>r.id===store.cur)||store.routes[0];
  for(const r of store.routes) migrateRoute(r);
  cursor=route.steps.length-1;
}
function reqFail(s,st){ if(!s.reqs) return '';
  const nm=ids=>ids.map(id=>Q(id)?.n||('quest '+id)).join(' / ');
  for(const r of s.reqs){ const ids=r.ids, on=ids.some(id=>st.log.has(id)), tin=ids.some(id=>st.turned.has(id)), comp=ids.some(id=>st.log.get(id)?.done);
    switch(r.k){
      case 'isonquest': if(!on) return 'only if you have '+nm(ids); break;
      case 'isnotonquest': if(on) return 'only if you don\u2019t have '+nm(ids); break;
      case 'isquestturnedin': if(!tin) return 'only after turning in '+nm(ids); break;
      case 'isquestnotturnedin': if(ids.every(id=>st.turned.has(id))) return nm(ids)+' already turned in'; break;
      case 'isquestcomplete': if(!comp) return 'only once '+nm(ids)+' is complete'; break;
      case 'isquestnotcomplete': if(comp) return nm(ids)+' already complete'; break;
      case 'isquestavailable': if(ids.every(id=>st.turned.has(id)||st.log.has(id))) return nm(ids)+' no longer available'; break; } }
  return ''; }
function migrateRoute(r){ r.guides=r.guides||[];
  const TM=META.taxiMig||{}; if(r.char&&Array.isArray(r.char.fps)) r.char.fps=r.char.fps.map(x=>META.taxi.nodes[x]?x:(TM[x]||x));
  for(const st of r.steps||[]) if(st.node&&!META.taxi.nodes[st.node]&&TM[st.node]) st.node=TM[st.node];
  if((r.notesMig||0)<2){ r.notesMig=2; for(const g of r.guides){ g.includeNotes=true; g.stopAtBlocked=false; } }
  // RestedXP #optional used to be imported as the user's own opt flag
  for(const g of r.guides) for(const gs of g.steps||[]) if(gs.opt){ gs.gopt=true; delete gs.opt; }
  for(const st of r.steps||[]){ if(!st.src||st.src.auto||!st.opt) continue; const g=r.guides.find(x=>x.id===st.src.g); if(g&&g.steps&&g.steps[st.src.i]?.gopt){ st.gopt=true; delete st.opt; } }
  return r; }
function initState(r){ return {level:+r.char.level||1,xp:+r.char.xp||0,party:Math.max(1,+r.char.party||1),log:new Map(),turned:new Set(),fps:new Set(r.char.fps||[]),home:null,fq:new Map()}; }
function cloneState(s){ return {level:s.level,xp:s.xp,party:s.party,log:new Map([...s.log].map(([k,v])=>[k,{...v,objs:v.objs?new Set(v.objs):undefined}])),turned:new Set(s.turned),fps:new Set(s.fps),home:s.home,fq:new Map(s.fq||[])}; }
// Forever: quest log holds 40, but escort quests can't be started with 25+ quests in the log
const LOGMAX=40, ESC_LIMIT=25, ESCORT=new Set([155,219,309,435,648,660,665,667,731,836,863,898,938,945,976,994,995,1144,1222,1249,1270,1393,1440,1560,1651,2742,2767,2845,2904,2969,3382,3525,3982,4121,4245,4261,4265,4322,4491,4770,4901,4904,4966,5203,5321,5713,5821,5943,5944,6132,6403,6482,6523,6544,6641,8736]);
const ESC_NOTE=`Escort quest: have fewer than ${ESC_LIMIT} quests in your log before accepting (Forever bug)`;
function simulate(){
  const st=initState(route); const res=[]; let atCursor=cloneState(st); const optQ=new Set(route.optOff?route.steps.filter(x=>x.opt&&x.t==='accept'&&x.q).map(x=>x.q):[]);
  let lastPt=null; const rqC=new Map();
  route.steps.forEach((s,i)=>{
    const r={i,err:[],warn:[],gained:0,before:{level:st.level,xp:st.xp}};
    const q=s.q?Q(s.q):null;
    let skip=stepActive(s,st);
    if(!skip && s.reqs){ const key=(s.src?.g||'')+':'+(s.rx||i); let w; if(s.rx&&rqC.has(key)) w=rqC.get(key); else { w=reqFail(s,st); rqC.set(key,w); } if(w) skip='Guide skips this: '+w; }
    if(!skip && s.src && !s.src.auto && q && ((s.t==='accept'&&(st.log.has(s.q)||st.turned.has(s.q)))||((s.t==='turnin'||s.t==='complete')&&st.turned.has(s.q)))) skip='Already done earlier in the route (the guide lists it more than once)';
    if(!skip && s.gopt && q){ // RestedXP #optional: only shown when it applies
      const L=st.log.get(s.q);
      if(s.t==='accept' && (L||st.turned.has(s.q)||whyUnavailable(s.q,st,route))) skip='Guide-optional: quest not available here, skipped';
      else if(s.t==='complete' && (!L||L.done)) skip='Guide-optional: '+(L?'already complete':'quest not in your log')+', skipped';
      else if(s.t==='turnin' && (!L||!L.done)) skip='Guide-optional: '+(L?'objectives not done':'quest not in your log')+', skipped';
    }
    if(!skip && route.hideOpt!==false && route.optOff){ if(s.opt) skip='Optional step, not counted'; else if(s.q&&optQ.has(s.q)&&s.t!=='accept') skip='Part of an optional quest, not counted'; }
    if(!skip && route.optOff && s.opt && s.t==='accept') optQ.add(s.q);
    if(skip){ r.inactive=skip; }
    else if((s.t==='accept'||s.t==='complete'||s.t==='turnin'||s.t==='abandon') && !q){ // Forever quest Questie doesn't know yet: kept as written, tracked like a custom quest
      const xpSet=+(route.qxp?.[s.q])||0, xp=xpSet||fqXpEst(s.q); r.custom=true; if(!st.fq) st.fq=new Map(); if(s.t==='accept'&&!st.fq.has(s.q)) st.fq.set(s.q,'log'); else if(s.t==='complete'&&st.fq.get(s.q)==='log') st.fq.set(s.q,'ready'); else if(s.t==='turnin') st.fq.set(s.q,'done'); else if(s.t==='abandon') st.fq.delete(s.q);
      if(s.t==='turnin'&&xp){ r.gained=xp; addXP(st,xp); }
      r.warn.push(`Forever quest not in the Questie database${s.src?': kept exactly as the guide has it.':' (taken from your imported guides).'}${s.t==='turnin'?(xpSet?` Counting ${fmt(xp)} XP.`:xp?` Counting ≈${fmt(xp)} XP, estimated from its level (Wowhead): set it below if you know it.`:' Set its XP reward below if you know it.'):''}`); }
    else if(s.t==='accept'){
      const w=whyUnavailable(s.q,st,route); if(w) r.err.push(w.why);
      if(st.log.size>=LOGMAX) r.err.push(`Quest log is full (${LOGMAX})`); else if(ESCORT.has(s.q)&&st.log.size>=ESC_LIMIT) r.err.push(`Escort quest: you have ${st.log.size} quests in your log; drop below ${ESC_LIMIT} before accepting`);
      st.log.set(s.q,{done:!hasObjectives(s.q)});
    } else if(s.t==='complete'){
      if(!st.log.has(s.q)) r.err.push('Not in your quest log yet'); else { const e=st.log.get(s.q); e.objs=e.objs||new Set();
        if(s.obj){ if(e.objs.has(s.obj)||e.done) r.warn.push('This objective is already done'); const ke=killEstimate(s.q,s.counts,st,i=>i!==s.obj); e.objs.add(s.obj); if(ke.xp){ r.kill=ke; r.gained=ke.xp; addXP(st,ke.xp); } if(objNums(s.q).every(n=>e.objs.has(n))) e.done=true; }
        else { const ke=killEstimate(s.q,s.counts,st,i=>e.objs.has(i)); e.done=true; objNums(s.q).forEach(n=>e.objs.add(n)); if(ke.xp){ r.kill=ke; r.gained=ke.xp; addXP(st,ke.xp); } } }
    } else if(s.t==='turnin'){
      if(!st.log.has(s.q)) r.err.push('Not in your quest log');
      else if(!st.log.get(s.q).done){ const e=st.log.get(s.q); const miss=objectives(s.q).filter(o=>o.rx&&!(e.objs&&e.objs.has(o.rx))).map(o=>o.text); r.err.push('Objectives not done'+(miss.length?': '+miss.join('; '):'')); }
      const xp=questXP(s.q,st.level); r.gained=xp; addXP(st,xp); st.log.delete(s.q); st.turned.add(s.q);
    } else if(s.t==='abandon'){ st.log.delete(s.q); }
    else if(s.t==='grind'){
      if(s.mode==='to'){
        const target=totalXP(s.level,s.xp||0), now=totalXP(st.level,st.xp);
        if(target<=now){ r.warn.push('Already past this point'); }
        else { r.gained=target-now; st.level=Math.min(MAXLVL,s.level); st.xp=st.level>=MAXLVL?0:(s.xp||0); }
      } else { r.gained=+s.amount||0; addXP(st,r.gained); }
    } else if(s.t==='party'){ if(s.size===st.party) r.warn.push('Group size is already '+s.size); st.party=s.size;
    } else if(s.t==='custom'){
      if(s.act==='turnin'){ r.gained=+s.xp||0; addXP(st,r.gained); }
    }
    if(s.xpo!=null&&!r.inactive){ r.xpCalc=r.gained; st.level=r.before.level; st.xp=r.before.xp; r.gained=+s.xpo; addXP(st,r.gained); }
    r.after={level:st.level,xp:st.xp}; r.logSize=st.log.size; r.party=st.party;
    if(r.inactive) r.pt=null; else if(!travelGeo(s,r,st,lastPt)) r.pt=stepPoint(s,lastPt);
    if(!r.inactive){ const P=pathOf(s); if(P&&P.length>=2){ r.path=pathPts(P); if(r.path.length) r.pt=Object.assign({},r.pt||{},r.path[0]); } }
    r.from=lastPt; r.stk=isSticky(s); if(r.pt&&!r.stk) lastPt=r.pt;
    res.push(r);
    if(i===cursor) atCursor=cloneState(st);
  });
  if(cursor<0) atCursor=initState(route);
  SIM={res,st:atCursor,end:{level:st.level,xp:st.xp,log:st.log.size}};
  SIM.avail=computeAvailable(SIM.st);
  SIM.near=nearZones();
}
function nearest(pts,ref){
  pts=pts.filter(p=>!p.dg).length?pts.filter(p=>!p.dg):pts;
  if(!pts.length) return null; if(!ref) return pts[0];
  let b=pts[0],bd=1e18; for(const p of pts){ const d=(p.X-ref.X)**2+(p.Y-ref.Y)**2; if(d<bd){bd=d;b=p;} } return b;
}
/* ---------- Forever quests known only from your imported guides ---------- */
function drawFQ(){ const s=view.s, st=SIM.st;
  if(layers.avail&&s>=0.015) for(const a of fqAvail(st,true)){ if(a.lock.length&&!layers.locked) continue; const e=a.e; const L=a.f?(a.f==='ready'?e.tin:e.cmp.length?e.cmp:e.tin):e.acc; const l=L[0]; if(!l) continue; const p=zp2plane(l.z,l.px,l.py); if(!p) continue; const [x,y]=toS(p); if(x<-12||x>W+12||y<-12||y>H+12) continue;
    const soon=!a.f&&st.level<e.minL; const ch=a.f==='ready'?'?':a.f?'◆':'!'; ctx.globalAlpha=soon?.55:1; ctx.fillStyle='#07363a'; ctx.beginPath(); ctx.arc(x,y,10,0,7); ctx.fill(); ctx.strokeStyle='#4fe3d0'; ctx.lineWidth=2; ctx.stroke();
    ctx.font='900 14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#4fe3d0'; ctx.fillText(ch,x,y+.5); ctx.globalAlpha=1;
    if(s>0.08) haloText(e.n,x,y-17,'11px "Alegreya Sans", sans-serif','#bff7ef','rgba(4,30,32,.9)',3);
    hits.push({x,y,r:11,kind:'fq',q:e.q,label:e.n+(soon?` (from level ${e.minL})`:'')}); } }

const FQ={key:null,map:new Map()};
function guideLevels(g){ const m=(g.name||'').match(/(\d+)\s*-\s*(\d+)/); return m?[+m[1],+m[2]]:[1,60]; }
function foreverQuests(){ const key=route.id+':'+(route.guides||[]).map(g=>g.id+'/'+g.steps.length).join(','); if(FQ.key===key) return FQ.map; const m=new Map();
  for(const g of route.guides||[]){ const [l0,l1]=guideLevels(g); for(const x of g.steps||[]){ if(!x.q||Q(x.q)||!x.cond||!['accept','turnin','complete'].includes(x.t)) continue;
    let e=m.get(x.q); if(!e) m.set(x.q,e={q:x.q,n:null,acc:[],tin:[],cmp:[],g:g.name,l:l0,l1,tgtA:null,tgtT:null,cl:null});
    if(x.qn&&!e.n) e.n=x.qn; const L=x.loc&&x.loc.z!=null?{z:x.loc.z,px:+x.loc.px,py:+x.loc.py}:null;
    if(x.t==='accept'){ if(L) e.acc.push(L); if(!e.tgtA) e.tgtA=x.tgt||null; } else if(x.t==='turnin'){ if(L) e.tin.push(L); if(!e.tgtT) e.tgtT=x.tgt||null; } else { if(L) e.cmp.push(L); if(!e.cl&&x.cl?.length) e.cl=x.cl; } } }
  for(const e of m.values()){ const w=META.fqw?.[e.q]; if(w){ e.lv=w[0]||null; e.req=w[1]||null; e.prev=w[2]||[]; e.next=w[3]||[]; if(!e.n&&w[4]) e.n=w[4]; } if(!e.n) e.n='Quest '+e.q; e.minL=e.req||Math.max(1,Math.min(e.l,e.lv?e.lv-4:e.l)); } FQ.key=key; FQ.map=m; return m; }
let xpMed=null; function fqXpEst(q){ const e=foreverQuests().get(q)||{lv:META.fqw?.[q]?.[0]}; if(!e.lv) return 0; if(!xpMed){ xpMed={}; const by={}; for(const k in DB.q){ const x=DB.q[k].xp; if(x&&x[1]) (by[x[0]]=by[x[0]]||[]).push(x[1]); } for(const L in by){ const a=by[L].sort((a,b)=>a-b); xpMed[L]=a[a.length>>1]; } } return xpMed[e.lv]||0; }
function fqPrevMissing(e,st){ const miss=[]; for(const p of e.prev||[]){ if(Q(p)){ if(!st.turned.has(p)) miss.push(Q(p).n); } else if(foreverQuests().has(p)||META.fqw?.[p]){ if(fqStatus(p,st)!=='done') miss.push(foreverQuests().get(p)?.n||META.fqw?.[p]?.[4]||('Quest '+p)); } } return miss; }
function fqStatus(q,st){ return (st||SIM.st).fq?.get(q)||null; }
function fqAvail(st,soon){ const out=[]; for(const e of foreverQuests().values()){ const f=fqStatus(e.q,st); if(f==='done') continue; if(!f&&!e.acc.length) continue; if(!f&&st.level<e.minL-(soon?3:0)) continue; const lock=f?[]:fqPrevMissing(e,st); out.push({e,f,lock}); } return out; }
function fqStep(t,q){ const e=foreverQuests().get(+q); if(!e) return null; const loc=(t==='accept'?e.acc:t==='turnin'?e.tin:e.cmp)[0]||e.acc[0]||null; const s={t,q:e.q,qn:e.n}; if(loc) s.loc={...loc}; const tg=t==='accept'?e.tgtA:t==='turnin'?e.tgtT:null; if(tg) s.tgt=tg; if(t==='complete'&&e.cl) s.cl=[...e.cl]; return s; }
function fqRow(a){ const e=a.e; const xp=+(route.qxp?.[e.q])||0, est=xp?0:fqXpEst(e.q); const nx=(e.next||[]).map(n=>foreverQuests().get(n)?.n||META.fqw?.[n]?.[4]||Q(n)?.n).filter(Boolean); return `<div class="qrow" data-fq="${e.q}"><span class="lv">${e.lv||e.l}</span><span class="nm"><span>${a.lock.length?'🔒 ':''}${esc(e.n)}</span><br><span class="meta">${esc(e.g)} · ${a.f==='log'?'in your log':a.f==='ready'?'ready to turn in':'Forever quest'}${xp?' · +'+fmt(xp)+' XP':est?' · ≈'+fmt(est)+' XP (est.)':''}${e.req?' · needs level '+e.req:''}${a.lock.length?' · Needs: '+esc(a.lock.join(', ')):''}${nx.length?' · leads to '+esc(nx.join(', ')):''}</span></span><span class="row" style="gap:3px">${a.f?'':`<button class="btn sm" data-fqa="accept:${e.q}">Accept</button>`}${a.f==='log'?`<button class="btn sm" data-fqa="complete:${e.q}">Complete</button>`:''}${a.f?`<button class="btn sm" data-fqa="turnin:${e.q}">Turn in</button>`:''}</span></div>`; }
/* ---------- vendors ---------- */
function vendorOf(id){ const v=META.vend?.[id]; return v?{id:+id,name:v[0],sub:v[1],fac:v[2],sp:v[3],items:v[4]}:null; }
function vendorOK(v){ const f=charInfo(route).fac; return !v.fac||v.fac.includes(f); }
function vendorPts(v){ return v.sp.map(([z,x,y])=>{ const p=zp2plane(z,x,y); return p?{...p,label:v.name,npc:v.id}:null; }).filter(Boolean); }
function itemName(id){ return META.vi?.[id]||DB.i?.[id]?.n||('Item '+id); }
function stepPoint(s,ref){
  if(s.t==='buy'){ const v=vendorOf(s.npc); return v?nearest(vendorPts(v),ref):(s.loc?zp2plane(s.loc.z,s.loc.px,s.loc.py):null); }
  if(s.loc) return zp2plane(s.loc.z,s.loc.px,s.loc.py);
  if(!s.q||!Q(s.q)) return null;
  if(s.t==='accept') return nearest(starterPts(s.q),ref) || nearest(Q(s.q).s.i.flatMap(i=>itemSourcePts(i,'item')),ref);
  if(s.t==='turnin') return nearest(finisherPts(s.q),ref);
  if(s.t==='complete') return objPoint(s.q,s.obj,ref);
  return null;
}
function computeAvailable(st){
  const out=[]; const logNames=new Set([...st.log.keys()].map(k=>Q(k)?.n).filter(Boolean));
  for(const id in DB.q){
    const qid=+id; const w=whyUnavailable(qid,st,route);
    if(!w) out.push({qid,ok:true});
    else if(w.level && w.level<=st.level+3 && !w.hard) out.push({qid,ok:false,level:w.level});
    else if(w.pre && !w.hard){ const q=Q(qid); if(q.l>grayLevel(st.level) && q.l<=st.level+4 && !logNames.has(q.n)){ const roots=lockRoots(qid,st); if(roots) out.push({qid,ok:false,locked:true,roots}); } }
  }
  return out;
}
// quests in your level range that are locked behind a prerequisite you haven't picked up; follow-ups of quests you're on are left out
function lockRoots(qid,st){
  const seen=new Set(), roots=new Set(); let stop=false;
  const visit=(id,depth)=>{ if(stop||seen.has(id)||depth>15) return; seen.add(id); const q=Q(id); if(!q) return;
    if(st.log.has(id)){ stop=true; return; } if(st.turned.has(id)) return;
    const w=whyUnavailable(id,st,route); if(w&&w.hard){ stop=true; return; }
    const miss=[]; if(q.pg) for(const p of q.pg) if(Q(p)&&!st.turned.has(p)) miss.push(p);
    if(q.ps && !q.ps.some(p=>st.turned.has(p)||!Q(p))){ const c=q.ps.filter(Q); if(c.some(p=>st.log.has(p))){ stop=true; return; } const good=c.find(p=>!whyUnavailable(p,st,route)?.hard); if(good) miss.push(good); else { stop=true; return; } }
    if(!miss.length){ if(depth===0) return; if(w&&!w.level){ stop=true; return; } roots.add(id); return; }
    for(const p of miss) visit(p,depth+1);
  };
  visit(qid,0); return stop||!roots.size?null:[...roots];
}
function nearZones(){
  // zones near the cursor step
  const r=SIM.res[cursor]; let pt=r?.pt;
  if(!pt){ for(let i=cursor;i>=0;i--) if(SIM.res[i]?.pt){pt=SIM.res[i].pt;break;} }
  if(!pt){ const s=START[route.char.race]; if(s) pt=zp2plane(...s); else { const cap=route.char.faction==='H'?1637:1519; pt=zp2plane(cap,50,50); } }
  if(!pt) return null;
  return {z:pt.z,pt};
}

/* ---------- kill XP while questing (estimate) ---------- */
let QGIVERS=null;
function isQuestGiver(id){ if(!QGIVERS){ QGIVERS=new Set(); for(const q of Object.values(DB.q)){ q.s.n.forEach(n=>QGIVERS.add(n)); q.f.n.forEach(n=>QGIVERS.add(n)); } } return QGIVERS.has(+id); }
function isUniqueMob(id){ const pts=entPts('n',id); const l=DB.n[id]?.l; if(!pts.length||pts.every(p=>p.dg)) return !!(l&&l[0]===l[1]); return pts.length===1; }
function genericDrop(src){ if(src.length<25) return false; const ls=src.map(n=>DB.n[n]?.l).filter(Boolean); if(!ls.length) return true; return Math.max(...ls.map(l=>l[1]))-Math.min(...ls.map(l=>l[0]))>20; }
function killCfg(){ const c=route.char; return {on:c.killxp!==false, rate:Math.max(5,Math.min(100,+c.droprate||60))/100, def:Math.max(1,+c.defcount||8), dg:2/(+c.dgdiv>0?+c.dgdiv:3.5)}; }
function npcInfo(id){ const n=DB.n[id]; if(!n||!n.l) return null; const pts=entPts('n',id); return {l:Math.round((n.l[0]+n.l[1])/2),elite:n.rk===1||n.rk===2||n.rk===3,dg:pts.length>0&&pts.every(p=>p.dg)}; }
function perKillXP(ids,st,cfg){
  const fac=route.char.faction; let best=null;
  for(const id of ids){ const n=DB.n[id]; if(!n||n.fr===fac||(isQuestGiver(id)&&ids.length===1&&!n.rk)) continue; const ni=npcInfo(id); if(!ni) continue;
    const d=Math.abs(ni.l-st.level); if(!best||d<best.d) best={ni,d}; }
  if(!best) return {xp:0,none:true}; const ni=best.ni; return {xp:mobXP(st.level,ni.l,ni.elite,st.party||1,ni.dg?cfg.dg:0),dg:ni.dg};
}
function killEstimate(qid,counts,st,skip){
  const cfg=killCfg(); const q=Q(qid); if(!cfg.on||!q) return {xp:0,kills:0,guessed:false};
  const o=q.o||{}; let idx=1, xp=0, kills=0, guessed=false, dg=false;
  const cnt=(uniq)=>{ const c=counts&&counts[idx]; if(c) return +c; if(uniq) return 1; guessed=true; return cfg.def; };
  const use=()=>!(skip&&skip(idx));
  for(const [id] of o.c||[]){ if(!use()){ idx++; continue; } const n=cnt(isUniqueMob(id)); const k=perKillXP([id],st,cfg); xp+=k.xp*n; kills+=n; dg=dg||k.dg; idx++; }
  for(const _ of o.o||[]) idx++;
  for(const [id] of o.i||[]){ const src=DB.i[id]?.d||[]; if(src.length&&!genericDrop(src)&&use()){ const boss=src.length<=2&&src.every(n=>isUniqueMob(n)); const n=boss?1:Math.ceil(cnt()/cfg.rate); const k=perKillXP(src,st,cfg); xp+=k.xp*n; kills+=n; dg=dg||k.dg; } idx++; }
  for(const [ids,base] of o.k||[]){ if(!use()){ idx++; continue; } const n=cnt(); const k=perKillXP(base?[base,...ids]:ids,st,cfg); xp+=k.xp*n; kills+=n; dg=dg||k.dg; idx++; }
  return {xp:Math.round(xp),kills,guessed,dg};
}

/* ---------- map ---------- */
const canvas=$('#map'); const ctx=canvas.getContext('2d');
const mctx=document.createElement('canvas').getContext('2d');
let W=0,H=0,DPR=1;
const view={s:0.03,tx:0,ty:0};
const zonePaths=new Map(); let landPaths=[];
const layers={vendors:true,avail:true,locked:true,trivial:false,objectives:true,route:true,fp:true,towns:true,dungeons:true,relief:true};
const reliefImgs=[];
function loadRelief(){ for(const [m,r] of Object.entries(META.relief||{})){ const o={...r,m,ri:new Image(),wi:new Image(),rs:new Set(r.tile?.r||[]),ws:new Set(r.tile?.w||[])}; o.ri.onload=o.wi.onload=requestDraw; o.ri.src='data:image/webp;base64,'+r.rel; o.wi.src='data:image/webp;base64,'+r.wat; reliefImgs.push(o);} }
const _cv={}; function offCtx(n){ let c=_cv[n]; if(!c){ c=_cv[n]=document.createElement('canvas').getContext('2d'); } if(c.canvas.width!==canvas.width||c.canvas.height!==canvas.height){ c.canvas.width=canvas.width; c.canvas.height=canvas.height; } return c; }
const landCtx=()=>offCtx('land'), maskCtx=()=>offCtx('mask');
const tileCache=new Map();
// close-up terrain tiles live in one pack file per continent (tiles/terrainN.bin: 4-byte header length, JSON index, WebP images)
const packs={};
function packFor(m){ let p=packs[m]; if(p) return p; p=packs[m]={state:'loading'};
  fetch(`tiles/terrain${m}.bin`).then(r=>{ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(b=>{ const n=new DataView(b).getUint32(0,true); p.idx=JSON.parse(new TextDecoder().decode(new Uint8Array(b,4,n))); p.base=4+n; p.buf=b; p.state='ok'; requestDraw(); }).catch(()=>{ p.state='fail'; }); return p; }
function tileImg(m,name){ const key=m+'/'+name; let im=tileCache.get(key); if(im){ tileCache.delete(key); tileCache.set(key,im); return im.complete&&im.naturalWidth?im:null; }
  const p=packFor(m); if(p.state==='loading') return null; let url;
  if(p.state==='ok'){ const e=p.idx[name]; if(!e) return null; url=URL.createObjectURL(new Blob([new Uint8Array(p.buf,p.base+e[0],e[1])],{type:'image/webp'})); } else url=`tiles/${name}.webp`; // no pack file: fall back to single tile images
  im=new Image(); im._u=url.startsWith('blob:')?url:null; im.onload=requestDraw; im.src=url; tileCache.set(key,im);
  while(tileCache.size>60){ const k=tileCache.keys().next().value; const x=tileCache.get(k); tileCache.delete(k); if(x._u) URL.revokeObjectURL(x._u); x.src=''; } return null; }
const HIRES_S=0.1;
function reliefDraw(g,kind){
  const s=view.s, vx0=-view.tx/s, vy0=-view.ty/s, vx1=(W-view.tx)/s, vy1=(H-view.ty)/s;
  for(const o of reliefImgs){ const ov=kind==='r'?o.ri:o.wi; if(!ov.complete||!ov.naturalWidth) continue;
    if(o.x>vx1||o.y>vy1||o.x+o.w<vx0||o.y+o.h<vy0) continue;
    const t=o.tile; if(s<HIRES_S||!t){ g.drawImage(ov,o.x,o.y,o.w,o.h); continue; }
    const set=kind==='r'?o.rs:o.ws, sc=ov.naturalWidth/o.w;
    const tx0=Math.max(0,Math.floor((vx0-o.x)/t.yd)), tx1=Math.min(t.nx-1,Math.floor((vx1-o.x)/t.yd)), ty0=Math.max(0,Math.floor((vy0-o.y)/t.yd)), ty1=Math.min(t.ny-1,Math.floor((vy1-o.y)/t.yd));
    for(let ty=ty0;ty<=ty1;ty++) for(let tx=tx0;tx<=tx1;tx++){ const k=ty+'_'+tx; if(!set.has(k)) continue;
      const X=o.x+tx*t.yd, Y=o.y+ty*t.yd, tw=Math.min(t.yd,o.w-tx*t.yd), th=Math.min(t.yd,o.h-ty*t.yd);
      const im=tileImg(o.m,`t${o.m}_${k}_${kind}`);
      if(im) g.drawImage(im,X,Y,im.naturalWidth*t.yd/t.px,im.naturalHeight*t.yd/t.px);
      else { const sx=(X-o.x)*sc, sy=(Y-o.y)*sc; g.drawImage(ov,sx,sy,Math.min(tw*sc,ov.naturalWidth-sx),Math.min(th*sc,ov.naturalHeight-sy),X,Y,Math.min(tw*sc,ov.naturalWidth-sx)/sc,Math.min(th*sc,ov.naturalHeight-sy)/sc); }
    }
  }
}
const BIOME={14:'#bf8c58',215:'#b3a35e',17:'#c6a667',141:'#6f9557',148:'#7c8c6c',331:'#5f8250',400:'#bf9d72',406:'#8b8669',405:'#a8a08b',357:'#5e8d4f',15:'#6f7c59',440:'#d9bb78',16:'#b98163',361:'#6e6d4c',490:'#6f9141',493:'#86a482',1377:'#caa76b',618:'#e3e8ea',616:'#80a360',16651:'#8e8b6b',16606:'#a3b36f',
  85:'#8d9063',130:'#71805f',28:'#908c6b',139:'#8a7a62',267:'#91a369',36:'#d9dde0',45:'#a9a56c',47:'#80a063',1:'#e2e7ea',38:'#a0a26c',11:'#6c8259',3:'#bd8a5b',51:'#8e5d47',46:'#71503f',12:'#80a458',40:'#ccb46c',44:'#ad8a52',10:'#56644c',41:'#716e63',33:'#5c8d48',8:'#607050',4:'#ad7551',16591:'#7d9d68'};
function mix(a,b,t){ const pa=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16)), pb=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16)); return 'rgb('+pa.map((v,i)=>Math.round(v+(pb[i]-v)*t)).join(',')+')'; }
function buildPaths(){
  for(const [m,c] of Object.entries(META.geo.cont)){
    const off=META.off[m]; const land=new Path2D();
    for(const r of c.coast){ land.moveTo(r[0]+off[0],r[1]+off[1]); for(let i=2;i<r.length;i+=2) land.lineTo(r[i]+off[0],r[i+1]+off[1]); land.closePath(); }
    landPaths.push(land);
    for(const [z,rings] of Object.entries(c.zones)){
      const p=new Path2D(); for(const r of rings){ p.moveTo(r[0]+off[0],r[1]+off[1]); for(let i=2;i<r.length;i+=2) p.lineTo(r[i]+off[0],r[i+1]+off[1]); p.closePath(); }
      zonePaths.set(+z,p);
    }
  }
}
let paperPat=null, seaPat=null;
function makePatterns(){
  const mk=(size,fn)=>{ const c=document.createElement('canvas'); c.width=c.height=size; const g=c.getContext('2d'); const im=g.createImageData(size,size); for(let i=0;i<size*size;i++){ const [r,gg,b,a]=fn(i%size,Math.floor(i/size)); im.data.set([r,gg,b,a],i*4);} g.putImageData(im,0,0); return c; };
  let seed=7; const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
  const n=new Float32Array(256*256).map(()=>rnd());
  const sm=(x,y)=>{ let s=0; for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) s+=n[((y+dy+256)%256)*256+((x+dx+256)%256)]; return s/25; };
  const paper=mk(256,(x,y)=>{ const v=sm(x,y)*0.6+n[y*256+x]*0.4; const k=Math.round(90+v*120); return [k,k*0.86|0,k*0.62|0,34]; });
  const sea=mk(256,(x,y)=>{ const v=Math.sin((x+sm(x,y)*60)/9)*0.5+0.5; return [220,235,240,Math.round(v*14)]; });
  paperPat=ctx.createPattern(paper,'repeat'); seaPat=ctx.createPattern(sea,'repeat');
}
function resize(){
  const r=canvas.getBoundingClientRect(); DPR=Math.min(2,window.devicePixelRatio||1);
  W=r.width; H=r.height; canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR); requestDraw();
}
const BOUNDS={x0:-4600,y0:-11800,x1:20800,y1:9900};
function fitAll(){ const s=Math.min(W/(BOUNDS.x1-BOUNDS.x0),H/(BOUNDS.y1-BOUNDS.y0))*0.95; view.s=s; view.tx=W/2-s*(BOUNDS.x0+BOUNDS.x1)/2; view.ty=H/2-s*(BOUNDS.y0+BOUNDS.y1)/2; requestDraw(); }
function flyTo(X,Y,s){ view.s=s||Math.max(view.s,0.09); view.tx=W/2-X*view.s; view.ty=H/2-Y*view.s; requestDraw(); }
function flyToZone(z){ const Z=META.zones[z]; if(!Z) return; const a=zp2plane(z,0,0), b=zp2plane(z,100,100); const s=Math.min(W/Math.abs(b.X-a.X),H/Math.abs(b.Y-a.Y))*0.95; flyTo((a.X+b.X)/2,(a.Y+b.Y)/2,s); }
const MINS=0.004, MAXS=3;
function zoomAt(f,sx,sy){ const ns=Math.max(MINS,Math.min(MAXS,view.s*f)); const k=ns/view.s; view.tx=sx-(sx-view.tx)*k; view.ty=sy-(sy-view.ty)*k; view.s=ns; requestDraw(); }
let drawPending=false; function requestDraw(){ if(!drawPending){ drawPending=true; requestAnimationFrame(()=>{drawPending=false; draw();}); } }
const toS=p=>[p.X*view.s+view.tx, p.Y*view.s+view.ty];
let hits=[];
const zoneImgs=new Map(); let imgOpacity=0.95;

function draw(){
  if(!META||!SIM) return;
  const s=view.s; hits=[];
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#2c4a55'; ctx.fillRect(0,0,W,H);
  const gr=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.2,W/2,H/2,Math.max(W,H)*0.8); gr.addColorStop(0,'rgba(80,120,130,.35)'); gr.addColorStop(1,'rgba(10,20,25,.45)'); ctx.fillStyle=gr; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=seaPat; ctx.fillRect(0,0,W,H);
  ctx.setTransform(DPR*s,0,0,DPR*s,DPR*view.tx,DPR*view.ty);
  // shallows
  ctx.lineJoin='round';
  if(!(layers.relief&&reliefImgs.length)) for(const lp of landPaths){ ctx.strokeStyle='rgba(120,165,165,.35)'; ctx.lineWidth=Math.max(260,14/s); ctx.stroke(lp); ctx.strokeStyle='rgba(150,190,180,.35)'; ctx.lineWidth=Math.max(110,6/s); ctx.stroke(lp); }
  const useRel=layers.relief&&reliefImgs.length&&reliefImgs.every(o=>o.ri.complete);
  const g=useRel?landCtx():ctx;
  if(useRel){ g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,g.canvas.width,g.canvas.height); g.setTransform(DPR*s,0,0,DPR*s,DPR*view.tx,DPR*view.ty); g.lineJoin='round'; }
  g.fillStyle=mix('#9a9272','#d9c69a',0.42); for(const lp of landPaths) g.fill(lp);
  for(const [z,p] of zonePaths){ g.fillStyle=mix(BIOME[z]||'#b7a574','#d9c69a',0.42); g.fill(p); }
  g.save();
  if(!useRel){ const all=new Path2D(); for(const lp of landPaths) all.addPath(lp); g.clip(all); }
  else { g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high'; g.globalCompositeOperation='overlay'; g.globalAlpha=1; reliefDraw(g,'r'); g.globalAlpha=1; g.globalCompositeOperation='source-over'; }
  g.setTransform(DPR,0,0,DPR,0,0); g.globalCompositeOperation='multiply'; g.fillStyle=paperPat; g.fillRect(0,0,W,H); g.globalCompositeOperation='source-over';
  g.restore();
  // user zone images
  if(zoneImgs.size && s>0.03){
    g.globalAlpha=Math.min(1,(s-0.03)/0.03)*imgOpacity;
    for(const [z,img] of zoneImgs){ const a=zp2plane(z,0,0), b=zp2plane(z,100,100); if(a&&b) g.drawImage(img,a.X,a.Y,b.X-a.X,b.Y-a.Y); }
    g.globalAlpha=1;
  }
  g.strokeStyle='rgba(60,40,20,.55)'; g.lineWidth=1.3/s; g.setLineDash([]);
  for(const [z,p] of zonePaths){ if(META.zones[z]?.ap){ g.setLineDash([5/s,4/s]); g.stroke(p); g.setLineDash([]);} else g.stroke(p); }
  if(useRel){
    g.globalAlpha=0.9; reliefDraw(g,'w'); g.globalAlpha=1;
    // cut the coastline out of the land using the relief images' alpha (fine ocean mask)
    const k=maskCtx(); k.setTransform(1,0,0,1,0,0); k.globalCompositeOperation='source-over'; k.clearRect(0,0,k.canvas.width,k.canvas.height);
    k.setTransform(DPR*s,0,0,DPR*s,DPR*view.tx,DPR*view.ty); k.imageSmoothingEnabled=true;
    reliefDraw(k,'r');
    g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation='destination-in'; g.drawImage(k.canvas,0,0); g.globalCompositeOperation='source-over';
    ctx.setTransform(1,0,0,1,0,0); ctx.save(); ctx.shadowColor='rgba(160,205,195,.6)'; ctx.shadowBlur=Math.min(50,Math.max(5,160*s))*DPR; ctx.drawImage(g.canvas,0,0); ctx.shadowColor='rgba(40,28,12,.95)'; ctx.shadowBlur=2.5*DPR; ctx.drawImage(g.canvas,0,0); ctx.restore();
    ctx.setTransform(DPR*s,0,0,DPR*s,DPR*view.tx,DPR*view.ty);
  } else { ctx.strokeStyle='#3a2915'; ctx.lineWidth=1.8/s; for(const lp of landPaths) ctx.stroke(lp); }
  // Zephras Isle (floating, position illustrative)
  ctx.beginPath(); ctx.ellipse(11200,-9800,900,600,0,0,Math.PI*2); ctx.fillStyle=mix('#b6c7d9','#d9c69a',0.35); ctx.fill(); ctx.setLineDash([6/s,5/s]); ctx.strokeStyle='#3a2915'; ctx.stroke(); ctx.setLineDash([]);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  drawLabels(); drawPOIs(); drawGhosts(); if(layers.route) drawRoute(); drawQuests(); drawFQ();
  $('#status').textContent=s>=0.035?'':'Zoom in to see towns'+(s<0.03?', flight paths and dungeons':'');
}
function haloText(t,x,y,font,fill,stroke,lw){ ctx.font=font; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round'; ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.strokeText(t,x,y); ctx.fillStyle=fill; ctx.fillText(t,x,y); }
function drawLabels(){
  const s=view.s;
  if(s<0.02){
    const kx=[3000,-900], ek=[14300+1700,-5800+5800];
    haloText('Kalimdor',kx[0]*s+view.tx,kx[1]*s+view.ty,`${Math.max(18,Math.min(34,s*1500))}px Marcellus, serif`,'#f6e7bf','rgba(30,20,8,.8)',4);
    haloText('Eastern Kingdoms',ek[0]*s+view.tx,ek[1]*s+view.ty,`${Math.max(18,Math.min(34,s*1500))}px Marcellus, serif`,'#f6e7bf','rgba(30,20,8,.8)',4);
  }
  if(s>=0.012 && s<0.3){
    for(const [z,pt] of Object.entries(META.labels)){
      const Z=META.zones[z]; if(!Z) continue; const off=META.off[Z.m];
      const x=(pt[0]+off[0])*s+view.tx, y=(pt[1]+off[1])*s+view.ty; if(x<-100||x>W+100||y<-50||y>H+50) continue;
      const fs=Math.max(11,Math.min(22,s*420)); const a=s>0.14?Math.max(0,0.6-(s-0.14)/0.2):(s>0.05?0.7:1); ctx.globalAlpha=a;
      haloText(Z.n+(Z.ap?' *':''),x,y,`${fs}px Marcellus, serif`,'#fff1c9','rgba(35,22,8,.85)',3.5);
      if(Z.lv && s>0.03) haloText(Z.lv,x,y+fs*0.95,`${Math.max(10,fs*0.62)}px "Alegreya Sans", sans-serif`,'#ffd65a','rgba(35,22,8,.85)',3);
      ctx.globalAlpha=1;
    }
  }
  if(s>=0.02 && s<0.3){ const p={X:11200,Y:-9800}; const [x,y]=toS(p); haloText('Zephras Isle *',x,y,`${Math.max(11,Math.min(20,s*420))}px Marcellus, serif`,'#fff1c9','rgba(35,22,8,.85)',3.5); }
  // cities
  if(s>=0.006){
    for(const [z,Z] of Object.entries(META.zones)){ if(!Z.city) continue; const p=zp2plane(z,50,50); const [x,y]=toS(p);
      ctx.fillStyle='#2b1c0b'; ctx.beginPath(); ctx.arc(x,y,4.5,0,7); ctx.fill(); ctx.fillStyle='#ffd65a'; ctx.beginPath(); ctx.arc(x,y,3,0,7); ctx.fill();
      if(s>0.02) haloText(Z.n,x,y-12,`${Math.max(11,Math.min(17,s*300))}px Marcellus, serif`,'#fff1c9','rgba(35,22,8,.9)',3);
      hits.push({x,y,r:8,kind:'town',label:Z.n,loc:{z:+z,px:50,py:50}});
    }
  }
}
function drawPOIs(){
  const s=view.s; const fac=charInfo(route).fac;
  if(layers.towns && s>=0.035){
    for(const [z,x0,y0,name] of META.towns){ const p=zp2plane(z,x0,y0); if(!p) continue; const [x,y]=toS(p); if(x<-50||x>W+50||y<-20||y>H+20) continue;
      ctx.fillStyle='#2b1c0b'; ctx.fillRect(x-3.5,y-3.5,7,7); ctx.fillStyle='#f3e2b5'; ctx.fillRect(x-2,y-2,4,4);
      haloText(name,x,y+12,`${Math.max(11,Math.min(15,s*140))}px "Alegreya Sans", sans-serif`,'#fff4d8','rgba(35,22,8,.9)',3);
      hits.push({x,y,r:8,kind:'town',label:name,loc:{z,px:x0,py:y0}});
    }
  }
  if(layers.vendors && s>=0.3 && META.vend){ ctx.font='700 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for(const id in META.vend){ const v=vendorOf(id); if(!vendorOK(v)) continue; for(const p of vendorPts(v)){ const [x,y]=toS(p); if(x<-10||x>W+10||y<-10||y>H+10) continue;
      ctx.fillStyle='#5a3d0a'; ctx.beginPath(); ctx.arc(x,y,5.5,0,7); ctx.fill(); ctx.strokeStyle='#ffd24a'; ctx.lineWidth=1.3; ctx.stroke(); ctx.fillStyle='#ffd24a'; ctx.fillText('¤',x,y+.5);
      hits.push({x,y,r:7,kind:'vendor',vid:v.id,label:v.name}); } } }
  if(layers.dungeons && s>=0.03){ const seen=[];
    for(const [aid,d] of Object.entries(META.dungeons)){ for(const [z,x0,y0] of d.l){ const p=zp2plane(z,x0,y0); if(!p) continue; const [x,y]=toS(p);
      ctx.save(); ctx.translate(x,y); ctx.fillStyle='#2a1030'; ctx.beginPath(); ctx.arc(0,0,7,0,7); ctx.fill(); ctx.strokeStyle='#c68bf0'; ctx.lineWidth=1.6; ctx.beginPath(); for(let a=0;a<9;a+=0.3){ const r=0.6*a; ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);} ctx.stroke(); ctx.restore();
      if(s>0.05 && !seen.some(([a,b,n])=>n===d.n&&Math.hypot(a-x,b-y)<60)){ seen.push([x,y,d.n]); } else if(s>0.05) {} ; if(s>0.05 && seen.some(([a,b,n])=>n===d.n&&a===x&&b===y)) haloText(d.n,x,y-13,`12px "Alegreya Sans", sans-serif`,'#e9c9ff','rgba(20,8,24,.9)',3);
      hits.push({x,y,r:9,kind:'dungeon',label:d.n,p}); } }
  }
  if(layers.fp && s>=0.03){
    for(const d of rideDocks()){ const rides=d.rides.filter(r=>r.f.includes(fac)); if(!rides.length) continue; const [x,y]=toS(d.p); if(x<-20||x>W+20||y<-20||y>H+20) continue;
      ctx.fillStyle='#1d5f86'; ctx.strokeStyle='#bfe6ff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(x,y,8,0,7); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#e8f6ff'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(rides[0].kind==='boat'?'⛵':rides[0].kind==='Zeppelin'?'Z':'T',x,y+0.5);
      hits.push({x,y,r:10,kind:'dock',label:d.label+' — '+rides.map(r=>r.dest).join(', '),dock:d,rides}); }
    for(const [id,n] of Object.entries(DB.n)){ if(!n.fp) continue; const fr=n.fr||''; if(fr && !fr.includes(fac)) continue;
      for(const p of entPts('n',id).slice(0,1)){ const [x,y]=toS(p); if(x<-20||x>W+20||y<-20||y>H+20) continue;
        ctx.save(); ctx.translate(x,y); ctx.fillStyle=fr.length===2?'#6b5a2a':(fr==='H'?'#8e2a1f':'#27488e'); ctx.strokeStyle='#f6d88a'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(8,0); ctx.lineTo(0,8); ctx.lineTo(-8,0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#f6d88a'; ctx.beginPath(); ctx.moveTo(-5,1); ctx.quadraticCurveTo(-2,-4,0,0); ctx.quadraticCurveTo(2,-4,5,1); ctx.quadraticCurveTo(0,-1,-5,1); ctx.fill(); ctx.restore();
        hits.push({x,y,r:10,kind:'fp',label:n.n+' — '+(n.sn||'Flight Master'),npc:+id,loc:{z:p.z,px:p.px,py:p.py}});
      }
    }
  }
}
function qmark(x,y,ch,fill,size){
  const h=size, w=size*0.34; ctx.save(); ctx.translate(x,y); ctx.lineJoin='round';
  const path=new Path2D();
  if(ch==='!'){
    path.moveTo(-w*0.62,-h*0.5); path.lineTo(w*0.62,-h*0.5); path.lineTo(w*0.3,h*0.14); path.lineTo(-w*0.3,h*0.14); path.closePath();
    path.moveTo(w*0.42,h*0.36); path.arc(0,h*0.36,w*0.42,0,Math.PI*2);
  } else {
    const r=h*0.26, cy=-h*0.2, t=w*0.55;
    path.moveTo(-r-t/2,cy); path.arc(0,cy,r+t/2,Math.PI,Math.PI*2.35,false); path.lineTo(t/2,h*0.14); path.lineTo(-t/2,h*0.14); path.lineTo(-t/2,h*0.02);
    path.arc(0,cy,r-t/2,Math.PI*0.35,Math.PI,true); path.closePath();
    path.moveTo(w*0.42,h*0.36); path.arc(0,h*0.36,w*0.42,0,Math.PI*2);
  }
  ctx.strokeStyle='#1a1206'; ctx.lineWidth=Math.max(2.5,size*0.16); ctx.stroke(path); ctx.fillStyle=fill; ctx.fill(path);
  ctx.restore();
}
const QCOL=['#ff6b6b','#5ec8ff','#ffd24a','#8ef08e','#ff9de2','#c49bff','#ffae57','#6effd8','#f5f5a0','#9fb6ff'];
function qColor(qid){ return QCOL[qid%QCOL.length]; }
function drawQuests(){
  const s=view.s; const st=SIM.st; const lv=st.level; const small=s<0.02;
  // objectives for quests in log
  const dgAgg=new Map();
  if(layers.objectives){
    for(const [qid,v] of st.log){ if(v.done) continue; const col=qColor(qid); const sel=selQuest===qid;
      for(const ob of objectives(qid)) for(const p of (v.objs&&ob.rx&&v.objs.has(ob.rx))?[]:ob.pts){ if(p.dg){ const k=p.X.toFixed(0)+','+p.Y.toFixed(0); if(!dgAgg.has(k)) dgAgg.set(k,{p,q:new Set()}); dgAgg.get(k).q.add(qid); continue; } const [x,y]=toS(p); if(x<-10||x>W+10||y<-10||y>H+10) continue;
        const r=(small?2.2:3.6)+(sel?1.4:0); ctx.fillStyle=col; ctx.strokeStyle='#120c04'; ctx.lineWidth=1.3; ctx.beginPath();
        if(p.kind==='obj'||p.kind==='loot'&&p.ent?.[0]==='o'){ ctx.rect(x-r,y-r,2*r,2*r);} else if(p.kind==='event'){ ctx.moveTo(x,y-r-1);ctx.lineTo(x+r+1,y);ctx.lineTo(x,y+r+1);ctx.lineTo(x-r-1,y);ctx.closePath(); } else ctx.arc(x,y,r,0,7);
        ctx.fill(); ctx.stroke(); if(p.kind==='loot'&&!small){ ctx.fillStyle='#120c04'; ctx.beginPath(); ctx.arc(x,y,1.2,0,7); ctx.fill(); }
        hits.push({x,y,r:r+3,kind:'obj',qids:[qid],label:p.label,obText:ob.text,obRx:ob.rx});
      }
    }
  }
  for(const {p,q} of dgAgg.values()){ const [x,y]=toS(p); if(x<-20||x>W+20||y<-20||y>H+20) continue; const bx=x+11, by=y-11; const sel=[...q].includes(selQuest);
    const t=`${q.size} quest${q.size>1?'s':''} inside`; ctx.font='700 11px "Alegreya Sans", sans-serif'; const tw=ctx.measureText(t).width+12; const lx=x+10, ly=y-22;
    ctx.fillStyle='#ff8a1f'; ctx.strokeStyle=sel?'#fff':'#2a1200'; ctx.lineWidth=sel?2.5:1.5; ctx.beginPath(); ctx.roundRect(lx,ly,tw,16,4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx+4,ly+16); ctx.lineTo(x+3,y-3); ctx.stroke();
    ctx.fillStyle='#231200'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(t,lx+6,ly+8.5);
    hits.push({x:lx+tw/2,y:ly+8,r:Math.max(12,tw/2),kind:'dgobj',qids:[...q],label:dungeonAt(p)}); }
  // turn-ins
  const groups=new Map();
  for(const [qid,v] of st.log){ for(const p of finisherPts(qid).slice(0,3)){ const k=p.ent+'@'+p.X.toFixed(0)+','+p.Y.toFixed(0); if(!groups.has(k)) groups.set(k,{p,t:[],a:[],l:[]}); groups.get(k).t.push(qid); } }
  if(layers.avail||layers.trivial){
    for(const a of SIM.avail){ if(!a.ok) continue; const q=Q(a.qid); const triv=diffClass(q.l,lv)==='grey'; if(triv&&!layers.trivial) continue; if(!triv&&!layers.avail) continue;
      for(const p of starterPts(a.qid).slice(0,3)){ const k=p.ent+'@'+p.X.toFixed(0)+','+p.Y.toFixed(0); if(!groups.has(k)) groups.set(k,{p,t:[],a:[],l:[]}); groups.get(k).a.push(a.qid); } }
  }
  if(layers.locked) for(const a of SIM.avail){ if(!a.locked) continue;
    for(const p of starterPts(a.qid).slice(0,3)){ const k=p.ent+'@'+p.X.toFixed(0)+','+p.Y.toFixed(0); if(!groups.has(k)) groups.set(k,{p,t:[],a:[],l:[]}); groups.get(k).l.push(a); } }
  for(const g of groups.values()){
    const [x,y]=toS(g.p); if(x<-20||x>W+20||y<-20||y>H+20) continue;
    const size=small?13:19; const hasSel=[...g.a,...g.t].includes(selQuest);
    if(hasSel){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,size*0.8,0,7); ctx.stroke(); }
    const DGC='#ff8a1f', DGG='#b98a5e';
    if(g.t.length){ const done=g.t.some(q=>st.log.get(q).done); const dq=g.t.every(isDungeonQuest); qmark(x,y,'?',done?(dq?DGC:'#ffd100'):(dq?DGG:'#b5b5b5'),size); }
    else if(!g.a.length){ qmark(x,y,'!','#8fb3d9',size*0.8); }
    else { const allTriv=g.a.every(q=>diffClass(Q(q).l,lv)==='grey'); const allD=g.a.every(isDungeonQuest), anyD=g.a.some(isDungeonQuest);
      qmark(x,y,'!',allTriv?'#a8a8a8':(allD?DGC:'#ffd100'),size); if(anyD&&!allD&&!allTriv) qmark(x-size*0.5,y-size*0.45,'!',DGC,size*0.6); }
    if(g.t.length&&g.a.length){ qmark(x+size*0.5,y-size*0.45,'!',g.a.every(isDungeonQuest)?'#ff8a1f':'#ffd100',size*0.6); }
    hits.push({x,y,r:size*0.7,kind:'quest',avail:g.a,turn:g.t,locked:g.l,label:g.p.label,npcLoc:g.p});
  }
  // selected quest extra: show starter/finisher even if not available
  if(selQuest && Q(selQuest) && !st.log.has(selQuest) && !SIM.avail.some(a=>a.ok&&a.qid===selQuest)){
    for(const p of starterPts(selQuest).slice(0,3)){ const [x,y]=toS(p); qmark(x,y,'!','#8a8a8a',18); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,15,0,7); ctx.stroke(); hits.push({x,y,r:13,kind:'quest',avail:[],turn:[],sel:[selQuest],label:p.label,npcLoc:p}); }
  }
}
function drawRoute(){
  const pts=[]; SIM.res.forEach((r,i)=>{ if(r.pt) pts.push({i,p:r.pt,r}); });
  if(pts.length<1) return;
  ctx.lineCap='round'; ctx.lineJoin='round';
  const walkStyle=f=>{ ctx.strokeStyle=f?'rgba(255,230,160,.45)':'rgba(255,205,70,.95)'; ctx.lineWidth=f?2:3; ctx.setLineDash(f?[5,6]:[]); };
  const poly=arr=>{ ctx.beginPath(); arr.forEach((q,k)=>{ const [x,y]=toS(q); k?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke(); };
  const walkLeg=(a,b,f)=>{ if(!a||!b) return; const P=legPath(a,b);
    if(!P){ walkStyle(f); if(P===undefined){ ctx.globalAlpha=.45; ctx.setLineDash([2,6]); } poly([a,b]); ctx.globalAlpha=1; return; }
    for(const sg of P.segs){ if(sg.k==='ship'){ ctx.strokeStyle=f?'rgba(120,200,255,.45)':'rgba(120,200,255,.95)'; ctx.lineWidth=2; ctx.setLineDash([3,5]); poly(sg.pts); } else { walkStyle(f); poly(sg.pts); } } };
  const lp=pts.filter(x=>!x.r.stk);
  pathHits=[]; SIM.res.forEach((r,i)=>{ if(!r.path||r.path.length<2) return; const f=i>cursor, ed=pathEdit===i; const P=r.path.map(toS);
    ctx.strokeStyle=ed?'rgba(120,255,160,.95)':f?'rgba(140,230,170,.4)':'rgba(120,235,160,.85)'; ctx.lineWidth=ed?2.5:1.8; ctx.setLineDash(ed?[]:[6,4]); ctx.beginPath(); P.forEach(([x,y],k)=>k?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    P.forEach(([x,y],k)=>{ ctx.fillStyle=ed?'#fff':ctx.strokeStyle; ctx.beginPath(); ctx.arc(x,y,ed?6:2.5,0,7); ctx.fill(); if(ed){ ctx.strokeStyle='#1b6b3a'; ctx.lineWidth=2; ctx.stroke(); ctx.fillStyle='#1b6b3a'; ctx.font='700 9px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(k+1),x,y+.5); ctx.strokeStyle='rgba(120,255,160,.95)'; } });
    if(ed) pathHits=P.map(([x,y],k)=>({x,y,k})); });
  for(const {i,p,r} of pts) if(r.stk){ const [x,y]=toS(p); ctx.strokeStyle=i>cursor?'rgba(255,230,160,.45)':'rgba(255,205,70,.9)'; ctx.lineWidth=1.5; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.arc(x,y,9,0,7); ctx.stroke(); ctx.setLineDash([]); }
  for(let k=1;k<lp.length;k++){ const {i,p,r}=lp[k]; const prev=lp[k-1].p; const f=i>cursor; const lt=r.leg?.type;
    if(lt==='hs') continue;
    if(lt==='fly'){ if(r.dep) walkLeg(prev,r.dep,f); drawFlight(r,f); continue; }
    if(lt==='ride'&&r.dep){ walkLeg(prev,r.dep,f); const [ax,ay]=toS(r.dep),[bx,by]=toS(p); const dx=bx-ax,dy=by-ay; ctx.strokeStyle=f?'rgba(120,200,255,.45)':'rgba(120,200,255,.95)'; ctx.lineWidth=2.5; ctx.setLineDash([3,5]); ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo((ax+bx)/2-dy*0.1,(ay+by)/2+dx*0.1,bx,by); ctx.stroke(); ctx.setLineDash([]); continue; }
    walkLeg(prev,p,f); }
  ctx.setLineDash([]);
  if(view.s>0.05){ let last=null;
    for(const {i,p} of pts){ const [x,y]=toS(p); if(last&&Math.hypot(x-last[0],y-last[1])<18) continue; last=[x,y];
      const cur=i===cursor; ctx.fillStyle=cur?'#ffd100':'#2a1c08'; ctx.strokeStyle=cur?'#2a1c08':'#ffd100'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(x+13,y+11,8,0,7); ctx.fill(); ctx.stroke();
      ctx.fillStyle=cur?'#2a1c08':'#ffe9a8'; ctx.font='700 10px "Alegreya Sans", sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(i+1),x+13,y+11.5);
      hits.push({x:x+13,y:y+11,r:8,kind:'route',step:i});
    }
  }
}
/* pointer interaction */
const ptrs=new Map(); let dragStart=null, moved=false, pinch=null, picking=null;
canvas.addEventListener('pointerdown',e=>{ if(pathEdit!=null&&e.button===0){ const h=pathHits.find(h=>Math.hypot(h.x-e.offsetX,h.y-e.offsetY)<10); if(h){ canvas.setPointerCapture(e.pointerId); pathDrag={k:h.k,moved:false}; e.preventDefault(); return; } }
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY}); moved=false; dragStart={x:e.offsetX,y:e.offsetY,tx:view.tx,ty:view.ty};
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch={d:Math.hypot(a.x-b.x,a.y-b.y),s:view.s}; } hidePop(); });
canvas.addEventListener('pointermove',e=>{
  if(pathDrag){ const s=route.steps[pathEdit]; const r=SIM.res[pathEdit]; if(!pathDrag.moved){ pushHistory(); pathDrag.moved=true; if(!s.path){ s.path=pathOf(s).map(l=>({...l})); } delete s.loopRaw; s.pathSrc='edited'; }
    const X=(e.offsetX-view.tx)/view.s, Y=(e.offsetY-view.ty)/view.s; const z=s.path[pathDrag.k].z; s.path[pathDrag.k]=planeToZp(z,X,Y); if(r.path) r.path[pathDrag.k]={...r.path[pathDrag.k],X,Y}; requestDraw(); return; }
  if(ptrs.has(e.pointerId)){ ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY});
    if(ptrs.size===2&&pinch){ const [a,b]=[...ptrs.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y); zoomAt((pinch.s*d/pinch.d)/view.s,(a.x+b.x)/2,(a.y+b.y)/2); moved=true; return; }
    const dx=e.offsetX-dragStart.x, dy=e.offsetY-dragStart.y; if(Math.abs(dx)+Math.abs(dy)>4) moved=true;
    if(moved){ canvas.classList.add('dragging'); view.tx=dragStart.tx+dx; view.ty=dragStart.ty+dy; requestDraw(); } $('#tip').style.display='none'; return; }
  hover(e.offsetX,e.offsetY);
});
function endPtr(e){ if(pathDrag){ const m=pathDrag.moved; pathDrag=null; if(m) refresh(); return; } ptrs.delete(e.pointerId); if(ptrs.size<2) pinch=null; canvas.classList.remove('dragging');
  if(!moved && e.type==='pointerup') click(e.offsetX,e.offsetY); }
canvas.addEventListener('pointerup',endPtr); canvas.addEventListener('pointercancel',endPtr);
canvas.addEventListener('contextmenu',e=>{ if(pathEdit==null) return; const h=pathHits.find(h=>Math.hypot(h.x-e.offsetX,h.y-e.offsetY)<10); if(!h) return; e.preventDefault(); pathDelPt(h.k); });
canvas.addEventListener('pointerleave',()=>{$('#tip').style.display='none';});
canvas.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(Math.exp(-e.deltaY*(e.deltaMode?0.05:0.0016)),e.offsetX,e.offsetY); },{passive:false});
canvas.addEventListener('keydown',e=>{ const k=e.key; if(k==='+'||k==='=') zoomAt(1.3,W/2,H/2); else if(k==='-') zoomAt(1/1.3,W/2,H/2); else if(k.startsWith('Arrow')){ const d=60; if(k==='ArrowLeft')view.tx+=d; if(k==='ArrowRight')view.tx-=d; if(k==='ArrowUp')view.ty+=d; if(k==='ArrowDown')view.ty-=d; requestDraw(); } else return; e.preventDefault(); });
const HIT_PRI={dgobj:0,quest:0,obj:1,route:1,ghost:2,fp:3,dungeon:3,town:4};
function hitAt(x,y){ let best=null,bd=1e9; for(const h of hits){ const d=Math.hypot(h.x-x,h.y-y); if(d>h.r+3) continue; const s=d+(HIT_PRI[h.kind]??3)*4; if(s<bd){ bd=s; best=h; } } return best; }
function dungeonAt(p){ let best='Dungeon',bd=1e12; for(const d of Object.values(META.dungeons)) for(const [z,x0,y0] of d.l){ const t=zp2plane(z,x0,y0); if(!t) continue; const dd=(t.X-p.X)**2+(t.Y-p.Y)**2; if(dd<bd){bd=dd;best=d.n;} } return best; }
function hover(x,y){
  const tip=$('#tip'); const h=picking?null:hitAt(x,y);
  if(!h){ tip.style.display='none'; canvas.style.cursor=picking?'crosshair':''; return; }
  canvas.style.cursor='pointer';
  let html='';
  if(h.kind==='quest'){ html=`<b>${esc(h.label)}</b>`; for(const q of h.turn) html+=`<div>? ${esc(Q(q).n)}</div>`; for(const q of h.avail) html+=`<div>! [${Q(q).l}] ${esc(Q(q).n)}${isDungeonQuest(q)?' <span style="color:#ff9a3c">(dungeon)</span>':''}</div>`; for(const q of h.sel||[]) html+=`<div>[${Q(q).l}] ${esc(Q(q).n)} (not available)</div>`; for(const a of h.locked||[]) html+=`<div>🔒 [${Q(a.qid).l}] ${esc(Q(a.qid).n)} <span style="opacity:.75">needs ${esc(a.roots.map(r=>Q(r).n).join(', '))}</span></div>`; }
  else if(h.kind==='obj') html=`<b>${esc(Q(h.qids[0]).n)}</b><div>${esc(h.obText)}</div><div style="opacity:.75">${esc(h.label||'')}</div>`;
  else if(h.kind==='dgobj') html=`<b>${esc(h.label)}</b><div>Objectives inside for:</div>${h.qids.map(q=>`<div>· ${esc(Q(q).n)}</div>`).join('')}`;
  else if(h.kind==='ghost'){ const g=G(h.g); const r=GH.get(h.g).res[h.i]; html=`<b>${esc(g.name)} · step ${h.i+1}</b><div>${esc(rxpPlain(ghostText(g.steps[h.i])))}</div><div style="opacity:.8">${esc(STLBL[r.status]||'')}${r.why?': '+esc(r.why):''}</div>`; }
  else if(h.kind==='route') html=`Step ${h.step+1}: ${esc(rxpPlain(stepText(route.steps[h.step]).t))}`;
  else html=`<b>${esc(h.label)}</b>`;
  tip.innerHTML=html; tip.style.display='block';
  const tw=tip.offsetWidth; tip.style.left=Math.min(W-tw-8,x+14)+'px'; tip.style.top=(y+14)+'px';
}
function click(x,y){ if(pathEdit!=null&&pathClick(x,y)) return;
  return click0(x,y); }
function click0(x,y){
  if(picking){ const X=(x-view.tx)/view.s, Y=(y-view.ty)/view.s; const z=plane2zone(X,Y); if(!z){ toast('That spot is outside every zone'); return; } const cb=picking; stopPick(); cb({z:z.z,px:z.px,py:z.py}); return; }
  const h=hitAt(x,y); if(!h){ hidePop(); return; }
  if(h.kind==='route'){ setCursor(h.step); return; }
  showPop(h,x,y);
}

/* ---------- steps ---------- */
function stepText(s){
  const q=s.q?Q(s.q):null; const qn=q?q.n:(s.qn||('Quest '+s.q));
  switch(s.t){
    case 'accept': return {ic:'!',cls:'accept',t:'Accept '+qn,sub:(q?locSub(s):'')+(s.src?' · from guide':'')};
    case 'complete': { const ob=s.obj&&q?objectives(s.q).find(o=>o.rx===s.obj):null; return {ic:'✓',cls:'complete',t:ob?`${qn}: ${ob.text}`:'Complete '+qn,sub:ob?'One objective':(q?objectives(s.q).map(o=>o.text).join('; '):'')}; }
    case 'turnin': return {ic:'?',cls:'turnin',t:'Turn in '+qn,sub:q?locSub(s):''};
    case 'abandon': return {ic:'×',cls:'abandon',t:'Abandon '+qn,sub:''};
    case 'buy': { const v=vendorOf(s.npc); return {ic:'¤',cls:'travel',t:'Buy from '+(v?.name||s.npcName||'vendor'),sub:(s.items||[]).map(it=>`${it.c}× ${it.n||itemName(it.id)}`).join(', ')+(v?.sub?' · '+v.sub:'')}; }
    case 'grind': return {ic:'⚔',cls:'grind',t:s.mode==='to'?`Grind to level ${s.level}${s.xp?' + '+fmt(s.xp)+' XP':''}`:`Grind ${fmt(s.amount||0)} XP`,sub:[s.note,{mobs:'Mob kills',explore:'Exploration',both:'Mobs and exploration',other:''}[s.src]||''].filter(Boolean).join(' · ')};
    case 'party': return {ic:s.size>1?String(s.size):'1',cls:'party',t:s.size>1?`Group up: ${s.size} players`:'Go solo',sub:'Affects mob-kill XP estimates from here on'};
    case 'custom': return {ic:'★',cls:'custom',t:({turnin:'Turn in ',accept:'Accept ',complete:'Complete '})[s.act||'turnin']+s.name,sub:(s.qid?'ID '+s.qid+' · ':'')+'custom quest'};
    case 'travel': { const r=SIM?.res[route.steps.indexOf(s)];
      if(s.kind==='fly'&&r?.dest) return {ic:'✈',cls:'travel',t:'Fly to '+taxiShort(r.dest),sub:(r.depNode?'from '+taxiShort(r.depNode):'')+(r.flight?.secs?' · '+fmtSecs(r.flight.secs):'')+(r.flight&&r.flight.nodes.length>2?' · via '+r.flight.nodes.slice(1,-1).map(taxiShort).join(', '):'')};
      if(s.kind==='fp'&&r?.node) return {ic:'✈',cls:'travel',t:'Get flight path: '+taxiShort(r.node),sub:r.pt?.label||''};
      if(s.kind==='ride'&&r?.ride) return {ic:r.ride.kind==='boat'?'⛵':r.ride.kind==='Zeppelin'?'◉':'⇆',cls:'travel',t:r.ride.text,sub:'from '+r.ride.dock};
      if(s.kind==='hs') return {ic:'⌂',cls:'travel',t:'Hearth to '+(r?.pt?.label||rxpPlain(s.text||'')),sub:''};
      return {ic:'➤',cls:'travel',t:(s.src&&!s.src.auto&&(s.kind==='goto'||s.kind==='note')?'':({fly:'Fly to ',fp:'Get flight path: ',home:'Set hearthstone: ',hs:'Hearth to ',goto:'Go to ',note:''})[s.kind])+(s.text||''),sub:s.loc?zoneName(s.loc.z)+' '+s.loc.px+', '+s.loc.py:''}; }
  }
  return {ic:'·',cls:'',t:'Step',sub:''};
}
function locSub(s){ const p=SIM?.res[route.steps.indexOf(s)]?.pt; if(!p) return ''; return (p.label?p.label+' · ':'')+zoneName(p.z)+' '+(+p.px).toFixed(1)+', '+(+p.py).toFixed(1); }
let history=[], future=[];
function pushHistory(){ history.push(JSON.stringify({steps:route.steps,cursor})); if(history.length>100) history.shift(); future=[]; }
function undo(){ selSteps.clear(); const h=history.pop(); if(!h) return toast('Nothing to undo'); future.push(JSON.stringify({steps:route.steps,cursor})); const o=JSON.parse(h); route.steps=o.steps; cursor=o.cursor; refresh(); }
// sticky / completewith: guide steps carry it from RestedXP; your own steps use s.stk = 'next' | 'sticky'
function stepGuide(s){ return s.src&&!s.src.auto&&typeof G==='function'?G(s.src.g)?.steps[s.src.i]:null; }
function isSticky(s){ const gs=stepGuide(s); return gs?!!(gs.sticky||gs.cw):!!s.stk; }
function guideStickyDefault(t,q){ for(const g of route.guides||[]) for(const x of g.steps||[]) if(x.q===q&&x.t===t&&x.cond&&(x.sticky||x.cw)) return {stk:x.cw==='next'?'next':'sticky',g:g.name}; return null; }
/* ---------- objective paths (#loop): the arrow walks you round the spawns ---------- */
function planeToZp(z,X,Y){ const Z=META.zones[z]; const [L,R,T,B]=Z.b; const off=META.off[Z.m]; const wy=-(X-off[0]), wx=-(Y-off[1]); return {z:+z,px:+((L-wy)/(L-R)*100).toFixed(2),py:+((T-wx)/(T-B)*100).toFixed(2)}; }
function pathOf(s){ return s.path!==undefined?s.path:(stepGuide(s)?.path||null); }
function pathPts(path){ return (path||[]).map(l=>zp2plane(l.z,l.px,l.py)).filter(Boolean); }
function guidePathFor(q){ for(const g of route.guides||[]) for(const x of g.steps||[]) if(x.q===q&&x.t==='complete'&&x.cond&&x.path&&x.path.length>=2) return {path:x.path.map(l=>({...l})),raw:x.loopRaw?[...x.loopRaw]:null,g:g.name}; return null; }
function genPath(qid,obj,ref){
  if(!Q(qid)) return null; const obs=objectives(qid).filter(o=>(!obj||o.rx===obj)&&['kill','loot','obj'].includes(o.kind));
  let pts=obs.flatMap(o=>o.pts).filter(p=>p&&!p.dg&&p.z!=null); if(pts.length<4) return null;
  const cl=new Map(); for(const p of pts){ const k=Math.round(p.X/300)+','+Math.round(p.Y/300); if(!cl.has(k)) cl.set(k,[]); cl.get(k).push(p); }
  let best=null,bs=-1e18; for(const g of cl.values()){ const mx=g.reduce((a,p)=>a+p.X,0)/g.length, my=g.reduce((a,p)=>a+p.Y,0)/g.length; const d=ref?Math.hypot(mx-ref.X,my-ref.Y):0; const sc=g.length*400-d; if(sc>bs){ bs=sc; best={mx,my}; } }
  const sel=pts.filter(p=>Math.hypot(p.X-best.mx,p.Y-best.my)<=420); if(sel.length<4) return null;
  const cells=new Map(); for(const p of sel){ const k=Math.floor(p.X/70)+','+Math.floor(p.Y/70); if(!cells.has(k)) cells.set(k,[]); cells.get(k).push(p); }
  let W=[...cells.values()].map(g=>({X:g.reduce((a,p)=>a+p.X,0)/g.length,Y:g.reduce((a,p)=>a+p.Y,0)/g.length,n:g.length}));
  if(W.length>10){ let C=[...W].sort((a,b)=>b.n-a.n).slice(0,10).map(w=>({X:w.X,Y:w.Y}));
    for(let it=0;it<10;it++){ const acc=C.map(()=>({X:0,Y:0,n:0})); for(const p of sel){ let bi=0,bd=1e18; C.forEach((c,k)=>{ const d=(c.X-p.X)**2+(c.Y-p.Y)**2; if(d<bd){bd=d;bi=k;} }); acc[bi].X+=p.X; acc[bi].Y+=p.Y; acc[bi].n++; } C=acc.filter(a=>a.n).map(a=>({X:a.X/a.n,Y:a.Y/a.n,n:a.n})); }
    W=C; }
  if(W.length<3) return null;
  // tour: nearest neighbour from the point closest to where you arrive, then 2-opt on the closed loop
  let start=0; if(ref){ let bd=1e18; W.forEach((w,k)=>{ const d=Math.hypot(w.X-ref.X,w.Y-ref.Y); if(d<bd){bd=d;start=k;} }); }
  const left=new Set(W.keys()); left.delete(start); const T=[start]; while(left.size){ const a=W[T[T.length-1]]; let bk=-1,bd=1e18; for(const k of left){ const d=Math.hypot(W[k].X-a.X,W[k].Y-a.Y); if(d<bd){bd=d;bk=k;} } T.push(bk); left.delete(bk); }
  const D=(a,b)=>Math.hypot(W[a].X-W[b].X,W[a].Y-W[b].Y); let imp=true, guard=0;
  while(imp&&guard++<50){ imp=false; for(let a=1;a<T.length-1;a++) for(let b=a+1;b<T.length;b++){ const p=T[a-1],q=T[a],r=T[b],t=T[(b+1)%T.length]; if(D(p,r)+D(q,t)<D(p,q)+D(r,t)-0.01){ T.splice(a,b-a+1,...T.slice(a,b+1).reverse()); imp=true; } } }
  return T.map(k=>{ const w=W[k]; let bz=sel[0], bd=1e18; for(const p of sel){ const d=(p.X-w.X)**2+(p.Y-w.Y)**2; if(d<bd){bd=d;bz=p;} } return planeToZp(bz.z,w.X,w.Y); });
}
function routeRefBefore(i){ for(let k=Math.min(i,route.steps.length)-1;k>=0;k--) if(SIM.res[k]?.pt&&!SIM.res[k].stk) return SIM.res[k].pt; return null; }
function defaultPath(step,at){ if(step.src||step.t!=='complete'||!step.q||step.path) return null; const gp=guidePathFor(step.q); if(gp){ step.path=gp.path; if(gp.raw) step.loopRaw=gp.raw; step.pathSrc=gp.g; return 'guide'; }
  const p=genPath(step.q,step.obj,routeRefBefore(at)); if(p){ step.path=p; step.pathSrc='generated'; return 'gen'; } return null; }
function addStep(step){ const pk=defaultPath(step,cursor+1); const msgs=[]; if(pk) msgs.push(pk==='guide'?`Path copied from ${step.pathSrc}.`:`Rough path generated through the spawns (${step.path.length} points): click 🔁 on the step to adjust it.`);
  let d=null; if(!step.src&&step.q&&['accept','complete','turnin'].includes(step.t)&&step.stk===undefined){ d=guideStickyDefault(step.t,step.q); if(d) step.stk=d.stk; }
  if(d) msgs.push(`Made sticky (${d.stk==='next'?'done with the next step':'stays on screen until done'}) as in ${d.g}: click 📌 to change.`);
  if(msgs.length) setTimeout(()=>toast(msgs.join(' '),5000),0);
  pushHistory(); route.steps.splice(cursor+1,0,step); cursor++; refresh(); scrollCursor(); }
function markRemoved(st){ if(!st?.src||st.src.auto) return; const g=G(st.src.g); if(!g) return; g.removed=g.removed||[]; if(!g.removed.includes(st.src.i)) g.removed.push(st.src.i); }
function removeStep(i){ pushHistory(); markRemoved(route.steps[i]); route.steps.splice(i,1); if(cursor>=i) cursor--; refresh(); }
function moveStep(from,to){ if(from===to) return; pushHistory(); const [s]=route.steps.splice(from,1); if(to>from) to--; route.steps.splice(to,0,s); cursor=to; refresh(); }
function setCursor(i){ cursor=i; refresh(); scrollCursor(); const p=SIM.res[i]?.pt; if(p){ const [x,y]=toS(p); if(x<40||y<40||x>W-40||y>H-40) flyTo(p.X,p.Y); } }
function scrollCursor(){ const el=$('#steps .cur'); el&&el.scrollIntoView({block:'nearest'}); }
function refresh(){ simulate(); computeGhosts(); renderSteps(); renderRight(); renderXP(); renderRouteHead(); renderHS(); requestDraw(); save(); }

function renderSteps(){
  const ul=$('#steps'); const parts=[];
  parts.push(`<li class="start ${cursor<0?'cur':''}" data-i="-1">Start · level ${route.char.level}${+route.char.xp?' + '+fmt(route.char.xp)+' XP':''}</li>`);
  if(cursor<0) parts.push(`<li class="insert">New steps are added here</li>`);
  if(!route.steps.length) parts.push(`<li class="empty">Pick a yellow <b>!</b> on the map or an entry in <b>Available</b> to accept your first quest. Steps are added after the highlighted step, so you can click any step to insert before later ones.</li>`);
  route.steps.forEach((s,i)=>{
    const r=SIM.res[i]; const tx=stepText(s);
    const gs=s.src&&typeof G==='function'?G(s.src.g)?.steps[s.src.i]:null; const dgTags=gs&&!r.inactive?(gs.dg||[]).filter(dgOn):[]; const qTag=s.q?questDgTag(s.q):null; const allTags=stepDgTags(i);
    const dq=s.q&&Q(s.q)&&isDungeonQuest(s.q);
    const lvl=r.after.level+(r.after.level<MAXLVL?r.after.xp/XP_TABLE[r.after.level]:0);
    parts.push(`<li tabindex="-1" class="step ${i===cursor?'cur':''} ${i>cursor?'future':''} ${r.inactive?'inactive':''} ${dgTags.length?'dgstep':''} ${s.opt?'optstep':''} ${selSteps.has(i)?'msel':''}" data-i="${i}" draggable="true">
      <span class="n" title="Drag to reorder">${i+1}</span><span class="ic ${tx.cls} ${dq?'dq':''}" aria-hidden="true">${tx.ic}</span>
      <span class="t">${''}${s.src&&s.t==='travel'&&(s.kind==='note'||s.kind==='goto')?rxpHTML(tx.t):esc(rxpPlain(tx.t))}${(()=>{const gs=s.src&&!s.src.auto?G(s.src.g)?.steps[s.src.i]:null; return gs?notesHTML(gs,s.t==='travel'&&(s.kind==='note'||s.kind==='goto')?(s.text||''):''):'';})()}${s.t==='grind'&&r.party>1?`<span class="sub">in a group of ${r.party}</span>`:''}${r.kill?`<span class="sub kx">≈${fmt(r.kill.kills)} kills${r.kill.guessed?' (some counts guessed)':''}${r.party>1?` · group of ${r.party}`:''}${r.kill.dg?' · dungeon mobs':''}</span>`:''}${s.unote?`<span class="unote">${s.unote.split('\n').map(esc).join('<br>')}</span>`:''}${stickyChip(s,i)}${r.path?`<span class="stk" data-pathed="${i}" style="cursor:pointer" title="The RestedXP arrow loops through these points (#loop). Click to see or edit it on the map.">🔁 path · ${r.path.length} pts</span>`:''}${s.t==='accept'&&ESCORT.has(s.q)?`<span class="sub" style="color:var(--warn)">⚠ ${esc(ESC_NOTE)}</span>`:''}${allTags.map(t=>`<span class="dgtag" data-dgsel="${esc(t)}" title="${dgTags.includes(t)?`Only because you're running ${esc(dgName(t))}`:`${esc(dgName(t))} quest`}. Click to select every ${esc(t)} step">${esc(t)}</span>`).join('')}${tx.sub?`<span class="sub">${esc(tx.sub)}</span>`:''}${r.inactive?`<span class="wrn">${esc(r.inactive)}</span>`:''}${r.err.map(e=>{ const m=e.match(/^Requires level (\d+)/); return `<span class="err">${esc(e)}${m?` <button class="linkish" data-fixgrind="${i}:${m[1]}">Add a grind to level ${m[1]} before this</button>`:''}</span>`; }).join('')}${r.warn.map(e=>`<span class="wrn">${esc(e)}</span>`).join('')}${r.custom&&s.t==='turnin'?`<button class="linkish" data-uxp="${i}">${route.qxp?.[s.q]?'Change XP reward':'Set XP reward'}</button>`:''}</span>
      <span class="x">${r.gained||s.xpo!=null?`<b${s.xpo!=null?' title="XP set by you"':''}>+${fmt(r.gained)}${s.xpo!=null?'*':''}</b><br>`:''}${lvl.toFixed(1)}</span>
      <span class="sbtns">${s.q?`<a class="wh" href="${whURL(s.q,s.qn)}" target="_blank" rel="noopener" title="Open this quest on Wowhead">wh↗</a>`:''}<button class="opt ${s.opt?'on':''}" data-opt="${i}" title="${s.opt?'Optional (click to make required)':'Mark as optional'}" aria-pressed="${!!s.opt}">opt</button>${!stepGuide(s)&&['accept','complete','turnin','custom','grind','travel'].includes(s.t)?`<button class="ed ${s.stk?'on':''}" data-stk="${i}" title="Sticky: ${s.stk==='next'?'with next step':s.stk==='sticky'?'until done':'off'} (click to change)" aria-label="Sticky for step ${i+1}">📌</button>`:''}<button class="ed ${s.unote||s.xpo!=null?'on':''}" data-edit="${i}" title="Edit step: note, XP${s.src?'':', text'}" aria-label="Edit step ${i+1}">✎</button><button class="del" data-del="${i}" aria-label="Delete step ${i+1}">×</button></span></li>`);
    if(i===cursor && i<route.steps.length-1) parts.push(`<li class="insert">New steps are added here</li>`);
  });
  if(selSteps.size>1) parts.unshift(`<li class="selbar"><b>${selSteps.size} steps selected</b> <button class="btn sm" data-blk="up" title="Move the block up one step">▲ Up</button><button class="btn sm" data-blk="down" title="Move the block down one step">▼ Down</button><button class="btn sm" data-blk="cursor" title="Move the block to just after the highlighted step">Move after step…</button><button class="btn sm" data-blk="del">Delete</button><button class="btn sm" data-blk="clear">Clear</button><span class="note">Drag any selected step to move them all</span></li>`);
  ul.innerHTML=parts.join('');
}
let selSteps=new Set(), selAnchor=null;
// RestedXP keeps #completewith/#sticky steps on screen alongside later steps; show that in the list
function stickyChip(s,i){ const gs=stepGuide(s); if(!gs&&s.stk) return `<span class="stk" title="${esc(s.stk==='next'?'Exported with #completewith next: RestedXP shows it together with the next step and the arrow skips it. Do it on the way.':'Exported with #sticky: RestedXP keeps it on screen until done while you carry on; the arrow skips it.')}">📌 ${s.stk==='next'?'with next step':'sticky'}</span>`; const cw=gs?.cw||s.cw; if(!(gs?.sticky||cw)) return '';
  let tip, lbl;
  if(cw==='next'){ tip='RestedXP shows this step together with the next one and ticks it off when you move past it. Do it passively on the way.'; lbl='with next step'; }
  else if(cw){ const j=route.steps.findIndex((x,k)=>k>i&&x.src&&x.src.g===s.src.g&&(G(x.src.g)?.steps[x.src.i]?.label===cw)); tip=`RestedXP keeps this on screen while you do the following steps, until you reach ${j>=0?'step '+(j+1)+' ('+rxpPlain(stepText(route.steps[j]).t)+')':'the guide step labelled '+cw+' (not in your route)'}.`; lbl=j>=0?'until step '+(j+1):'until '+cw; }
  else { tip='RestedXP keeps this step on screen until it is done, while you carry on with the following steps.'; lbl='sticky'; }
  return `<span class="stk" title="${esc(tip)}">📌 ${esc(lbl)}</span>`; }
const qdgCache=new Map();
let qNameIdx=null;
function questDgTag(qid){ if(qdgCache.has(qid)) return qdgCache.get(qid); let tag=baseDgTag(qid);
  if(!tag&&Q(qid)){ if(!qNameIdx){ qNameIdx=new Map(); for(const id in DB.q){ const n=DB.q[id].n.replace(/\s*\(\d+\/\d+\)$/,''); if(!qNameIdx.has(n)) qNameIdx.set(n,[]); qNameIdx.get(n).push(+id); } }
    for(const o of qNameIdx.get(Q(qid).n.replace(/\s*\(\d+\/\d+\)$/,''))||[]) if(o!==qid){ const t=baseDgTag(o); if(t){ tag=t; break; } } } // same-name chain parts (e.g. Hidden Enemies 1-5)
  qdgCache.set(qid,tag); return tag; }
const bdgCache=new Map();
function baseDgTag(qid){ if(bdgCache.has(qid)) return bdgCache.get(qid); let tag=null; const q=Q(qid);
  if(q&&isDungeonQuest(qid)){ let name=META.dungeons[q.z]?.n; if(!name){ const p=objectives(qid).flatMap(o=>o.pts).find(p=>p.dg); if(p) name=dungeonAt(p); }
    if(name){ const d=DUNGEONS.find(d=>d[1]===name)||DUNGEONS.find(d=>name.startsWith(d[1])||d[1].startsWith(name)); tag=d?d[0]:name; } }
  bdgCache.set(qid,tag); return tag; }
function stepDgTags(i){ const s=route.steps[i]; const out=[]; const gs=s.src?G(s.src.g)?.steps[s.src.i]:null;
  if(gs) for(const t of gs.dg||[]) if(dgOn(t)&&!out.includes(t)) out.push(t);
  const t=s.q?questDgTag(s.q):null; if(t&&!out.includes(t)) out.push(t); return out; }
function selectDungeon(tag,add){ if(!add) selSteps.clear(); route.steps.forEach((_,i)=>{ if(stepDgTags(i).includes(tag)) selSteps.add(i); }); renderSteps(); toast(selSteps.size?`Selected ${selSteps.size} ${tag} steps`:`No ${tag} steps`); }
function moveBlock(idxs,to){ // move steps idxs (any order) so they sit before index `to` (to may equal steps.length)
  idxs=[...new Set(idxs)].sort((a,b)=>a-b); if(!idxs.length) return; const items=idxs.map(i=>route.steps[i]);
  const ins=to-idxs.filter(i=>i<to).length; pushHistory();
  for(let k=idxs.length-1;k>=0;k--) route.steps.splice(idxs[k],1);
  route.steps.splice(ins,0,...items); selSteps=new Set(items.map((_,k)=>ins+k)); selAnchor=ins; cursor=ins+items.length-1; refresh(); scrollCursor(); }
function blockAction(a){ const idx=[...selSteps].sort((x,y)=>x-y); if(!idx.length) return;
  if(a==='clear'){ selSteps.clear(); renderSteps(); return; }
  if(a==='del'){ pushHistory(); const del=new Set(idx); idx.forEach(i=>markRemoved(route.steps[i])); const before=idx.filter(i=>i<=cursor).length; route.steps=route.steps.filter((_,i)=>!del.has(i)); cursor=Math.max(-1,cursor-before); selSteps.clear(); refresh(); toast(`Deleted ${idx.length} steps`); return; }
  if(a==='up'){ if(idx[0]===0) return; moveBlock(idx,idx[0]-1); return; }
  if(a==='down'){ const last=idx[idx.length-1]; if(last>=route.steps.length-1) return; moveBlock(idx,last+2); return; }
  if(a==='cursor'){ askMoveAfter(idx); } }
async function askMoveAfter(idx){ const v=await askText(`Move the ${idx.length} selected steps to just after step number:`,String(cursor+1),'Move'); if(v==null) return; const n=parseInt(v); if(!(n>=0&&n<=route.steps.length)) return toast('Enter a step number between 0 and '+route.steps.length);
  if(idx.includes(n-1)&&!idx.includes(n)) return; moveBlock(idx,n); }
$('#steps').addEventListener('click',e=>{
  if(e.target.closest('a.wh')){ e.stopPropagation(); return; }
  const pe=e.target.closest('[data-pathed]'); if(pe){ e.stopPropagation(); startPathEdit(+pe.dataset.pathed); return; }
  const sk=e.target.closest('[data-stk]'); if(sk){ e.stopPropagation(); const s=route.steps[+sk.dataset.stk]; pushHistory(); s.stk=s.stk==null||s.stk===false?'next':s.stk==='next'?'sticky':false; refresh(); toast(s.stk==='next'?'Sticky: done together with the next step':s.stk==='sticky'?'Sticky: stays on screen until done':'Not sticky'); return; }
  const ed=e.target.closest('[data-edit]'); if(ed){ e.stopPropagation(); editStep(+ed.dataset.edit); return; }
  const ux=e.target.closest('[data-uxp]'); if(ux){ e.stopPropagation(); askUXP(route.steps[+ux.dataset.uxp]); return; }
  const bb=e.target.closest('[data-blk]'); if(bb){ e.stopPropagation(); blockAction(bb.dataset.blk); return; }
  const dgs=e.target.closest('[data-dgsel]'); if(dgs){ e.stopPropagation(); selectDungeon(dgs.dataset.dgsel,e.ctrlKey||e.metaKey||e.shiftKey); return; }
  if(e.target.closest('.selbar')) return;
  const d=e.target.closest('[data-del]'); if(d){ e.stopPropagation(); removeStep(+d.dataset.del); return; }
  const ob=e.target.closest('[data-opt]'); if(ob){ e.stopPropagation(); const i=+ob.dataset.opt; pushHistory(); route.steps[i].opt=!route.steps[i].opt; refresh(); return; }
  const fg=e.target.closest('[data-fixgrind]'); if(fg){ e.stopPropagation(); const [i,l]=fg.dataset.fixgrind.split(':').map(Number); pushHistory(); route.steps.splice(i,0,{t:'grind',mode:'to',level:l,xp:0,note:'Catch up to level '+l}); if(cursor>=i) cursor++; refresh(); toast('Grind to level '+l+' added'); return; }
  const li=e.target.closest('[data-i]'); if(!li) return; const i=+li.dataset.i;
  if(e.shiftKey){ const a=selAnchor??cursor; selSteps=new Set(); for(let k=Math.min(a,i);k<=Math.max(a,i);k++) if(k>=0) selSteps.add(k); selAnchor=a; renderSteps(); return; }
  if(e.ctrlKey||e.metaKey){ if(!selSteps.size&&cursor>=0) selSteps.add(cursor); selSteps.has(i)?selSteps.delete(i):selSteps.add(i); selAnchor=i; renderSteps(); return; }
  if(selSteps.size){ selSteps.clear(); } selAnchor=i; setCursor(i);
  const s=route.steps[i]; if(s&&s.q&&Q(s.q)){ selQuest=s.q; renderRight(); requestDraw(); }
});
$('#steps').addEventListener('dblclick',async e=>{ const li=e.target.closest('[data-i]'); if(!li) return; const s=route.steps[+li.dataset.i];
  if(s&&s.q&&!Q(s.q)&&s.t==='turnin'){ askUXP(s); return; } if(s&&s.t==='buy'){ openBuy(+li.dataset.i); return; } if(s&&['grind','travel','custom'].includes(s.t)) openStepDialog(s.t,+li.dataset.i); });
let pathEdit=null, pathDrag=null, pathHits=[];
function ownPath(s){ if(!s.path) s.path=(pathOf(s)||[]).map(l=>({...l})); delete s.loopRaw; s.pathSrc='edited'; return s.path; }
function pathDelPt(k){ const s=route.steps[pathEdit]; if(pathOf(s).length<=2) return toast('A path needs at least 2 points: use Remove path instead'); pushHistory(); ownPath(s).splice(k,1); refresh(); }
function pathClick(x,y){ const s=route.steps[pathEdit]; const h=pathHits.find(h=>Math.hypot(h.x-x,h.y-y)<10); if(h) return true;
  const P=pathHits; let best=-1,bd=12; for(let k=0;k<P.length;k++){ const a=P[k], b=P[(k+1)%P.length]; const dx=b.x-a.x, dy=b.y-a.y, L=dx*dx+dy*dy||1; const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/L)); const d=Math.hypot(a.x+t*dx-x,a.y+t*dy-y); if(d<bd){bd=d;best=k;} }
  if(best<0) return false; pushHistory(); const path=ownPath(s); const X=(x-view.tx)/view.s, Y=(y-view.ty)/view.s; path.splice(best+1,0,planeToZp(path[best].z,X,Y)); refresh(); return true; }
function startPathEdit(i){ const s=route.steps[i]; if(!pathOf(s)){ pushHistory(); const p=genPath(s.q,s.obj,routeRefBefore(i)); if(!p) return toast('Not enough spawn points to build a path for this objective'); s.path=p; s.pathSrc='generated'; refresh(); }
  pathEdit=i; closePanels&&closePanels(); const pts=SIM.res[i]?.path||[]; if(pts.length){ const xs=pts.map(p=>p.X), ys=pts.map(p=>p.Y); const bw=Math.max(60,Math.max(...xs)-Math.min(...xs)), bh=Math.max(60,Math.max(...ys)-Math.min(...ys)); flyTo((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,Math.min(8,Math.min(W/(bw*2.2),H/(bh*2.2)))); }
  $('#pathbar').style.display='flex'; $('#pathMsg').textContent=`Path for step ${i+1}${stepGuide(s)&&!s.path?' (from the guide: editing makes it your own)':''}: drag points · click the line to add one · right-click a point to remove it`; requestDraw(); }
function stopPathEdit(){ pathEdit=null; pathDrag=null; $('#pathbar').style.display='none'; requestDraw(); }
function editStep(i){ const s=route.steps[i], r=SIM.res[i]||{}; const d=$('#dlgEdit');
  const own=!s.src&&s.t==='travel'&&(s.kind==='note'||s.kind==='goto'); $('#edTextL').hidden=!own; $('#edText').value=own?(s.text||''):'';
  $('#edTitle').textContent='Edit step '+(i+1); $('#edNote').value=s.unote||''; $('#edXp').value=s.xpo!=null?s.xpo:'';
  const calc=s.xpo!=null?r.xpCalc:r.gained; $('#edXp').placeholder=String(calc||0); $('#edXpHint').textContent=`Planner's estimate: ${fmt(calc||0)} XP. Leave empty to use it.`+(s.t==='grind'&&s.mode==='to'?' Setting XP here replaces the level target with that amount of XP.':'');
  const done=v=>{ d.close(); if(!v) return; pushHistory();
    if(v==='reset'){ delete s.unote; delete s.xpo; }
    else { const n=$('#edNote').value.replace(/\s+$/,''); if(n) s.unote=n; else delete s.unote; const x=$('#edXp').value.trim(); if(x!==''&&+x>=0) s.xpo=Math.round(+x); else delete s.xpo; if(own){ const t=$('#edText').value.trim(); if(t) s.text=t; } }
    refresh(); };
  const pth=pathOf(s), canPath=s.t==='complete'&&s.q; $('#edPathRow').hidden=!canPath;
  if(canPath){ $('#edPathInfo').textContent=pth?`Path: ${pth.length} points (${s.path?(s.pathSrc==='generated'?'generated':s.pathSrc==='edited'?'edited by you':'from '+s.pathSrc):'from the guide, exported as is'})`:'No path: the arrow points at one spot.'; $('#edPathRm').hidden=!s.path; $('#edPathGen').textContent=pth?'Regenerate':'Make path'; }
  $('#edPathEdit').onclick=()=>{ d.close(); startPathEdit(i); };
  $('#edPathGen').onclick=()=>{ const p=genPath(s.q,s.obj,routeRefBefore(i)); if(!p) return toast('Not enough spawn points to build a path for this objective'); d.close(); pushHistory(); s.path=p; delete s.loopRaw; s.pathSrc='generated'; refresh(); startPathEdit(i); };
  $('#edPathRm').onclick=()=>{ d.close(); pushHistory(); if(stepGuide(s)?.path) s.path=null; else delete s.path; delete s.loopRaw; delete s.pathSrc; if(pathEdit===i) stopPathEdit(); refresh(); };
  $('#edOk').onclick=()=>done('ok'); $('#edNo').onclick=()=>done(null); $('#edReset').onclick=()=>done('reset'); d.showModal(); setTimeout(()=>$('#edNote').focus(),0); }
async function askUXP(s){ { const v=await askText(`XP reward for ${s.qn||'quest '+s.q} (at your level):`,String(route.qxp?.[s.q]||'')); if(v==null) return; pushHistory(); route.qxp=route.qxp||{}; if(+v>0) route.qxp[s.q]=Math.round(+v); else delete route.qxp[s.q]; refresh(); } }
let dragFrom=null;
$('#steps').addEventListener('dragstart',e=>{ const li=e.target.closest('.step'); if(!li) return; dragFrom=+li.dataset.i; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(dragFrom)); });
$('#steps').addEventListener('dragover',e=>{ const li=e.target.closest('.step'); if(!li||dragFrom===null) return; e.preventDefault(); $$('.step.dragover').forEach(x=>x.classList.remove('dragover')); li.classList.add('dragover'); });
$('#steps').addEventListener('drop',e=>{ const li=e.target.closest('.step'); $$('.step.dragover').forEach(x=>x.classList.remove('dragover')); if(!li||dragFrom===null) return; e.preventDefault(); const to=+li.dataset.i;
  if(selSteps.size>1&&selSteps.has(dragFrom)){ if(!selSteps.has(to)) moveBlock([...selSteps],to); } else { selSteps.clear(); moveStep(dragFrom,to); } dragFrom=null; });
$('#steps').addEventListener('dragend',()=>{ dragFrom=null; $$('.step.dragover').forEach(x=>x.classList.remove('dragover')); });

function renderXP(){
  const st=SIM.st; const need=st.level<MAXLVL?XP_TABLE[st.level]:1; const pct=st.level<MAXLVL?st.xp/need*100:100;
  $('#lvl').innerHTML=`${st.level}<small>${cursor<0?'at start':'after step '+(cursor+1)}</small>`;
  $('#xpfill').style.width=pct+'%';
  $('#xplbl').textContent=st.level<MAXLVL?`${fmt(st.xp)} / ${fmt(need)} XP (${pct.toFixed(0)}%)`:'Level 60';
  const e=SIM.end; const quests=route.steps.filter(s=>s.t==='turnin').length; const endL=e.level+(e.level<MAXLVL?e.xp/XP_TABLE[e.level]:0);
  $('#groupSel').value=String(SIM.st.party||1);
  $('#xpsum').innerHTML=`Route end: <b>level ${endL.toFixed(2)}</b> · ${quests} turn-ins · ${SIM.st.log.size}/${LOGMAX} in log`;
}
function renderRouteHead(){
  $('#routeSel').innerHTML=store.routes.map(r=>`<option value="${r.id}" ${r.id===route.id?'selected':''}>${esc(r.name)}</option>`).join('');
  const c=route.char; $('#whoBtn').innerHTML=`<b>${esc(c.race)} ${esc(c.cls)}</b> · ${c.faction==='H'?'Horde':'Alliance'}`;
  const no=route.steps.filter(s=>s.opt).length; $('#routeInfo').innerHTML=`${route.steps.length} steps · starts at level ${c.level}`+(no?` · <label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="optCount" ${route.optOff?'':'checked'}> count ${no} optional</label>`:'');
  const oc=document.getElementById('optCount'); if(oc) oc.onchange=()=>{ route.optOff=!oc.checked; refresh(); };
  const tags=new Map(); route.steps.forEach((_,i)=>stepDgTags(i).forEach(t=>tags.set(t,(tags.get(t)||0)+1)));
  if(tags.size){ const sel=document.createElement('select'); sel.id='dgPick'; sel.title='Select every step for a dungeon'; sel.style.cssText='margin-left:6px;font-size:12px;max-width:150px';
    sel.innerHTML='<option value="">Select dungeon steps…</option>'+[...tags].map(([t,n])=>`<option value="${esc(t)}">${esc(t)} (${n})</option>`).join('');
    sel.onchange=()=>{ if(sel.value) selectDungeon(sel.value); sel.value=''; }; $('#routeInfo').appendChild(sel); }
}

/* ---------- right panel ---------- */
let tab='avail';
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>{ tab=b.dataset.tab; renderRight(); }));
$('#availFilter').addEventListener('input',()=>renderRight());
$('#availZone').addEventListener('change',()=>renderRight());
function rootsHTML(a){ return a.roots.map(r=>{ const q=Q(r); const w=whyUnavailable(r,SIM.st,route); return `<a href="#" data-q="${r}" class="lk">${esc(q.n)}</a> <span class="note">[${q.l}]${w&&w.level?' lvl '+w.level:''}</span>${w?'':` <button class="btn sm" data-accept="${r}" title="Accept the prerequisite">Accept</button>`}`; }).join(' · '); }
function lockRow(a){ const q=Q(a.qid); const dc=diffClass(q.l,SIM.st.level); const xp=questXP(a.qid,SIM.st.level);
  return `<div class="qrow locked ${selQuest===a.qid?'sel':''}" data-q="${a.qid}"><span class="lv c-${dc}">${q.l}</span><span class="nm"><span class="c-${dc}">🔒 ${esc(q.n)}</span> <span class="meta">${xp?'+'+fmt(xp)+' XP':''}${isDungeonQuest(a.qid)?' · <span class="dgtxt">dungeon</span>':''}</span><br><span class="meta">Needs: ${rootsHTML(a)}</span></span></div>`; }
function qRow(qid,extra,locked){
  const q=Q(qid); const lv=SIM.st.level; const dc=locked?'grey':diffClass(q.l,lv); const xp=questXP(qid,Math.max(lv,locked||0));
  return `<div class="qrow ${selQuest===qid?'sel':''}" data-q="${qid}"><span class="lv c-${dc}">${q.l}</span><span class="nm"><span class="c-${dc}">${esc(q.n)}</span><br><span class="meta">${extra||(xp?'+'+fmt(xp)+' XP':'no XP data')}${isDungeonQuest(qid)?' · <span class="dgtxt">dungeon</span>':''}</span></span>${locked?'':`<button class="btn sm" data-accept="${qid}">Accept</button>`}</div>`;
}
function renderRight(){
  $$('.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  $('#availHead').hidden=tab!=='avail';
  const body=$('#rightBody');
  if(tab==='avail'){
    const f=$('#availFilter').value.trim().toLowerCase(); const zf=$('#availZone').value; const lv=SIM.st.level;
    const near=SIM.near; const groups={}; const zonesSeen=new Set();
    for(const a of SIM.avail){
      const q=Q(a.qid); const zl=areaLabel(q); zonesSeen.add(zl);
      if(f && !q.n.toLowerCase().includes(f) && String(a.qid)!==f) continue;
      if(zf==='near'){ if(!near) continue; const sp=starterPts(a.qid); if(!(sp.some(p=>p.z===near.z)||zl===zoneName(near.z))) continue; }
      else if(zf && zl!==zf) continue;
      const key=a.locked?(diffClass(q.l,lv)==='grey'?'Low level':zl):!a.ok?'Unlocks soon':(diffClass(q.l,lv)==='grey'?'Low level':zl);
      (groups[key]=groups[key]||[]).push(a);
    }
    const sel=$('#availZone'); const keep=sel.value;
    sel.innerHTML=`<option value="">All zones</option><option value="near">Near this step</option>`+[...zonesSeen].sort().map(z=>`<option ${z===keep?'selected':''}>${esc(z)}</option>`).join('');
    if(keep==='near') sel.value='near';
    const ref=near?.pt; const dist=k=>{ if(!ref) return 0; let b=1e18; for(const a of groups[k]) for(const p of starterPts(a.qid).slice(0,3)){ const d=(p.X-ref.X)**2+(p.Y-ref.Y)**2; if(d<b) b=d; } return b; };
    const dk={}; for(const k in groups) dk[k]=dist(k);
    const order=Object.keys(groups).sort((a,b)=>{ const rank=k=>k==='Needs a prerequisite'?1:k==='Unlocks soon'?2:k==='Low level'?3:0; if(rank(a)!==rank(b)) return rank(a)-rank(b); return dk[a]-dk[b]; });
    let html=''; let n=0;
    for(const k of order){ const list=groups[k].sort((a,b)=>(!!a.locked-!!b.locked)||Q(a.qid).l-Q(b.qid).l||Q(a.qid).n.localeCompare(Q(b.qid).n)); n+=list.length;
      html+=`<div class="qgroup"><h3>${esc(k)} (${list.length})</h3>${list.slice(0,150).map(a=>a.ok?qRow(a.qid):a.locked?lockRow(a):qRow(a.qid,'Unlocks at level '+a.level,a.level)).join('')}</div>`; }
    { const fl=fqAvail(SIM.st).filter(a=>!f||a.e.n.toLowerCase().includes(f)||String(a.e.q)===f).sort((a,b)=>a.e.l-b.e.l||a.e.n.localeCompare(b.e.n)); if(!foreverQuests().size) html=`<p class="note" style="margin:4px 0 8px">Forever quests (not in Questie yet) appear here and on the map once you import the RestedXP guide files for your zones.</p>`; else if(fl.length) html=`<div class="qgroup"><h3>Forever quests from your guides (${fl.length})</h3><p class="note" style="margin:2px 0 6px">Not in Questie yet: locations come from the guides you imported.</p>${fl.slice(0,150).map(fqRow).join('')}</div>`+html; }
    body.innerHTML=html||`<div class="empty">No quests match. Try another zone filter, or add a grind step to reach the next unlock level.</div>`;
  } else if(tab==='log'){
    const st=SIM.st; const rows=[...st.log].map(([qid,v])=>{ const q=Q(qid); if(!q) return ''; const dc=diffClass(q.l,st.level);
      return `<div class="qrow ${selQuest===qid?'sel':''}" data-q="${qid}"><span class="lv c-${dc}">${q.l}</span><span class="nm"><span class="c-${dc}">${esc(q.n)}</span><br><span class="meta">${v.done?'Ready to turn in':'In progress'} · ${esc(areaLabel(q))}</span>${v.done?'':objChecklist(qid,v)}</span><span class="row" style="flex-wrap:nowrap">${v.done?'':`<button class="btn sm" data-complete="${qid}">Done</button>`}<button class="btn sm" data-turnin="${qid}">Turn in</button></span></div>`; });
    body.innerHTML=`<div class="qgroup"><h3>Quest log at this step (${st.log.size}/${LOGMAX})</h3>${rows.join('')||'<div class="empty">Your quest log is empty at this step.</div>'}</div>`;
  } else if(tab==='guides'){ body.innerHTML=renderGuides(); afterGuidesRender(); } else body.innerHTML=renderDetail();
}
function renderDetail(){
  const qid=selQuest; const q=qid&&Q(qid);
  if(!q) return `<div class="empty">Select a quest on the map, in a list, or with search to see its details.</div>`;
  const st=SIM.st; const w=whyUnavailable(qid,st,route); const inLog=st.log.get(qid);
  const sp=starterPts(qid)[0], fp=finisherPts(qid)[0];
  const loc=p=>p?`${esc(p.label)} · ${esc(zoneName(p.z))} ${(+p.px).toFixed(1)}, ${(+p.py).toFixed(1)}${p.dg?' (dungeon)':''}`:'Unknown';
  const itemStart=q.s.i.map(i=>DB.i[i]?.n||('Item '+i));
  const pre=[...(q.pg||[]),...(q.ps||[])].filter(Q);
  let act='';
  if(inLog){ if(!inLog.done&&hasObjectives(qid)) act+=`<button class="btn" data-complete="${qid}">Mark objectives done</button>`; act+=`<button class="btn gold" data-turnin="${qid}">Turn in</button>`; }
  else if(!w) act+=`<button class="btn gold" data-accept="${qid}">Accept</button>`;
  else if(!st.turned.has(qid)) act+=`<button class="btn" data-accept="${qid}">Accept anyway</button>`;
  const obs=objectives(qid);
  return `<div class="detail"><h2>${esc(q.n)}</h2><div class="note">Quest ${qid} · ${whLink(qid)}</div>
  ${w?`<div class="reason">${esc(w.why)}</div>`:''}
  <dl class="facts"><dt>Level</dt><dd><span class="c-${diffClass(q.l,st.level)}">${q.l}</span> (requires ${q.r})</dd>
  <dt>XP now</dt><dd>${q.xp?fmt(questXP(qid,st.level))+' of '+fmt(isDungeonQuest(qid)?q.xp[1]*dqMult():q.xp[1])+(isDungeonQuest(qid)?` <span class="dgtxt">(dungeon: Era ${fmt(q.xp[1])} × ${dqMult()})</span>`:''):'No XP data'}</dd>
  <dt>Zone</dt><dd>${esc(areaLabel(q))}</dd>
  <dt>Starts</dt><dd>${itemStart.length?'From item: '+esc(itemStart.join(', ')):loc(sp)}</dd>
  <dt>Ends</dt><dd>${loc(fp)}</dd></dl>
  ${q.t?`<p>${esc(q.t)}</p>`:''}
  ${obs.length?`<b>Objectives</b><ul>${obs.map(o=>`<li>${esc(o.text)}${o.pts.length?'':' <span class="note">(no map data)</span>'}</li>`).join('')}</ul>`:'<p class="note">No objectives; talk to the quest ender.</p>'}
  ${pre.length?`<p class="note">Follows: ${pre.map(p=>`<button class="linkish" data-sel="${p}">${esc(Q(p).n)}</button>`).join(', ')}</p>`:''}
  ${q.nx&&Q(q.nx)?`<p class="note">Leads to: <button class="linkish" data-sel="${q.nx}">${esc(Q(q.nx).n)}</button></p>`:''}
  <div class="row" style="margin-top:10px">${act}<button class="btn" data-show="${qid}">Show on map</button></div></div>`;
}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-ride],[data-flynode],[data-fpnode],[data-cobj],[data-accept],[data-complete],[data-turnin],[data-sel],[data-show],[data-q],[data-fp],[data-fly],[data-home],[data-hs],[data-goto]'); if(!t||t.closest('#steps')) return;
  if(t.tagName==='A') e.preventDefault();
  const d=t.dataset;
  if(d.cobj){ const [q,n]=d.cobj.split(':').map(Number); addStep({t:'complete',q,obj:n}); hidePop(); }
  else if(d.accept){ addStep({t:'accept',q:+d.accept}); hidePop(); }
  else if(d.complete){ addStep({t:'complete',q:+d.complete}); hidePop(); }
  else if(d.turnin){ addStep({t:'turnin',q:+d.turnin}); hidePop(); }
  else if(d.flynode){ addStep({t:'travel',kind:'fly',node:d.flynode,text:taxiShort(d.flynode)}); hidePop(); }
  else if(d.fpnode){ addStep({t:'travel',kind:'fp',node:d.fpnode,text:taxiShort(d.fpnode)}); hidePop(); }
  else if(d.fp){ addStep({t:'travel',kind:'fp',text:d.fp,loc:JSON.parse(d.loc)}); hidePop(); }
  else if(d.fly){ addStep({t:'travel',kind:'fly',text:d.fly,loc:JSON.parse(d.loc)}); hidePop(); }
  else if(d.home){ addStep({t:'travel',kind:'home',text:d.home,loc:JSON.parse(d.loc)}); hidePop(); }
  else if(d.hs){ addStep({t:'travel',kind:'hs',text:d.hs,loc:JSON.parse(d.loc)}); hidePop(); }
  else if(d.ride){ const rd=RIDES[+d.ride]; addStep({t:'travel',kind:'ride',ride:rd.id,text:rd.text}); hidePop(); }
  else if(d.goto){ addStep({t:'travel',kind:'goto',text:d.goto,loc:JSON.parse(d.loc)}); hidePop(); }
  else if(d.sel){ selectQuest(+d.sel); }
  else if(d.show){ showQuestOnMap(+d.show); }
  else if(d.q){ selectQuest(+d.q,true); }
});
function selectQuest(qid,center){ selQuest=qid; tab='detail'; renderRight(); if(center) showQuestOnMap(qid,true); requestDraw(); }
function showQuestOnMap(qid,soft){
  const pts=[...starterPts(qid).slice(0,2),...finisherPts(qid).slice(0,2),...objectives(qid).flatMap(o=>o.pts)].filter(p=>!p.dg);
  if(!pts.length) return toast('No map position for this quest');
  const xs=pts.map(p=>p.X), ys=pts.map(p=>p.Y); const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const s=Math.min(0.5,W/Math.max(400,(x1-x0)*1.4),H/Math.max(300,(y1-y0)*1.4));
  if(soft){ const [sx,sy]=toS({X:(x0+x1)/2,Y:(y0+y1)/2}); if(sx>60&&sx<W-60&&sy>60&&sy<H-60&&view.s>0.04) { requestDraw(); return; } }
  flyTo((x0+x1)/2,(y0+y1)/2,Math.max(s,0.04));
}

/* ---------- popups ---------- */
function hidePop(){ $('.pop')?.remove(); }
function showPop(h,x,y){
  hidePop(); const st=SIM.st; const lv=st.level; let html='';
  const locAttr=l=>`data-loc='${esc(JSON.stringify(l))}'`;
  if(h.kind==='quest'){
    html+=`<h4>${esc(h.label)}</h4>`;
    for(const q of h.turn){ const v=st.log.get(q); html+=`<div class="it"><b>${esc(Q(q).n)}</b> <span class="note">${v.done?'ready':'in progress'} · +${fmt(questXP(q,lv))} XP</span><div class="row">${!v.done&&hasObjectives(q)?`<button class="btn sm" data-complete="${q}">Objectives done</button>`:''}<button class="btn sm gold" data-turnin="${q}">Turn in</button><button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`; }
    for(const q of h.avail){ const dc=diffClass(Q(q).l,lv); html+=`<div class="it"><span class="c-${dc}">[${Q(q).l}] ${esc(Q(q).n)}</span> <span class="note">+${fmt(questXP(q,lv))} XP</span><div class="row"><button class="btn sm gold" data-accept="${q}">Accept</button><button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`; }
    for(const a of h.locked||[]){ const q=a.qid; html+=`<div class="it"><span class="c-${diffClass(Q(q).l,lv)}">🔒 [${Q(q).l}] ${esc(Q(q).n)}</span> <span class="note">+${fmt(questXP(q,lv))} XP</span><div class="note">Needs: ${rootsHTML(a)}</div><div class="row"><button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`; }
    for(const q of h.sel||[]) html+=`<div class="it">${esc(Q(q).n)}<div class="row"><button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`;
    if(h.npcLoc) html+=`<div class="it"><div class="row">${flyBtn(h.npcLoc)}<button class="btn sm" data-goto="${esc(h.label)}" ${locAttr({z:h.npcLoc.z,px:h.npcLoc.px,py:h.npcLoc.py})}>Go to</button></div></div>`;
  } else if(h.kind==='obj'){
    const q=h.qids[0]; html+=`<h4>${esc(Q(q).n)}</h4><div class="it">${esc(h.obText)}<br><span class="note">${esc(h.label||'')}</span><div class="row">${h.obRx&&objNums(q).length>1?`<button class="btn sm gold" data-cobj="${q}:${h.obRx}">This objective done</button><button class="btn sm" data-complete="${q}">All objectives done</button>`:`<button class="btn sm gold" data-complete="${q}">Objectives done</button>`}<button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`;
  } else if(h.kind==='fp'){
    const node=Object.entries(META.taxi.nodes).find(([id,n])=>n.fm===h.npc)?.[0]; const place=guessPlace(h.loc);
    html+=`<h4>${esc(h.label)}</h4><div class="it">${node?`<span class="note">${esc(META.taxi.nodes[node].n)}${SIM.st.fps.has(node)?' · learned':''}</span>`:''}<div class="row">${node?`<button class="btn sm gold" data-fpnode="${node}">Get flight path</button><button class="btn sm" data-flynode="${node}">Fly here</button>`:`<button class="btn sm gold" data-fp="${esc(place)}" ${locAttr(h.loc)}>Get flight path</button><button class="btn sm" data-fly="${esc(place)}" ${locAttr(h.loc)}>Fly here</button>`}</div></div>`;
  } else if(h.kind==='town'){
    html+=`<h4>${esc(h.label)}</h4><div class="it"><div class="row"><button class="btn sm" data-home="${esc(h.label)}" ${locAttr(h.loc)}>Set hearthstone</button><button class="btn sm" data-hs="${esc(h.label)}" ${locAttr(h.loc)}>Hearth here</button><button class="btn sm" data-goto="${esc(h.label)}" ${locAttr(h.loc)}>Go here</button>${flyBtn(zp2plane(h.loc.z,h.loc.px,h.loc.py))}</div></div>`;
  } else if(h.kind==='fq'){ const e=foreverQuests().get(h.q); const f=fqStatus(h.q);
    html+=`<h4>${esc(e.n)}</h4><div class="it"><span class="note">Forever quest (not in Questie yet) · from ${esc(e.g)}${e.tgtA?' · '+esc(e.tgtA):''}</span><div class="row">${f?'':`<button class="btn sm gold" data-fqa="accept:${e.q}">Accept</button>`}${f==='log'?`<button class="btn sm gold" data-fqa="complete:${e.q}">Complete</button>`:''}${f?`<button class="btn sm${f==='ready'?' gold':''}" data-fqa="turnin:${e.q}">Turn in</button>`:''}<a class="btn sm" href="${whURL(e.q,e.n)}" target="_blank" rel="noopener">Wowhead</a></div></div>`;
  } else if(h.kind==='vendor'){ const v=vendorOf(h.vid);
    html+=`<h4>${esc(v.name)}</h4><div class="it"><span class="note">${esc(v.sub||'Vendor')}${v.items.length?' · sells '+v.items.slice(0,6).map(i=>esc(itemName(i))).join(', ')+(v.items.length>6?'…':''):''}</span><div class="row"><button class="btn sm gold" data-buyv="${v.id}">Buy from ${esc(v.name)}</button></div></div>`;
  } else if(h.kind==='dock'){
    html+=`<h4>${esc(h.dock.label)}</h4>`+h.rides.map(r=>`<div class="it"><div class="row"><button class="btn sm gold" data-ride="${r.id}">${esc(r.text)}</button></div></div>`).join('');
  } else if(h.kind==='ghost'){ html=ghostPopHTML(h);
  } else if(h.kind==='dungeon'||h.kind==='dgobj'){
    const qs=h.kind==='dgobj'?h.qids:[...st.log.keys()].filter(q=>objectives(q).some(o=>o.pts.some(p=>p.dg&&h.p&&Math.abs(p.X-h.p.X)<5&&Math.abs(p.Y-h.p.Y)<5)));
    html+=`<h4>${esc(h.label)}</h4>`;
    if(!qs.length) html+=`<div class="it note">Dungeon entrance. Accept a quest with objectives inside and it will be listed here.</div>`;
    for(const q of qs){ const v=st.log.get(q); html+=`<div class="it"><b>${esc(Q(q).n)}</b> <span class="note">${v&&v.done?'objectives done':'objectives inside'}</span>${objChecklist(q,v)}<div class="row">${v&&!v.done?`<button class="btn sm gold" data-complete="${q}">All objectives done</button>`:''}${v?`<button class="btn sm" data-turnin="${q}">Turn in</button>`:''}<button class="btn sm" data-sel="${q}">Details</button>${whLink(q,true)}</div></div>`; }
  }
  const div=document.createElement('div'); div.className='pop'; div.innerHTML=html; $('#mapwrap').appendChild(div);
  const w=div.offsetWidth, hh=div.offsetHeight; div.style.left=Math.max(6,Math.min(W-w-6,x+12))+'px'; div.style.top=Math.max(6,Math.min(H-hh-6,y+12))+'px';
  $('#tip').style.display='none';
}
function flyBtn(p){ if(!p||!META.taxi) return ''; const id=nearestNode(p); if(!id) return ''; return `<button class="btn sm" data-flynode="${id}" title="Adds a .fly step to the nearest flight path">Fly to ${esc(taxiShort(id))}</button>`; }
function guessPlace(loc){ let best=null,bd=1e18; const p=zp2plane(loc.z,loc.px,loc.py); for(const [z,x,y,n] of META.towns){ const t=zp2plane(z,x,y); if(!t) continue; const d=(t.X-p.X)**2+(t.Y-p.Y)**2; if(d<bd){bd=d;best=n;} } for(const [z,Z] of Object.entries(META.zones)){ if(!Z.city) continue; const t=zp2plane(z,50,50); const d=(t.X-p.X)**2+(t.Y-p.Y)**2; if(d<bd){bd=d;best=Z.n;} } return bd<1200*1200?best:zoneName(loc.z); }

/* ---------- search ---------- */
let qIndex=null; let resSel=0;
$('#search').addEventListener('input',()=>{ const v=$('#search').value.trim().toLowerCase(); const box=$('#results'); if(v.length<2){ box.hidden=true; return; }
  qIndex=qIndex||Object.entries(DB.q).map(([id,q])=>[+id,q.n.toLowerCase()]);
  const res=qIndex.filter(([id,n])=>n.includes(v)||String(id)===v).slice(0,40);
  resSel=0; box.innerHTML=res.map(([id],i)=>{ const q=Q(id); const w=whyUnavailable(id,SIM.st,route); const status=SIM.st.turned.has(id)?'done':SIM.st.log.has(id)?'in log':w?(w.hard?'n/a':'locked'):'available';
    return `<button data-pick="${id}" class="${i===0?'hi':''}"><span class="c-${diffClass(q.l,SIM.st.level)}" style="min-width:24px">${q.l}</span><span style="flex:1">${esc(q.n)}<br><span class="note">${esc(areaLabel(q))} · ${status}</span></span></button>`; }).join('')||'<div class="empty">No quests found.</div>';
  box.hidden=false; });
$('#search').addEventListener('keydown',e=>{ const btns=$$('#results button'); if(!btns.length) return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); resSel=(resSel+(e.key==='ArrowDown'?1:-1)+btns.length)%btns.length; btns.forEach((b,i)=>b.classList.toggle('hi',i===resSel)); btns[resSel].scrollIntoView({block:'nearest'}); }
  else if(e.key==='Enter'){ btns[resSel].click(); } else if(e.key==='Escape'){ $('#results').hidden=true; } });
$('#results').addEventListener('click',e=>{ const b=e.target.closest('[data-pick]'); if(!b) return; $('#results').hidden=true; $('#search').value=''; selectQuest(+b.dataset.pick); showQuestOnMap(+b.dataset.pick); openPanel('right'); });
document.addEventListener('click',e=>{ if(!e.target.closest('.search')) $('#results').hidden=true; });

/* ---------- dialogs ---------- */
function openStepDialog(kind,editIndex){
  const dlg={grind:'#dlgGrind',travel:'#dlgTravel',custom:'#dlgCustom'}[kind]; const d=$(dlg); const f=d.querySelector('form');
  const s=editIndex!=null?route.steps[editIndex]:null; let loc=s?.loc||null;
  const locEl=d.querySelector('[id$="Loc"]'); const showLoc=()=>locEl.textContent=loc?`${zoneName(loc.z)} ${loc.px}, ${loc.py}`:'No location'; showLoc();
  d._setLoc=l=>{ loc=l; showLoc(); };
  f.reset();
  const lv=SIM.st.level;
  if(kind==='grind'){ setSeg('#grindMode',s?.mode||'add'); f.amount.value=s?.amount||''; f.src.value=s?.src||'mobs'; f.tlevel.value=s?.level||Math.min(60,lv+1); f.txp.value=s?.xp||0; f.note.value=s?.note||''; f.mlevel.value=lv; f.kills.value=''; updEst(); }
  if(kind==='travel'){ f.kind.value=s?.kind||'fly'; f.text.value=s?.text||''; fillNodeSel(f,s?.node||(s?resolveNode(s):null)); }
  if(kind==='custom'){ f.name.value=s?.name||''; f.xp.value=s?.xp||''; f.qid.value=s?.qid||''; f.act.value=s?.act||'turnin'; }
  d.querySelector('.gold').textContent=s?'Save step':'Add step';
  f.onsubmit=null;
  d.onclose=()=>{ if(d.returnValue!=='ok'||d._picking) return; let step;
    if(kind==='grind'){ const m=$('#grindMode [aria-pressed="true"]').dataset.m; step=m==='to'?{t:'grind',mode:'to',level:Math.max(2,Math.min(60,+f.tlevel.value||lv+1)),xp:+f.txp.value||0,note:f.note.value}:{t:'grind',mode:'add',amount:Math.max(0,+f.amount.value||0),src:f.src.value,note:f.note.value}; }
    if(kind==='travel'){ step={t:'travel',kind:f.kind.value,text:f.text.value}; if((step.kind==='fly'||step.kind==='fp')&&f.node.value){ step.node=f.node.value; step.text=taxiShort(step.node); loc=null; } }
    if(kind==='custom') step={t:'custom',name:f.name.value||'Custom quest',xp:+f.xp.value||0,qid:+f.qid.value||null,act:f.act.value};
    if(loc) step.loc=loc;
    if(s){ pushHistory(); route.steps[editIndex]=step; refresh(); } else addStep(step);
  };
  d.showModal();
}
function setSeg(sel,m){ $$(sel+' button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.m===m))); if(sel==='#grindMode') $$('#dlgGrind [data-gm]').forEach(el=>el.hidden=el.dataset.gm!==m); if(sel==='#expMode') $$('#dlgExport [data-exp]').forEach(el=>el.hidden=el.dataset.exp!==m); }
$('#grindMode').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setSeg('#grindMode',b.dataset.m); });
function updEst(){ const f=$('#grindForm'); const party=SIM.st.party||1; const per=mobXP(SIM.st.level,+f.mlevel.value||1,f.elite.checked,party,f.dgmob.checked?killCfg().dg:0); const n=+f.kills.value||0; $('#estOut').textContent=`${fmt(per)} XP per kill at level ${SIM.st.level}${party>1?` in a group of ${party}`:' solo'} → ${fmt(per*n)} XP`; return per*n; }
['mlevel','kills','elite','dgmob'].forEach(n=>$('#grindForm')[n].addEventListener('input',updEst));
$('#estUse').addEventListener('click',()=>{ $('#grindForm').amount.value=updEst(); });
function startPick(dlgSel,cb){ const d=$(dlgSel); d._picking=true; d.close('pick'); d._picking=false; picking=l=>{ cb(l); d.showModal(); }; canvas.classList.add('picking'); $('#pickbar').style.display='flex'; closePanels(); }
function stopPick(){ picking=null; canvas.classList.remove('picking'); $('#pickbar').style.display='none'; }
let buyCtx=null;
function openBuy(i,vid){ const s=i!=null?route.steps[i]:null; buyCtx={i,vid:s?s.npc:(vid!=null?+vid:null),items:new Map((s?.items||[]).map(it=>[it.id?String(it.id):'n:'+it.n,{...it}]))};
  $('#buyFind').value=''; $('#buyOther').value=''; $('#buyOtherId').value=''; $('#buyOtherN').value='1'; $('#buyMsg').textContent=''; $('#buyOk').textContent=s?'Save':'Add step'; renderBuy(); $('#dlgBuy').showModal(); }
function renderBuy(){ const ref=routeRefBefore(buyCtx.i!=null?buyCtx.i:cursor+1); const f=$('#buyFind').value.trim().toLowerCase();
  let L=Object.keys(META.vend||{}).map(vendorOf).filter(v=>vendorOK(v)&&(!f||v.name.toLowerCase().includes(f)||(v.sub||'').toLowerCase().includes(f)||v.items.some(i=>itemName(i).toLowerCase().includes(f))));
  const dist=v=>{ if(!ref) return 0; let b=1e18; for(const p of vendorPts(v)) b=Math.min(b,Math.hypot(p.X-ref.X,p.Y-ref.Y)); return b; };
  L=L.map(v=>({v,d:dist(v)})).sort((a,b)=>a.d-b.d).slice(0,12); if(buyCtx.vid!=null&&!L.some(x=>x.v.id===buyCtx.vid)){ const v=vendorOf(buyCtx.vid); if(v) L.unshift({v,d:dist(v)}); }
  $('#buyVendors').innerHTML=L.map(({v,d})=>`<button type="button" data-bv="${v.id}" aria-pressed="${v.id===buyCtx.vid}"><b>${esc(v.name)}</b> <span class="note">${esc(v.sub||'')} · ${esc(zoneName(v.sp[0][0]))}${ref?' · '+fmt(Math.round(d))+' yd':''}</span></button>`).join('')||'<span class="note">No vendors match.</span>';
  const v=buyCtx.vid!=null?vendorOf(buyCtx.vid):null; const rows=[];
  if(v) for(const id of v.items){ const k=String(id), it=buyCtx.items.get(k); rows.push(`<label class="buyi"><input type="checkbox" data-bi="${k}" ${it?'checked':''}> <span style="flex:1">${esc(itemName(id))}</span> <input type="number" min="1" data-bn="${k}" value="${it?it.c:1}"></label>`); }
  for(const [k,it] of buyCtx.items) if(!v||!v.items.includes(+k)) rows.push(`<label class="buyi"><input type="checkbox" data-bi="${esc(k)}" checked> <span style="flex:1">${esc(it.n||itemName(it.id))}${it.id?'':' <span class="note">(no item ID: shown as text only)</span>'}</span> <input type="number" min="1" data-bn="${esc(k)}" value="${it.c}"></label>`);
  $('#buyItems').innerHTML=v?(`<div class="note">${v.items.length?'Items this vendor sells (from Questie):':'Questie lists no items for this vendor: add them below.'}</div>`+rows.join('')):(rows.join('')||'<div class="note">Pick a vendor.</div>'); }
$('#buyBtn').addEventListener('click',()=>openBuy(null,null));
$('#buyFind').addEventListener('input',renderBuy);
$('#buyVendors').addEventListener('click',e=>{ const b=e.target.closest('[data-bv]'); if(!b) return; buyCtx.vid=+b.dataset.bv; renderBuy(); });
$('#buyItems').addEventListener('change',e=>{ const c=e.target.closest('[data-bi]'), n=e.target.closest('[data-bn]'); const k=(c||n)?.dataset.bi||(c||n)?.dataset.bn; if(!k) return;
  const cb=$(`#buyItems [data-bi="${CSS.escape(k)}"]`), nn=$(`#buyItems [data-bn="${CSS.escape(k)}"]`); const c0=Math.max(1,parseInt(nn.value)||1);
  if(n&&!cb.checked) cb.checked=true; if(cb.checked){ const old=buyCtx.items.get(k); buyCtx.items.set(k,{...(old||{}),...(k.startsWith('n:')?{}:{id:+k,n:itemName(+k)}),c:c0}); } else buyCtx.items.delete(k); });
$('#buyOtherAdd').addEventListener('click',()=>{ const n=$('#buyOther').value.trim(), id=parseInt($('#buyOtherId').value)||null, c=Math.max(1,parseInt($('#buyOtherN').value)||1); if(!n&&!id) return; const k=id?String(id):'n:'+n; buyCtx.items.set(k,{id,n:n||itemName(id),c}); $('#buyOther').value=''; $('#buyOtherId').value=''; renderBuy(); });
$('#buyNo').addEventListener('click',()=>$('#dlgBuy').close());
$('#buyOk').addEventListener('click',()=>{ if(buyCtx.vid==null){ $('#buyMsg').textContent='Pick a vendor first.'; return; } if(!buyCtx.items.size){ $('#buyMsg').textContent='Tick at least one item.'; return; }
  const v=vendorOf(buyCtx.vid); const step={t:'buy',npc:v.id,npcName:v.name,items:[...buyCtx.items.values()].map(it=>({id:it.id||null,n:it.n||itemName(it.id),c:it.c}))}; $('#dlgBuy').close();
  if(buyCtx.i!=null){ pushHistory(); Object.assign(route.steps[buyCtx.i],step); refresh(); } else addStep(step); });
document.addEventListener('click',e=>{ const b=e.target.closest('[data-fqa]'); if(!b) return; e.stopPropagation(); hidePop(); const [t,q]=b.dataset.fqa.split(':'); const st=fqStep(t,+q); if(st){ addStep(st); if(t==='turnin'&&!route.qxp?.[+q]) toast('Set its XP reward with “Set XP” on the step if you know it.',4000); } });
document.addEventListener('click',e=>{ const b=e.target.closest('[data-buyv]'); if(!b) return; hidePop(); openBuy(null,+b.dataset.buyv); });
$('#pathDone').addEventListener('click',stopPathEdit); document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&pathEdit!=null) stopPathEdit(); });
$('#pickCancel').addEventListener('click',()=>{ const cb=picking; stopPick(); cb&&cb(null); });
[['#grindPick','#dlgGrind'],['#travelPick','#dlgTravel'],['#customPick','#dlgCustom']].forEach(([b,d])=>$(b).addEventListener('click',()=>startPick(d,l=>{ if(l) $(d)._setLoc(l); })));
// dialog close via 'pick' should not add step: returnValue 'pick' != 'ok'
$('#addGrind').addEventListener('click',()=>openStepDialog('grind'));
$('#addTravel').addEventListener('click',()=>openStepDialog('travel'));
const SOURCE_URL='https://github.com/tyba-dev/WoWF-QRP'; // set to the project's GitHub address when it is published
$('#aboutBtn').addEventListener('click',()=>{ $('#aboutSrc').innerHTML=SOURCE_URL?`Source code: <a href="${SOURCE_URL}" target="_blank" rel="noopener">${esc(SOURCE_URL)}</a>.`:'The full source is this page itself (View Source).'; $('#dlgAbout').showModal(); });
$('#aboutClose').addEventListener('click',()=>$('#dlgAbout').close());
$('#restoreBtn').addEventListener('click',async()=>{ const db=await rawDB(); const keys=(await kvKeys()).filter(k=>String(k).startsWith('backup:')).sort().reverse(); const list=$('#backupList');
  if(!keys.length){ list.textContent='No backups yet.'; } else { const rows=[]; for(const k of keys){ const t=await kvGet(k); let st=null; try{ st=JSON.parse(t); }catch(e){} if(!st) continue; rows.push(`<div class="it" style="padding:6px 0;border-top:1px solid var(--line)"><b>${esc(k.slice(7))}</b>: ${st.routes.map(r=>esc(r.name)+' ('+(r.steps||[]).length+' steps)').join(', ')} <button class="btn sm" data-restore="${esc(k)}">Restore</button></div>`); } list.innerHTML=rows.join(''); }
  $('#dlgBackup').showModal(); });
$('#backupList').addEventListener('click',async e=>{ const b=e.target.closest('[data-restore]'); if(!b) return; const st=JSON.parse(await kvGet(b.dataset.restore)); let n=0;
  for(const r of st.routes){ const nr=migrateRoute({...r,id:uid(),name:r.name+' (backup '+b.dataset.restore.slice(7)+')'}); for(const g of nr.guides||[]) if(g.raw) rawPut(g.id,g.raw); store.routes.push(nr); n++; }
  route=store.routes[store.routes.length-1]; cursor=route.steps.length-1; history=[]; refresh(); $('#dlgBackup').close(); $('#dlgChar').close(); toast(`Restored ${n} route${n>1?'s':''} from ${b.dataset.restore.slice(7)}`); });
$('#backupClose').addEventListener('click',()=>$('#dlgBackup').close());
function renderHS(){ const b=$('#hsBtn'); if(!b||!SIM) return; const h=SIM.st.home;
  b.innerHTML=h?`Hearth → ${esc(h.label||'?')}`:'Hearth'; b.title=h?`Adds a "Use hearthstone" step after the selected step. At this point your hearthstone is set to ${h.label||'?'}${h.step!=null?' (set at step '+(h.step+1)+')':''}.`:'Adds a "Use hearthstone" step. Your hearthstone hasn\u2019t been set in this route yet by this point; add a "Set hearthstone" step (click an inn or town on the map) first.'; }
$('#hsBtn').addEventListener('click',()=>{ const h=SIM.st.home; addStep({t:'travel',kind:'hs',text:h?.label||'Hearthstone'}); if(!h) toast('Hearthstone not set yet at this point: add a Set hearthstone step before it'); });
$('#addCustom').addEventListener('click',()=>openStepDialog('custom'));
$('#undoBtn').addEventListener('click',undo);
document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.target.closest('input,textarea')){ e.preventDefault(); undo(); } if(e.key==='Escape') hidePop(); });

function fillRaces(f){ const fac=f.faction.value; f.race.innerHTML=Object.entries(RACES).filter(([n,[b,fa]])=>!fa||fa===fac).map(([n])=>`<option>${n}</option>`).join(''); }
function openChar(){ const f=$('#charForm'); const c=route.char; f.name.value=route.name; f.faction.value=c.faction; fillRaces(f); f.race.value=c.race; f.cls.innerHTML=Object.keys(CLASSES).map(n=>`<option>${n}</option>`).join(''); f.cls.value=c.cls; f.level.value=c.level; f.xp.value=c.xp; f.party.value=c.party; f.rep.checked=!!c.rep; f.prof.checked=!!c.prof; f.event.checked=!!c.event; $('#dgSettings').innerHTML=dungeonChecks('dgset'); f.xprate.value=c.xprate||1; f.dqmult.value=c.dqmult||3.5; fillFpSettings(c); f.killxp.checked=c.killxp!==false; f.droprate.value=c.droprate||60; f.defcount.value=c.defcount||8; f.dgdiv.value=c.dgdiv||3.5; $('#dlgChar').showModal(); }
$('#charForm').faction.addEventListener('change',e=>fillRaces(e.target.form));
$('#dlgChar').addEventListener('close',()=>{ if($('#dlgChar').returnValue!=='ok') return; const f=$('#charForm');
  route.name=f.name.value||'Route'; Object.assign(route.char,{faction:f.faction.value,race:f.race.value,cls:f.cls.value,level:Math.max(1,Math.min(60,+f.level.value||1)),xp:Math.max(0,+f.xp.value||0),party:Math.max(1,Math.min(5,+f.party.value||1)),rep:f.rep.checked,prof:f.prof.checked,event:f.event.checked});
  const prev={...(route.char.dungeons||{})}; const next={}; $$('#dgSettings [data-dgset]').forEach(cb=>{ if(cb.checked) next[cb.dataset.dgset]=true; });
  route.char.xprate=Math.max(0.5,Math.min(5,+f.xprate.value||1)); pruneXpRate(); route.char.fps=$$('#fpSettings [data-fpk]').filter(x=>x.checked).map(x=>x.dataset.fpk); route.char.allfps=$('#fpAll').checked; route.char.dqmult=Math.max(0.1,Math.min(10,+f.dqmult.value||3.5)); route.char.killxp=f.killxp.checked; route.char.droprate=Math.max(5,Math.min(100,+f.droprate.value||60)); route.char.defcount=Math.max(1,+f.defcount.value||8); route.char.dgdiv=Math.max(0.1,+f.dgdiv.value||3.5);
  route.char.dungeons=next; const turnedOn=Object.keys(next).some(t=>!prev[t]); if(turnedOn) insertNewlyEnabled(); refresh(); });
$('#charBtn').addEventListener('click',openChar); $('#whoBtn').addEventListener('click',openChar);
$('#newRoute').addEventListener('click',()=>{ const r=newRoute({char:{...route.char,level:1,xp:0}}); store.routes.push(r); route=r; cursor=-1; history=[]; refresh(); openChar(); });
$('#routeSel').addEventListener('change',e=>{ route=store.routes.find(r=>r.id===e.target.value); cursor=route.steps.length-1; history=[]; selQuest=null; refresh(); });

/* ---------- export ---------- */
function rxpZone(z){ return zoneName(z); }
function gotoLine(p){ return p?`    .goto ${rxpZone(p.z)},${(+p.px).toFixed(1)},${(+p.py).toFixed(1)}`:null; }
function objIndexList(qid){ const q=Q(qid); if(!q) return []; const o=q.o||{}; const out=[]; let i=1; const add=(txt)=>out.push([i++,txt]);
  (o.c||[]).forEach(([id,t])=>add(t||entName('n',id))); (o.o||[]).forEach(([id,t])=>add(t||entName('o',id))); (o.i||[]).forEach(([id,t])=>add(t||DB.i[id]?.n||'item')); (o.k||[]).forEach(k=>add(k[2]||entName('n',k[1]||k[0][0]))); if(q.te) add(q.te[0]); return out; }
let EXPORT_WARN=[];
const blkLines=t=>t.split('\n');
const blkHdrCond=t=>(blkLines(t)[0].replace(/\s--.*$/,'').match(/<<\s*(.+)$/)||[])[1]||'';
function blkRefs(t){ const out=[]; for(const l of blkLines(t)){ const m=l.replace(/\s--.*$/,'').match(/^\s*#(completewith|requires)\s+([^\s<]+)\s*(?:<<\s*(.+))?$/i); if(m&&condOK(m[3]||'')) out.push({k:m[1].toLowerCase(),v:m[2]}); } return out; }
function blkLabels(t){ const out=[]; for(const l of blkLines(t)){ const m=l.replace(/\s--.*$/,'').match(/^\s*#label\s+([^\s<]+)\s*(?:<<\s*(.+))?$/i); if(m&&condOK(m[2]||'')) out.push(m[1]); } return out; }
// would RestedXP drop or auto-skip this stock block for this character on Forever (so its absence changes nothing)?
function blkAutoSkip(t){ if(!condOK(blkHdrCond(t))) return 'class'; const ls=blkLines(t).map(l=>l.replace(/\s--.*$/,'').trim());
  if(ls.some(l=>/^#(hardcore|ssf|sod|som|hardcoreserver)\b/i.test(l))) return 'mode'; if(ls.some(l=>{ const m=l.match(/^#season\s+(.+)$/i); return m&&!/\b0\b/.test(m[1]); })) return 'mode';
  const xr=ls.find(l=>/^#xprate\b/i.test(l)); if(xr&&!xrOK(xr.replace(/^#xprate\s*/i,'').split('<<')[0])) return 'xprate';
  const dg=ls.filter(l=>/^\.dungeon\b/i.test(l)); if(dg.length&&!dungeonOK({dg:dg.filter(l=>!/!/.test(l)).map(l=>dgTag(l.split(/\s+/)[1])),dgs:dg.filter(l=>/!/.test(l)).map(l=>dgTag(l.replace(/.*!/,'').trim()))}).ok) return 'dungeon';
  return ''; }
function buildRXP(){
  const g=route.guide; const fac=charInfo(route).fac==='H'?'Horde':'Alliance';
  const name=$('#expName').value||route.name, group=$('#expGroup').value||'Forever Routes', next=$('#expNext').value, extra=$('#expExtra').value, merge=$('#expMerge').checked;
  g.group=group; g.next=next; g.extra=extra; save();
  const warns=[]; const segs=[]; let seg=null; const done=new Set();
  const newSeg=gid=>{ seg={gid,items:[],lastBlk:null,prevKey:null,text(){ return this.items.map(x=>x.text).filter(Boolean); }}; segs.push(seg); };
  const blockSteps=(g,rx)=>g.steps.filter(x=>x.rx===rx);
  const actKey=(t,q)=>t+':'+q;
  route.steps.forEach((s,i)=>{
    const gg=s.src&&!s.src.auto?G(s.src.g):null; const gsx=gg?.steps[s.src.i]; const raw=gg&&rawCache.get(gg.id);
    if(gg){ if(!seg) newSeg(gg.id); else if(seg.gid!==gg.id){ if(seg.gid==null) seg.gid=gg.id; else newSeg(gg.id); } } else if(!seg) newSeg(null);
    const L=[];
    if(raw&&gsx&&gsx.rx&&raw[gsx.rx-1]!=null){
      if(done.has(i)) return;
      let j=i; const run=[]; while(j<route.steps.length){ const t=route.steps[j]; const tg=t.src&&!t.src.auto?G(t.src.g):null; const tx=tg?.steps[t.src.i]; if(!tx||tg.id!==gg.id||tx.rx!==gsx.rx) break; run.push(t); done.add(j); j++; }
      if(seg.lastBlk&&seg.lastBlk.g===gg.id) for(let k=seg.lastBlk.rx+1;k<gsx.rx;k++){ const t=raw[k-1]; if(!t) continue; if(blkLines(t).slice(1).every(l=>/^\s*(#|--)/.test(l)) && condOK(blkHdrCond(t))) seg.items.push({rx:k,text:t,step:null}); } // label-only anchors
      const runActs=new Set(run.filter(x=>x.q).map(x=>actKey(x.t,x.q))); const rm=new Set(gg.removed||[]); const blkActs=new Set(gg.steps.map((x,k)=>[x,k]).filter(([x,k])=>x.rx===gsx.rx&&x.cond&&x.q&&rm.has(k)).map(([x])=>actKey(x.t,x.q)));
      const out=[]; let cut=0; for(const ln of raw[gsx.rx-1].split('\n')){ const am=ln.match(/^\s*\.(accept|turnin|complete)\s+(\d+)/i); if(am){ const k=actKey(am[1].toLowerCase(),+am[2]); if(blkActs.has(k)&&!runActs.has(k)){ cut++; continue; } } out.push(ln); }
      for(let k=out.length-1;k>=0;k--){ const am=out[k].match(/^\s*\.accept\s+(\d+)/i); if(am&&ESCORT.has(+am[1])&&!out.some(l=>l.includes('Forever bug'))) out.splice(k+1,0,`    >>|cRXP_WARN_${ESC_NOTE}|r`); }
      if(run.some(x=>x.opt)&&!out.some(l=>/^\s*#optional\b/i.test(l))) out.splice(1,0,'    #optional');
      const ep=run.find(x=>x.path!==undefined); if(ep){ for(let k=out.length-1;k>0;k--) if(/^\s*(#loop\b|\.goto\b)/i.test(out[k])) out.splice(k,1); if(ep.path&&ep.path.length>=2){ let h=1; while(h<out.length&&/^\s*#/.test(out[h])) h++; out.splice(h,0,'    #loop',gotoLine(ep.path[0])+',0',...ep.path.map(w=>gotoLine(w)+',30,0')); } }
      const un=run.map(x=>x.unote).filter(Boolean); if(un.length){ let e=out.length; while(e>1&&!out[e-1].trim()) e--; out.splice(e,0,...un.flatMap(n=>n.split('\n')).filter(l=>l.trim()).map(l=>'    >>'+l.trim())); }
      const txt=out.join('\n'); seg.items.push({rx:gsx.rx,text:txt,step:i,cut}); seg.lastBlk={g:gg.id,rx:gsx.rx}; seg.prevKey=null; return;
    }
    const r=SIM.res[i]; const p=r.pt; const q=s.q?(Q(s.q)||{n:s.qn||('Quest '+s.q)}):null; const lines=[];
    const gs=s.src?G(s.src.g)?.steps[s.src.i]:null; const dgl=gs?[...(gs.dg||[]).map(t=>'    .dungeon '+t),...(gs.dgs||[]).map(t=>'    .dungeon !'+t)]:[]; const xrl=gs&&gs.xr?'    #xprate '+gs.xr:null; const optl=(s.opt||s.gopt)?'    #optional':null;
    const stl=s.stk==='next'?'    #completewith next':s.stk==='sticky'?'    #sticky':null;
    const key=(s.t==='accept'||s.t==='turnin')&&p&&!stl?p.ent+'@'+p.X.toFixed(0)+'|'+dgl.join()+(xrl||'')+(optl||''):null;
    const cont=merge&&key&&key===seg.prevKey; seg.prevKey=key;
    const gp=s.t==='travel'&&(s.kind==='fly'||s.kind==='ride')?r.dep:p;
    const own=s.path||null; if(!cont){ L.push('step'); if(stl) L.push(stl); if(optl) L.push(optl); if(xrl) L.push(xrl); if(own&&own.length>=2){ if(s.loopRaw) L.push(...s.loopRaw); else { L.push('    #loop'); L.push(gotoLine(own[0])+',0'); for(const w of own) L.push(gotoLine(w)+',30,0'); } } const gl=own&&own.length>=2?null:gotoLine(gp); if(gl&&!(s.t==='travel'&&(s.kind==='hs'||s.kind==='note'||s.kind==='ride'))&&(s.t!=='grind'||s.loc)) L.push(gl); }
    if(s.t==='accept'){ lines.push(`    .accept ${s.q} >>Accept ${q.on||q.n}`); if(s.tgt) lines.push(`    .target ${s.tgt}`); if(ESCORT.has(s.q)) lines.push(`    >>|cRXP_WARN_${ESC_NOTE}|r`); }
    else if(s.t==='turnin'){ lines.push(`    .turnin ${s.q} >>Turn in ${q.on||q.n}`); if(s.tgt) lines.push(`    .target ${s.tgt}`); }
    else if(s.t==='abandon') lines.push(`    .abandon ${s.q} >>Abandon ${q.on||q.n}`);
    else if(s.t==='buy'){ const v=vendorOf(s.npc), nm=v?.name||s.npcName||'the vendor'; lines.push(`    >>|Tinterface/worldmap/chatbubble_64grey.blp:20|tTalk to |cRXP_FRIENDLY_${nm}|r`);
      for(const it of s.items||[]) lines.push(`    >>|cRXP_BUY_Buy|r ${it.c>1?it.c+' ':''}[${it.n||itemName(it.id)}] |cRXP_BUY_from|r |cRXP_FRIENDLY_${nm}|r`);
      for(const it of s.items||[]) if(it.id) lines.push(`    .collect ${it.id},${it.c} --Collect ${it.n||itemName(it.id)} (${it.c})`);
      lines.push(`    .target ${nm}`); }
    else if(s.t==='complete'&&s.cl?.length&&!Q(s.q)) lines.push(...s.cl);
    else if(s.t==='complete'){ const obs=objIndexList(s.q).filter(([n])=>!s.obj||n===s.obj); if(obs.length) obs.forEach(([n,t])=>lines.push(`    .complete ${s.q},${n} --${t}`)); else lines.push(`    >>Complete ${q.on||q.n}`); }
    else if(s.t==='grind'){ const a=r.after; lines.push(`    .xp ${a.level}${a.xp?'+'+a.xp:''} >>Grind to ${a.level<MAXLVL&&a.xp?fmt(a.xp)+' XP into ':''}level ${a.level}${s.note?' ('+s.note+')':''}`); }
    else if(s.t==='custom'){ const verb={turnin:'Turn in',accept:'Accept',complete:'Complete'}[s.act||'turnin']; if(s.qid&&s.act!=='complete') lines.push(`    .${s.act==='accept'?'accept':'turnin'} ${s.qid} >>${verb} ${s.name}`); else lines.push(`    >>${verb} ${s.name}${s.xp&&s.act==='turnin'?' (+'+s.xp+' XP)':''}`); }
    else if(s.t==='party') lines.push(s.size>1?`    >>Group up with ${s.size-1} other player${s.size>2?'s':''}`:'    >>Continue solo');
    else if(s.t==='travel'&&s.kind==='fly'&&r.dest){ const t=taxiShort(r.dest); lines.push(`    .fly ${t} >>Fly to ${t}`); if(r.dep?.label&&r.dep.node) lines.push(`    .target ${r.dep.label}`); }
    else if(s.t==='travel'&&s.kind==='fp'&&r.node){ const t=taxiShort(r.node); lines.push(`    .fp ${t} >>Get the ${t} flight path`); if(r.pt?.label&&r.pt.node) lines.push(`    .target ${r.pt.label}`); }
    else if(s.t==='travel'&&s.kind==='ride'&&r.ride){ const rd=r.ride, z=rxpZone(rd.zone); if(!cont&&r.dep) lines.push(gotoLine(r.dep)+',40'+(rd.kind==='Zeppelin'?' >>Go up the Zeppelin Tower':'')); lines.push(`    .zone ${z} >>${rd.text}`); lines.push(`    .zoneskip ${z}`); }
    else if(s.t==='travel'&&s.kind==='hs'){ lines.push(`    .hs >>Hearth to ${r.pt?.label||rxpPlain(s.text||'')}`); lines.push('    .use 6948'); }
    else if(s.t==='travel'){ const t=s.text||''; lines.push(({fly:`    .fly ${t} >>Fly to ${t}`,fp:`    .fp ${t} >>Get the ${t} flight path`,home:`    .home >>Set your Hearthstone to ${t}`,hs:`    .hs >>Hearth to ${t}`,goto:`    >>Go to ${t}`,note:`    >>${t}`})[s.kind]); }
    if(s.unote) lines.push(...s.unote.split('\n').filter(l=>l.trim()).map(l=>'    >>'+l.trim()));
    L.push(...lines); if(!cont) L.push(...dgl);
    seg.items.push({rx:null,step:i,text:L.join('\n')});
  });
  if(!segs.length) newSeg(null);
  // keep RestedXP's label links working: add stock blocks that exported steps point to (#completewith / #requires) if they were left out
  for(const sg of segs){ if(!sg.gid) continue; const gg=G(sg.gid), raw=rawCache.get(sg.gid); if(!raw) continue;
    const have=()=>new Set(sg.items.filter(x=>x.text).flatMap(x=>blkLabels(x.text)));
    for(const it of [...sg.items]) if(it.text) for(const ref of blkRefs(it.text)){ if(ref.v==='next'||have().has(ref.v)) continue;
      let k=-1; raw.forEach((t,ix)=>{ if(t&&condOK(blkHdrCond(t))&&blkLabels(t).includes(ref.v)) k=ix+1; });
      if(k<0) continue; // the stock guide has the same dangling reference for this character
      const t=raw[k-1]; const pos=sg.items.findIndex(x=>x.rx!=null&&x.rx>k); const ins={rx:k,text:t,step:null,added:true};
      if(pos<0) sg.items.push(ins); else sg.items.splice(pos,0,ins); }
  }
  // checks against the stock guide
  segs.forEach((sg,si)=>{ if(!sg.gid) return; const gg=G(sg.gid), raw=rawCache.get(sg.gid); if(!raw) return;
    const blocks=sg.items; const labelCount=new Map(); blocks.filter(x=>x.text).forEach(x=>blkLabels(x.text).forEach(l=>labelCount.set(l,(labelCount.get(l)||0)+1)));
    for(const [l,n] of labelCount) if(n>1&&raw.filter(t=>t&&condOK(blkHdrCond(t))&&blkLabels(t).includes(l)).length<n) warns.push(`${gg.name}: “#label ${l}” appears ${n} times because a guide step was split up in your route; RestedXP uses the last one.`);
    blocks.forEach((x,bi)=>{ if(!x.text||!blkRefs(x.text).some(r=>r.v==='next')) return; const nx=blocks[bi+1];
      let want=-1; for(let k=x.rx+1;k<=raw.length;k++){ const t=raw[k-1]; if(t&&condOK(blkHdrCond(t))){ want=k; break; } }
      if(want<0) return; const ok=nx&&nx.rx!=null&&(nx.rx===want||(()=>{ for(let k=want;k<nx.rx;k++){ const t=raw[k-1]; if(t&&condOK(blkHdrCond(t))&&!blkAutoSkip(t)) return false; } return nx.rx>want; })());
      if(!ok){ const sn=x.step!=null?x.step+1:'?'; warns.push(`Step ${sn} (${gg.name}) uses “#completewith next”, so RestedXP shows it together with the step after it. In your route that is ${nx?(nx.rx==null?'your own step '+(nx.step+1):'a different guide step'):'nothing'} instead of the guide’s next step, so it may stay on screen longer or shorter than in the original.`); } });
    blocks.forEach(x=>{ if(x.cut) warns.push(`Step ${x.step+1} (${gg.name}): ${x.cut} quest line${x.cut>1?'s were':' was'} left out because you removed ${x.cut>1?'those steps':'that step'} from your route.`); });
  });
  for(const gid of new Set(route.steps.filter(x=>x.src&&!x.src.auto).map(x=>x.src.g))){ const gg=G(gid); if(!gg) continue; const miss=fillGuide(gg,true); if(miss.length){ const fq=miss.filter(i=>gg.steps[i].q&&!Q(gg.steps[i].q)).length; warns.unshift(`${miss.length} step${miss.length>1?'s':''} of ${gg.name}${fq?` (including ${fq} for Forever quests)`:''} ${miss.length>1?'are':'is'} missing from your route, so ${miss.length>1?'they are':'it is'} not in this export. Open the guide in the Guides tab and click “Fill in missing steps in place”.`); } }
  const ag=route.steps.map((x,k)=>x.src&&x.src.auto?k+1:0).filter(Boolean); if(ag.length) warns.push(`${ag.length} catch-up grind step${ag.length>1?'s were':' was'} added by the planner and ${ag.length>1?'are':'is'} not in the original guides (step${ag.length>1?'s':''} ${ag.slice(0,12).join(', ')}${ag.length>12?'…':''}). Delete ${ag.length>1?'them':'it'} if you want the guide exactly as written.`);
  EXPORT_WARN=warns;
  const nm=k=>segs.length===1?name:`${name} ${k+1}${segs[k].gid?' - '+G(segs[k].gid).name:''}`;
  const outL=[]; if(segs.some(sg=>sg.items.some(x=>x.rx!=null))) outL.push('-- Contains text from RestedXP guides (https://github.com/RestedXP/RXPGuides), licensed CC BY-NC-SA 4.0.','-- If you share this file: credit RestedXP, keep it non-commercial and share it under the same licence.','-- Made with the Forever Route Planner (GPL-3.0). Not affiliated with RestedXP, Blizzard or WoW: Forever.','');
  segs.forEach((sg,k)=>{ const H=[`RXPGuides.RegisterGuide(${JSON.stringify(group)},[[`]; if(extra) H.push(...extra.split(/\s*;\s*|\n/).filter(Boolean)); H.push(`<< ${fac}`); H.push(`#name ${nm(k)}`); const nx=k<segs.length-1?nm(k+1):next; if(nx) H.push(`#next ${nx}`);
    outL.push(...H, ...sg.text(), ']])'); if(k<segs.length-1) outL.push(''); });
  return outL.join('\n');
}
async function exportText(){ const m=$('#expMode [aria-pressed="true"]').dataset.m; const ids=route.steps.filter(s=>s.src&&!s.src.auto).map(s=>s.src.g); await rawLoad(ids);
  if(m==='rxp'){ $('#expText').value=buildRXP(); const miss=[...new Set(ids)].filter(id=>!rawCache.has(id)).map(id=>G(id)?.name).filter(Boolean); const msgs=[]; if(miss.length) msgs.push(`Re-import ${miss.join(', ')} to export ${miss.length>1?'their':'its'} steps exactly as written in the guide.`); msgs.push(...EXPORT_WARN); $('#expMsg').innerHTML=msgs.map(m=>`<div>⚠ ${esc(m)}</div>`).join(''); }
  else { const used=new Set(ids); const r=JSON.parse(JSON.stringify(route)); for(const g of r.guides||[]) if(used.has(g.id)&&rawCache.has(g.id)) g.raw=rawCache.get(g.id); $('#expText').value=JSON.stringify({format:'forever-route-planner/1',route:r},null,1); $('#expMsg').textContent=''; } }
$('#exportBtn').addEventListener('click',()=>{ $('#expGroup').value=route.guide?.group||'Forever Routes'; $('#expName').value=route.name; $('#expNext').value=route.guide?.next||''; $('#expExtra').value=route.guide?.extra||''; setSeg('#expMode','rxp'); exportText(); $('#dlgExport').showModal(); });
$('#expMode').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; setSeg('#expMode',b.dataset.m); exportText(); });
['#expGroup','#expName','#expNext','#expExtra','#expMerge'].forEach(s=>$(s).addEventListener('input',exportText));
$('#expClose').addEventListener('click',()=>$('#dlgExport').close());
$('#expCopy').addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText($('#expText').value); toast('Copied'); }catch(e){ $('#expText').select(); document.execCommand('copy'); toast('Copied'); } });
$('#expSave').addEventListener('click',async()=>{ const m=$('#expMode [aria-pressed="true"]').dataset.m; const name=((m==='rxp'?$('#expName').value.trim():'')||route.name||'route').replace(/[\\/:*?"<>|]+/g,'_').trim();
  const dl=window.claude&&await window.claude.use('downloads').catch(()=>null);
  if(!dl){ try{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([$('#expText').value],{type:'text/plain'})); a.download=m==='rxp'?name+'.lua':name+'.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000); toast('Saved'); }catch(e){ toast('Download isn\u2019t available here. Use Copy instead.'); } return; }
  try{ await dl.save({filename:m==='rxp'?name+'.txt':name+'.json',data:new TextEncoder().encode($('#expText').value)}); toast('Saved'); }
  catch(e){ if(e?.code!=='declined') toast('Download failed: '+(e?.message||e?.code||'unknown')); } });
$('#expFile').addEventListener('change',async e=>{ const f=e.target.files[0]; if(!f) return; $('#expText').value=await f.text(); e.target.value=''; $('#expImport').click(); });
$('#expImport').addEventListener('click',()=>{ try{ const o=JSON.parse($('#expText').value); const r=o.route||o; if(!Array.isArray(r.steps)) throw 0; const nr=migrateRoute(newRoute({...r,id:uid(),name:(r.name||'Imported')+' (imported)'})); for(const g of nr.guides||[]) if(g.raw){ rawPut(g.id,g.raw); delete g.raw; } store.routes.push(nr); route=nr; cursor=nr.steps.length-1; history=[]; refresh(); $('#dlgExport').close(); toast('Route imported'); }catch(e){ toast('That text isn\u2019t a route file'); } });

/* ---------- zone images (IndexedDB, this browser only) ---------- */
const IDB={db:null,
  open(){ return new Promise(res=>{ try{ const rq=indexedDB.open('frp-images',1); rq.onupgradeneeded=()=>rq.result.createObjectStore('img'); rq.onsuccess=()=>{this.db=rq.result;res(this.db)}; rq.onerror=()=>res(null); }catch(e){res(null)} }); },
  tx(mode){ return this.db.transaction('img',mode).objectStore('img'); },
  put(k,v){ return new Promise(r=>{ if(!this.db) return r(); const q=this.tx('readwrite').put(v,k); q.onsuccess=q.onerror=()=>r(); }); },
  del(k){ return new Promise(r=>{ if(!this.db) return r(); const q=this.tx('readwrite').delete(k); q.onsuccess=q.onerror=()=>r(); }); },
  all(){ return new Promise(r=>{ if(!this.db) return r([]); const out=[]; const q=this.tx('readonly').openCursor(); q.onsuccess=()=>{ const c=q.result; if(c){ out.push([c.key,c.value]); c.continue(); } else r(out); }; q.onerror=()=>r(out); }); }
};
async function loadImages(){ await IDB.open(); for(const [k,blob] of await IDB.all()){ try{ zoneImgs.set(+k,await createImageBitmap(blob)); }catch(e){} } try{ imgOpacity=+(localStorage.getItem('frp.imgop')||0.95); }catch(e){} requestDraw(); }
function renderImgList(){ $('#imgList').innerHTML=zoneImgs.size?[...zoneImgs.keys()].map(z=>`${esc(zoneName(z))} <button class="linkish" data-rmimg="${z}">Remove</button>`).join(' · '):'No zone images added yet.'; }
$('#imgBtn').addEventListener('click',()=>{ $('#imgZone').innerHTML=Object.entries(META.zones).sort((a,b)=>a[1].n.localeCompare(b[1].n)).map(([z,Z])=>`<option value="${z}">${esc(Z.n)}${zoneImgs.has(+z)?' (added)':''}</option>`).join(''); $('#imgOpacity').value=imgOpacity; renderImgList(); $('#dlgImg').showModal(); });
$('#imgFile').addEventListener('change',async e=>{ const file=e.target.files[0]; if(!file) return; const z=+$('#imgZone').value; try{ const bmp=await createImageBitmap(file); zoneImgs.set(z,bmp); await IDB.put(String(z),file); renderImgList(); requestDraw(); toast(zoneName(z)+' image added'); }catch(err){ toast('That file couldn\u2019t be read as an image'); } e.target.value=''; });
$('#imgList').addEventListener('click',async e=>{ const b=e.target.closest('[data-rmimg]'); if(!b) return; zoneImgs.delete(+b.dataset.rmimg); await IDB.del(b.dataset.rmimg); renderImgList(); requestDraw(); });
$('#imgOpacity').addEventListener('input',e=>{ imgOpacity=+e.target.value; try{localStorage.setItem('frp.imgop',imgOpacity)}catch(_){ } requestDraw(); });
$('#imgClose').addEventListener('click',()=>$('#dlgImg').close());

/* ---------- misc ---------- */
function toast(t,ms){ const el=$('#toast'); el.textContent=t; el.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>el.style.display='none',ms||2200); }
$$('#layers input').forEach(i=>i.addEventListener('change',()=>{ layers[i.dataset.l]=i.checked; requestDraw(); }));
$('#zin').addEventListener('click',()=>zoomAt(1.5,W/2,H/2)); $('#zout').addEventListener('click',()=>zoomAt(1/1.5,W/2,H/2)); $('#zfit').addEventListener('click',fitAll);
$('#zcur').addEventListener('click',()=>{ let p=null; for(let i=cursor;i>=0&&!p;i--) p=SIM.res[i]?.pt; if(p) flyTo(p.X,p.Y,Math.max(view.s,0.12)); else toast('No step with a location yet'); });
$('#zoneJump').addEventListener('change',e=>{ if(e.target.value) flyToZone(+e.target.value); e.target.value=''; });
function applyTheme(t){ if(t) document.documentElement.setAttribute('data-theme',t); else document.documentElement.removeAttribute('data-theme'); }
$('#themeBtn').addEventListener('click',()=>{ const cur=document.documentElement.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'); const nt=cur==='light'?'dark':'light'; applyTheme(nt); try{localStorage.setItem('frp.theme',nt)}catch(e){} });
function openPanel(which){ if(innerWidth>900) return; closePanels(); $(which==='left'?'#leftPanel':'#rightPanel').classList.add('open'); }
function closePanels(){ $$('.panel').forEach(p=>p.classList.remove('open')); }
$('#openLeft').addEventListener('click',()=>{ const o=$('#leftPanel').classList.contains('open'); closePanels(); if(!o) openPanel('left'); });
$('#openRight').addEventListener('click',()=>{ const o=$('#rightPanel').classList.contains('open'); closePanels(); if(!o) openPanel('right'); });
canvas.addEventListener('pointerdown',()=>{ if(innerWidth<=900) closePanels(); });

(async function init(){
  try{ const t=localStorage.getItem('frp.theme'); if(t) applyTheme(t); }catch(e){}
  await loadData();
  buildPaths(); makePatterns(); loadRelief(); navInit();
  $('#zoneJump').innerHTML='<option value="">Jump to zone…</option>'+Object.entries(META.zones).sort((a,b)=>a[1].n.localeCompare(b[1].n)).map(([z,Z])=>`<option value="${z}">${esc(Z.n)}${Z.lv?' ('+Z.lv+')':''}</option>`).join('');
  await loadStore(); new ResizeObserver(resize).observe(canvas); resize();
  rawLoad(store.routes.flatMap(r=>(r.guides||[]).map(g=>g.id))).then(()=>{ if(tab==='guides') renderRight(); });
  refresh();
  const first=SIM.res.find(r=>r.pt)?.pt;
  if(first) flyTo(first.X,first.Y,0.12); else { const n=SIM.near?.pt; if(n) flyTo(n.X,n.Y,0.1); else fitAll(); }
  if(innerWidth<=900) $('#layers').open=false;
  $('#loading').remove();
  document.fonts?.ready.then(requestDraw);
  loadImages();
})().catch(e=>{ $('#loading').textContent='The quest data failed to load: '+e.message; console.error(e); });

/* ---------- deleting steps and routes ---------- */
$('#clearSteps').addEventListener('click',async()=>{ if(!route.steps.length) return toast('This route has no steps'); if(!await ask(`Remove all ${route.steps.length} steps from "${route.name}"? You can undo this.`)) return; pushHistory(); route.steps=[]; cursor=-1; $('#dlgChar').close('cancel'); refresh(); toast('All steps removed. Undo brings them back.'); });
$('#clearAfter').addEventListener('click',async()=>{ const n=route.steps.length-1-cursor; if(n<=0) return toast('No steps after the selected one'); if(!await ask(`Remove the ${n} step${n>1?'s':''} after step ${cursor+1}? You can undo this.`)) return; pushHistory(); route.steps.splice(cursor+1); $('#dlgChar').close('cancel'); refresh(); toast(`Removed ${n} step${n>1?'s':''}`); });
$('#delRoute').addEventListener('click',async()=>{ if(!await ask(`Delete the route "${route.name}" and its imported guides? This can't be undone.`)) return;
  store.deleted=[...(store.deleted||[]),route.id]; kvDel('route:'+route.id); store.routes=store.routes.filter(r=>r!==route); if(!store.routes.length) store.routes.push(newRoute({name:'New route'}));
  route=store.routes[0]; cursor=route.steps.length-1; history=[]; selQuest=null; if(typeof selGuide!=='undefined') selGuide=null; $('#dlgChar').close('cancel'); refresh(); toast('Route deleted'); });
let stepsFocus=false; document.addEventListener('pointerdown',e=>{ stepsFocus=!!e.target.closest('#steps'); },true);
document.addEventListener('keydown',e=>{ if((e.key==='Delete'||e.key==='Backspace')&&stepsFocus&&cursor>=0&&!e.target.closest('input,textarea,select,dialog')){ e.preventDefault(); removeStep(cursor); } });

$('#groupSel').addEventListener('change',e=>{ const v=+e.target.value; if(v===(SIM.st.party||1)) return; addStep({t:'party',size:v}); toast(v>1?`Group of ${v} from step ${cursor+1}`:`Solo from step ${cursor+1}`); });

function whURL(qid,alt){ const q=Q(qid); return (qid>=90000||!q)?'https://www.wowhead.com/classic/search?q='+encodeURIComponent(q?.on||q?.n||alt||qid):'https://www.wowhead.com/classic/quest='+qid; }
function whLink(qid,btn){ const url=whURL(qid);
  return btn?`<a class="btn sm" href="${url}" target="_blank" rel="noopener" style="text-decoration:none">Wowhead ↗</a>`:`<a href="${url}" target="_blank" rel="noopener">Wowhead ↗</a>`; }

function objChecklist(qid,v){ const obs=objectives(qid).filter(o=>o.rx); if(obs.length<2&&!(v&&v.objs&&v.objs.size)) return obs.length?'':'';
  return `<span class="olist">${obs.map(o=>{ const done=v&&(v.done||(v.objs&&v.objs.has(o.rx))); return `<span class="oitem ${done?'done':''}">${done?'✓':'○'} ${esc(o.text)}${!done&&v?` <button class="linkish" data-cobj="${qid}:${o.rx}">done here</button>`:''}</span>`; }).join('')}</span>`; }

/* ---------- RestedXP guide import & ghost routes ---------- */
const GCOLORS=['#5fd9e8','#ff8fd6','#a6ff7a','#ffb35c','#b39dff'];
let GH=new Map();            // guideId -> {res:[...], pts:[...]}
let selGuide=null, selGhost=null, gFilter='relevant';
layers.ghost=true;

function zoneLookup(){
  if(zoneLookup.m) return zoneLookup.m; const m=new Map();
  for(const [z,Z] of Object.entries(META.zones)){ const n=Z.n.toLowerCase(); m.set(n,+z); m.set(n.replace(/^the /,''),+z); m.set(n.replace(/[^a-z]/g,''),+z); if(Z.ui) m.set(String(Z.ui),+z); }
  m.set('barrens',17); m.set('stranglethorn',33); m.set('hillsbrad',267); m.set('stormwind',1519); m.set('ungoro crater',490); m.set('ungorocrater',490);
  return zoneLookup.m=m;
}
function zoneFromName(n){ const m=zoneLookup(); n=String(n).trim().toLowerCase(); return m.get(n)??m.get(n.replace(/^the /,''))??m.get(n.replace(/[^a-z0-9]/g,'')); }
// same rules as RestedXP's applies() (GuideLoader.lua) on the Forever client: '/' = or, space = and, '!' = not, (...) groups;
// class names match any case, races/factions match exactly (Undead = Scourge), numbers = player level, anything else (skip, era, sod, typos) is false
const RXP_RACE={'Undead':'Scourge','Night Elf':'NightElf'};
function condOK(str){
  if(!str) return true; str=String(str).trim(); if(!str) return true;
  const ci=charInfo(route); const cls=String(route.char.cls||'').toUpperCase(); const race=RXP_RACE[route.char.race]||String(route.char.race||'').replace(/\s/g,''); const fac=ci.fac==='H'?'Horde':'Alliance'; const lvl=+route.char.level||1;
  const parse=t=>{ t=t.replace(/(!?)\(\s*(.*?)\s*\)/g,(m,op,inner)=>parse(inner)!==(op==='!')?cls:'NULL');
    for(const alt of t.split('/')){ let v=true; for(let e of alt.match(/!?[A-Za-z0-9]+/g)||[]){ let st=false; if(e[0]==='!'){ st=true; e=e.slice(1); } const lv=/^\d+$/.test(e)?+e:0xfff; if(e==='Undead') e='Scourge'; const up=e.toUpperCase();
        const m=up===cls||e===race||e===fac||lvl>=lv||up==='FOREVER'; v=(!m)===st; if(!v) break; } if(v) return true; } return false; };
  return parse(str);
}
function verTag(k,val){
  const [v,c]=String(val||'').split('<<'); if(c&&!condOK(c)) return null;
  if(k==='season'){ const s=v.split(/[,\s]+/).filter(Boolean).map(Number); return s.includes(0)?null:(s.includes(2)?'Season of Discovery only':'Season of Mastery only'); }
  if(k==='som') return 'Season of Mastery only';
  if(k==='sod') return 'Season of Discovery only';
  if(k==='hardcore'||k==='hardcoreserver') return 'Hardcore only';
  if(k==='ssf') return 'Self-found only';
  return null; }
function parseRXP(text){
  const out=[]; const re=/RegisterGuide\s*\(([\s\S]*?)\[(=*)\[([\s\S]*?)\]\2\]/g; let m;
  while((m=re.exec(text))) out.push(parseGuideBody(m[3],(m[1].match(/["']([^"']+)["']/)||[])[1]||''));
  if(!out.length && /(^|\n)\s*step\b/.test(text)) out.push(parseGuideBody(text,''));
  return out;
}
function parseGuideBody(body,group){
  const g={name:'',group,cond:'',next:'',nexts:[],blocks:[]}; let cur=null;
  for(const raw of body.split(/\r?\n/)){
    if(cur && raw.trim() && !/^\s*step\b/i.test(raw)) cur.raw.push(raw.replace(/\s+$/,''));
    const cm=raw.match(/^\s*\.complete\s+\d+\s*,\s*(\d+)[^-]*--.*?\(x?(\d+)\)/i);
    let line=raw.replace(/\s--.*$/,'').replace(/^--.*$/,'').trim(); if(!line) continue; if(cm) line+=` @@${cm[1]}=${cm[2]}`;
    const hdr=line.match(/^#(\w+)\s*(.*)$/);
    if(hdr){ const k=hdr[1].toLowerCase(); if(cur&&k==='optional') cur.optional=true; if(cur&&(k==='completewith'||k==='label'||k==='requires')){ const [v,c]=hdr[2].split('<<'); if(condOK(c||'')) cur[k]=v.trim(); } if(cur&&k==='loop'){ const c=hdr[2].split('<<')[1]; if(condOK(c||'')) cur.loop=true; } if(cur&&k==='sticky'){ const c=hdr[2].split('<<')[1]; if(condOK(c||'')) cur.sticky=true; } if(k==='xprate'){ const [xr,xc]=hdr[2].split('<<'); if(cur){ if(condOK(xc||'')) cur.xprate=xr.trim(); } else g.xprate=xr.trim(); } { const vw=verTag(k,hdr[2]); if(vw){ if(cur) cur.ver=cur.ver||vw; else g.ver=g.ver||vw; } }
      if(!cur){ if(k==='name') g.name=hdr[2].trim(); else if(k==='next'){ for(const alt of hdr[2].split(';')){ const [nx,nc]=alt.split('<<'); const nm=nx.replace(/^\s*#group\s+/i,'').split('\\').pop().trim(); if(nm&&condOK(nc||'')) g.nexts.push(nm); } g.next=g.nexts.join(';'); } else if(k==='group'&&!g.group){ for(const alt of hdr[2].split(';')){ const [gn,gc]=alt.split('<<'); if(condOK(gc||'')){ g.group=gn.trim(); break; } } } } continue; }
    if(/^step\b/i.test(line)){ cur={cond:(line.match(/<<\s*(.+)$/)||[])[1]||'',lines:[],raw:[raw.replace(/\s+$/,'')]}; g.blocks.push(cur); continue; }
    if(!cur){ if(line.startsWith('<<')) g.cond=line.slice(2).trim(); continue; }
    cur.lines.push(line);
  }
  return g;
}
function convertLoc(z,px,py,convert){ const cv=META.zones[z]?.cv; if(convert&&cv){ px=px*cv[0]+cv[1]; py=py*cv[2]+cv[3]; } return {z,px:+px.toFixed(1),py:+py.toFixed(1)}; }
function buildGuideSteps(g,convert){
  const steps=[]; let unknownZones=new Set();
  g.blocks.forEach((b,bi)=>{
    const bOK=condOK(b.cond)&&!b.ver; let loc=null, firstLoc=null; const pend=[]; const notes=[]; const seenC=new Set(); const dg=[], dgs=[]; let lmin=0, lmax=0; const startN=steps.length; const disp=[]; const reqs=[]; let gotoTxt=''; const gl=[]; const tgts=[];
    for(const line of b.lines){
      const [main,econd]=line.split('<<'); const ok=bOK&&condOK(econd||''); const txt=(main.match(/>>\s*(.*)$/)||[])[1]||''; const cmd=main.replace(/>>.*$/,'').trim();
      if(txt&&ok&&!/^\.(accept|turnin|complete|goto|xp)\b/i.test(cmd)) disp.push(txt.trim());
      if(/^\+/.test(main.trim())){ if(ok) disp.push(main.trim().slice(1).trim()); continue; }
      let m;
      if((m=cmd.match(/^\.xp\s*([<>]?)\s*(\d+)[^,]*,\s*(-?\d+)/i))){ if(ok){ const L=+m[2]; if(m[1]==='<') lmin=Math.max(lmin,L); else lmax=lmax?Math.min(lmax,L):L; } continue; }
      if((m=cmd.match(/^\.(isOnQuest|isNotOnQuest|isQuestTurnedIn|isQuestNotTurnedIn|isQuestComplete|isQuestNotComplete|isQuestAvailable)\s+(.+)$/i))){ if(ok){ const ids=m[2].split(',').map(x=>parseInt(x)).filter(x=>x>0); if(ids.length) reqs.push({k:m[1].toLowerCase(),ids}); } continue; }
      if((m=cmd.match(/^\.maxlevel\s+(\d+)/i))){ if(ok){ const L=+m[1]+1; lmax=lmax?Math.min(lmax,L):L; } continue; }
      if((m=cmd.match(/^\.dungeon\s+(!?)\s*([^\s>]+)/i))){ const tag=dgTag(m[2]); (m[1]?dgs:dg).push(tag); continue; }
      if(/^\.goto\b/i.test(cmd)&&txt&&ok&&!gotoTxt) gotoTxt=txt.trim();
      { const tm=cmd.match(/^\.target\s+(.+)$/i); if(tm&&ok) tgts.push(tm[1].replace(/^\+/,'').trim()); }
      if((m=cmd.match(/^\.goto\s+(\d+)\/(\d+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i))){ if(!ok) continue; // "uiMapId/continent, worldY, worldX" (Forever guides)
        const z=zoneFromName(m[1]); const Z=z!=null?META.zones[z]:null; if(!Z){ unknownZones.add(m[1]+'/'+m[2]); continue; } const [Lb,Rb,Tb,Bb]=Z.b; const px=(Lb-(+m[3]))/(Lb-Rb)*100, py=(Tb-(+m[4]))/(Tb-Bb)*100;
        loc=convertLoc(z,px,py,false); if(loc) gl.push(loc); if(!firstLoc) firstLoc=loc; for(const p of pend) if(!p.loc) p.loc=loc; continue; }
      if((m=cmd.match(/^\.goto\s+([^,]+),\s*([\d.]+)\s*,\s*([\d.]+)/i))){ if(!ok) continue; const z=zoneFromName(m[1]); if(z==null){ unknownZones.add(m[1].trim()); continue; } loc=convertLoc(z,+m[2],+m[3],convert); if(loc) gl.push(loc); if(!firstLoc) firstLoc=loc; for(const p of pend) if(!p.loc) p.loc=loc; continue; }
      const mk=(o)=>{ o.cond=ok; o.rx=bi+1; o.loc=loc; o.label=txt; if(o.q&&!Q(o.q)&&txt){ const n=txt.replace(/\|c\w{8}|\|r|\|T[^|]*\|t/g,'').replace(/^(Accept|Turn in|Complete)\s+/i,'').trim(); if(n) o.qn=n; } pend.push(o); return o; };
      if((m=cmd.match(/^\.accept\s+(\d+)/i))) steps.push(mk({t:'accept',q:+m[1]}));
      else if((m=cmd.match(/^\.turnin\s+(\d+)/i))) steps.push(mk({t:'turnin',q:+m[1]}));
      else if((m=cmd.match(/^\.complete\s+(\d+)/i))){ let st2=pend.find(p=>p.t==='complete'&&p.q===+m[1]); if(!seenC.has(+m[1])){ seenC.add(+m[1]); st2=mk({t:'complete',q:+m[1]}); steps.push(st2); } const cc=cmd.match(/@@(\d+)=(\d+)/); if(cc&&st2){ st2.counts=st2.counts||{}; st2.counts[cc[1]]=+cc[2]; } }
      else if((m=cmd.match(/^\.xp\s+(\d+)(?:\.(\d+))?(?:([+-])(\d+))?\s*$/i))){ let L=+m[1], xp=0; if(m[2]) xp=Math.round(XP_TABLE[L]*(+('0.'+m[2]))); if(m[3]==='+') xp=+m[4]; if(m[3]==='-'){ L=L-1; xp=Math.max(0,XP_TABLE[L]-(+m[4])); } steps.push(mk({t:'grind',mode:'to',level:L,xp,note:txt||'Guide XP checkpoint'})); }
      else if((m=cmd.match(/^\.(fly|fp)\s+(.+)$/i))) steps.push(mk({t:'travel',kind:m[1].toLowerCase(),text:m[2].trim()}));
      else if((m=cmd.match(/^\.zone\s+(.+)$/i)) && /Take the (Zeppelin|boat|Deeprun Tram) to/i.test(txt) && typeof RIDES!=='undefined'){ const zid=zoneFromName(m[1]); const kind=txt.match(/Take the (Zeppelin|boat|Deeprun Tram)/i)[1].toLowerCase();
        let c=RIDES.filter(rd=>rd.zone===zid && rd.kind.toLowerCase()===kind); if(!c.length) c=RIDES.filter(rd=>txt.toLowerCase().includes(rd.dest.toLowerCase()));
        if(c.length){ const here=loc?zp2plane(loc.z,loc.px,loc.py):null; if(here) c.sort((a,b)=>{ const pa=tpPt(a.from), pb=tpPt(b.from); return Math.hypot(pa.X-here.X,pa.Y-here.Y)-Math.hypot(pb.X-here.X,pb.Y-here.Y); }); steps.push(mk({t:'travel',kind:'ride',ride:c[0].id,text:c[0].text})); }
        else if(txt) notes.push({txt,ok}); }
      else if(/^\.home\b/i.test(cmd)) steps.push(mk({t:'travel',kind:'home',text:txt.replace(/^Set your Hearthstone to\s*/i,'')||'Inn'}));
      else if(/^\.hs\b/i.test(cmd)) steps.push(mk({t:'travel',kind:'hs',text:txt.replace(/^Hearth to\s*/i,'')||'Hearthstone'}));
      else if(!cmd && txt) notes.push({txt,ok});
    }
    for(const p of pend) if(!p.loc) p.loc=firstLoc;
    const okN=notes.filter(n=>n.ok).map(n=>n.txt), dj=[...new Set([...okN,...disp])].slice(0,2).join(' · '); const mobs=[...new Set(b.lines.map(l=>(l.split('<<')[0].match(/^\.(?:mob|unitscan)\s+(.+)$/i)||[])[1]).filter(Boolean).map(x=>x.replace(/^\+/,'').trim()))]; const hasCmd=b.lines.some(l=>/^[.+>]/.test(l));
    const nt=dj?{txt:dj,ok:true}:gotoTxt?{txt:gotoTxt,ok:true}:(notes[0]||(mobs.length?{txt:'Kill '+mobs.slice(0,3).join(', '),ok:true}:firstLoc?{txt:'Go to '+zoneName(firstLoc.z),ok:true}:hasCmd?{txt:'Guide step',ok:true}:null));
    if(!pend.length && nt){ steps.push({t:'travel',kind:firstLoc?'goto':'note',text:nt.txt,loc:firstLoc,cond:bOK&&nt.ok,rx:bi+1,info:true}); }
    if(reqs.length) for(let k=startN;k<steps.length;k++) steps[k].reqs=reqs;
    for(let k=startN;k<steps.length;k++){ const x=steps[k]; if(!x.q||Q(x.q)) continue; if((x.t==='accept'||x.t==='turnin')&&tgts.length) x.tgt=tgts[0]; if(x.t==='complete'){ const re=new RegExp('^\\s*\\.complete\\s+'+x.q+'\\b','i'); x.cl=(b.raw||[]).filter(l=>re.test(l)).map(l=>'    '+l.trim()); } }
    if(b.loop&&gl.length>=2){ const lr=['    #loop',...(b.raw||[]).filter(l=>/^\s*\.goto\b/i.test(l))]; for(let k=startN;k<steps.length;k++){ steps[k].path=gl.map(l=>({z:l.z,px:+l.px,py:+l.py})); steps[k].loopRaw=lr; } }
    for(let k=startN;k<steps.length;k++){ if(b.completewith) steps[k].cw=b.completewith; if(b.sticky||b.completewith) steps[k].sticky=true; if(b.label) steps[k].label=b.label; }
    if(b.optional) for(let k=startN;k<steps.length;k++) steps[k].gopt=true;
    if(b.xprate) for(let k=startN;k<steps.length;k++) steps[k].xr=b.xprate;
    if(disp.length) for(let k=startN;k<steps.length;k++) steps[k].notes=disp.slice(0,6);
    if(lmin||lmax) for(let k=startN;k<steps.length;k++){ if(lmin) steps[k].lmin=lmin; if(lmax) steps[k].lmax=lmax; }
    if(dg.length||dgs.length) for(let k=startN;k<steps.length;k++){ if(dg.length) steps[k].dg=[...new Set(dg)]; if(dgs.length) steps[k].dgs=[...new Set(dgs)]; }
  });
  const qm={}; steps.forEach(x=>{ if(x.qn&&!qm[x.q]) qm[x.q]=x.qn; }); steps.forEach(x=>{ if(x.q&&!x.qn&&qm[x.q]) x.qn=qm[x.q]; });
  return {steps,unknownZones:[...unknownZones]};
}
/* original guide text per block, kept in IndexedDB so exports can reproduce the guide verbatim */
const rawCache=new Map(); let rawDBp=null;
function rawDB(){ if(!rawDBp) rawDBp=new Promise((res)=>{ try{ const rq=indexedDB.open('frp-raw',2); rq.onupgradeneeded=()=>{ const d=rq.result; if(!d.objectStoreNames.contains('g')) d.createObjectStore('g'); if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); }; rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(null); }catch(e){ res(null); } }); return rawDBp; }
function kvPut(k,v){ return rawDB().then(db=>new Promise(res=>{ if(!db) return res(false); try{ const t=db.transaction('kv','readwrite'); t.objectStore('kv').put(v,k); t.oncomplete=()=>res(true); t.onerror=t.onabort=()=>res(false); }catch(e){ res(false); } })); }
function kvDel(k){ rawDB().then(db=>{ try{ db&&db.transaction('kv','readwrite').objectStore('kv').delete(k); }catch(e){} }); }
async function kvKeys(){ const db=await rawDB(); if(!db) return []; return new Promise(res=>{ try{ const rq=db.transaction('kv').objectStore('kv').getAllKeys(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>res([]); }catch(e){ res([]); } }); }
async function kvGet(k){ const db=await rawDB(); if(!db) return null; return new Promise(res=>{ try{ const rq=db.transaction('kv').objectStore('kv').get(k); rq.onsuccess=()=>res(rq.result??null); rq.onerror=()=>res(null); }catch(e){ res(null); } }); }
function rawPut(id,blocks){ rawCache.set(id,blocks); rawDB().then(db=>{ if(!db) return; try{ db.transaction('g','readwrite').objectStore('g').put(blocks,id); }catch(e){} }); }
async function rawLoad(ids){ const db=await rawDB(); await Promise.all([...new Set(ids)].filter(id=>!rawCache.has(id)).map(id=>new Promise(res=>{ if(!db) return res(); try{ const rq=db.transaction('g').objectStore('g').get(id); rq.onsuccess=()=>{ if(rq.result) rawCache.set(id,rq.result); res(); }; rq.onerror=()=>res(); }catch(e){ res(); } }))); }
function importGuides(text,convert){
  const parsed=parseRXP(text); if(!parsed.length) return {err:'No RestedXP steps found. Paste the whole guide, including the step lines.'};
  route.guides=route.guides||[]; const added=[], refreshed=[]; const unknown=new Set();
  for(const pg of parsed){
    const {steps,unknownZones}=buildGuideSteps(pg,convert); unknownZones.forEach(z=>unknown.add(z)); if(!steps.length) continue;
    const nm=pg.name||pg.group||'Imported guide'; const ex=route.guides.find(x=>x.name===nm&&x.group===pg.group);
    if(ex){ // same guide again: swap in the new parse and re-point your route's steps at it, keeping their order
      rawPut(ex.id,pg.blocks.map(b=>(b.raw||[]).join('\n')));
      const sig=x=>[x.rx,x.t,x.q||'',x.t==='travel'&&(x.info||x.kind==='note'||x.kind==='goto')?'info':(x.kind||''),x.t==='grind'?x.level:''].join('|'); const pool=new Map(); steps.forEach((x,k)=>{ const k2=sig(x); if(!pool.has(k2)) pool.set(k2,[]); pool.get(k2).push(k); });
      const map=ex.steps.map(o=>{ const a=pool.get(sig(o)); return a&&a.length?a.shift():-1; });
      for(const r of store.routes){ r.steps=r.steps.filter(st=>{ if(!st.src||st.src.g!==ex.id) return true; const ni=map[st.src.i];
          if(ni==null||ni<0){ if(st.t==='travel'&&(st.kind==='note'||st.kind==='goto')&&!st.src.auto) return false; if(st.src.auto){ st.src={...st.src,i:Math.max(0,Math.min(steps.length-1,st.src.i))}; return true; } delete st.src; return true; } // unmatched guide notes are re-added in place by the fill below; other unmatched steps become your own steps
          st.src.i=ni; const ns=steps[ni]; for(const f of ['reqs','rx','qn','ride','gopt','cw','sticky','label','text','kind','loc']) if(ns[f]!=null) st[f]=ns[f]; return true; }); if(r===route) cursor=Math.min(cursor,r.steps.length-1); }
      ex.excluded=(ex.excluded||[]).map(i=>map[i]).filter(i=>i>=0); ex.removed=(ex.removed||[]).map(i=>map[i]).filter(i=>i>=0); ex.from=Math.max(0,map[ex.from]??0); ex.steps=steps; ex.pv=2; ex.to=steps.length-1; refreshed.push(ex); continue; }
    const g={id:uid(),pv:2,name:pg.name||pg.group||'Imported guide',group:pg.group,cond:pg.cond,next:pg.next,ver:pg.ver||'',xprate:pg.xprate||'',color:GCOLORS[route.guides.length%GCOLORS.length],visible:false,from:0,to:steps.length-1,excluded:[],stopAtBlocked:false,includeNotes:true,includeXp:true,steps};
    route.guides.push(g); added.push(g); rawPut(g.id,pg.blocks.map(b=>(b.raw||[]).join('\n')));
  }
  const vis=added.find(x=>guideOK(x))||added[0]; if(vis) vis.visible=true;
  return {added,refreshed,unknown:[...unknown]};
}

/* ghost simulation: run the guide from the join step against the state at the cursor */
function ghostPoint(s,ref){ if(s.loc) return zp2plane(s.loc.z,s.loc.px,s.loc.py); return s.q&&Q(s.q)?stepPoint({...s,loc:null},ref):null; }
function computeGhosts(){
  GH=new Map(); if(!route.guides) return;
  const live=route.steps.filter(s=>!stepActive(s)); const keys=new Set(live.filter(s=>s.q).map(s=>s.t+':'+s.q)); keys.src=new Map(); for(const s of live) if(s.q){ const k=s.t+':'+s.q; if(!keys.src.has(k)) keys.src.set(k,new Set()); keys.src.get(k).add(s.src&&!s.src.auto?s.src.g:'-'); } for(const s of live) if(s.src&&!s.src.auto) keys.add('src:'+s.src.g+':'+s.src.i);
  for(const g of route.guides) GH.set(g.id,ghostSim(g,keys));
}
function ghostSim(g,keys,fromOverride,limit){
  const st=cloneState(SIM.st); const excl=new Set(g.excluded); const from=fromOverride??g.from, to=fromOverride!=null?g.steps.length-1:g.to;
  const res=[]; let ref=null; let okRun=0; const skipped=new Set(); const rqCache=new Map(); const gAcc=new Set(g.steps.filter(x=>x.t==='accept'&&x.cond).map(x=>x.q));
  g.steps.forEach((s,i)=>{
    const r={i,status:'ok',why:'',gained:0};
    const pt=ghostPoint(s,ref); r.pt=pt; if(pt) ref=pt;
    if(limit && i>from+limit){ r.status='outside'; res.push(r); return; }
    if(!s.cond){ r.status='cond'; r.why='Not for your character'; }
    else if(!guideOK(g)){ r.status='xprate'; r.why=guideWhy(g); }
    else if(!xrOK(s.xr)){ r.status='xprate'; r.why='Only at XP rate '+s.xr; }
    else if(!(r._d=dungeonOK(s)).ok){ r.status='dungeon'; r.why=r._d.why; }
    else if(s.lmin && st.level<s.lmin){ r.status='level'; r.why='Guide only does this from level '+s.lmin; }
    else if(s.lmax && st.level>=s.lmax){ r.status='level'; r.why='Guide skips this once you\u2019re level '+s.lmax; }
    else if(excl.has(i)){ r.status='excl'; r.why='Excluded'; }
    else if(i<from||i>to){ r.status='outside'; r.why=i<from?'Before the join step':'After the leave step'; }
    else if((r._rq=(s.reqs&&s.rx?(rqCache.has(s.rx)?rqCache.get(s.rx):(rqCache.set(s.rx,reqFail(s,st)),rqCache.get(s.rx))):reqFail(s,st)))){ r.status='skip'; r.why=r._rq; }
    else if(s.q && !Q(s.q)){ r.status='unknown'; r.why='Quest '+s.q+' isn\u2019t in the Questie database yet (added without XP)'; }
    else {
      const srcs=s.q&&keys.src?.get(s.t+':'+s.q); const inRoute=keys.src?false:(s.q&&keys.has(s.t+':'+s.q)); // guide steps are kept even when the quest is also planned elsewhere (RestedXP skips the repeat itself) // same quest already planned from somewhere else
      if(s.t==='accept'){ if(st.turned.has(s.q)||st.log.has(s.q)){ r.status='done'; r.why='Already accepted'; } else { const w=whyUnavailable(s.q,st,route); if(w&&w.hard){ r.status='unknown'; r.why=w.why; } else if(w&&w.level&&g.autoGrind!==false){ r.autoGrind=w.level; r.why='catch-up grind to level '+w.level+' first'; r.gained=totalXP(w.level,0)-totalXP(st.level,st.xp); st.level=w.level; st.xp=0; st.log.set(s.q,{done:!hasObjectives(s.q)}); } else if(w){ r.status='blocked'; r.why=w.why; if(w.level) r.needLevel=w.level; } else st.log.set(s.q,{done:!hasObjectives(s.q)}); } }
      else if(s.t==='complete'){ if(st.turned.has(s.q)||st.log.get(s.q)?.done&&hasObjectives(s.q)){ r.status='done'; r.why='Already done'; } else if(!st.log.has(s.q)){ r.status='blocked'; r.why='Quest not accepted yet'; } else { const e=st.log.get(s.q); const ke=killEstimate(s.q,s.counts,st,i=>e.objs&&e.objs.has(i)); e.done=true; if(ke.xp){ r.gained=ke.xp; addXP(st,ke.xp); } } }
      else if(s.t==='turnin'){ if(st.turned.has(s.q)){ r.status='done'; r.why='Already turned in'; } else if(!st.log.has(s.q)){ r.status='blocked'; r.why='Not in your quest log'; } else { if(!st.log.get(s.q).done&&hasObjectives(s.q)&&!keys.has('complete:'+s.q)){ r.implicit=true; r.why='objectives completed on the way'; } r.gained=questXP(s.q,st.level); addXP(st,r.gained); st.log.delete(s.q); st.turned.add(s.q); } }
      else if(s.t==='grind'){ const tgt=totalXP(s.level,s.xp||0), now=totalXP(st.level,st.xp); if(tgt<=now){ r.status='done'; r.why='Already past level '+s.level; } else { r.gained=tgt-now; st.level=Math.min(MAXLVL,s.level); st.xp=st.level>=MAXLVL?0:(s.xp||0); r.status='xp'; } }
      else if(s.info) r.status='info';
      if(!s.q && keys.has('src:'+g.id+':'+i) && ['ok','info','xp','done'].includes(r.status)){ r.status='route'; r.why='Already in your route'; }
      if(inRoute && (r.status==='ok'||r.status==='done')) { r.status='route'; r.why='Already in your route'; }
    }
    if(keys.has('src:'+g.id+':'+i) && !['cond','dungeon','xprate','route'].includes(r.status)){ r.status='route'; r.why='Already in your route'; }
    if(s.q){
      if(['unknown','cond','dungeon','excl','xprate','level','skip'].includes(r.status) && s.t==='accept') skipped.add(s.q);
      else if(r.status==='blocked' && s.t!=='accept' && !gAcc.has(s.q) && !keys.has('accept:'+s.q)){ r.status='skip'; r.why='the guide never picks up '+(Q(s.q)?.n||'this quest')+', so this only applies if you already have it'; }
      else if(r.status==='blocked' && skipped.has(s.q) && s.t!=='accept'){ r.status='unknown'; r.why='Skipped because accepting it was skipped'; }
      else if(r.status==='blocked' && s.t==='accept'){ const pre=[...(Q(s.q)?.pg||[]),...(Q(s.q)?.ps||[])]; if(pre.length&&pre.some(p=>skipped.has(p))&&/^Requires/.test(r.why)){ r.status='unknown'; r.why='Skipped because an earlier quest in its chain was skipped'; skipped.add(s.q); } }
    }
    r.level=st.level+(st.level<MAXLVL?st.xp/XP_TABLE[st.level]:0);
    res.push(r);
  });
  return {res};
}
function ghostToStep(g,i){ if(g.removed) g.removed=g.removed.filter(k=>k!==i); const s=g.steps[i]; const o={t:s.t,src:{g:g.id,i}}; for(const k of ['q','mode','level','xp','note','kind','text','counts','gopt','reqs','rx','qn','ride','cw','sticky','label']) if(s[k]!=null) o[k]=s[k]; if(s.loc) o.loc=s.loc; if(s.t==='grind') o.src.xpcheck=true; return o; }
// add this guide's steps that are missing from the part of the route you already took from it, each placed right after the guide step before it
function fillGuide(g,dry){
  const pos=new Map(); route.steps.forEach((s,k)=>{ if(s.src&&!s.src.auto&&s.src.g===g.id&&!pos.has(s.src.i)) pos.set(s.src.i,k); });
  if(!pos.size) return dry?[]:0; const idx=[...pos.keys()].sort((a,b)=>a-b); let lo=idx[0], hi=idx[idx.length-1]; const miss=[];
  // also take in the note/travel steps right before and after the stretch you follow (up to the neighbouring quest step)
  const soft=x=>!x.q||!x.cond||!dungeonOK(x).ok||!xrOK(x.xr); while(lo>0&&soft(g.steps[lo-1])) lo--; while(hi<g.steps.length-1&&soft(g.steps[hi+1])) hi++;
  const other=new Set(route.steps.filter(s=>s.q&&!(s.src&&s.src.g===g.id)).map(s=>s.t+':'+s.q)); const excl=new Set(g.excluded||[]); const rmv=new Set(g.removed||[]); let added=0; if(!dry) pushHistory();
  for(let i=lo;i<=hi;i++){ if(pos.has(i)) continue; const s=g.steps[i];
    if(!s.cond||!xrOK(s.xr)||!dungeonOK(s).ok||excl.has(i)) continue; if(s.info&&!g.includeNotes) continue; if(s.t==='grind'&&!g.includeXp) continue; if(dry){ if(!rmv.has(i)) miss.push(i); continue; }
    let pj=-1; for(const j of pos.keys()) if(j<i&&j>pj) pj=j; let at; if(pj>=0) at=pos.get(pj)+1; else { let nj=Infinity; for(const j of pos.keys()) if(j>i&&j<nj) nj=j; at=pos.get(nj); }
    route.steps.splice(at,0,ghostToStep(g,i)); if(cursor>=at) cursor++; for(const [k,v] of pos) if(v>=at) pos.set(k,v+1); pos.set(i,at); added++; }
  if(dry) return miss; if(!added) history.pop(); return added; }
// a catch-up grind must not split a guide step from the step it is shown together with (#completewith next)
function addGrind(add,gr){ let p=add.length; while(p>0&&add[p-1].cw==='next') p--; add.splice(p,0,gr); }
function connectGuide(g){
  const auto=g.autoGrind!==false; let added=0, grinds=0, stopped=null, lastLvl=null;
  pushHistory();
  for(let guard=0;guard<400;guard++){
    const gh=GH.get(g.id); const add=[]; let lvl=null; stopped=null;
    for(let i=g.from;i<=g.to;i++){ const r=gh.res[i]; const s=g.steps[i];
      if(r.status==='ok'){ if(r.autoGrind) addGrind(add,{t:'grind',mode:'to',level:r.autoGrind,xp:0,src:{g:g.id,i,auto:true},note:`Catch up to level ${r.autoGrind} for "${ghostText(s)}"`}); if(r.implicit) add.push({t:'complete',q:s.q,src:{g:g.id,i}}); add.push(ghostToStep(g,i)); }
      else if(r.status==='xp'){ if(g.includeXp) add.push(ghostToStep(g,i)); }
      else if(r.status==='info'){ if(g.includeNotes) add.push(ghostToStep(g,i)); }
      else if(r.status==='blocked'){
        if(auto && r.needLevel && !s.gopt && !(lastLvl&&lastLvl.i===i)){ lvl={i,level:r.needLevel}; break; }
        if(g.stopAtBlocked && !s.opt && !s.gopt){ stopped=i; break; }
        add.push(ghostToStep(g,i)); // keep it: the route shows why it can't be done yet
      }
      else if(['skip','unknown','level'].includes(r.status) || (r.status==='done' && (s.t!=='grind'||g.includeXp))) add.push(ghostToStep(g,i));
    }
    if(lvl) addGrind(add,{t:'grind',mode:'to',level:lvl.level,xp:0,src:{g:g.id,i:lvl.i,auto:true},note:`Catch up to level ${lvl.level} for "${ghostText(g.steps[lvl.i])}"`});
    if(add.length){ route.steps.splice(cursor+1,0,...add); cursor+=add.length; added+=add.length; }
    if(lvl){ grinds++; lastLvl=lvl; g.from=lvl.i; simulate(); computeGhosts(); continue; }
    if(stopped!=null) g.from=stopped;
    break;
  }
  if(!added){ history.pop(); const gh=GH.get(g.id); toast(stopped!=null?`Step ${stopped+1} is blocked: ${gh.res[stopped].why}`:'Nothing to add in this range'); refresh(); return; }
  refresh(); scrollCursor();
  toast(`Added ${added} step${added>1?'s':''}`+(grinds?` including ${grinds} catch-up grind${grinds>1?'s':''}`:'')+(stopped!=null?` · stopped at blocked step ${stopped+1}`:''));
}
function nextGuides(g){ const names=(g.next||'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean); const f=[]; for(const n of names) for(const x of route.guides||[]) if(x!==g&&x.name.trim().toLowerCase()===n&&!f.includes(x)) f.push(x); const m=f.filter(x=>guideOK(x)).slice(0,1); return {names:(g.next||'').split(';').map(s=>s.trim()).filter(Boolean),found:m.length?m:f}; }
function continueWith(prev,id){
  const ng=G(id); if(!ng) return;
  const left=GH.get(prev.id)?.res.filter(r=>r.i>=prev.from&&r.i<=prev.to&&(r.status==='ok'||r.status==='blocked')).length||0;
  cursor=route.steps.length-1; selGuide=id; selGhost=null; ng.visible=true; prev.visible=false; ng.from=0; ng.to=ng.steps.length-1; refresh();
  const first=GH.get(id).res.find(r=>['ok','xp','blocked','info'].includes(r.status));
  if(first){ ng.from=first.i; selGhost={g:id,i:first.i}; }
  renderGuides._scroll=true; refresh();
  const p=first&&GH.get(id).res.slice(first.i).find(r=>r.pt)?.pt; if(p) flyTo(p.X,p.Y,Math.max(view.s,0.06));
  toast(`Joined ${ng.name} at step ${(first?.i??0)+1}`+(left?` · ${left} step${left>1?'s':''} of ${prev.name} aren't in your route yet`:''));
}
function suggestJoin(g){
  let ref=null; for(let i=cursor;i>=0&&!ref;i--) ref=SIM.res[i]?.pt; if(!ref) ref=SIM.near?.pt;
  const keys=new Set(route.steps.filter(s=>s.q).map(s=>s.t+':'+s.q));
  let best=null;
  g.steps.forEach((s,i)=>{
    if(s.t!=='accept'||!s.cond||!Q(s.q)||keys.has('accept:'+s.q)) return;
    if(whyUnavailable(s.q,SIM.st,route)) return;
    const sim=ghostSim({...g,from:i,to:g.steps.length-1},keys,i,40).res.slice(i,i+40);
    let run=0; for(const r of sim){ if(r.status==='blocked') break; if(r.status==='ok'||r.status==='xp') run++; }
    const p=sim[0]?.pt; const d=p&&ref?Math.hypot(p.X-ref.X,p.Y-ref.Y):0;
    const score=run*300-d; if(!best||score>best.score) best={i,score,run,d};
  });
  if(!best){ toast('No step in this guide can be joined from here yet'); return; }
  g.from=best.i; if(g.to<g.from) g.to=g.steps.length-1; selGhost={g:g.id,i:best.i}; refresh();
  const p=GH.get(g.id).res[best.i].pt; if(p) flyTo(p.X,p.Y,Math.max(view.s,0.08));
  toast(`Join at step ${best.i+1}: ${best.run} steps in a row are doable, ${fmt(best.d)} yards away`);
}

/* drawing */
function arrow(ax,ay,bx,by,col,label){
  ctx.strokeStyle=col; ctx.lineWidth=2.2; ctx.setLineDash([2,5]); ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke(); ctx.setLineDash([]);
  const a=Math.atan2(by-ay,bx-ax); ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx-10*Math.cos(a-0.4),by-10*Math.sin(a-0.4)); ctx.lineTo(bx-10*Math.cos(a+0.4),by-10*Math.sin(a+0.4)); ctx.closePath(); ctx.fill();
  if(label) haloText(label,(ax+bx)/2,(ay+by)/2-9,'600 12px "Alegreya Sans", sans-serif','#fff3c4','rgba(20,12,4,.9)',3);
}
function drawGhosts(){
  if(!layers.ghost||!route.guides) return;
  for(const g of route.guides){ if(!g.visible) continue; const gh=GH.get(g.id); if(!gh) continue;
    const nodes=gh.res.filter(r=>r.pt&&!['cond','dungeon','xprate'].includes(r.status));
    ctx.lineCap='round';
    for(let k=1;k<nodes.length;k++){ const a=nodes[k-1], b=nodes[k]; const [ax,ay]=toS(a.pt),[bx,by]=toS(b.pt);
      if(Math.max(ax,bx)<-50||Math.min(ax,bx)>W+50||Math.max(ay,by)<-50||Math.min(ay,by)>H+50) continue;
      const st=b.status; const inRange=b.i>=g.from&&b.i<=g.to;
      if(st==='route'||st==='done'){ ctx.strokeStyle=g.color; ctx.globalAlpha=0.25; ctx.lineWidth=1.5; ctx.setLineDash([]); }
      else if(!inRange||st==='excl'||st==='outside'){ ctx.strokeStyle=g.color; ctx.globalAlpha=0.18; ctx.lineWidth=1.5; ctx.setLineDash([3,6]); }
      else if(st==='blocked'){ ctx.strokeStyle='#ff6a55'; ctx.globalAlpha=0.8; ctx.lineWidth=2; ctx.setLineDash([4,5]); }
      else { ctx.strokeStyle=g.color; ctx.globalAlpha=0.85; ctx.lineWidth=2.4; ctx.setLineDash([8,6]); }
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha=1;
    const showNodes=view.s>0.045; let last=null;
    for(const r of nodes){ const [x,y]=toS(r.pt); if(x<-20||x>W+20||y<-20||y>H+20) continue;
      const inRange=r.i>=g.from&&r.i<=g.to; const sel=selGhost&&selGhost.g===g.id&&selGhost.i===r.i;
      if((r.status==='dungeon'||r.status==='xprate')&&!sel) continue;
      if(!showNodes && !sel && r.i!==g.from && r.i!==g.to) continue;
      if(last&&Math.hypot(x-last[0],y-last[1])<9&&!sel) continue; last=[x,y];
      const faint=!inRange||['route','done','excl','outside'].includes(r.status);
      ctx.globalAlpha=faint?0.35:1; ctx.fillStyle='#10161a'; ctx.strokeStyle=r.status==='blocked'?'#ff6a55':g.color; ctx.lineWidth=sel?3:1.6;
      ctx.beginPath(); ctx.arc(x,y,sel?7:5,0,7); ctx.fill(); ctx.stroke();
      if(r.status==='blocked'){ ctx.strokeStyle='#ff6a55'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x-3,y-3); ctx.lineTo(x+3,y+3); ctx.moveTo(x+3,y-3); ctx.lineTo(x-3,y+3); ctx.stroke(); }
      else if(r.status==='route'||r.status==='done'){ ctx.fillStyle=g.color; ctx.beginPath(); ctx.arc(x,y,2.5,0,7); ctx.fill(); }
      ctx.globalAlpha=1;
      if(view.s>0.12 && !faint) haloText(String(r.i+1),x,y-11,'600 10px "Alegreya Sans", sans-serif',g.color,'rgba(10,10,10,.85)',3);
      hits.push({x,y,r:8,kind:'ghost',g:g.id,i:r.i});
    }
    if(selGuide===g.id){
      // join / leave connectors
      let cp=null; for(let i=cursor;i>=0&&!cp;i--) cp=SIM.res[i]?.pt; if(!cp) cp=SIM.near?.pt;
      const join=gh.res.slice(g.from).find(r=>r.pt&&r.status!=='cond'); const leave=[...gh.res.slice(0,g.to+1)].reverse().find(r=>r.pt&&r.status!=='cond');
      let np=null; for(let i=cursor+1;i<SIM.res.length&&!np;i++) np=SIM.res[i]?.pt;
      if(cp&&join){ const [a,b]=toS(cp),[c,d]=toS(join.pt); if(Math.hypot(c-a,d-b)>14) arrow(a,b,c,d,'#ffd24a','Join'); }
      if(leave&&np){ const [a,b]=toS(leave.pt),[c,d]=toS(np); if(Math.hypot(c-a,d-b)>14) arrow(a,b,c,d,'#ffd24a','Back to route'); }
    }
  }
}

/* guide panel */
const G=id=>route.guides?.find(g=>g.id===id);
function ghostIcon(s){ return {accept:'!',turnin:'?',complete:'✓',grind:'⚔',travel:'➤'}[s.t]||'·'; }
function ghostText(s){ const q=s.q&&Q(s.q); const qn=q?q.n:(s.q?(s.qn||'Quest '+s.q):'');
  switch(s.t){ case 'accept': return 'Accept '+qn; case 'turnin': return 'Turn in '+qn; case 'complete': return 'Complete '+qn;
    case 'grind': return `Reach level ${s.level}${s.xp?' + '+fmt(s.xp)+' XP':''}`;
    case 'buy': return 'Buy from '+(vendorOf(s.npc)?.name||'vendor');
    case 'travel': return ({fly:'Fly to ',fp:'Get flight path: ',home:'Set hearthstone: ',hs:'Hearth to ',goto:'',note:''})[s.kind]+rxpPlain(s.text||''); }
  return s.text||''; }
const STLBL={skip:'Guide skips this',level:'Level skip',xprate:'XP rate',unknown:'Skipped',dungeon:'Dungeon',ok:'Doable',xp:'XP checkpoint',info:'Note',blocked:'Blocked',done:'Already done',route:'In your route',outside:'',excl:'Excluded',cond:'Not for your character'};
function renderGuides(){
  const gs=(route.guides||[]).filter(x=>guideOK(x)||xrBox.other||x.id===selGuide);
  if(!selGuide||!G(selGuide)||(!guideOK(G(selGuide))&&!xrBox.other)) selGuide=(gs.find(x=>guideOK(x))||gs[0])?.id||null;
  const g=G(selGuide);
  let h=`<div class="gbar"><div class="row"><button class="btn sm gold" id="gImport">Import guide</button>${gs.length?`<select id="gSel" style="flex:1;min-width:0">${guideOptions(gs)}</select>`:''}</div>`;
  if(!g){ return h+xrBox()+dungeonBox()+`</div><div class="empty">Import a RestedXP guide to see it as a ghost route on the map. You choose where to <b>join</b> it from your route and where to <b>leave</b> it; the guide's steps become real route steps once their prerequisites are met at that point.</div>`; }
  h+=xrBox()+dungeonBox();
  h+=`<div class="note" style="color:${rawCache.has(g.id)?'var(--ok)':'var(--warn)'}">${rawCache.has(g.id)?'✓ Original guide text saved: exported steps match the guide exactly':'⚠ Original guide text missing: re-import this guide file so exported steps match it exactly'}</div>`;
  if(!guideOK(g)) h+=`<div class="reason">${esc(guideWhy(g))}, so its steps are skipped for your character.</div>`;
  const gh=GH.get(g.id); const res=gh.res; const cnt=s=>res.filter((r,i)=>i>=g.from&&i<=g.to&&r.status===s).length;
  const firstBlock=res.find((r,i)=>i>=g.from&&i<=g.to&&r.status==='blocked');
  const opt=(i)=>`<option value="${i}">${i+1}. ${esc(rxpPlain(ghostText(g.steps[i])).slice(0,48))}</option>`;
  const endLvl=[...res].reverse().find((r,i)=>r.i<=g.to&&r.i>=g.from)?.level;
  h+=`<div class="row"><span class="gchip" style="background:${g.color}"></span><input type="text" id="gName" value="${esc(g.name)}" aria-label="Guide name" style="flex:1;min-width:0;padding:3px 6px;border:1px solid var(--line);border-radius:5px;background:var(--panel2)"><label><input type="checkbox" id="gVis" ${g.visible?'checked':''}> Show</label><button class="btn sm" id="gDel">Remove</button></div>
  <div class="row"><label style="flex:1">Join at<select id="gFrom" style="flex:1;min-width:0">${g.steps.map((_,i)=>opt(i)).join('')}</select></label></div>
  <div class="row"><label style="flex:1">Leave at<select id="gTo" style="flex:1;min-width:0">${g.steps.map((_,i)=>opt(i)).join('')}</select></label></div>
  ${g.from>0||g.to<g.steps.length-1?`<div class="row"><button class="linkish" id="gReset">Clear join and leave (use the whole guide)</button></div>`:''}
  <div class="row"><label><input type="checkbox" id="gStop" ${g.stopAtBlocked?'checked':''}> Stop at first blocked step</label></div>
  <div class="row"><label><input type="checkbox" id="gAuto" ${g.autoGrind!==false?'checked':''}> Add a grind step when only your level blocks a step</label></div>
  <div class="row"><label><input type="checkbox" id="gXp" ${g.includeXp?'checked':''}> Include XP checkpoints</label><label><input type="checkbox" id="gNotes" ${g.includeNotes?'checked':''}> Include notes</label></div>
  <div class="gsum">From step ${cursor+1<1?'start':cursor+1} of your route: <b>${cnt('ok')}</b> doable, <b>${cnt('blocked')}</b> blocked, <b>${cnt('route')+cnt('done')}</b> already covered${endLvl?` · ends near level <b>${endLvl.toFixed(1)}</b>`:''}</div>
  ${firstBlock?`<div class="reason">First blocker, step ${firstBlock.i+1}: ${esc(firstBlock.why)}. <button class="linkish" data-gsel="${firstBlock.i}">Show</button></div>`:''}
  <div class="row"><button class="btn sm" id="gSuggest">Suggest join point</button><button class="btn sm gold" id="gConnect">Add doable steps to route</button><button class="btn sm" id="gFill" title="Adds this guide's steps that are missing from the part of your route that already follows it, each in its guide position. Nothing is duplicated or moved.">Fill in missing steps in place</button></div>
  ${(()=>{ const n=nextGuides(g); if(!n.names.length) return ''; return n.found.length?`<div class="row">${n.found.map(x=>`<button class="btn sm" data-gnext="${x.id}">Continue with ${esc(x.name)}</button>`).join('')}</div>`:`<p class="note" style="margin:0">Next guide: ${esc(n.names.join(' or '))}. Import the file that contains it to continue.</p>`; })()}
  <div class="row"><label>List<select id="gFilt"><option value="relevant">Your character and XP rate</option><option value="range">Join to leave only</option><option value="all">Every step</option></select></label></div></div>`;
  const rows=[]; g.steps.forEach((s,i)=>{ const r=res[i];
    const dgb=(s.dg||[]).map(t=>`<span class="gmark" title="Only when running ${esc(dgName(t))}">${esc(t)}</span>`).join('')+(s.dgs||[]).map(t=>`<span class="gmark" title="Skipped when running ${esc(dgName(t))}">no ${esc(t)}</span>`).join('');
    if(gFilter==='relevant'&&(r.status==='cond'||r.status==='xprate')) return; if(gFilter==='range'&&(i<g.from||i>g.to||r.status==='cond')) return;
    const sel=selGhost&&selGhost.g===g.id&&selGhost.i===i; const marks=(i===g.from?'<span class="gmark">join</span>':'')+(i===g.to?'<span class="gmark">leave</span>':'');
    const lbl=r.status==='outside'?'':(STLBL[r.status]+(r.why&&r.status!=='cond'&&r.status!=='route'?': '+r.why:'')+(r.gained?' · +'+fmt(r.gained)+' XP':''));
    rows.push(`<div class="gstep st-${r.status} ${sel?'sel':''}" data-gstep="${i}" style="--gcol:${g.color}"><input type="checkbox" data-gex="${i}" ${g.excluded.includes(i)?'':'checked'} aria-label="Include step ${i+1}" ${s.cond?'':'disabled'}><span class="gn">${i+1}</span><span class="gi">${ghostIcon(s)}</span><span>${s.info?rxpHTML(s.text||''):esc(rxpPlain(ghostText(s)))}${marks}${dgb}${notesHTML(s)}${lbl?`<span class="gs">${esc(lbl)}</span>`:''}${sel?`<span class="row" style="margin-top:3px"><button class="btn sm" data-gjoin="${i}">Join here</button><button class="btn sm" data-gleave="${i}">Leave here</button><button class="btn sm" data-gone="${i}">Add this step</button></span>`:''}</span><button class="gdel" data-gdel="${i}" title="${r.status==='route'?'Remove this step from your route':'Leave this step out'}" aria-label="Remove step ${i+1}">×</button></div>`);
  });
  h+=`<div>${rows.join('')||'<div class="empty">No steps match this filter.</div>'}</div>`;
  return h;
}
function afterGuidesRender(){
  const g=G(selGuide); const on=(id,ev,fn)=>{ const el=document.getElementById(id); el&&el.addEventListener(ev,fn); };
  on('gImport','click',openImport);
  on('gSel','change',e=>{ selGuide=e.target.value; const sg=G(selGuide); if(sg) sg.visible=true; selGhost=null; renderRight(); requestDraw(); });
  if(!g) return;
  $('#gFrom').value=g.from; $('#gTo').value=g.to; $('#gFilt').value=gFilter;
  on('gName','change',e=>{ g.name=e.target.value||'Guide'; save(); renderRight(); });
  on('gVis','change',e=>{ g.visible=e.target.checked; save(); requestDraw(); });
  on('gDel','click',async()=>{ if(!await ask('Remove this guide from the route? Steps already added stay.')) return; route.guides=route.guides.filter(x=>x!==g); selGuide=null; refresh(); });
  on('gFrom','change',e=>{ g.from=+e.target.value; if(g.to<g.from) g.to=g.steps.length-1; refresh(); });
  on('gTo','change',e=>{ g.to=+e.target.value; if(g.to<g.from) g.from=g.to; refresh(); });
  on('gReset','click',()=>{ g.from=0; g.to=g.steps.length-1; refresh(); });
  on('gStop','change',e=>{ g.stopAtBlocked=e.target.checked; save(); });
  on('gAuto','change',e=>{ g.autoGrind=e.target.checked; save(); });
  $$('#rightBody [data-gnext]').forEach(b=>b.addEventListener('click',()=>continueWith(g,b.dataset.gnext)));
  on('gXp','change',e=>{ g.includeXp=e.target.checked; save(); });
  on('gNotes','change',e=>{ g.includeNotes=e.target.checked; save(); });
  on('gFilt','change',e=>{ gFilter=e.target.value; renderRight(); });
  on('gSuggest','click',()=>suggestJoin(g));
  on('gConnect','click',()=>connectGuide(g));
  on('gFill','click',()=>{ if(!g.pv){ toast('This guide was imported by an older planner version that left out Forever quests. Import the guide file again (Import button) and the missing steps are added in place.',9000); return; } const n=fillGuide(g); refresh(); toast(n?`Added ${n} missing step${n>1?'s':''} in place`:'Nothing missing: your route already has every step of this guide in that stretch'); });
  const sel=$('#rightBody .gstep.sel'); if(sel&&renderGuides._scroll){ sel.scrollIntoView({block:'nearest'}); renderGuides._scroll=false; }
}
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-gdel],[data-gex],[data-gjoin],[data-gleave],[data-gone],[data-gsel],[data-gstep],[data-ghjoin],[data-ghleave],[data-ghone],[data-ghshow]'); if(!t) return;
  const d=t.dataset;
  if(d.ghjoin||d.ghleave||d.ghone||d.ghshow){ const [gid,i]=(d.ghjoin||d.ghleave||d.ghone||d.ghshow).split(':'); const g=G(gid); if(!g) return; selGuide=gid; selGhost={g:gid,i:+i}; hidePop();
    if(d.ghjoin){ g.from=+i; if(g.to<g.from) g.to=g.steps.length-1; } if(d.ghleave){ g.to=+i; if(g.from>g.to) g.from=0; }
    if(d.ghone){ const r=GH.get(gid).res[+i]; if(r.status==='blocked'&&!await ask('This step is blocked here: '+r.why+'. Add it anyway?')) return; { const s=g.steps[+i], i2=+i; if(r.autoGrind) addStep({t:'grind',mode:'to',level:r.autoGrind,xp:0,src:{g:gid,i:i2,auto:true},note:`Catch up to level ${r.autoGrind} for "${ghostText(s)}"`}); } if(r.implicit) addStep({t:'complete',q:g.steps[+i].q,src:{g:gid,i:+i}}); addStep(ghostToStep(g,+i)); }
    tab='guides'; renderGuides._scroll=true; openPanel('right'); refresh(); return; }
  const g=G(selGuide); if(!g) return;
  if(d.gdel!=null){ e.stopPropagation(); const i=+d.gdel; const s=g.steps[i];
    const idx=route.steps.map((x,k)=>(x.src&&x.src.g===g.id&&x.src.i===i)||(s.q&&x.q===s.q&&x.t===s.t)?k:-1).filter(k=>k>=0);
    if(idx.length){ pushHistory(); for(const k of idx.reverse()){ route.steps.splice(k,1); if(cursor>=k) cursor--; } toast('Removed from your route'); }
    else { if(!g.excluded.includes(i)) g.excluded.push(i); toast('Step left out of this guide'); }
    refresh(); return; }
  if(d.gex!=null){ e.stopPropagation(); const i=+d.gex; g.excluded=t.checked?g.excluded.filter(x=>x!==i):[...g.excluded,i]; refresh(); return; }
  if(d.gjoin!=null){ g.from=+d.gjoin; if(g.to<g.from) g.to=g.steps.length-1; refresh(); return; }
  if(d.gleave!=null){ g.to=+d.gleave; if(g.from>g.to) g.from=0; refresh(); return; }
  if(d.gone!=null){ const i=+d.gone; const r=GH.get(g.id).res[i]; if(r.status==='blocked'&&!await ask('This step is blocked here: '+r.why+'. Add it anyway?')) return; { const s=g.steps[i]; if(r.autoGrind) addStep({t:'grind',mode:'to',level:r.autoGrind,xp:0,src:{g:g.id,i,auto:true},note:`Catch up to level ${r.autoGrind} for "${ghostText(s)}"`}); } if(r.implicit) addStep({t:'complete',q:g.steps[i].q,src:{g:g.id,i}}); addStep(ghostToStep(g,i)); return; }
  if(d.gsel!=null||d.gstep!=null){ const i=+(d.gsel??d.gstep); selGhost={g:g.id,i}; const s=g.steps[i]; if(s.q&&Q(s.q)) selQuest=s.q; renderGuides._scroll=d.gsel!=null; renderRight(); const p=GH.get(g.id).res[i].pt; if(p){ const [x,y]=toS(p); if(x<40||y<40||x>W-40||y>H-40||view.s<0.04) flyTo(p.X,p.Y,Math.max(view.s,0.08)); } requestDraw(); }
});
function ghostPopHTML(h){
  const g=G(h.g); const s=g.steps[h.i]; const r=GH.get(g.id).res[h.i]; const key=g.id+':'+h.i;
  return `<h4><span class="gchip" style="background:${g.color}"></span>${esc(g.name)} · step ${h.i+1}</h4><div class="it">${s.info?rxpHTML(s.text||''):esc(rxpPlain(ghostText(s)))}${notesHTML(s)}<br><span class="note">${esc(STLBL[r.status]||'')}${r.why?': '+esc(r.why):''}</span>
  <div class="row"><button class="btn sm gold" data-ghjoin="${key}">Join here</button><button class="btn sm" data-ghleave="${key}">Leave here</button><button class="btn sm" data-ghone="${key}">Add this step</button><button class="btn sm" data-ghshow="${key}">In list</button></div></div>`;
}
function openImport(){ $('#impText').value=''; $('#impMsg').textContent=''; $('#dlgImport').showModal(); }
$('#impFile').addEventListener('change',async e=>{ const f=e.target.files[0]; if(!f) return; $('#impText').value=await f.text(); $('#impMsg').textContent=`Loaded ${f.name} (${fmt(f.size/1024)} KB).`; e.target.value=''; });
$('#impCancel').addEventListener('click',()=>$('#dlgImport').close());
$('#impGo').addEventListener('click',()=>{
  const r=importGuides($('#impText').value,$('#impConvert').checked);
  if(r.err){ $('#impMsg').textContent=r.err; return; }
  let filled=0; for(const g of r.refreshed) filled+=fillGuide(g);
  if(!r.added.length&&r.refreshed.length){ $('#dlgImport').close(); refresh(); toast(`Updated ${r.refreshed.length} guide${r.refreshed.length>1?'s':''} you already had`+(filled?` and added ${filled} missing step${filled>1?'s':''} in their guide positions`:'')+'. Your own steps and order are unchanged.'); return; }
  if(!r.added.length){ $('#impMsg').textContent='The guide had no steps this planner understands (accept, complete, turn in, xp, fly, flight path, hearth).'; return; }
  selGuide=(r.added.find(x=>x.visible)||r.added[0]).id; selGhost=null; tab='guides'; $('#dlgImport').close(); refresh(); openPanel('right');
  const p=GH.get(selGuide).res.find(x=>x.pt)?.pt; if(p) flyTo(p.X,p.Y,Math.max(view.s,0.06));
  toast(`Imported ${r.added.length} guide${r.added.length>1?'s':''}`+(r.refreshed.length?` · updated ${r.refreshed.length} existing`:'')+(r.unknown.length?` · unknown zones skipped: ${r.unknown.slice(0,3).join(', ')}`:''));
});

/* ---------- dungeon conditionals (.dungeon TAG / .dungeon !TAG) ---------- */
const DUNGEONS=[['RFC','Ragefire Chasm'],['DM','The Deadmines'],['WC','Wailing Caverns'],['SFK','Shadowfang Keep'],['BFD','Blackfathom Deeps'],['STOCKS','The Stockade'],['GNOMER','Gnomeregan'],['RFK','Razorfen Kraul'],['SM','Scarlet Monastery'],['RFD','Razorfen Downs'],['ULDA','Uldaman'],['ZF',"Zul'Farrak"],['MARA','Maraudon'],['ST','Sunken Temple'],['BRD','Blackrock Depths'],['DME','Dire Maul'],['SCHOLO','Scholomance'],['STRAT','Stratholme'],['LBRS','Lower Blackrock Spire']];
const DG_ALT={DEADMINES:'DM',VC:'DM',STOCKADES:'STOCKS',STOCKADE:'STOCKS',"TEMPLE OF ATAL'HAKKAR":'ST',DMW:'DME',DMN:'DME',GNOMEREGAN:'GNOMER',ULDAMAN:'ULDA',MARAUDON:'MARA',STRATHOLME:'STRAT',SCHOLOMANCE:'SCHOLO',"ZUL'FARRAK":'ZF'};
function dgTag(x){ const u=String(x).trim().toUpperCase(); return DG_ALT[u]||u; }
function dgName(t){ return (DUNGEONS.find(d=>d[0]===t)||[t,t])[1]; }
function dgOn(t){ return !!route.char.dungeons?.[t]; }
function dungeonOK(s){
  if(s.dgs&&s.dgs.some(dgOn)) return {ok:false,why:'Skipped when you run '+s.dgs.filter(dgOn).map(dgName).join(', ')};
  const need=(s.dg||[]).filter(t=>!(s.dgs||[]).includes(t));
  if(need.length && !need.some(dgOn)) return {ok:false,why:'Only when you run '+need.map(dgName).join(' or ')};
  return {ok:true};
}
function guideOptions(gs){ const by=new Map(); for(const x of gs){ const k=x.group||'Imported'; if(!by.has(k)) by.set(k,[]); by.get(k).push(x); }
  return [...by].map(([k,l])=>`<optgroup label="${esc(k)}">${l.map(x=>`<option value="${x.id}" ${x.id===selGuide?'selected':''}>${esc(x.name)}${guideOK(x)?'':' — '+esc(guideWhy(x).replace(/^Guide is /,''))}</option>`).join('')}</optgroup>`).join(''); }
const isAoE=g=>/\bAoE\b/i.test((g.group||'')+' '+(g.name||''));
function guideOK(g){ return !!g&&xrOK(g.xprate)&&!g.ver&&condOK(g.cond||'')&&(!isAoE(g)||!!route.char.aoe); }
function guideWhy(g){ if(!xrOK(g.xprate)) return 'Guide is for XP rate '+g.xprate; if(g.ver) return 'Guide is '+g.ver.replace(' only',' only'); if(!condOK(g.cond||'')) return 'Guide is for '+g.cond; if(isAoE(g)&&!route.char.aoe) return 'Guide is an AoE mage route (turn on in the XP rate box)'; return ''; }
function stepActive(s,st){ if(!s.src) return null; const g=G(s.src.g); const gs=g?.steps[s.src.i]; if(!gs) return null; if(!guideOK(g)) return guideWhy(g); if(!xrOK(gs.xr)) return 'Only at XP rate '+gs.xr; const d=dungeonOK(gs); if(!d.ok) return d.why;
  if(st&&!s.src.auto){ if(gs.lmin&&st.level<gs.lmin) return 'Guide only does this from level '+gs.lmin; if(gs.lmax&&st.level>=gs.lmax) return 'Guide skips this once you\u2019re level '+gs.lmax; } return null; }
function allDungeonTags(){ const tags=new Map(DUNGEONS.map(([t])=>[t,0])); for(const g of route.guides||[]) for(const s of g.steps) for(const t of [...(s.dg||[]),...(s.dgs||[])]) tags.set(t,(tags.get(t)||0)+1); return tags; }
function dungeonChecks(prefix){ const tags=allDungeonTags(); return [...tags].map(([t,n])=>`<label title="${esc(dgName(t))}"><input type="checkbox" data-${prefix}="${esc(t)}" ${dgOn(t)?'checked':''}> ${esc(t==='ST'?'Sunken Temple':dgName(t))}${n?` <span class="note">(${n})</span>`:''}</label>`).join(''); }
function dungeonBox(){ const on=Object.values(route.char.dungeons||{}).filter(Boolean).length;
  return `<details class="dgbox" ${dungeonBox.open?'open':''}><summary>Dungeons you'll run (${on} selected)</summary><p class="note" style="margin:4px 0">Guide steps marked <code>.dungeon</code> only apply when that dungeon is ticked; steps marked <code>.dungeon !</code> are skipped when it is. Numbers are guide steps that depend on each dungeon.</p><div class="dggrid">${dungeonChecks('dgon')}</div></details>`; }
document.addEventListener('toggle',e=>{ if(e.target.classList?.contains('dgbox')) dungeonBox.open=e.target.open; },true);
document.addEventListener('change',e=>{ const t=e.target.dataset?.dgon; if(t==null) return; setDungeon(t,e.target.checked); });
function setDungeon(tag,on){
  route.char.dungeons=route.char.dungeons||{}; if(on) route.char.dungeons[tag]=true; else delete route.char.dungeons[tag];
  pushHistory(); let added=0; if(on) added=insertNewlyEnabled(); refresh();
  const off=route.steps.filter(s=>stepActive(s)).length;
  toast(on?`${dgName(tag)} on`+(added?` · ${added} guide step${added>1?'s':''} added to your route`:''):`${dgName(tag)} off`+(off?` · ${off} route step${off>1?'s':''} now skipped`:''));
}
/* when a dungeon is switched on, guide steps inside the part of a guide you've already connected get added in guide order */
function insertNewlyEnabled(){
  let added=0;
  for(const g of route.guides||[]){
    const idxs=route.steps.map((s,k)=>s.src&&s.src.g===g.id?s.src.i:null).filter(v=>v!=null); if(!idxs.length) continue;
    const lo=Math.min(...idxs), hi=Math.max(...idxs); const excl=new Set(g.excluded);
    for(let i=lo+1;i<hi;i++){
      const s=g.steps[i]; if(!s.cond||excl.has(i)||!(s.dg||s.dgs||s.xr)||!dungeonOK(s).ok||!xrOK(s.xr)||!guideOK(g)) continue;
      if(s.q&&!Q(s.q)) continue; if(s.info&&!g.includeNotes) continue; if(s.t==='grind'&&!g.includeXp) continue;
      if(route.steps.some(x=>x.src&&!x.src.auto&&x.src.g===g.id&&x.src.i===i)) continue;
      if(s.q&&route.steps.some(x=>x.t===s.t&&x.q===s.q)) continue;
      let pos=-1; route.steps.forEach((x,k)=>{ if(x.src&&x.src.g===g.id&&x.src.i<i) pos=k; });
      route.steps.splice(pos+1,0,ghostToStep(g,i)); if(pos+1<=cursor) cursor++; added++;
    }
  }
  return added;
}

/* resizable side panels */
(function(){ const root=document.documentElement;
  try{ const w=JSON.parse(localStorage.getItem('frp.widths')||'{}'); if(w.l) root.style.setProperty('--lw',w.l+'px'); if(w.r) root.style.setProperty('--rw',w.r+'px'); }catch(e){}
  $$('.resizer').forEach(h=>{ h.addEventListener('pointerdown',e=>{ e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('on'); const side=h.dataset.side; const panel=h.parentElement; const x0=e.clientX, w0=panel.getBoundingClientRect().width;
    const mv=ev=>{ let w=side==='l'?w0+(ev.clientX-x0):w0-(ev.clientX-x0); w=Math.max(240,Math.min(innerWidth*0.55,w)); root.style.setProperty(side==='l'?'--lw':'--rw',Math.round(w)+'px'); };
    const up=()=>{ h.classList.remove('on'); h.removeEventListener('pointermove',mv); h.removeEventListener('pointerup',up); try{ const o=JSON.parse(localStorage.getItem('frp.widths')||'{}'); o[side]=Math.round((side==='l'?$('#leftPanel'):$('#rightPanel')).getBoundingClientRect().width); localStorage.setItem('frp.widths',JSON.stringify(o)); }catch(_){ } resize(); };
    h.addEventListener('pointermove',mv); h.addEventListener('pointerup',up); });
    h.addEventListener('dblclick',()=>{ root.style.removeProperty(h.dataset.side==='l'?'--lw':'--rw'); try{ const o=JSON.parse(localStorage.getItem('frp.widths')||'{}'); delete o[h.dataset.side]; localStorage.setItem('frp.widths',JSON.stringify(o)); }catch(_){ } resize(); }); });
})();

function ask(msg,okLabel){ $('#askIn').hidden=true; return new Promise(res=>{ const d=$('#dlgAsk'); $('#askMsg').textContent=msg; $('#askOk').textContent=okLabel||'OK';
  const done=v=>{ d.onclose=null; $('#askOk').onclick=null; $('#askNo').onclick=null; d.close(); res(v); };
  $('#askOk').onclick=()=>done(true); $('#askNo').onclick=()=>done(false); d.onclose=()=>res(false); d.showModal(); }); }

function askText(msg,def,ok){ return new Promise(res=>{ const d=$('#dlgAsk'), inp=$('#askIn'); $('#askMsg').textContent=msg; $('#askOk').textContent=ok||'OK'; inp.hidden=false; inp.value=def||'';
  const done=v=>{ d.onclose=null; $('#askOk').onclick=null; $('#askNo').onclick=null; inp.onkeydown=null; d.close(); inp.hidden=true; res(v); };
  $('#askOk').onclick=()=>done(inp.value); $('#askNo').onclick=()=>done(null); inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); done(inp.value); } }; d.onclose=()=>{ inp.hidden=true; res(null); }; d.showModal(); inp.select(); }); }

/* ---------- XP rate conditional (#xprate) ---------- */
function xrRate(){ return +route.char.xprate||1; }
function xrOK(str){ if(!str) return true; const rate=xrRate(); let lo=1,hi=4095; const m=String(str).trim().match(/^([<>]?)\s*(\d+\.?\d*)-?(\d*\.?\d*)/); if(!m) return true;
  if(m[1]==='<'){ lo=0; hi=+m[2]-1e-4; } else if(m[1]==='>'){ lo=+m[2]+1e-4; hi=4095; } else { lo=+m[2]; hi=m[3]?+m[3]:4095; } return rate>=lo&&rate<=hi; }
const XR_OPTS=[1,1.25,1.5,2,2.5,3];
function xrBox(){ const r=xrRate(); const opts=XR_OPTS.includes(r)?XR_OPTS:[...XR_OPTS,r].sort((a,b)=>a-b);
  const tags=new Map(); for(const g of route.guides||[]){ if(g.xprate) tags.set(g.xprate,(tags.get(g.xprate)||0)+g.steps.length); for(const s of g.steps) if(s.xr) tags.set(s.xr,(tags.get(s.xr)||0)+1); }
  return `<details class="dgbox" ${xrBox.open?'open':''} data-box="xr"><summary>XP rate: ${r}×</summary><div class="row" style="margin:6px 0"><label>Your XP rate<select id="xrSel">${opts.map(o=>`<option value="${o}" ${o===r?'selected':''}>${o}×</option>`).join('')}</select></label></div>
  <p class="note" style="margin:0 0 4px">Guides and steps with an <code>#xprate</code> line only apply when your rate matches. Guides for another faction or class, Season of Discovery/Mastery, Hardcore or self-found are hidden too; Forever is treated as Classic Era. Normal Classic XP is 1×.</p>${(route.guides||[]).some(isAoE)?`<label style="margin-bottom:4px"><input type="checkbox" id="aoeOn" ${route.char.aoe?'checked':''}> Use AoE mage guides</label>`:''}<label style="margin-bottom:4px"><input type="checkbox" id="xrOther" ${xrBox.other?'checked':''}> Show guides that don't apply to this character</label>${tags.size?`<div class="dggrid">${[...tags].map(([t,n])=>`<span>${xrOK(t)?'✓':'✕'} <code>${esc(t)}</code> <span class="note">(${n})</span></span>`).join('')}</div>`:''}</details>`; }
document.addEventListener('toggle',e=>{ if(e.target.dataset?.box==='xr') xrBox.open=e.target.open; },true);
document.addEventListener('change',e=>{ if(e.target.id!=='xrSel') return; setXpRate(+e.target.value); });
function pruneXpRate(){ let n=0; for(let k=route.steps.length-1;k>=0;k--){ const w=stepActive(route.steps[k]); if(w&&/XP rate|AoE mage/.test(w)){ route.steps.splice(k,1); if(cursor>=k) cursor--; n++; } } return n; }
function setXpRate(v){ pushHistory(); route.char.xprate=v; const removed=pruneXpRate(); const added=insertNewlyEnabled(); refresh(); if(removed){ toast(`XP rate ${v}× · ${removed} steps for other XP rates removed`+(added?` · ${added} added`:'')); return; } const off=route.steps.filter(s=>stepActive(s)).length; toast(`XP rate ${v}×`+(added?` · ${added} guide steps added`:'')+(off?` · ${off} route steps skipped`:'')); }

document.addEventListener('change',e=>{ if(e.target.id==='aoeOn'){ pushHistory(); route.char.aoe=e.target.checked; pruneXpRate(); refresh(); return; } if(e.target.id==='xrOther'){ xrBox.other=e.target.checked; renderRight(); } });

/* ---------- RestedXP text formatting (|T...|t icons, |cRXP_...|r colours) ---------- */
const TALK_SVG='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3.5C2 2.7 2.7 2 3.5 2h9c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H7l-3.2 2.6c-.3.2-.8 0-.8-.4V11h0c-.6 0-1-.5-1-1.1z" fill="#c9c9c9" stroke="#3a3a3a" stroke-width="1"/><circle cx="5.5" cy="6.5" r=".9" fill="#555"/><circle cx="8" cy="6.5" r=".9" fill="#555"/><circle cx="10.5" cy="6.5" r=".9" fill="#555"/></svg>';
function rxpIcon(tex){ if(/chatbubble/i.test(tex)) return `<span class="rxi" title="Talk to">${TALK_SVG}</span>`; if(/^\d+/.test(tex)) return '<span class="rxi item" title="Item"></span>'; if(/questturnin|questactive/i.test(tex)) return '<span class="rxi q">?</span>'; if(/available/i.test(tex)) return '<span class="rxi q">!</span>'; return '<span class="rxi item"></span>'; }
function rxpHTML(str){
  let s=esc(String(str||'')).replace(/\\n|\|n/g,'<br>');
  s=s.replace(/\|T([^|]+?)(?::[^|]*)?\|t/gi,(m,t)=>rxpIcon(t));
  // colour codes can nest ("|cRXP_WARN_Kill |cRXP_ENEMY_Duskbats|r now|r"), so walk them with a stack
  let out='', depth=0; for(const part of s.split(/(\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})|\|r)/)){ let m;
    if((m=part.match(/^\|c(?:RXP_([A-Z]+)_|[0-9a-fA-F]{8})$/))){ out+=`<span class="rxc rxc-${(m[1]||'x').toLowerCase()}">`; depth++; }
    else if(part==='|r'){ if(depth){ out+='</span>'; depth--; } }
    else out+=part; }
  return out+'</span>'.repeat(depth);
}
function rxpPlain(str){ return String(str||'').replace(/\|T[^|]*\|t/gi,'').replace(/\|c(?:RXP_[A-Z]+_|[0-9a-fA-F]{8})/g,'').replace(/\|r/g,'').replace(/\\n|\|n/g,' ').replace(/\s+/g,' ').trim(); }
function notesHTML(s,skip){ const ns=(s.notes||[]).filter(n=>!skip||!skip.includes(n)); if(!ns.length) return ''; return `<span class="rxnotes">${ns.map(n=>`<span>${rxpHTML(n)}</span>`).join('')}</span>`; }


function fillNodeSel(f,sel){ const list=taxiNodes().sort((x,y)=>x.n.localeCompare(y.n)); const known=SIM.st.fps;
  f.node.innerHTML='<option value="">Choose…</option>'+list.map(n=>`<option value="${n.id}" ${n.id===sel?'selected':''}>${esc(n.n)}${known.has(n.id)?' ✓':''}</option>`).join('');
  const upd=()=>{ const fly=f.kind.value==='fly'||f.kind.value==='fp'; $('#travelNode').hidden=!fly; $('#travelText').hidden=fly; }; f.kind.onchange=upd; upd(); }

function fillFpSettings(c){ const list=taxiNodes(c.faction).sort((x,y)=>taxiShort(x.id).localeCompare(taxiShort(y.id))); const set=new Set(c.fps||[]);
  $('#fpSettings').innerHTML=list.map(n=>`<label><input type="checkbox" data-fpk="${n.id}" ${set.has(n.id)?'checked':''}> ${esc(taxiShort(n.id))}</label>`).join(''); $('#fpAll').checked=!!c.allfps; }
