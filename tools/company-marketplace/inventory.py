from pathlib import Path
from PIL import Image
import csv,json,hashlib
R=Path(__file__).resolve().parents[2];P=R/'assets/art/phase4';m=json.load(open(P/'manifest.json'))
m['reusedBuildings']={'manifest':'assets/art/phase2/manifest.json','ids':['pizza-t1','pizza-t3','mill-t1','cafe-t1','dairy-t1','farm-t1','timber-t1'],'note':'Original logical dimensions and atlas rectangles are unchanged.'}
m['reusedCommodities']={'manifest':'assets/art/phase3/manifest.json','dimensions':[48,48],'ids':['commodity-wheat','commodity-flour','commodity-cheese','commodity-milk','commodity-pizza','commodity-timber','commodity-energy','commodity-coffee-drinks']}
m['screenFiles']=[]
for p in sorted((R/'docs/art/phase4/qa').glob('*.png')):
 im=Image.open(p);m['screenFiles'].append({'file':str(p.relative_to(R)),'dimensions':list(im.size),'usage':'browser screenshot for implementation review; never runtime artwork','viewport':'1440x1000'if p.name.startswith('desktop')else'390x844','capture':'viewport when modal open; otherwise full page'})
(P/'manifest.json').write_text(json.dumps(m,indent=2))
with open(P/'manifest.csv','w')as f:
 w=csv.writer(f,lineterminator="\n");w.writerow(['id','file','width','height','usage','status'])
 for a in m['assets']:w.writerow([a['id'],a['file'],*a['dimensions'],a['usage'],'reused approved icon'if a['reused']else'new native SVG; awaiting visual approval'])
 for a in m['screenFiles']:w.writerow([Path(a['file']).stem,a['file'],*a['dimensions'],a['usage'],'browser-verified reference'])
entries=[]
for prefix in ['assets/art/phase4','tools/company-marketplace','docs/art/phase4']:
 for p in sorted((R/prefix).rglob('*')):
  if not p.is_file()or p.name=='files.json':continue
  entries.append({'file':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(P/'files.json').write_text(json.dumps({'files':entries,'note':'Excludes this inventory to avoid recursive hash; approved reused assets are recorded in inherited manifests.'},indent=2))
print(len(entries),'files inventoried;',len(m['screenFiles']),'screen captures')
