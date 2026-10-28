// Run with NODE_PATH pointing to installed @napi-rs/canvas or install it locally.
import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';
import{drawSprite,terrain,quay,project}from './renderer.js';
const require=createRequire(import.meta.url);const{createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(import.meta.dirname,'../..');const out=process.argv[2]||'/tmp/pe-art-review';fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/art/runtime/manifest.json')));const images={};for(const source of new Set(manifest.assets.map(a=>a.source)))images[source]=await loadImage(path.join(root,source));const assets={manifest,images};
for(let page=0;page<3;page++){const items=manifest.assets.slice(page*15,page*15+15);const c=createCanvas(1100,Math.ceil(items.length/3)*400);const ctx=c.getContext('2d');ctx.fillStyle='#141c20';ctx.fillRect(0,0,c.width,c.height);items.forEach((a,i)=>{const x=(i%3)*366,y=Math.floor(i/3)*400;for(let yy=0;yy<350;yy+=16)for(let xx=0;xx<350;xx+=16){ctx.fillStyle=(xx/16+yy/16)%2?'#aeb3b6':'#e3e5e7';ctx.fillRect(x+xx,y+yy,16,16);}drawSprite(ctx,assets,a.id,x+175,y+330);ctx.fillStyle='#f0e8d7';ctx.font='16px sans-serif';ctx.fillText(a.id+' '+a.logicalSize.join('x'),x+8,y+380);});fs.writeFileSync(path.join(out,`gallery-${page}.png`),c.toBuffer('image/png'));}
for(const z of [1,2]){const c=createCanvas(1400*z,1100*z);const ctx=c.getContext('2d');ctx.scale(z,z);ctx.fillStyle='#17252a';ctx.fillRect(0,0,1400,1100);const ox=700,oy=290;
for(let r=0;r<10;r++)for(let col=0;col<10;col++){const[x,y]=project(col,r);let mask=0;if(col===2||col===5)mask|=10;if(r===2||r===5)mask|=5;terrain(ctx,ox+x,oy+y,col===9?'water':mask?'road':'paving',mask);if(col===8)quay(ctx,ox+x,oy+y,1);}
const buildings=[['farm',0,0],['mill',3,0],['dairy',6,0],['timber',0,3],['warehouse',3,3],['pizza',6,3],['cafe',3,6],['utility',0,6],['terraces',6,6]];
for(const[id,col,r]of buildings.sort((a,b)=>a[1]+a[2]-b[1]-b[2])){const[x,y]=project(col+1,r+1);drawSprite(ctx,assets,id,ox+x,oy+y+32);ctx.fillStyle='#f0e8d7';ctx.font='14px sans-serif';ctx.fillText(id,ox+x-20,oy+y+53);}
for(const[id,col,r]of[['resident-sw',2,8],['worker-se',5,8],['courier-ne',8,5]]){const[x,y]=project(col,r);drawSprite(ctx,assets,id,ox+x,oy+y+32);}fs.writeFileSync(path.join(out,`district-${z}x.png`),c.toBuffer('image/png'));}
const c=createCanvas(1024,260);const ctx=c.getContext('2d');for(let i=0;i<16;i++){terrain(ctx,64+(i%8)*128,Math.floor(i/8)*128,'road',i);}fs.writeFileSync(path.join(out,'road-masks.png'),c.toBuffer('image/png'));
console.log(JSON.stringify({frames:manifest.assets.length,sheets:Object.keys(images).length,output:out}));
