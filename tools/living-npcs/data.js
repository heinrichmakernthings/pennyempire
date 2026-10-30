export const companies=[
{id:'co-mad-slices',name:'Mad Slices',industry:'pizza',ownerKind:'player',persona:null,salesUnits:120,previousUnits:100,revenueMinor:120000,reputationBps:7200,status:'operating',colour:'#FFC45E'},
{id:'co-clifton-slice',name:'Clifton Slice',industry:'pizza',ownerKind:'npc',persona:'leo-marsh',salesUnits:90,previousUnits:100,revenueMinor:94500,reputationBps:6900,status:'operating',colour:'#A9B5B9'},
{id:'co-new-pizza-fixture',name:'Redcliffe Oven',industry:'pizza',ownerKind:'npc',persona:'maya-reed',salesUnits:30,previousUnits:0,revenueMinor:28500,reputationBps:null,status:'operating',colour:'#A9B5B9',newEntrant:true},
{id:'co-harbour-bean',name:'Harbour Bean',industry:'cafe',ownerKind:'player',persona:null,salesUnits:70,previousUnits:60,revenueMinor:24500,reputationBps:6100,status:'operating',colour:'#FFC45E'},
{id:'co-bean-there',name:'Bean There',industry:'cafe',ownerKind:'npc',persona:'nora-bell',salesUnits:80,previousUnits:85,revenueMinor:28800,reputationBps:7400,status:'operating',colour:'#A9B5B9'},
{id:'co-bristol-energy',name:'Bristol Energy',industry:'utility',ownerKind:'state',persona:'owen-price',salesUnits:null,previousUnits:null,revenueMinor:null,reputationBps:9000,status:'operating',colour:'#62DBAF'}
];
export const workers=['farm-worker','mill-worker','dairy-worker','pizza-chef','barista','timber-worker','delivery-driver','warehouse-worker'];
export const populations=[['Students','maya-reed','Everyday jacket; study is a scenario label, not a spending rule.'],['Office workers','imogen-shaw','Tailored clothing; no automatic income or demand modifier.'],['Hospitality customers','leo-marsh','Casual visiting role; appearances are reusable.'],['Commuters','dev-patel','Waiting and street movement use route metadata.'],['Tourists','evelyn-park','Visitor scenario; purchases come from actual demand.'],['Shoppers','nora-bell','Age and clothing never determine purchasing behaviour.'],['Industrial workers','farah-ali','Uniform appearance independent of consumer budget.'],['Premium-dressed visitors','rafael-costa','Cosmetic outfit; no hidden economic advantage.']];
export const newsTemplates=[
['opening','New business opening','maya-reed','Redcliffe Oven opens its doors','A confirmed company-created event introduces a new local operator.'],
['leader','Local market leader','leo-marsh','Clifton Slice leads its reported market','Use the same market definition and reporting period as the ranking.'],
['expansion','Company expansion','farah-ali','Brunel Milling completes an upgrade','Report completion only after the upgrade job finishes.'],
['rivalry','Corporate rivalry','nora-bell','Café operators trade places in the rankings','Compare consecutive periods with identical scope and metric.'],
['shortage','Commodity shortage','kit-morgan','Suppliers report a flour shortage','Use confirmed supply, funded demand and a clearly labelled estimate.'],
['hiring','Hiring announcement','aisha-cole','A local operator expands its team','Report an actual employment-count increase, not a hiring proposal.'],
['bankruptcy','Business bankruptcy','dev-patel','A local business closes after bankruptcy','A negative trading day alone never triggers this report.'],
['acquisition','Successful acquisition','imogen-shaw','A company changes hands','Requires a confirmed ownership-transfer event; not supported by current engine.'],
['milestone','Investor milestone','evelyn-park','An investor reaches a recorded milestone','Report a confirmed achievement without promising future returns.']
].map(([id,category,persona,headline,body],i)=>({id:'news-'+id,kind:id,category,persona,headline,body,eventId:'fixture-event-'+i,tick:20-i,status:'confirmed-fixture'}));
export const snapshots={busy:{asOfTick:20,status:'operating',retailUnits:120,productionActive:true},quiet:{asOfTick:20,status:'operating',retailUnits:12,productionActive:false},lowStock:{asOfTick:20,status:'operating',retailUnits:20,productionActive:false},closed:{asOfTick:20,status:'closed',retailUnits:0,productionActive:false},bankrupt:{asOfTick:20,status:'bankrupt',retailUnits:0,productionActive:false},stale:{asOfTick:18,status:'operating',retailUnits:120,productionActive:true}};
