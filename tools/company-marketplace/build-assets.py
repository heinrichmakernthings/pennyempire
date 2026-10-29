from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parents[2];D=R/'assets/art/phase4';out=D/'ui'
paths={'arrow':'M4 12h16m-6-6 6 6-6 6','check':'M4 12l5 5L20 5','alert':'M12 3 2 21h20ZM12 9v5m0 3v1','info':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6m0-10v1','premises':'M3 10 12 3l9 7v11H3ZM9 21v-8h6v8','contract':'M5 2h10l4 4v16H5ZM14 2v5h5M8 11h8m-8 4h8m-8 4h4','transit':'M2 5h12v14H2ZM14 10h4l4 5v4h-8M6 19v3m12-3v3','close':'M5 5l14 14M19 5 5 19','city':'M2 22V10h6v12m0-18h8v18m0-8h6v8M11 7h2m-2 4h2m-2 4h2','company':'M3 7h18v15H3ZM8 7V3h8v4M3 13h18m-9-2v4','market':'M3 21V9h18v12M2 9l3-6h14l3 6M8 21v-7h8v7','chain':'M2 9h6v6H2ZM16 9h6v6h-6M8 12h8m-3-3 3 3-3 3','growth':'M3 21V3m0 18h18M6 16l5-5 3 2 6-7m-5 0h5v5','people':'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 22v-5a6 6 0 0 1 12 0v5M17 4a4 4 0 0 1 0 8m0 3a5 5 0 0 1 5 5v2','stock':'M3 8l9-5 9 5v13H3ZM3 8l9 5 9-5m-9 5v8','settings':'M3 6h18M3 12h18M3 18h18M7 3v6m10 0v6m-8 0v6'}
# Prefer existing approved icons for equivalent symbols. Copy only new geometry; manifest aliases existing files.
aliases={'check':'assets/art/phase3/ui/order-filled.svg','alert':'assets/art/ui/warning.svg','close':'assets/art/ui/close.svg','city':'assets/art/ui/city.svg','company':'assets/art/ui/companies.svg','market':'assets/art/ui/marketplace.svg','chain':'assets/art/phase3/ui/supply-chain.svg','growth':'assets/art/phase3/ui/profit.svg','people':'assets/art/ui/staff.svg','stock':'assets/art/phase3/ui/inventory.svg','settings':'assets/art/ui/settings.svg','transit':'assets/art/phase3/ui/shipment.svg'}
assets=[]
for id,d in paths.items():
 if id in aliases:
  # The fixture consumes the manifest via generated CSS aliases; approved icons are not duplicated.
  f=aliases[id];reused=True
 else:
  f=f'assets/art/phase4/ui/{id}.svg';(R/f).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>');reused=False
 assets.append({'id':id,'file':f,'dimensions':[24,24],'usage':'terminal icon / CSS mask','reused':reused,'status':'finished; visual approval pending'})
(R/'tools/company-marketplace/icon-aliases.css').write_text('\n'.join(f'.icon[data-icon="{a["id"]}"]{{--icon:url("../../{a["file"]}")}}'for a in assets))
(D/'manifest.json').write_text(json.dumps({'version':4,'inherits':['assets/art/runtime/manifest.json','assets/art/phase2/manifest.json','assets/art/phase3/manifest.json'],'assets':assets,'commodityAliases':{'cafe-drink':'commodity-coffee-drinks'},'components':{'source':'tools/company-marketplace/components.js','stylesheet':'tools/company-marketplace/styles.css','screens':'tools/company-marketplace/app.js'},'screenExports':'docs/art/phase4/qa/','newRasterArtwork':False,'note':'Approved sprites and commodity icons reused; financial data and charts stay live HTML/SVG.'},indent=2))
print('4 new 24px icons; 12 aliases to approved icons')
