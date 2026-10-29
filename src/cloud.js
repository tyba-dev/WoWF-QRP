/* ---------- shared online copy (Claude-hosted page only) ----------
   Routes live in the page's database as well as in this browser, so the routes here and the ones Claude reads and edits are the same.
   routes/<id>        {id,name,rev,n,updatedAt,by,deleted?}  (n = number of parts)
   routes/<id>/parts/<k>  {s: part of the route JSON}
   guides/<gid>       {n}   guides/<gid>/parts/<k> {s: part of the guide's step text}
   Last writer wins; a route you are editing is never overwritten until your own save has gone up. */
const CLOUD={db:null,on:false,revs:{},seen:{},why:{},sent:{},ed:{},guides:new Set(),busy:false,again:false,timer:null};
const CL_PART=150000;
const clSplit=s=>{ const a=[]; for(let i=0;i<s.length;i+=CL_PART) a.push(s.slice(i,i+CL_PART)); return a.length?a:['']; };
const clRouteJSON=r=>JSON.stringify(r,(k,v)=>k==='raw'||k==='savedAt'?undefined:v);
function clBadge(t,warn){ const b=document.getElementById('cloudBadge'); if(!b) return; b.hidden=false; b.textContent=t; b.style.color=warn?'var(--danger)':''; }
/* the page database limits how fast one viewer may call it: back off and retry instead of giving up (a failed read used to look like a missing route) */
async function clRetry(f,n=5){ for(let k=0;;k++){ try{ return await f(); }catch(e){ const c=e?.code; if(k>=n||!['resource_exhausted','unavailable'].includes(c)) throw e; await new Promise(r=>setTimeout(r,(700<<k)+Math.random()*500)); } } }
/* all parts in one read; refuse a set that doesn't add up rather than load a broken route */
async function clReadParts(base,n){ const qs=await clRetry(()=>CLOUD.db.collection(base+'/parts').get()); const by={}; for(const d of qs.docs) if(d.exists) by[d.id]=String(d.data().s||'');
  const out=[]; for(let k=0;k<n;k++){ if(by[k]===undefined) throw new Error('part '+k+' of '+n+' missing'); out.push(by[k]); } return out.join(''); }
async function clEnsureGuides(r){ for(const g of r.guides||[]){ if(rawCache.has(g.id)) continue; await rawLoad([g.id]); if(rawCache.has(g.id)) continue;
    const m=await clRetry(()=>CLOUD.db.doc('guides/'+g.id).get()); if(!m.exists) continue; try{ rawPut(g.id,JSON.parse(await clReadParts('guides/'+g.id,+m.data().n||0))); }catch(e){} } }
async function clPushGuides(r){ const used=new Set((r.steps||[]).filter(s=>s.src&&!s.src.auto).map(s=>s.src.g)); for(const g of r.guides||[]){ if(!used.has(g.id)||CLOUD.guides.has(g.id)) continue;
    await rawLoad([g.id]); const raw=rawCache.get(g.id)||g.raw; if(!raw) continue; const m=await CLOUD.db.doc('guides/'+g.id).get(); if(!m.exists){ const parts=clSplit(JSON.stringify(raw)); for(let k=0;k<parts.length;k++) await CLOUD.db.doc('guides/'+g.id+'/parts/'+k).set({s:parts[k]}); await CLOUD.db.doc('guides/'+g.id).set({n:parts.length,name:g.name||''}); } CLOUD.guides.add(g.id); } }
/* a route only goes up when you changed it here (an edit, not just opening or viewing it) */
function clMarkEdit(id){ if(id) CLOUD.ed[id]=(CLOUD.ed[id]||0)+1; }
async function clPushRoute(r){ const js=clRouteJSON(r); if(CLOUD.sent[r.id]===js) return;
  /* the shared copy has this route: only send it when you edited it here, and only if nobody saved a newer one meanwhile */
  if(CLOUD.seen[r.id]!=null&&!(CLOUD.ed[r.id]>0)) return;
  if(CLOUD.seen[r.id]!=null&&CLOUD.revs[r.id]==null) return;
  { const m=await clRetry(()=>CLOUD.db.doc('routes/'+r.id).get()); if(m.exists){ const md=m.data(); CLOUD.seen[r.id]=Math.max(CLOUD.seen[r.id]||0,md.rev||0);
      if((md.rev||0)>(CLOUD.revs[r.id]||0)){ /* a newer shared copy exists (e.g. Claude's): keep your edits as a separate route, then load the newer one */
        const copy=JSON.parse(clRouteJSON(r)); copy.id=uid(); copy.name=(r.name||'Route')+' (your edits '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+')'; copy.member=false; delete copy.group; store.routes.push(copy);
        CLOUD.ed[r.id]=0; if(await clApply(md)){ store.cur=route.id; saveNow(); refresh(); toast('A newer shared copy of '+(r.name||'a route')+' was loaded; your edits are kept as “'+copy.name+'”',5000); } return; } } }
  await clPushGuides(r); const parts=clSplit(js);
  for(let k=0;k<parts.length;k++) await clRetry(()=>CLOUD.db.doc('routes/'+r.id+'/parts/'+k).set({s:parts[k]}));
  const rev=Math.max(CLOUD.revs[r.id]||0,CLOUD.seen[r.id]||0)+1; await clRetry(()=>CLOUD.db.doc('routes/'+r.id).set({id:r.id,name:r.name||'',rev,n:parts.length,updatedAt:Date.now(),by:'page'})); CLOUD.revs[r.id]=rev; CLOUD.sent[r.id]=js; CLOUD.ed[r.id]=0; }
