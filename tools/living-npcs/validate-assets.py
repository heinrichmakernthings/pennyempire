"""Read-only pixel and manifest checks. No creative image editing."""
from pathlib import Path
from PIL import Image
import json,csv,hashlib,xml.etree.ElementTree as ET
b=Path('assets/art/phase7');m=json.loads((b/'manifest.json').read_text());results=[]
for a in m['assets']:
 im=Image.open(a['source']);assert im.mode=='RGBA';assert list(im.size)==a['sourceSize']
 x,y,w,h=a['frame'];assert x>=0 and y>=0 and x+w<=im.width and y+h<=im.height
 assert [w,h]==a['logicalSize'];crop=im.crop((x,y,x+w,y+h));alpha=crop.getchannel('A');assert alpha.getbbox();assert alpha.getextrema()[0]==0
 if a['usage']=='world':assert [w,h]==[24,40] and a['pivot']==[12,40]
 results.append({'id':a['id'],'dimensions':[w,h],'alphaBounds':alpha.getbbox()})
for clip in json.loads((b/'animations.json').read_text())['clips']:
 assert Path(clip['file']).exists()
 if clip.get('frames'):
  im=Image.open(clip['file']);assert list(im.size)==clip['sheetSize'];frames=[im.crop((x,y,x+w,y+h)).tobytes() for x,y,w,h in clip['frames']];assert frames[0]!=frames[1],clip['id']
assert not any('walk' in a['source'] for a in m['assets'])
(b/'qa/asset-validation.json').write_text(json.dumps({'passed':True,'frameCount':len(results),'assets':results},indent=2)+'\n')
with (b/'files.csv').open('w',newline='') as f:
 w=csv.writer(f,lineterminator='\n');w.writerow(['filename','width','height','bytes','sha256','usage'])
 for p in sorted(b.rglob('*')):
  if not p.is_file() or p.name=='files.csv':continue
  dimensions=Image.open(p).size if p.suffix in ['.png','.gif'] else tuple(int(ET.parse(p).getroot().attrib[k]) for k in ['width','height']) if p.suffix=='.svg' else ('','')
  usage='rejected-study' if 'walk' in p.name else 'source' if 'source' in p.parts else 'runtime' if 'runtime' in p.parts else 'metadata-or-review'
  w.writerow([str(p),*dimensions,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest(),usage])
print(f'{len(results)} frame records passed; work poses differ; walking excluded')
