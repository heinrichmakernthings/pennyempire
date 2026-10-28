from pathlib import Path
from PIL import Image
import json,csv
r=Path(__file__).resolve().parents[2];d=r/'assets/art/phase2';p=d/'manifest.json';m=json.loads(p.read_text());m['animations']=json.loads((d/'animations.json').read_text())['animations'];m['files']=[]
for f in sorted(d.rglob('*')):
 if f.suffix=='.png':
  im=Image.open(f);hist=im.getchannel('A').histogram()if im.mode=='RGBA'else None
  m['files'].append({'filename':str(f.relative_to(r)),'dimensions':list(im.size),'mode':im.mode,'bytes':f.stat().st_size,'transparentPixels':hist[0]if hist else 0,'usage':'runtime atlas'if 'runtime'in f.parts else'review-only source'if 'study'in f.name else'source artwork'})
 elif f.suffix=='.svg':m['files'].append({'filename':str(f.relative_to(r)),'dimensions':[96,24],'bytes':f.stat().st_size,'usage':'four-frame state animation'})
for a in m['assets']:
 if a['status']=='runtime-exported':a['status']='finished-static-integration'
p.write_text(json.dumps(m,indent=2))
with(d/'manifest.csv').open('w')as f:
 w=csv.writer(f);w.writerow(['id','file','atlas_dimensions','frame','logical_dimensions','pivot','plot','usage','status'])
 for a in m['assets']:w.writerow([a['id'],a['source'],str(a['sourceSize']),str(a['frame']),str(a['logicalSize']),str(a['pivot']),str(a['footprint']),a['usage'],a['status']])
doc=r/'docs/art/phase2'
lines=['# Building tier inventory','', '| Industry | Tier 1 | Tier 2 | Tier 3 | Fixed frame | Reserved plot |','|---|---|---|---|---|---|']
for id in ['farm','mill','dairy','pizza','cafe','timber']:
 a=next(a for a in m['assets']if a['id']==id+'-t1');lines.append(f"| {id} | {id}-t1 (inherited) | {id}-t2 | {id}-t3 | {'×'.join(map(str,a['logicalSize']))} | {'×'.join(map(str,a['footprint']))} |")
lines+=['','Tier 2 = refurbished premises/equipment. Tier 3 = premium trim and advanced machinery. All use the existing plot; separate larger-site expansion is outstanding. See qa/building-tiers.png for exact-size comparison.']
(doc/'BUILDING-TIERS.md').write_text('\n'.join(lines)+'\n')
lines=['# Environment catalogue','','| ID | Logical frame | Placement |','|---|---|---|']
for a in m['assets']:
 if a['usage']=='environment':lines.append(f"| {a['id']} | {'×'.join(map(str,a['logicalSize']))} | {'whole building on reserved plot'if 'module'in a['id']else'decorative prop; not an automatic collision tile'} |")
lines+=['','Existing Phase 1 harbour water, road/quay masks and parks provide the ground. rail-a is a decorative straight segment only; no railway auto-connect is claimed. Billboard/sign surfaces are blank for dynamic content.']
(doc/'ENVIRONMENT-CATALOGUE.md').write_text('\n'.join(lines)+'\n')
print('Catalogued',len(m['files']),'files,',len(m['assets']),'sprite entries and',len(m['animations']),'state animations.')
