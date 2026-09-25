import gzip, numpy as np, json, sys
U='/root/.claude/uploads/1e729794-a7aa-5488-885c-9d8e332e9fc8/'
HF={'0':U+'b1a90005-azeroth_heights.bin.gz','1':U+'c5752707-kalimdor_heights.bin.gz'}
def decode(f):
    b=gzip.open(f).read(); assert b[:4]==b'HGT2'
    dt=np.dtype([('r','<u2'),('c','<u2'),('base','<i4'),('holes','<u8'),('res','<i2',(145,))])
    a=np.frombuffer(b,dt,offset=4)
    res=a['res'].astype(np.int32); n=len(a)
    R=res[:,:81].reshape(n,9,9)
    col0=np.cumsum(R[:,:,0],axis=1)
    O=a['base'][:,None,None]+col0[:,:,None]+np.concatenate([np.zeros((n,9,1),np.int32),np.cumsum(R[:,:,1:],axis=2)],2)
    inner=(O[:,:-1,:-1]+O[:,:-1,1:]+O[:,1:,:-1]+O[:,1:,1:]+2)//4+res[:,81:].reshape(n,8,8)
    return a['r'].astype(int),a['c'].astype(int),O,inner,a['holes']
if __name__=='__main__':
    for m,f in HF.items():
        r,c,O,inner,holes=decode(f); print(m,len(r),O.min()/16,O.max()/16)
        np.savez(f'hts_{m}.npz',r=r,c=c,O=O,inner=inner,holes=holes)
