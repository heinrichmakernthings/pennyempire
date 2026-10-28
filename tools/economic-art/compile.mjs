// Deterministic renderer export: existing logical sizes, nearest-neighbour, no creative repainting.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const{createCanvas,loadImage}=require('@napi-rs/canvas');
const R=path.resolve(import.meta.dirname,'../..'),D=path.join(R,'assets/art/phase3');
const read=p=>JSON.parse(fs.readFileSync(path.join(R,p)));const base=read('assets/art/runtime/manifest.json');
const measurements=read('assets/art/phase3/measurements.json');const assets=[], commodities=[];
const names=['wheat','milk','timber','water','energy','animal-feed','flour','cheese','coffee','packaging','building-materials','pizza','coffee-drinks','bakery-products','furniture'];
const inherited={wheat:'wheat',milk:'milk',timber:'timber-item',energy:'energy',flour:'flour',cheese:'cheese',packaging:'delivery',pizza:'pizza-item'};
const atlas=createCanvas(5*52,3*52),ac=atlas.getContext('2d');ac.imageSmoothingEnabled=false;
fs.mkdirSync(path.join(D,'runtime/commodities'),{recursive:true});fs.mkdirSync(path.join(D,'runtime/animations'),{recursive:true});
for(const[idIndex,id]of names.entries()){
 const old=inherited[id]&&base.assets.find(a=>a.id===inherited[id]);const measured=measurements.find(a=>a.id===id);
 const source=old?.source??measured.source,frame=old?.frame??measured.crop;
 const im=await loadImage(path.join(R,source));let [w,h]=old?.logicalSize??[0,0];if(!old){const s=48/Math.max(frame[2],frame[3]);w=Math.round(frame[2]*s);h=Math.round(frame[3]*s);}
 const c=createCanvas(48,48),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;const x=Math.floor((48-w)/2),y=48-h;ctx.drawImage(im,...frame,x,y,w,h);
 const file=`assets/art/phase3/runtime/commodities/${id}.png`;fs.writeFileSync(path.join(R,file),c.toBuffer('image/png'));
 const ax=idIndex%5*52+2,ay=Math.floor(idIndex/5)*52+2;ac.drawImage(c,ax,ay);
 const assetId='commodity-'+id;
 assets.push({id:assetId,source:'assets/art/phase3/runtime/commodity-atlas.png',sourceSize:[260,156],frame:[ax,ay,48,48],logicalSize:[48,48],pivot:[24,48],contentRect:[x,y,w,h],individualFile:file,sourceArtwork:source,sourceCrop:frame,usage:'inventory/trade/recipe icon; not world-scale cargo',status:'native-scale-reviewed; approval-pending',reusedFrom:inherited[id]??null,scaleMode:'nearest',productionCertified:false});
 commodities.push({commodityId:id,iconAssetId:assetId,legacyIconAssetId:inherited[id]??null,contractStatus:['wheat','milk','timber','energy','flour','cheese','pizza'].includes(id)?'existing fixture ID':'proposed commodity ID; map engine aliases explicitly'});
}
fs.writeFileSync(path.join(D,'runtime/commodity-atlas.png'),atlas.toBuffer('image/png'));
const anim=read('assets/art/phase3/animations.json');
for(const a of anim.animations){if(a.reused)continue;const im=await loadImage(path.join(R,a.file));const c=createCanvas(96,24);c.getContext('2d').drawImage(im,0,0);a.pngFile=`assets/art/phase3/runtime/animations/${a.id}.png`;fs.writeFileSync(path.join(R,a.pngFile),c.toBuffer('image/png'));}
fs.writeFileSync(path.join(D,'animations.json'),JSON.stringify(anim,null,2));
fs.writeFileSync(path.join(D,'manifest.json'),JSON.stringify({version:3,tile:[128,64],dependencies:['assets/art/runtime/manifest.json','assets/art/phase2/manifest.json'],assets,commodities,animations:'assets/art/phase3/animations.json',terminalIcons:'assets/art/phase3/terminal-icons.json',businessStates:'assets/art/phase3/business-states.json',marketActivity:'assets/art/phase3/market-activity.json'},null,2));
console.log('15 individual 48px commodities + 260x156 atlas; 17 PNG animation exports');
