/* =====================================================================
   Group routes: one route for the whole group. route.members = [{id,name,race,cls,...}], route.view = the member being viewed.
   A step is for everyone unless it has who:[member ids]. Each member is simulated on their own (steps not for them are skipped),
   and the group export tags those steps with the member's class/race, the way RestedXP's own guides do.
   ===================================================================== */
function memFields(){ return ['race','cls','rcol','level','xp','party','rep','prof','faction','spd','profs']; }
function isGrp(r){ r=r||route; return !!(r&&r.members&&r.members.length); }
function curMem(r){ r=r||route; return isGrp(r)?(r.members.find(m=>m.id===r.view)||r.members[0]):null; }
/* route.char holds the viewed member's own fields; copy them back before saving or switching */
function memSync(r){ r=r||route; const m=curMem(r); if(!m) return; for(const k of memFields()){ if(r.char[k]===undefined) delete m[k]; else m[k]=JSON.parse(JSON.stringify(r.char[k])); } }
function memApply(r,m){ for(const k of memFields()){ if(m[k]===undefined) delete r.char[k]; else r.char[k]=JSON.parse(JSON.stringify(m[k])); }
  /* guide text is parsed for one character: a shared step points at each member's own copy of the guide */ for(const s of r.steps||[]) if(s.srcs&&s.src&&s.srcs[m.id]) s.src.g=s.srcs[m.id]; }
function memFix(r){ if(!isGrp(r)) return; if(!r.members.some(m=>m.id===r.view)) r.view=r.members[0].id; memApply(r,curMem(r)); const ids=new Set(r.members.map(m=>m.id));
  for(const s of r.steps||[]) if(s.who){ s.who=s.who.filter(x=>ids.has(x)); if(!s.who.length||s.who.length===ids.size) delete s.who; } }
function viewMember(id){ if(!isGrp()||route.view===id) return; memSync(route); route.view=id; memApply(route,curMem()); FQ.key=null; save(); refresh(); }
function whoSkip(s){ if(!s.who||!isGrp()) return ''; if(s.who.includes(route.view)) return ''; return 'Not for '+curMem().name+' (only '+s.who.map(id=>route.members.find(m=>m.id===id)?.name||'?').join(', ')+')'; }
function memAbbr(m,r){ r=r||route; const c=(m.cls||m.name||'?')[0].toUpperCase(); return r.members.filter(x=>(x.cls||x.name||'?')[0].toUpperCase()===c).length>1?(m.name||'?').slice(0,2):c; }
function whoLabel(s){ if(!s.who) return {all:1,t:'all',title:'Everyone does this step (click to change)'}; const ms=route.members.filter(m=>s.who.includes(m.id));
  return {t:ms.map(m=>memAbbr(m)).join('·'),title:'Only '+ms.map(m=>m.name).join(', ')+' (click to change)',col:ms.length===1?ms[0].rcol:null}; }
/* each member as a route of their own (for the export and the summary): only their steps, their character */
function memberRoute(r,m){ const v=JSON.parse(JSON.stringify({...r,members:null,view:null})); v.id=r.id+'~'+m.id; v.name=m.name; memApply(v,m); v.steps=v.steps.filter(s=>!s.who||s.who.includes(m.id)); for(const s of v.steps) delete s.who; delete v.members; delete v.view; return v; }
function memberRoutes(r){ r=r||route; memSync(r); return r.members.map(m=>memberRoute(r,m)); }
function memSummary(){ const R0=route,C0=cursor,S0=SIM; const out=[]; memSync(R0);
  try{ for(const m of R0.members){ const v=memberRoute(R0,m); route=v; cursor=v.steps.length-1; simulate(); const res=SIM.res; const last=res[res.length-1];
      const i30=res.findIndex(x=>x&&x.after&&x.after.level>=30); out.push({m,lv:last?last.after.level+(last.after.xp/(XP_TABLE[last.after.level]||1)):1,min:Math.round((last?.tAt||0)/60),errs:res.filter(x=>x&&!x.inactive&&x.err&&x.err.length).length,n:v.steps.length,t30:i30>=0?Math.round(res[i30].tAt/60):null}); } }
  finally{ route=R0; cursor=C0; SIM=S0; } return out; }
