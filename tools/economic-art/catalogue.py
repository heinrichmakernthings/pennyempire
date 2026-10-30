from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]; D=R/'assets/art/phase3'
industries=['farm','mill','dairy','pizza','cafe','timber']
states={'producing':None,'missing-inputs':'missing-inputs','low-stock':'low-stock','high-demand':'high-demand','overproduction':'overproduction','loss':'loss','upgrading':'construction','closed':'closed'}
lifecycle={'startup':'startup','profitable':'profit','expansion':'expansion','major-success':'major-success','financial-difficulty':'loss','bankruptcy':'bankrupt','new-ownership':'new-ownership'}
(D/'business-states.json').write_text(json.dumps({'version':1,'industries':{i:{s:('production-'+i if s=='producing' else a)for s,a in states.items()}for i in industries},'lifecycle':lifecycle,'placement':{'space':'screen','anchor':'above building top centre','offset':[0,-8],'badgeSize':[32,32],'maxPrimaryBadges':1,'secondaryStates':'accessible inspector list'},'priority':['bankrupt','closed','upgrading','missing-inputs','loss','low-stock','overproduction','high-demand','producing']},indent=2))
# World props retain original frames, dimensions, pivots. Offsets describe a staging fixture, not authoritative world routes.
events={
'delivery.collected':('collection',[('crates',0,0),('courier-sw',38,0),('delivery-van-sw',104,12)]),
'delivery.arrived':('warehouse-arrival',[('crates',0,0),('forklift-sw',65,8)]),
'customer.queue':('high-demand',[('customer-sw',0,0),('customer-sw',28,14),('customer-sw',56,28)]),
'supplier.dispatched':('shipment',[('lorry-se',0,0),('crates',100,20)]),
'campaign.started':('campaign',[('street-ad',0,0),('owner-sw',40,0)]),
'construction.started':('construction',[('skip',0,0),('construction-worker-sw',45,0),('crane',120,0)]),
'shop.sale':('success',[('customer-se',0,0),('owner-sw',40,0)]),
'delivery.in-transit':('shipment',[('delivery-van-se',0,0)])}
(D/'market-activity.json').write_text(json.dumps({'version':1,'note':'Compositions reuse approved art; no duplicate flattened sprites. Ground positions are demonstration staging offsets; runtime route/door/loading positions must come from map metadata. Do not imply animation frames for static actors.','compositions':[{'id':id,'animation':anim,'placements':[{'assetId':asset,'offset':[x,y]}for asset,x,y in props],'trigger':'authoritative '+id,'status':'reusable-static-composition','cargoBadge':'cargo'if id=='delivery.in-transit'else None}for id,(anim,props)in events.items()]},indent=2))
print('48 industry/state bindings, seven lifecycle bindings, eight reused event compositions')
