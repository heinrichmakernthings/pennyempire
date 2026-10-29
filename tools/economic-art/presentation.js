/** Pure presentation adapter. Never advances production, transfers goods or derives economic authority. */
export const industries = ['farm','mill','dairy','pizza','cafe','timber'];
export const statePriority = ['bankrupt','closed','upgrading','missing-inputs','loss','low-stock','overproduction','high-demand','producing'];
export const stateAnimation = { bankrupt:'bankrupt', closed:'closed', upgrading:'construction', 'missing-inputs':'missing-inputs', loss:'loss', 'low-stock':'low-stock', overproduction:'overproduction', 'high-demand':'high-demand' };
export function resolveCompanyVisual(company, signals={}) {
  const candidates=[];
  if(company.status==='insolvent') candidates.push('bankrupt');
  if(company.status==='paused') candidates.push('closed');
  // Explicit engine signals only. Planned capacity, open orders and upgrade availability do not prove activity.
  for(const state of ['upgrading','missing-inputs','low-stock','overproduction','high-demand','producing']) if(signals[state]===true) candidates.push(state);
  if(company.dailyProfit?.minor<0) candidates.push('loss');
  const ordered=statePriority.filter(s=>candidates.includes(s));
  const primary=ordered[0]??null;
  const animation=primary==='producing' && industries.includes(company.industry)?`production-${company.industry}`:stateAnimation[primary]??null;
  return {primary,animation,secondary:ordered.slice(1),ariaLabel:ordered.length?ordered.join(', '):'No reported activity',profitTone:company.dailyProfit?.minor>0?'positive':company.dailyProfit?.minor<0?'negative':'neutral'};
}
export function frameAt(animation, elapsedMs, reducedMotion=false) {
  if(!Number.isFinite(elapsedMs)||elapsedMs<0) return null;
  const duration=animation.frameDurationMs*animation.frames.length;
  if(!animation.loop && elapsedMs>=duration) return null;
  return reducedMotion?animation.reducedMotionFrame:Math.floor(elapsedMs/animation.frameDurationMs)%animation.frames.length;
}
export const eventAnimations={ 'delivery.collected':'collection','delivery.arrived':'warehouse-arrival','supplier.dispatched':'shipment','customer.entered':'customer-entry','campaign.started':'campaign','construction.started':'construction','shop.sale':'success','ownership.changed':'new-ownership','company.created':'startup','company.expanded':'expansion','company.milestone':'major-success' };
/** Caller supplies synchronized server time. Seed seen IDs on initial load: historical events must not replay. */
export function createEventGate({capacity=512,maxAgeMs=5000,initialSeen=[]}={}) {
  const seen=new Map(initialSeen.map(id=>[id,true]));
  return {accept(event,nowMs){
    if(!event || typeof event.id!=='string' || !event.id || !eventAnimations[event.type] || seen.has(event.id)) return null;
    const at=Date.parse(event.at); if(!Number.isFinite(at)||!Number.isFinite(nowMs)||nowMs<at||nowMs-at>maxAgeMs) return null;
    seen.set(event.id,true); while(seen.size>Math.max(1,capacity)) seen.delete(seen.keys().next().value);
    return {animation:eventAnimations[event.type],companyId:event.companyId,startedAt:at,eventId:event.id,oneShot:true};
  }};
}
/** Render a fixed-size screen-space badge above a building; x/y are screen pixels, not world units. */
export function drawActivity(ctx,image,animation,x,y,elapsedMs,reducedMotion=false,{oneShot=false}={}) {
  const frame=frameAt(oneShot?{...animation,loop:false}:animation,elapsedMs,reducedMotion); if(frame===null)return false;
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.fillStyle='#141C20';ctx.fillRect(Math.round(x)-16,Math.round(y)-28,32,32);
  ctx.drawImage(image,...animation.frames[frame],Math.round(x)-12,Math.round(y)-24,24,24);ctx.restore();return true;
}
/** Progress is authoritative completed / total, never a locally invented production tick. */
export function progressFraction(completed,total){return Number.isFinite(completed)&&Number.isFinite(total)&&total>0?Math.max(0,Math.min(1,completed/total)):null;}