function membersBar(){ if(!isGrp()) return ''; const m0=curMem();
  const tabs=route.members.map(m=>`<button class="btn sm ${m.id===route.view?'gold':''}" data-memv="${m.id}" title="View the route as ${esc(m.name)} (${esc(m.race+' '+m.cls)}): XP, levels and errors for them">${m.id===route.view?'👁 ':''}<span style="color:${m.id===route.view?'inherit':(m.rcol||'inherit')}">${esc(m.name)}</span></button>`).join('');
  return `<li class="mbar" style="list-style:none;position:sticky;top:0;z-index:4;background:var(--panel);display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 2px 6px;border-bottom:1px solid var(--line)"><span class="note">Viewing as:</span>${tabs}<button class="btn sm" data-memact="manage" title="Add, rename or remove group members">Members…</button>
    <label class="note" title="Steps you add from now on"><input type="checkbox" id="newWhoView" ${route.newWho==='view'?'checked':''}> new steps only for ${esc(m0.name)}</label></li>`; }
function whoChip(s,i){ if(!isGrp()) return ''; const w=whoLabel(s);
  return `<button class="ptag" data-who="${i}" title="${esc(w.title)}" style="font-size:9px;line-height:1;padding:1px 3px;border-radius:3px;margin-right:3px;white-space:nowrap;cursor:pointer;background:${w.all?'none':'rgba(224,160,40,.25)'};border:1px solid ${w.all?'currentColor':'transparent'};${w.all?'opacity:.45;':'font-weight:700;'}${w.col?'color:'+w.col:'color:inherit'}">${esc(w.t)}</button>`; }
/* who-picker: tick the members who do the step(s) */
function whoPick(idx,anchor){ document.getElementById('whoPop')?.remove(); const S=idx.map(i=>route.steps[i]).filter(Boolean); if(!S.length) return;
  const has=m=>S.every(s=>!s.who||s.who.includes(m.id)); const d=document.createElement('div'); d.id='whoPop';
  d.style.cssText='position:fixed;z-index:9999;background:var(--panel,#1d1f24);border:1px solid var(--line,#444);border-radius:8px;padding:8px 10px;box-shadow:0 4px 18px rgba(0,0,0,.5);font-size:13px;display:flex;flex-direction:column;gap:4px';
  d.innerHTML=`<b style="font-size:12px">${S.length>1?S.length+' steps: ':''}who does ${S.length>1?'these':'this'}?</b>`+route.members.map(m=>`<label><input type="checkbox" data-wm="${m.id}" ${has(m)?'checked':''}> <span style="color:${m.rcol||'inherit'}">${esc(m.name)}</span></label>`).join('')+
    `<div style="display:flex;gap:4px;margin-top:4px"><button class="btn sm gold" data-wok>OK</button><button class="btn sm" data-wall>Everyone</button><button class="btn sm" data-wx>Cancel</button></div>`;
  document.body.appendChild(d); const b=anchor?.getBoundingClientRect?.(); const x=b?Math.min(b.left,innerWidth-220):innerWidth/2-100, y=b?Math.min(b.bottom+4,innerHeight-40-32*route.members.length):innerHeight/3; d.style.left=Math.max(4,x)+'px'; d.style.top=Math.max(4,y)+'px';
  const set=ids=>{ pushHistory(); for(const s of S){ if(!ids.length||ids.length===route.members.length) delete s.who; else s.who=[...ids]; } d.remove(); save(); refresh(); };
  d.addEventListener('click',e=>{ const t=e.target; if(t.closest('[data-wx]')) d.remove(); else if(t.closest('[data-wall]')) set([]); else if(t.closest('[data-wok]')){ const ids=[...d.querySelectorAll('[data-wm]')].filter(x=>x.checked).map(x=>x.dataset.wm); if(!ids.length) return toast('Tick at least one member.',2500); set(ids); } });
  setTimeout(()=>document.addEventListener('mousedown',function f(e){ if(!d.contains(e.target)){ d.remove(); document.removeEventListener('mousedown',f); } }),0); }
