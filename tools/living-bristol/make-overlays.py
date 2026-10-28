from pathlib import Path
import json
r=Path(__file__).resolve().parents[2];out=r/'assets/art/phase2/ui'
paths={
'production':'M4 20V9l6 4V8l6 5V4h4v16ZM8 16v2m5-2v2m5-2v2',
'delivery':'M3 6h11v13H3ZM14 11h4l3 4v4h-7M6 21v-3m12 3v-3',
'customer-entry':'M13 3h7v18h-7M2 12h13m-4-4 4 4-4 4',
'construction':'M3 9h18v7H3ZM6 16v6m12-6v6M5 9l6 7m3-7 6 7',
'expansion':'M2 15h7v7H2ZM13 15h9v7h-9M16 2v9m-4-5h8',
'low-stock':'M3 9l9-5 9 5v12H3ZM12 10v5m0 3v1',
'closed':'M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
'bankrupt':'M3 3v18h18M6 6l5 5 3-2 6 8m-5 0h5v-5',
'high-demand':'M5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M1 21v-4a4 4 0 0 1 8 0v4M14 10l4-5 4 5m-4-5v14',
'success':'M4 12l5 5L20 5M4 22h16'}
animations=[]
for name,d in paths.items():
 color='#F08076'if name in ['bankrupt','closed']else'#62DBAF'if name=='success'else'#FFC45E'
 frames=''.join(f'<g transform="translate({i*24} 0)" opacity="{o}" fill="none" stroke="{color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></g>'for i,o in enumerate([.72,.86,1,.86]))
 (out/f'state-{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24">{frames}</svg>')
 animations.append({'id':name,'file':f'assets/art/phase2/ui/state-{name}.svg','sheetSize':[96,24],'frameSize':[24,24],'frames':[[i*24,0,24,24]for i in range(4)],'frameDurationMs':200,'loop':name not in ['success','delivery','customer-entry'],'reducedMotionFrame':2,'anchor':[12,24],'kind':'UI state pulse, not world character animation'})
(r/'assets/art/phase2/animations.json').write_text(json.dumps({'version':1,'animations':animations,'excluded':['courier-walk-study.png: direction and pose inconsistency']},indent=2))
print('10 exact 24x24 four-frame state strips')
