from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];base=root/'assets/art/phase6/ui';base.mkdir(parents=True,exist_ok=True)
paths={
'market-crash':'<path d="M3 3v18h18M5 7l5 4 4-2 6 8m-6 0h6v-6"/>',
'energy-crisis':'<path d="M13 2 5 13h6l-1 9 9-12h-6l1-8M3 3l18 18"/>',
'inflation':'<path d="M3 10V4h6l11 11-6 6L3 10Z"/><circle cx="7" cy="7" r="1"/><path d="M17 8V2m-3 3 3-3 3 3"/>',
'spending':'<path d="M4 8h16l-1 13H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2m-4 4v6m-3-3h6"/>',
'construction':'<path d="M3 21h18M6 21V3h12v18M6 7h12M6 11h12M6 15h12M9 3v18m6-18v18"/>',
'route-broken':'<path d="M2 6h5v5H2Zm15 7h5v5h-5M7 8h4l2 3m-2 4 2 1h4M10 20 16 4"/>',
'bankruptcy':'<path d="M3 21V8l9-5 9 5v13M6 21V10h12v11M9 13l6 6m0-6-6 6"/>',
'stimulus':'<path d="m3 8 9-5 9 5H3Zm2 4v6m7-6v6m7-6v6M3 21h18"/><path d="M9 15h6m-3-3v6"/>',
'customs':'<path d="M5 3h11l3 3v15H5V3Zm11 0v4h3M8 13l3 3 5-5M8 7h4"/>',
'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
'vote':'<path d="M4 13h16v8H4v-8Zm4-8 5-3 5 7-5 3-5-7ZM8 16h8"/>',
'globe':'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
'penny-post':'<path d="M3 4h15v17H5a2 2 0 0 1-2-2V4Zm15 5h3v10a2 2 0 0 1-2 2M6 7h9M6 10h4v4H6v-4Zm7 0h2m-2 4h2M6 17h9"/>'}
for id,body in paths.items():
 color='#FFC45E' if id=='penny-post' else 'currentColor'
 (base/(id+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{body}</svg>\n')
old={'boom':'profit','recession':'loss','shortage':'missing-inputs','acquisition':'new-ownership'}
new={'crash':'market-crash','energy':'energy-crisis','inflation':'inflation','spending':'spending','construction':'construction','disruption':'route-broken','bankruptcy':'bankruptcy','stimulus':'stimulus'}
(root/'assets/art/phase6/event-icons.json').write_text(json.dumps({'frameSize':[24,24],'strokeWidth':1.6,'colour':'currentColor; semantic tone supplied by UI','events':{**{k:'assets/art/phase3/ui/'+v+'.svg' for k,v in old.items()},**{k:'assets/art/phase6/ui/'+v+'.svg' for k,v in new.items()}},'shipments':{'pending':'assets/art/phase6/ui/clock.svg','in-transit':'assets/art/phase3/ui/shipment.svg','delivered':'assets/art/phase3/ui/order-filled.svg','delayed':'assets/art/phase6/ui/clock.svg','customs-hold':'assets/art/phase6/ui/customs.svg','disrupted':'assets/art/phase6/ui/route-broken.svg'}},indent=2)+'\n')
print(len(paths),'new native SVG files; 12 event identities and six shipment-state mappings')
