"""Read-only artifact checks; no image editing."""
from pathlib import Path
from PIL import Image
import json, hashlib, csv
root=Path(__file__).resolve().parents[2]
base=root/'assets/art/phase6'
m=json.loads((base/'manifest.json').read_text())
rows=[]
for a in m['assets']:
 p=root/a['source']; im=Image.open(p)
 assert im.mode=='RGBA',(p,'requires RGBA')
 assert list(im.size)==a['logicalSize'],(p,'size')
 assert a['frame']==[0,0,*a['logicalSize']]
 assert a['pivot']==[im.width//2,im.height]
 lo,hi=im.getchannel('A').getextrema();assert lo==0 and hi>0,(p,'alpha')
 assert im.getchannel('A').getbbox(),(p,'empty')
 rows.append({'id':a['id'],'dimensions':list(im.size),'alphaRange':[lo,hi],'contentRect':a['contentRect'],'pivot':a['pivot'],'reusedFrom':a['reusedFrom']})
(base/'qa/asset-validation.json').write_text(json.dumps({'checked':len(rows),'passed':True,'assets':rows},indent=2)+'\n')
with (base/'files.csv').open('w',newline='') as f:
 w=csv.writer(f,lineterminator='\n');w.writerow(['filename','width','height','bytes','sha256','usage'])
 for p in sorted(base.rglob('*')):
  if not p.is_file() or p.name=='files.csv':continue
  size=Image.open(p).size if p.suffix=='.png' else ('','')
  w.writerow([str(p.relative_to(root)),*size,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest(),'source-reference' if '/source/' in str(p) else 'runtime-sprite' if '/runtime/' in str(p) else 'qa-or-metadata'])
print(f'{len(rows)} RGBA sprites passed dimensions, frame, pivot, alpha and nonempty checks')
