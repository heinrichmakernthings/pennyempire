// All economic values are illustrative view data, never engine rules.
export const listings=[
{id:'mill',companyId:'co-brunel-mill',name:'Brunel Milling',ticker:'BRML',industry:'Flour mill',price:1000,changeBps:240,shares:100000,profit:420000, revenue:1800000,owned:1200,reserved:100,tradable:true,assetId:'mill-t3',history:[880,900,895,null,950,975,1000]},
{id:'cafe',companyId:'co-harbour-bean',name:'Harbour Bean',ticker:'HBRB',industry:'Café group',price:300,changeBps:-180,shares:50000,profit:120000,revenue:640000,owned:200,reserved:0,tradable:true,assetId:'cafe-t3',history:[310,320,318,309,null,305,300]},
{id:'timber',companyId:'co-avon-timber',name:'Avon Timber',ticker:'AVON',industry:'Timber yard',price:520,changeBps:0,shares:80000,profit:-35000,revenue:830000,owned:0,reserved:0,tradable:true,assetId:'timber-t3',history:[540,530,525,520,520,520,520]},
{id:'energy',companyId:'co-bristol-energy',name:'Penny Energy',ticker:null,industry:'State utility',price:null,changeBps:null,shares:null,profit:null,revenue:null,owned:0,reserved:0,tradable:false,assetId:'penny-energy',history:[]}
];
export const services=[
{id:'penny-energy',name:'Penny Energy',role:'Electricity',description:'Power for production and daily operations.',settlement:'Energy payments go to the state provider. They are transfers, not coin sinks.',engineId:'co-bristol-energy'},
{id:'penny-ads',name:'Penny Ads',role:'Advertising',description:'Campaigns, signage and local visibility.',settlement:'Marketing expenditure transfers to the state media account.',engineId:'co-bristol-media'},
{id:'penny-logistics',name:'Penny Logistics',role:'Distribution',description:'Warehouse and transport services.',settlement:'Future logistics capability. Current commodity trades settle goods atomically.',engineId:null},
{id:'central-property',name:'Central Property',role:'Premises & rent',description:'Commercial property and operating premises.',settlement:'Rent transfers to the state property account.',engineId:'co-bristol-estates'},
{id:'national-bank',name:'National Bank',role:'Company banking',description:'A recognisable civic banking institution.',settlement:'Dedicated banking products are not implemented. Do not imply loans or interest.',engineId:null},
{id:'penny-exchange',name:'Penny Exchange',role:'Market infrastructure',description:'A civic home for fictional markets.',settlement:'Current commodity exchange fees are destroyed as a sink; they are not revenue paid to this building.',engineId:null}
];
export const prestige=[
{id:'executive-car-sw',name:'Executive saloon',category:'Vehicles',rarity:'Refined',price:350000,score:30,owned:true,placement:'roadside',description:'Quiet confidence, polished chrome and a comfortable arrival.'},
{id:'sports-car-sw',name:'Racing-green coupé',category:'Vehicles',rarity:'Rare',price:650000,score:60,owned:false,placement:'roadside',description:'A compact two-seat sports car for the owner who enjoys the journey.'},
{id:'supercar-sw',name:'Amber supercar',category:'Vehicles',rarity:'Exceptional',price:1800000,score:160,owned:false,placement:'roadside',description:'A low, unmistakable silhouette outside your flagship business.'},
{id:'luxury-suv-sw',name:'Ivory luxury SUV',category:'Vehicles',rarity:'Rare',price:850000,score:80,owned:false,placement:'roadside',description:'An imposing arrival in understated ivory.'},
{id:'luxury-townhouse',name:'Clifton townhouse',category:'Properties',rarity:'Rare',price:2200000,score:180,owned:false,placement:'plot',description:'Honey stone, iron railings and a private front door.'},
{id:'penthouse',name:'Harbourside penthouse',category:'Properties',rarity:'Exceptional',price:3600000,score:260,owned:false,placement:'plot',description:'A private roof terrace above an elegant Bristol apartment building.'},
{id:'mansion',name:'City mansion',category:'Properties',rarity:'Exceptional',price:6400000,score:420,owned:false,placement:'plot',description:'A grand urban residence with a compact formal forecourt.'},
{id:'corporate-hq',name:'Flagship headquarters',category:'Properties',rarity:'Exceptional',price:9500000,score:600,owned:false,placement:'plot',description:'A prestigious address with a dynamic company nameplate.'},
{id:'luxury-boat-sw',name:'Teak-deck motor launch',category:'Waterfront',rarity:'Rare',price:1300000,score:100,owned:false,placement:'water',description:'A private launch for the harbourside. Requires an eligible berth.'},
{id:'trophy-display',name:'Founder’s trophy',category:'Collectibles',rarity:'Refined',price:80000,score:15,owned:true,placement:'forecourt',description:'A rare trophy display for your first business milestone.'},
{id:'exclusive-sculpture',name:'Bronze spiral',category:'Collectibles',rarity:'Rare',price:240000,score:25,owned:false,placement:'forecourt',description:'A sculptural centrepiece for an ambitious company forecourt.'},
{id:'prestige-monument',name:'Laurel monument',category:'Collectibles',rarity:'Exceptional',price:480000,score:50,owned:false,placement:'forecourt',description:'Celebrate a company’s achievements with an editable owner plaque.'},
{id:'skyscraper',name:'City skyline tower',category:'Properties',rarity:'Landmark',price:null,score:null,owned:false,placement:'plot',description:'Awaiting an approved tall-building frame and footprint.',unavailable:true},
{id:'superyacht',name:'Harbour superyacht',category:'Waterfront',rarity:'Landmark',price:null,score:null,owned:false,placement:'water',description:'Awaiting an approved large-watercraft frame and berth footprint.',unavailable:true}
];
export const news=[
{id:'ipo',companyId:'co-brunel-mill',kind:'ipo',title:'A new listing opens in Bristol',company:'Brunel Milling',body:'The listing has been announced. Read the issuer’s financial report and offering terms before placing an order.',day:23,severity:'info',action:'View issuer',route:'stocks'},
{id:'dividend',companyId:'co-harbour-bean',kind:'dividend',title:'Dividend declared',company:'Harbour Bean',body:'Record date: Day 24. Payment date: Day 26. Illustrative dividend: 0.04 EC per eligible share. Entitlement is determined by the server.',day:23,severity:'positive',action:'View holdings',route:'portfolio'},
{id:'crash',companyId:null,kind:'market-crash',title:'Local market under pressure',company:'Bristol market',body:'Selected prices have fallen. This event does not promise a rebound. Review actual holdings and current market status.',day:22,severity:'warning',action:'Open market',route:'stocks'},
{id:'acquisition',companyId:'co-avon-timber',kind:'acquisition',title:'Acquisition announced',company:'Avon Timber',body:'An acquisition notice has been issued. Consideration, affected holdings and effective dates must come from confirmed corporate-action data.',day:22,severity:'info',action:'Read report',route:'stocks'},
{id:'bankruptcy',companyId:null,kind:'bankruptcy',title:'Company enters administration',company:'Example company',body:'Trading and payouts follow the confirmed insolvency process. Do not infer recoverable value or cancel holdings locally.',day:21,severity:'negative',action:'View holdings',route:'portfolio'},
{id:'state',companyId:'co-bristol-energy',kind:'state-announcement',title:'State service update',company:'Penny Energy',body:'A service-policy announcement is available. Apply any tariffs only from its published effective date and server state.',day:21,severity:'info',action:'State services',route:'state'},
{id:'shortage',companyId:null,kind:'commodity-shortage',title:'Cheese supply tightens',company:'Bristol suppliers',body:'Local demand exceeds available supply in the reported period. Review input coverage before increasing production.',day:20,severity:'warning',action:'View issuer',route:'stocks'},
{id:'milestone',companyId:'co-mad-slices',kind:'milestone',title:'A local business reaches a milestone',company:'Mad Slices',body:'A confirmed business milestone can award a collection item. Any award must be recorded in authoritative ownership data.',day:20,severity:'positive',action:'Open collection',route:'prestige'},
{id:'international',companyId:null,kind:'international-expansion',title:'Expansion beyond Bristol',company:'Example holding company',body:'A new city entry has been announced. Eligibility, fees and market access remain explicit server capabilities.',day:19,severity:'info',action:'Empire overview',route:'portfolio'}
];