function newMember(o,r){ r=r||route; const k=r.members?.length||0; return {id:uid(),name:o.name||('Member '+(k+1)),race:o.race,cls:o.cls,rcol:o.rcol||CLS_COL[o.cls]||PATH_COLS[k%PATH_COLS.length],level:o.level||1,xp:o.xp||0,party:o.party||1,faction:o.faction||(RACES[o.race]||[])[1]||r.char.faction,rep:o.rep!=null?o.rep:r.char.rep,prof:o.prof!=null?o.prof:r.char.prof}; }
/* a solo route becomes a group route: the current character is the first member */
function makeGroup(r){ r=r||route; if(isGrp(r)) return; const m=newMember({name:r.char.name||((r.char.race||'')+' '+(r.char.cls||'')).trim()||r.name,race:r.char.race,cls:r.char.cls,rcol:r.char.rcol,level:r.char.level,xp:r.char.xp,party:r.char.party},r);
  for(const k of memFields()) if(r.char[k]!==undefined) m[k]=JSON.parse(JSON.stringify(r.char[k])); r.members=[m]; r.view=m.id; }
function addMembers(list,r){ r=r||route; makeGroup(r); for(const o of list) r.members.push(newMember(o,r)); const n=r.members.length; for(const m of r.members) m.party=Math.max(+m.party||1,n); memApply(r,curMem(r)); }
async function manageMembers(){ memSync(route); const rows=route.members.map((m,k)=>`<tr><td><input data-mn="${m.id}" value="${esc(m.name)}" style="width:120px"></td><td>${esc(m.race+' '+m.cls)}</td><td>${route.steps.filter(s=>s.who&&s.who.length===1&&s.who[0]===m.id).length} own steps</td><td>${route.members.length>1?`<button class="btn sm" data-mdel="${m.id}" title="Remove from the group (their own steps are deleted)">Remove</button>`:''}</td></tr>`).join('');
  const races=Object.keys(RACES||{}), clss=[...new Set(Object.keys(CLS_COL||{}))];
  const d=document.createElement('dialog'); d.style.cssText='max-width:560px'; d.innerHTML=`<h3 style="margin-top:0">Group members</h3><table style="width:100%">${rows}</table>
    <div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>Add:</b><input id="mAddN" placeholder="Name" style="width:110px"><select id="mAddR">${races.map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="mAddC">${clss.map(x=>`<option>${esc(x)}</option>`).join('')}</select><button class="btn sm gold" id="mAddGo">Add member</button></div>
    <p class="note">A new member does every shared step. Use the tag on each step to say who does it.</p><div style="text-align:right"><button class="btn" id="mDone">Done</button></div>`;
  document.body.appendChild(d); d.showModal(); const done=()=>{ for(const i of d.querySelectorAll('[data-mn]')){ const m=route.members.find(x=>x.id===i.dataset.mn); if(m) m.name=i.value.trim()||m.name; } d.close(); d.remove(); save(); refresh(); };
  d.addEventListener('click',e=>{ const t=e.target; if(t.id==='mDone') return done(); if(t.id==='mAddGo'){ pushHistory(); addMembers([{name:d.querySelector('#mAddN').value.trim(),race:d.querySelector('#mAddR').value,cls:d.querySelector('#mAddC').value}]); d.close(); d.remove(); save(); refresh(); return manageMembers(); }
    const del=t.closest('[data-mdel]'); if(del){ const m=route.members.find(x=>x.id===del.dataset.mdel); if(!m||!confirm(`Remove ${m.name} from the group? Steps only they do are deleted.`)) return; pushHistory(); memSync(route);
      route.steps=route.steps.filter(s=>!(s.who&&s.who.length===1&&s.who[0]===m.id)); for(const s of route.steps) if(s.who) s.who=s.who.filter(x=>x!==m.id);
      route.members=route.members.filter(x=>x!==m); if(route.members.length===1){ memApply(route,route.members[0]); for(const s of route.steps) delete s.who; delete route.members; delete route.view; } else memFix(route);
      cursor=Math.min(cursor,route.steps.length-1); d.close(); d.remove(); save(); refresh(); if(isGrp()) manageMembers(); } }); }
document.addEventListener('click',e=>{ const t=e.target; const v=t.closest?.('[data-memv]'); if(v){ viewMember(v.dataset.memv); return; }
  if(t.closest?.('[data-memact=manage]')){ manageMembers(); return; }
  const w=t.closest?.('[data-who]'); if(w){ e.stopPropagation(); const i=+w.dataset.who; whoPick(selSteps.size>1&&selSteps.has(i)?[...selSteps].sort((a,b)=>a-b):[i],w); } },true);
