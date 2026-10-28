"""Extend the approved 24px, 1.6px stroke terminal icon system. No world art redraw."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]; D=R/'assets/art/phase3'; U=D/'ui'; U.mkdir(parents=True,exist_ok=True)
col={'muted':'#A9B5B9','amber':'#FFC45E','positive':'#62DBAF','negative':'#F08076'}
paths={
'queue':'M3 5h12m-12 7h8m-8 7h8M17 9v10l5-5Z',
'inventory':'M3 7l9-4 9 4v14H3ZM3 7l9 4 9-4M12 11v10',
'supplier':'M2 7h8v10H2ZM14 3h8v10h-8ZM10 12h4m-2-2 2 2-2 2M7 20h12v-4',
'missing-inputs':'M3 3h7v7H3ZM14 14h7v7h-7M10 6h8v5M15 8l6 6m0-6-6 6',
'overproduction':'M3 15h7v7H3ZM14 15h7v7h-7M8 3h8v8H8ZM3 11V4m-2 2 2-2 2 2',
'loss':'M20 12a8 8 0 1 1-8-8M8 12h8M17 3h6',
'profit':'M3 3v18h18M6 16l5-5 3 2 6-7m-5 0h5v5',
'order-buy':'M3 3h18v18H3ZM12 6v12m-4-4 4 4 4-4',
'order-sell':'M3 3h18v18H3ZM12 18V6m-4 4 4-4 4 4',
'order-open':'M4 4h16v16H4ZM8 8h8m-8 4h8m-8 4h4',
'order-partial':'M4 4h16v16H4ZM4 12h8v8m0-16v8h8',
'order-filled':'M3 12l6 6L21 4',
'order-cancelled':'M5 5l14 14M19 5 5 19',
'ranking':'M2 13h6v9H2ZM9 3h6v19H9ZM16 9h6v13h-6',
'supply-chain':'M1 9h6v6H1ZM17 9h6v6h-6M7 12h10m-4-4 4 4-4 4',
'price-up':'M12 21V3m-7 7 7-7 7 7',
'price-down':'M12 3v18m-7-7 7 7 7-7',
'price-flat':'M3 12h18m-4-4 4 4-4 4',
'notification-economic':'M5 17V9a7 7 0 0 1 14 0v8l2 2H3ZM10 22h4M12 6v5m0 3v1',
'startup':'M12 22V10M12 15C2 15 3 6 3 6s9-1 9 9ZM12 11c0-9 9-9 9-9s1 9-9 9',
'new-ownership':'M8 13a5 5 0 1 1 4-8M8 13 2 19v3h4v-3h3l5-5M15 3h7v7m-7-7 7 7',
'major-success':'M6 3h12v5a6 6 0 0 1-12 0ZM6 5H2v3a5 5 0 0 0 5 5M18 5h4v3a5 5 0 0 1-5 5M12 14v6m-5 2h10',
'collection':'M2 12h13m-4-4 4 4-4 4M16 3h6v18h-6',
'warehouse-arrival':'M2 10l10-7 10 7v12H2ZM8 22v-9h8v9M12 11v8m-3-3 3 3 3-3',
'shipment':'M2 5h12v14H2ZM14 10h4l4 5v4h-8M6 19v3m12-3v3M5 9h6m-3-2 3 2-3 2',
'campaign':'M3 8h5l12-5v18L8 16H3ZM7 16l2 6h4l-2-5M20 9h3v6h-3',
'cargo':'M3 9l9-6 9 6-9 6ZM3 9v9l9 5 9-5V9M12 15v8',
}
icons=[]
for id,d in paths.items():
 f=f'assets/art/phase3/ui/{id}.svg'
 (R/f).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>')
 icons.append({'id':id,'file':f,'size':[24,24],'usage':'terminal-icon','colour':'currentColor','label':id.replace('-',' ')})
base=json.load(open(R/'assets/art/phase2/animations.json'))['animations']; animations=[]
for a in base: animations.append({**a,'reused':True})
for id,tone in [('missing-inputs','negative'),('overproduction','amber'),('loss','negative'),('profit','positive'),('startup','amber'),('new-ownership','amber'),('major-success','positive'),('collection','amber'),('warehouse-arrival','amber'),('shipment','amber'),('campaign','amber')]:
 f=f'assets/art/phase3/ui/state-{id}.svg'
 body=''.join(f'<g transform="translate({i*24} 0)" opacity="{o}"><path d="{paths[id]}"/></g>'for i,o in enumerate([.72,.86,1,.86]))
 (R/f).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24" fill="none" stroke="{col[tone]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
 animations.append({'id':id,'file':f,'sheetSize':[96,24],'frameSize':[24,24],'frames':[[i*24,0,24,24]for i in range(4)],'frameDurationMs':200,'loop':id in ['missing-inputs','overproduction','loss','profit'],'reducedMotionFrame':2,'anchor':[12,24],'kind':'UI state pulse','reused':False})
# Industry-specific 4-frame motion glyphs. Existing 24x24 overlay convention, no new sprite scale.
def motif(ind,i):
 if ind=='farm':
  y=[18,14,10,7][i]
  return f'<path d="M3 22h18M12 22V{y}m0 7-4-3m4 0 4-3"/><path d="M8 {y+1}l4 4 4-4"/>'
 if ind=='mill':
  return f'<path d="M4 22h16M6 18h12"/><g transform="rotate({i*45} 12 10)"><circle cx="12" cy="10" r="6"/><path d="M12 2v16M4 10h16"/></g>'
 if ind=='dairy':
  return f'<path d="M3 5h10v16H3ZM5 2h6M13 9h7v12M3 15h10"/><path d="M17 {12+i*2}h5"/>'
 if ind=='pizza':
  return f'<path d="M3 22V12a9 9 0 0 1 18 0v10ZM6 20v-7h12v7Z"/><path d="M9 18l2-{[4,6,5,3][i]} 2 3 2-2 1 3"/>'
 if ind=='cafe':
  x=[3,5,7,5][i]
  return f'<path d="M2 22h20M{x} 11h10v6a3 3 0 0 1-3 3H{x+3}a3 3 0 0 1-3-3ZM{x+10} 12h3v4h-3M{x+4} 8V{[4,3,2,3][i]}"/>'
 return f'<path d="M2 15h20v6H2ZM5 15v6m4-6v6m4-6v6m4-6v6"/><path d="M{2+i} 9h16l-2 3-2-3-2 3-2-3-2 3-2-3"/>'
for ind in ['farm','mill','dairy','pizza','cafe','timber']:
 id='production-'+ind;f=f'assets/art/phase3/ui/{id}.svg'
 body=''.join(f'<g transform="translate({i*24} 0)">{motif(ind,i)}</g>'for i in range(4))
 (R/f).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24" fill="none" stroke="{col["amber"]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
 animations.append({'id':id,'file':f,'sheetSize':[96,24],'frameSize':[24,24],'frames':[[i*24,0,24,24]for i in range(4)],'frameDurationMs':200,'loop':True,'reducedMotionFrame':2,'anchor':[12,24],'kind':'industry-specific production motion glyph; not facade machinery','industry':ind,'reused':False})
(D/'animations.json').write_text(json.dumps({'version':1,'animations':animations},indent=2))
(D/'terminal-icons.json').write_text(json.dumps({'version':1,'icons':icons},indent=2))
print(len(icons),'terminal icons;',len(animations),'animations (10 reused)')
