"""Measure source alpha components; writes metadata, never changes source pixels."""
from pathlib import Path
from PIL import Image
from scipy.ndimage import label,find_objects
import numpy as np,json
root=Path(__file__).resolve().parents[2];base=json.loads((root/'assets/art/runtime/manifest.json').read_text());byid={a['id']:a for a in base['assets']}
specs=[
('retail-upgrades',2,['pizza-t2','pizza-t3','cafe-t2','cafe-t3'],['pizza','pizza','cafe','cafe'],'building'),
('processing-upgrades',2,['mill-t2','mill-t3','dairy-t2','dairy-t3'],['mill','mill','dairy','dairy'],'building'),
('resource-upgrades',2,['farm-t2','farm-t3','timber-t2','timber-t3'],['farm','farm','timber','timber'],'building'),
('state-infrastructure',3,['penny-energy','penny-ads','penny-logistics','central-property','national-bank','penny-exchange'],['utility','warehouse','warehouse','cafe','cafe','warehouse'],'state'),
('environment',4,['shop-module','warehouse-module','terrace-module','park-tree','street-ad','roof-billboard','digital-sign','park-gate','rail-a','rail-b','bus-shelter','skip'],['pizza','warehouse','terraces','tree','lamp','railing','lamp','railing','tile','tile','parasol','crates'],'environment'),
('vehicles',4,[f'{v}-{d}'for v in ['delivery-van','lorry','car']for d in ['sw','se','ne','nw']]+['bicycle-sw','bicycle-se','forklift-sw','service-van-se'],['van-sw']*4+['boat']*4+['van-sw']*4+['bench','bench','van-sw','van-sw'],'vehicle'),
('additional-actors',4,[f'{v}-{d}'for v in ['owner','office-worker','customer','construction-worker']for d in ['sw','se','ne','nw']],['actor']*16,'actor')]
out=[]
for sheet,cols,names,refs,kind in specs:
 p=root/f'assets/art/phase2/source/{sheet}.png';im=Image.open(p);a=np.array(im.getchannel('A'));labs,n=label(a>128,np.ones((3,3)));sz=np.bincount(labs.ravel());boxes=[b for i,b in enumerate(find_objects(labs),1)if sz[i]>1500];assert len(boxes)==len(names),(sheet,len(boxes))
 boxes.sort(key=lambda b:(b[0].start+b[0].stop)/2)
 ordered=[]
 for i in range(0,len(boxes),cols):ordered+=sorted(boxes[i:i+cols],key=lambda b:b[1].start)
 for name,ref,b in zip(names,refs,ordered):
  if name=='rail-b':continue
  frame=([128,64]if ref=='tile'else[24,40]if ref=='actor'else byid[ref]['logicalSize'])
  x=max(0,b[1].start-2);y=max(0,b[0].start-2);w=min(im.width,b[1].stop+2)-x;h=min(im.height,b[0].stop+2)-y
  out.append({'id':name,'source':str(p.relative_to(root)),'sourceSize':list(im.size),'crop':[x,y,w,h],'logicalSize':frame,'pivot':[frame[0]//2,frame[1]],'footprint':byid[ref]['footprint']if ref in byid else[1,1],'usage':kind,'dimensionReference':ref,'tier':int(name[-1])if name.endswith(('-t2','-t3')) else None,'status':'pending-scale-review'})
(root/'assets/art/phase2/measurements.json').write_text(json.dumps(out,indent=2));print('Measured',len(out),'new frames')
