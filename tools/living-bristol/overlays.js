// Dynamic UI overlays. No permanent player names or ownership colours in textures.
export const companyColours=['#FFC45E','#62DBAF','#70AFC4','#D89C73','#C6B7DB','#E7D9B6'];
export function drawCompanyLabel(ctx,{name,tier=1,x,y,colour=companyColours[0],selected=false}){
 const text=String(name).replace(/[\x00-\x1f]/g,'').slice(0,32);ctx.save();ctx.font='14px system-ui';const width=Math.min(240,Math.max(90,ctx.measureText(text).width+36));ctx.fillStyle='#141C20';ctx.fillRect(x-width/2,y-24,width,24);ctx.fillStyle=colour;ctx.fillRect(x-width/2,y-24,4,24);ctx.fillStyle='#F0E8D7';ctx.textAlign='center';ctx.fillText(text,x-7,y-7,width-36);ctx.fillStyle=colour;ctx.fillText(String(Math.max(1,Math.min(3,tier))),x+width/2-12,y-7);if(selected){ctx.strokeStyle='#FFC45E';ctx.strokeRect(x-width/2,y-24,width,24);}ctx.restore();
}
export function animationFrame(animation,elapsedMs,reducedMotion=false){if(reducedMotion)return animation.reducedMotionFrame;const f=Math.floor(Math.max(0,elapsedMs)/animation.frameDurationMs);return animation.loop?f%animation.frames.length:Math.min(f,animation.frames.length-1);}
export function drawState(ctx,image,animation,x,y,elapsedMs,reducedMotion=false){const f=animation.frames[animationFrame(animation,elapsedMs,reducedMotion)];ctx.drawImage(image,...f,x-animation.anchor[0],y-animation.anchor[1],...animation.frameSize);}
