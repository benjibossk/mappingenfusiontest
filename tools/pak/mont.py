import sys,os,glob
from PIL import Image,ImageDraw
T=sys.argv[1]
for pre in sys.argv[2:]:
  fs=sorted(glob.glob(T+'/byprefab/'+pre+'*.png'))[:48]
  W=Image.new('RGB',(8*160,6*135),(60,60,60));d=ImageDraw.Draw(W)
  for i,f in enumerate(fs):
    im=Image.open(f).convert('RGBA');im.thumbnail((160,120));x,y=(i%8)*160,(i//8)*135;W.paste(im,(x,y),im)
    d.text((x+2,y+121),os.path.basename(f).split('__')[-1][:-4][:26],fill=(255,255,0))
  W.save(T+'/sheets/view_'+pre.replace('__','_')+'.png')
