/** Presentation only. Never mutates simulation inventory, cash or ownership. */
export function activityPlan(snapshot,nowTick){
 const stale=nowTick-snapshot.asOfTick>1;
 if(stale||snapshot.status!=='operating')return{customerSprites:0,workerActive:false,deliveryAllowed:false,reason:stale?'stale':'not-operating'};
 return{customerSprites:Math.min(6,Math.floor(Math.max(0,snapshot.retailUnits)/20)),workerActive:snapshot.productionActive===true,deliveryAllowed:true,reason:'representative-throughput'};
}
export function rankCompanies(rows){
 const complete=rows.every(r=>r.salesUnits!==null&&r.salesUnits!==undefined);
 const total=rows.reduce((n,r)=>n+(r.salesUnits??0),0);
 return [...rows].sort((a,b)=>(b.salesUnits??-1)-(a.salesUnits??-1)||a.id.localeCompare(b.id)).map((r,i)=>({...r,rank:complete?i+1:null,shareBps:complete&&total?Math.floor(r.salesUnits*10000/total):null}));
}
export class TransferReplay{
 constructor(){this.seen=new Set();this.active=null;}
 accept(event,now){if(!event||event.status!=='settled'||this.seen.has(event.id))return false;this.seen.add(event.id);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);this.active={event,start:now};return true;}
 sample(now,reduced=false){if(!this.active)return null;const t=now-this.active.start;if(t>=4800){this.active=null;return null;}const stage=t<1400?'arriving':t<2600?'unloading':t<3400?'complete':'departing';return{stage,progress:reduced?1:Math.min(1,t/4800),eventId:this.active.event.id};}
}
export function frameAt(elapsed,durations,loop=true){const total=durations.reduce((a,b)=>a+b,0);let t=loop?elapsed%total:Math.min(elapsed,total-1);for(let i=0;i<durations.length;i++){if(t<durations[i])return i;t-=durations[i];}return durations.length-1;}
