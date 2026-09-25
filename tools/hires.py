import numpy as np, json, io, base64, os
from scipy import ndimage
from PIL import Image
from tload import load
from hdecode import HF
U='/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/'
TF={'0':U+'f31004ba-azeroth_terrain.bin.gz','1':U+'651cdfbf-kalimdor_terrain.bin.gz'}
M=json.load(open('meta_full.json')); REL=json.load(open('relief.json'))
C=33.333333; ORG=17066.667; P=16; TILE=1024; OV=8   # 16 px/chunk (2.08 yd), overview = /8
LAVA={7,1284}; SLIME={5}
os.makedirs('tiles',exist_ok=True)
out={}
for m in ('0','1'):
    off=M['off'][m]; R=REL[m]
    c0=round((R['x']-off[0]+ORG)/C); r0=round((R['y']-off[1]+ORG)/C)
    nc=round(R['w']/C); nr=round(R['h']/C)
    d=np.load(f'hts_{m}.npz'); r=d['r']-r0; c=d['c']-c0; ok=(r>=0)&(r<nr)&(c>=0)&(c<nc)
    r,c=r[ok],c[ok]; O=d['O'][ok].astype(np.float32)/16; IN=d['inner'][ok].astype(np.float32)/16
    Hh=np.full((nr*P,nc*P),np.nan,np.float32)
    blk=np.empty((len(r),16,16),np.float32)
    blk[:,0::2,0::2]=O[:,:8,:8]; blk[:,1::2,1::2]=IN
    blk[:,0::2,1::2]=(O[:,:8,:8]+O[:,:8,1:])/2; blk[:,1::2,0::2]=(O[:,:8,:8]+O[:,1:,:8])/2
    for k in range(len(r)): Hh[r[k]*P:(r[k]+1)*P, c[k]*P:(c[k]+1)*P]=blk[k]
    del blk
    # liquids per chunk
    a,I,J=load(TF[m]); I=I-r0; J=J-c0; ok=(I>=0)&(I<nr)&(J>=0)&(J<nc)
    lt=np.zeros((nr,nc),np.int32); ll=np.zeros((nr,nc),np.float32)
    lt[I[ok],J[ok]]=a['lt'][ok]; ll[I[ok],J[ok]]=a['ll'][ok]
    LT=np.repeat(np.repeat(lt,P,0),P,1); LL=np.repeat(np.repeat(ll,P,0),P,1)
    void=np.isnan(Hh); Hh[void]=-50
    # continent column limit (EK/Kalimdor split at plane X 10000)
    Xc=R['x']+(np.arange(nc*P)+.5)*C/P
    colmask=(Xc>10000) if m=='0' else (Xc<=10000)
    water=((LT>0)&(Hh<LL))
    ocean=(void|((LT==1250)&(Hh<LL)))|~colmask[None,:]
    ocean=ocean|((Hh<-2)&(LT==0)&False)
    # hillshade
    hs=np.where(ocean,np.where(LT==1250,LL,0),Hh)
    hs=ndimage.gaussian_filter(hs,0.7)
    gy,gx=np.gradient(hs,C/P)
    alt=np.radians(45); lx=ly=-np.cos(alt)*np.sqrt(.5)
    n=np.sqrt(gx*gx+gy*gy+1); sh=(-gx*lx-gy*ly+np.sin(alt))/n
    del gx,gy,n
    v=np.clip(128+105*np.tanh((sh-np.sin(alt))*2.4),0,255).astype(np.uint8); del sh
    v[ocean]=128
    # water rgba
    dep=np.clip(LL-Hh,0,None)
    rgba=np.zeros(v.shape+(4,),np.uint8)
    inl=water&~ocean
    rgba[inl,0]=92; rgba[inl,1]=140; rgba[inl,2]=168; rgba[inl,3]=np.clip(60+dep[inl]*30,0,215).astype(np.uint8)
    for s,col in ((LAVA,(235,95,30)),(SLIME,(110,140,60))):
        mk=inl&np.isin(LT,list(s)); rgba[mk,:3]=col; rgba[mk,3]=225
    rv=np.dstack([v,v,v,np.where(ocean,0,255).astype(np.uint8)])
    del dep,LT,LL,Hh,water,inl
    # tiles
    ny=-(-v.shape[0]//TILE); nx=-(-v.shape[1]//TILE); rl=[]; wl=[]; tot=0
    for ty in range(ny):
        for tx in range(nx):
            sl=(slice(ty*TILE,(ty+1)*TILE),slice(tx*TILE,(tx+1)*TILE))
            oc=ocean[sl]
            if oc.all(): continue
            tv=rv[sl]; tw=rgba[sl]
            fn=f'tiles/t{m}_{ty}_{tx}_r.webp'; Image.fromarray(tv,'RGBA').save(fn,'WEBP',quality=70,alpha_quality=60,method=6); rl.append(f'{ty}_{tx}'); tot+=os.path.getsize(fn)
            if tw[...,3].any():
                fn=f'tiles/t{m}_{ty}_{tx}_w.webp'; Image.fromarray(tw,'RGBA').save(fn,'WEBP',quality=75,method=6); wl.append(f'{ty}_{tx}'); tot+=os.path.getsize(fn)
    # overview
    def ds(x): return Image.fromarray(x).resize((x.shape[1]//OV,x.shape[0]//OV),Image.BOX)
    b=io.BytesIO(); ds(rv).save(b,'WEBP',quality=72,method=6); rel=base64.b64encode(b.getvalue()).decode()
    b=io.BytesIO(); ds(rgba).save(b,'WEBP',quality=78,method=6); wat=base64.b64encode(b.getvalue()).decode()
    out[m]=dict(x=R['x'],y=R['y'],w=R['w'],h=R['h'],rel=rel,wat=wat,tile=dict(px=TILE,yd=TILE*C/P,nx=nx,ny=ny,r=rl,w=wl))
    print(m,v.shape,'tiles',len(rl),len(wl),'MB',round(tot/1e6,1),'overview KB',len(rel)//1024,len(wat)//1024)
    del v,rv,rgba,ocean
json.dump(out,open('relief.json.new','w'))
