import numpy as np, json, io, base64
from scipy import ndimage
from PIL import Image
from tload import load
U='/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/'
FILES={'0':U+'f31004ba-azeroth_terrain.bin.gz','1':U+'651cdfbf-kalimdor_terrain.bin.gz'}
M=json.load(open('meta_full.json')); C=33.333333; ORG=17066.667
LAVA={7,1284}; SLIME={5}
out={}
for m,f in FILES.items():
    a,I,J=load(f); off=M['off'][m]; N=1024
    h=np.full((N,N),np.nan,np.float32); lo=h.copy(); hi=h.copy(); wl=h.copy(); lt=np.zeros((N,N),np.int32)
    h[I,J]=(a['hmin']+a['hmax'])/2; lo[I,J]=a['hmin']; hi[I,J]=a['hmax']; wl[I,J]=a['ll']; lt[I,J]=a['lt']
    X=off[0]-ORG+np.arange(N)*C; Y=off[1]-ORG+np.arange(N)*C
    sea=(lt==1250)&(wl-hi>1.5)
    land=~np.isnan(h)&~sea
    colok=(X>10000) if m=='0' else ((X<=10000)&(X>-4800))
    land&=colok[None,:]
    rows=np.flatnonzero(land.any(1)); cols=np.flatnonzero(land.any(0))
    r0,r1,c0,c1=rows[0]-2,rows[-1]+3,cols[0]-2,cols[-1]+3
    hh=h[r0:r1,c0:c1].copy(); sm=sea[r0:r1,c0:c1]|np.isnan(hh)
    hh[sm]=0; hh=np.maximum(hh,-5)
    K=2; hz=ndimage.zoom(ndimage.gaussian_filter(hh,0.6),K,order=3)
    gy,gx=np.gradient(hz,C/K); ex=1.0
    slope=np.arctan(ex*np.hypot(gx,gy)); asp=np.arctan2(-gx,gy)
    az,alt=np.radians(315),np.radians(45)
    # light from NW (up-left on screen): x right = +col, y down = +row
    lx,ly=-np.cos(alt)*np.sin(np.radians(45)),-np.cos(alt)*np.cos(np.radians(45))
    nx,ny,nz=-ex*gx,-ex*gy,np.ones_like(gx); n=np.sqrt(nx*nx+ny*ny+1)
    sh=(nx*lx+ny*ly+nz*np.sin(alt))/n
    flat=np.sin(alt)
    v=np.clip(128+105*np.tanh((sh-flat)*2.4),0,255).astype(np.uint8)
    b=io.BytesIO(); Image.fromarray(v,'L').convert('RGB').save(b,'WEBP',quality=72,method=6); rel=base64.b64encode(b.getvalue()).decode()
    # inland liquids
    L=lt[r0:r1,c0:c1]; w=wl[r0:r1,c0:c1]; lo_=lo[r0:r1,c0:c1]; hi_=hi[r0:r1,c0:c1]
    frac=np.clip((w-lo_)/np.maximum(hi_-lo_,0.5),0,1); frac[(L==0)|(L==1250)]=0; frac=np.nan_to_num(frac)
    rgba=np.zeros(L.shape+(4,),np.uint8); rgba[...,:3]=(92,140,168)
    for s,col in ((LAVA,(235,95,30)),(SLIME,(110,140,60))):
        mk=np.isin(L,list(s)); rgba[mk,:3]=col
    rgba[...,3]=(np.clip(frac*1.4,0,1)*200).astype(np.uint8)
    wim=Image.fromarray(rgba,'RGBA').resize(((c1-c0)*K,(r1-r0)*K),Image.BILINEAR)
    b=io.BytesIO(); wim.save(b,'WEBP',quality=80,method=6); wat=base64.b64encode(b.getvalue()).decode()
    out[m]=dict(x=round(float(X[c0]),1),y=round(float(Y[r0]),1),w=round((c1-c0)*C,1),h=round((r1-r0)*C,1),rel=rel,wat=wat)
    Image.fromarray(v).save(f'relief_{m}.png')
    print(m,v.shape,len(rel)//1024,'KB relief',len(wat)//1024,'KB water')
json.dump(out,open('relief.json','w'))