async function clPushAll(){ if(!CLOUD.on) return; if(CLOUD.busy){ CLOUD.again=true; return; } CLOUD.busy=true; clBadge('☁ Saving…');
  try{ for(const r of store.routes) await clPushRoute(r);
    for(const id of store.deleted||[]) if(CLOUD.revs[id]&&CLOUD.sent[id]!=='deleted'){ const rev=CLOUD.revs[id]+1; await CLOUD.db.doc('routes/'+id).set({id,rev,deleted:true,updatedAt:Date.now(),by:'page'}); CLOUD.revs[id]=rev; CLOUD.sent[id]='deleted'; }
    const bad=Object.keys(CLOUD.why); if(bad.length){ clBadge('☁ Couldn\'t load '+bad.map(id=>(store.routes.find(r=>r.id===id)?.name||id)+' ('+CLOUD.why[id]+')').join(', ')+' — reload to retry',true); } else clBadge('☁ Saved online'); }
  catch(e){ clBadge('☁ Online save failed: '+(e?.code||e?.message||'error'),true); }
  finally{ CLOUD.busy=false; if(CLOUD.again){ CLOUD.again=false; clSchedule(); } } }
function clSchedule(){ if(!CLOUD.on) return; clearTimeout(CLOUD.timer); CLOUD.timer=setTimeout(clPushAll,1500); }
function clDirty(id){ const r=store.routes.find(x=>x.id===id); return !!r&&CLOUD.sent[id]!==undefined&&CLOUD.sent[id]!==clRouteJSON(r); }
async function clApply(meta){ const id=meta.id; if(id) CLOUD.seen[id]=Math.max(CLOUD.seen[id]||0,meta.rev||0); if(!id||(CLOUD.revs[id]||0)>=(meta.rev||0)) return false; if(CLOUD.ed[id]>0) return false; /* you have unsent edits: the next save sorts it out (keeps them as a copy if the shared one is newer) */
  if(meta.deleted){ CLOUD.revs[id]=meta.rev; CLOUD.sent[id]='deleted'; const i=store.routes.findIndex(r=>r.id===id); if(i>=0&&store.routes.length>1){ store.routes.splice(i,1); store.deleted=[...new Set([...(store.deleted||[]),id])]; if(route?.id===id){ route=store.routes[0]; cursor=route.steps.length-1; } return true; } return false; }
  let r=null; try{ r=JSON.parse(await clReadParts('routes/'+id,+meta.n||0)); }catch(e){ CLOUD.why[id]='read: '+(e?.code||e?.message||e); return false; } if(!r||r.id!==id){ CLOUD.why[id]='id mismatch'; return false; }
  try{ migrateRoute(r); await clEnsureGuides(r); }catch(e){ CLOUD.why[id]='load: '+(e?.message||e); return false; } delete CLOUD.why[id]; CLOUD.revs[id]=meta.rev; CLOUD.sent[id]=clRouteJSON(r); store.deleted=(store.deleted||[]).filter(x=>x!==id);
  const i=store.routes.findIndex(x=>x.id===id); if(i>=0) store.routes[i]=r; else store.routes.push(r); if(route?.id===id){ route=r; cursor=Math.min(cursor,r.steps.length-1); } return true; }
async function clRetryFailed(){ const ids=Object.keys(CLOUD.why); if(!ids.length) return; let ch=false; for(const id of ids){ try{ const d=await clRetry(()=>CLOUD.db.doc('routes/'+id).get()); if(d.exists&&await clApply(d.data())) ch=true; }catch(e){} }
  if(ch){ store.cur=route.id; saveNow(); refresh(); toast('Loaded the shared routes',2500); } clPushAll(); if(Object.keys(CLOUD.why).length) setTimeout(clRetryFailed,30000); }
async function cloudInit(){ let db=null; try{ db=typeof claude!=='undefined'&&claude.use?await claude.use('db'):null; }catch(e){ db=null; } if(!db) return; CLOUD.db=db; CLOUD.on=true; clBadge('☁ Connecting…');
  try{ const snap=await clRetry(()=>db.collection('routes').get()); let changed=false; for(const d of snap.docs) if(await clApply(d.data())) changed=true;
    if(changed){ store.cur=route.id; saveNow(); refresh(); toast('Loaded the shared routes',2500); }
    await clPushAll(); /* anything only in this browser goes up */
    if(Object.keys(CLOUD.why).length) setTimeout(clRetryFailed,8000);
    db.collection('routes').onSnapshot(async s=>{ let ch=false; for(const c of s.docChanges()){ if(c.type==='removed'||c.doc.metadata.hasPendingWrites) continue; if(await clApply(c.doc.data())) ch=true; } if(ch){ store.cur=route.id; saveNow(); refresh(); toast('Route updated from the shared copy',2500); } },
      e=>clBadge('☁ Live updates stopped: '+(e?.code||'error'),true)); }
  catch(e){ CLOUD.initErr=String(e?.stack||e); clBadge('☁ Online copy unavailable: '+(e?.code||e?.message||'error'),true); } }
