from pathlib import Path
from PIL import Image
import json,csv,hashlib,xml.etree.ElementTree as ET
R=Path(__file__).resolve().parents[2];D=R/'assets/art/phase3';entries=[]
m=json.load(open(D/'manifest.json'))
with open(D/'commodity-map.csv','w')as f:
 w=csv.writer(f);w.writerow(['commodity_id','icon_asset_id','individual_file','width','height','pivot_x','pivot_y','legacy_icon','contract_status'])
 for c,a in zip(m['commodities'],m['assets']):w.writerow([c['commodityId'],c['iconAssetId'],a['individualFile'],48,48,24,48,c['legacyIconAssetId']or'',c['contractStatus']])
for p in sorted(D.rglob('*')):
 if not p.is_file()or p.name in ['files.json','files.csv']:continue
 rel=str(p.relative_to(R));size=None;alpha=None
 if p.suffix=='.png':
  im=Image.open(p);size=list(im.size);alpha=im.getchannel('A').getextrema()if im.mode=='RGBA'else None
 elif p.suffix=='.svg':
  e=ET.fromstring(p.read_text());size=[int(e.attrib['width']),int(e.attrib['height'])];alpha='transparent SVG canvas'
 usage='source artwork (do not load at runtime)'if'/source/'in rel else'commodity UI icon'if'/commodities/'in rel else'animation sheet'if'/animations/'in rel or p.stem.startswith(('state-','production-'))else'terminal icon'if p.suffix=='.svg'else'commodity atlas'if p.name=='commodity-atlas.png'else'metadata'
 entries.append({'file':rel,'dimensions':size,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'alpha':alpha,'usage':usage,'status':'finished-file; visual approval pending'})
(D/'files.json').write_text(json.dumps({'version':1,'files':entries,'missingReport':'docs/art/phase3/MISSING-ASSETS.md','note':'Inventory excludes itself to avoid recursive hashes. Phase 1/2 reused sources are inventoried in their own manifests.'},indent=2))
with open(D/'files.csv','w')as f:
 w=csv.writer(f);w.writerow(['filename','width','height','bytes','usage','status'])
 for e in entries:w.writerow([e['file'],*(e['dimensions']or['','']),e['bytes'],e['usage'],e['status']])
print(len(entries),'files inventoried;',sum(e['bytes']for e in entries),'bytes')
