import gzip,numpy as np
dt=np.dtype([('tx','u1'),('ty','u1'),('cx','u1'),('cy','u1'),('area','<u4'),('flags','<u4'),('px','<f4'),('py','<f4'),('pz','<f4'),('hmin','<f4'),('hmax','<f4'),('s50','u1'),('s35','u1'),('holes','<u2'),('lt','<u2'),('ll','<f4'),('cov','u1'),('pad','u1')])
def load(f):
    a=np.frombuffer(gzip.open(f).read(),dt)
    I=a['ty'].astype(int)*16+a['cy']; J=a['tx'].astype(int)*16+a['cx']
    return a,I,J
