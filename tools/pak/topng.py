import sys,os
from PIL import Image
src,dst=sys.argv[1],sys.argv[2];ok=0;bad=[]
for r,_,fs in os.walk(src):
  for f in fs:
    p=os.path.join(r,f);rel=os.path.relpath(p,src)[:-4]+'.png';o=os.path.join(dst,rel)
    try:
      im=Image.open(p);im.load();im=im.convert('RGBA');im.thumbnail((200,150));os.makedirs(os.path.dirname(o),exist_ok=True);im.save(o,optimize=True);ok+=1
    except Exception as e: bad.append(rel+' '+str(e))
print(ok,len(bad));print('\n'.join(bad[:5]))
