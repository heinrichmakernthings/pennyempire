from pathlib import Path
import json
b=Path('assets/art/phase7');icons={
'owner-player':'<path d="M12 3 21 12 12 21 3 12Z"/><path d="m8 12 3 3 5-6"/>',
'owner-npc':'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
'owner-state':'<path d="m3 8 9-5 9 5H3Zm2 2v9m7-9v9m7-9v9M3 21h18"/>',
'reputation':'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
'vacant':'<path d="M4 21V4h16v17M8 8h8M8 12h8m-4 4v5"/>',
'for-sale':'<path d="M5 22V3h15M9 4v3m9-3v3M8 7h12v9H8Z"/>',
'vip-frame':'<path d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4"/><path d="m8 3 4 3 4-3"/>'}
for name,content in icons.items():(b/'ui'/f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{content}</svg>\n')
pop=[('student','maya-reed'),('office','imogen-shaw'),('hospitality','leo-marsh'),('commuter','dev-patel'),('tourist','evelyn-park'),('shopper','nora-bell'),('industrial','farah-ali'),('premium-dressed','rafael-costa')]
(b/'population.json').write_text(json.dumps({'version':1,'note':'Appearance reuse only. No named-person identity or demographic spending rule is assigned to a consumer. New appearances SW only; generic earlier actors supply four-direction idle views.','variants':[{'id':a,'appearanceSource':p+'-world-neutral','frameSize':[24,40],'direction':'sw','behaviours':['queue','wait','visit','leave'],'motion':'held pose; path translation is not authored walking'} for a,p in pop]},indent=2)+'\n')
(b/'branding.json').write_text(json.dumps({'ownerKinds':{k:{'icon':f'assets/art/phase7/ui/owner-{k}.svg','label':k} for k in ['player','npc','state']},'companyName':{'dynamic':True,'maxReferenceCharacters':26,'textureBaked':False},'accentPalette':['#FFC45E','#62DBAF','#F08076'],'prestige':{'requiresOwnedCosmeticId':True,'economicModifier':None,'reuse':['executive-car-sw','trophy-display']},'shopShutter':{'profile':'shop-module-only','source':'assets/art/phase7/runtime/closed-shutter.png','sourceSize':[64,81],'placementsTopLeft':[[32,145],[96,177]],'clipPolygon':[[35,159],[153,211],[153,262],[35,211]],'note':'Coordinates relative to native shop-module top-left. Review facade fit; do not reuse blindly on other buildings.'}},indent=2)+'\n')
(b/'ui-manifest.json').write_text(json.dumps({'version':1,'icons':[{'id':name,'source':f'assets/art/phase7/ui/{name}.svg','size':[24,24],'usage':'UI icon; ownership, reputation, vacancy or cosmetic status','colour':'currentColor; use CSS mask for external img colouring','status':'finished-vector'} for name in sorted(icons)]},indent=2)+'\n')
