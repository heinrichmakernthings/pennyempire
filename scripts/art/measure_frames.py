"""Measure connected opaque regions; update metadata only, never image pixels.
Requires Pillow, numpy and scipy. Main-object rectangles include 2px alpha edge margin.
"""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label,find_objects
import numpy as np,json
r=Path(__file__).resolve().parents[2];p=r/'assets/art/runtime/manifest.json';m=json.loads(p.read_text())
groups={
'props-sheet.png':['tree','lamp','planter','bench','van-sw','van-se','boat','railing','crane','parasol','crates','bollard'],
'commodities-sheet.png':['wheat','milk','flour','cheese','energy','delivery','pizza-item','timber-item'],
'actors-idle-sheet.png':['resident-sw','resident-ne','resident-nw','resident-se','worker-sw','worker-se','worker-ne','worker-nw','courier-sw','courier-se','courier-ne','courier-nw']}
for file,ids in groups.items():
 im=Image.open(r/'assets/art/source'/file);arr=np.array(im.getchannel('A'));labs,n=label(arr>128,np.ones((3,3)));sizes=np.bincount(labs.ravel());boxes=[b for i,b in enumerate(find_objects(labs),1) if sizes[i]>1000]
 assert len(boxes)==len(ids),(file,len(boxes))
 for id,b in zip(ids,boxes):
  a=next(a for a in m['assets'] if a['id']==id);x=max(0,b[1].start-2);y=max(0,b[0].start-2);w=min(im.width,b[1].stop+2)-x;h=min(im.height,b[0].stop+2)-y
  a['frame']=[x,y,w,h]
  if a['usage']=='inventory':scale=48/max(w,h)
  elif a['usage']=='actor':scale=40/h
  else:scale=a['logicalSize'][0]/w
  dw=round(w*scale);dh=round(h*scale);a['logicalSize']=[dw,dh];a['pivot']=[dw//2,dh]
  a['notes']='Measured main connected source region, 2px alpha edge margin. Runtime sampled at declared size.'
p.write_text(json.dumps(m,indent=2))
