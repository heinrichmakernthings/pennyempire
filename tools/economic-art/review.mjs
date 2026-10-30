import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import{drawSprite}from'../art-review/renderer.js';import{drawActivity}from'./presentation.js';
const require=createRequire(import.meta.url);const{createCanvas,loadImage}=require('@napi-rs/canvas');const R=path.resolve(import.meta.dirname,'../..'),Q=path.join(R,'docs/art/phase3/qa');fs.mkdirSync(Q,{recursive:true});const read=p=>JSON.parse(fs.readFileSync(path.join(R,p)));
const m=read('assets/art/phase3/manifest.json'),animations=read(m.animations).animations,terminal=read(m.terminalIcons).icons;
const all=[...read('assets/art/runtime/manifest.json').assets,...read('assets/art/phase2/manifest.json').assets,...m.assets];const images={};for(const src of new Set(all.map(a=>a.source)))images[src]=await loadImage(path.join(R,src));const pack={manifest:{assets:all},images};
const ai={};for(const a of animations)ai[a.id]=await loadImage(path.join(R,a.pngFile??a.file));
function canvas(w,h,title){const c=createCanvas(w,h),ctx=c.getContext('2d');ctx.fillStyle='#141C20';ctx.fillRect(0,0,w,h);ctx.fillStyle='#F0E8D7';ctx.font='18px sans-serif';ctx.fillText(title,20,28);ctx.imageSmoothingEnabled=false;return[c,ctx];}
function label(ctx,text,x,y){ctx.fillStyle='#A9B5B9';ctx.font='13px sans-serif';ctx.fillText(text,x,y);}
function save(c,id){fs.writeFileSync(path.join(Q,id+'.png'),c.toBuffer('image/png'));}
let[c,ctx]=canvas(1000,690,'Commodity pack — native 48px left; 2× nearest-neighbour right');
m.assets.forEach((a,i)=>{const x=20+i%5*196,y=65+Math.floor(i/5)*204;ctx.fillStyle='#26343B';ctx.fillRect(x,y,180,150);drawSprite(ctx,pack,a.id,x+30,y+100);drawSprite(ctx,pack,a.id,x+120,y+120,2);label(ctx,m.commodities[i].commodityId,x,y+173);label(ctx,a.reusedFrom?'Approved art reused':'New illustration',x,y+192);});save(c,'commodities');
[c,ctx]=canvas(960,930,'Six industries — unchanged building scale; 24px production badges');
['farm','mill','dairy','pizza','cafe','timber'].forEach((id,i)=>{const x=160+i%3*320,y=370+Math.floor(i/3)*440,a=all.find(a=>a.id===id),an=animations.find(a=>a.id==='production-'+id);drawSprite(ctx,pack,id,x,y);drawActivity(ctx,ai[an.id],an,x,y-a.logicalSize[1]-8,400);label(ctx,id,x-140,y+24);const states=Object.values(read(m.businessStates).industries[id]);states.forEach((s,j)=>{const a=animations.find(a=>a.id===s);drawActivity(ctx,ai[s],a,x-125+j*35,y+65,400);});label(ctx,'Left to right: production, inputs, stock, demand,',x-145,y+95);label(ctx,'excess, loss, upgrading, closed',x-145,y+112);});save(c,'industry-states');
[c,ctx]=canvas(820,animations.length*56+55,'Animation sheets — 4 × 24px; 200ms/frame; 800ms cycle');
animations.forEach((a,i)=>{let y=52+i*56;label(ctx,a.id,20,y+18);ctx.drawImage(ai[a.id],235,y);ctx.drawImage(ai[a.id],380,y,192,48);label(ctx,a.reused?'REUSED':'NEW',610,y+18);label(ctx,a.loop?'Persistent signal':'One-shot',690,y+18);});save(c,'animation-strips');
[c,ctx]=canvas(900,400,'Terminal icons — native 24px / currentColor');
for(const[i,a]of terminal.entries()){const x=20+i%6*147,y=58+Math.floor(i/6)*64;const raw=fs.readFileSync(path.join(R,a.file),'utf8').replaceAll('currentColor','#F0E8D7');const im=await loadImage(Buffer.from(raw));ctx.drawImage(im,x,y);label(ctx,a.id,x,y+45);}save(c,'terminal-icons');
const compositions=read(m.marketActivity).compositions;
[c,ctx]=canvas(980,990,'Event-driven staging — reused sprites at native gameplay size');
compositions.forEach((a,i)=>{const x=80+i%2*490,y=200+Math.floor(i/2)*230;for(const p of a.placements)drawSprite(ctx,pack,p.assetId,x+p.offset[0],y+p.offset[1]);const an=animations.find(an=>an.id===a.animation);drawActivity(ctx,ai[a.animation],an,x+250,y-70,400);label(ctx,a.id,x-60,y+60);});save(c,'market-activity');
console.log('Five contact sheets rendered using actual drawSprite and drawActivity.');
