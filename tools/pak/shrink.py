# python shrink.py <src_dir> <dst_dir> : BMP/PNG du generateur -> PNG 200x150 (meme nom)
import sys,os
from PIL import Image
src,dst=sys.argv[1],sys.argv[2];ok=0;bad=0
for f in os.listdir(src):
  if not f.lower().endswith(('.bmp','.png')) or f.startswith('contact-'): continue
  o=os.path.join(dst,os.path.splitext(f)[0]+'.png')
  if os.path.exists(o) and os.path.getmtime(o)>=os.path.getmtime(os.path.join(src,f)): continue
  try:
    im=Image.open(os.path.join(src,f)).convert('RGB');im.thumbnail((200,150));im.save(o,optimize=True);ok+=1
  except Exception as e: bad+=1;print('ERR',f,e)
print('converties',ok,'erreurs',bad)