document.addEventListener('change',e=>{ if(e.target.id==='newWhoView'){ route.newWho=e.target.checked?'view':null; save(); } });
/* group export header: lets the import rebuild the same members */
function memHeader(){ return isGrp()?'-- Forever group: '+JSON.stringify(route.members.map(m=>({name:m.name,race:m.race,cls:m.cls,level:m.level||1,xp:m.xp||0,party:m.party||1,prof:!!m.prof,rep:!!m.rep}))):''; }
function memFromHeader(text){ const m=/^-- Forever group: (\[.*\])\s*$/m.exec(text||''); if(!m) return null; try{ const a=JSON.parse(m[1]); return Array.isArray(a)&&a.length>1?a:null; }catch(e){ return null; } }
/* import a group export: one new group route with the same members; each guide step goes to the members its tags allow */
/* import a group export: one new group route with the same members. The file is read once per member (guide text is parsed for one character),
   each member's steps are the guides and steps their tags allow, in file order (the export keeps every member's order), then merged */
function importGroupRoute(gm,text){ const R0=route; const nr=newRoute({name:'Group route',char:JSON.parse(JSON.stringify(R0.char))});
  nr.members=[]; for(const o of gm) nr.members.push(newMember(o,nr)); nr.view=nr.members[0].id; memApply(nr,nr.members[0]);
  const V=nr.members.map(m=>memberRoute({...nr,steps:[]},m)); const per=[];
  try{ for(const v of V){ v.guides=[]; route=v; const r=importGuides(text,false); if(r.err) return r.err; per.push(r.added); } } finally{ route=R0; }
  nr.guides=per.flat(); for(const g of nr.guides) g.visible=false; nr.name=(per[0][0]?.name||'Group route').replace(/\s+\d+(\s+-\s+.*)?$/,'')||'Group route';
  const seqs=nr.members.map((m,k)=>{ const out=[]; per[k].forEach((g,gi)=>{ if(g.cond&&!condFor(g.cond,V[k])) return; for(let i=0;i<g.steps.length;i++){ const gs=g.steps[i], cs=impCond(g,gs); if((!cs||condFor(cs,V[k]))&&(!gs.q||memQOK(gs.q,V[k]))) out.push({k,g,gi,i}); } }); const seen=new Map(); for(const x of out){ const gs=x.g.steps[x.i]; const b=x.gi+':'+(gs.rx||0)+':'+gs.t+':'+(gs.q||'')+':'+(gs.kind||''); const n=seen.get(b)||0; seen.set(b,n+1); x.key=b+'#'+n; } return out; });
  const M=mergeSeqs(seqs,x=>x.key);
  for(const x of M){ const ks=[...x.m].sort((a,b)=>a-b); const f=x.per.get(ks[0]); const o=ghostToStep(f.g,f.i); if(ks.length<nr.members.length) o.who=ks.map(k=>nr.members[k].id);
    if(ks.length>1){ o.srcs={}; for(const k of ks) o.srcs[nr.members[k].id]=x.per.get(k).g.id; } nr.steps.push(o); }
  memFix(nr); ensureIds(nr); store.routes.push(nr); route=nr; cursor=nr.steps.length-1; history=[]; FQ.key=null; save(); refresh();
  toast(`Group route “${nr.name}” for ${nr.members.map(m=>m.name).join(', ')}: ${nr.steps.length} steps (${nr.steps.filter(s=>s.who).length} for some members only).`,6000); return ''; }
function impCond(g,gs){ if(!gs?.rx) return ''; const blk=rawCache.get(g.id)?.[gs.rx-1]; if(!blk) return ''; const out=[]; const h=(typeof blkHdrCond==='function'?blkHdrCond(blk):stepCond(blk)); if(h) out.push(h);
  if(gs.q){ const ln=blk.split('\n').find(l=>new RegExp('^\\s*\\.(accept|turnin|complete)\\s+'+gs.q+'\\b').test(l)); const m=ln&&ln.match(/<<\s*(.+)$/); if(m) out.push(m[1].trim()); }
  return out.map(c=>'('+c+')').join(' '); }
function memQOK(q,v){ const x=Q(q); if(!x) return true; const ci=charInfo(v); if(x.ra&&ci.rb&&!(x.ra&ci.rb)) return false; if(x.cl&&!(x.cl&ci.cb)) return false; if(x.z<0&&CLASS_SORT_NAME[x.z]&&CLASS_SORT_NAME[x.z]!==v.char.cls) return false; return true; }
