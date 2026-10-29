import fs from 'node:fs';
import {createRequire} from 'node:module';
import {drawActorRig, DIRECTIONS, POSES, FRAME_MS} from '../../src/city/actorRig.ts';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??process.cwd()]}));
const base='assets/art/phase8', manifest=JSON.parse(fs.readFileSync(`${base}/manifest.json`));
const contact=createCanvas(640,480), c=contact.getContext('2d');c.fillStyle='#1d282d';c.fillRect(0,0,640,480);
const actors=['courier','farm-worker','mill-worker','dairy-worker','pizza-chef','barista','timber-worker','delivery-driver','warehouse-worker',...JSON.parse(fs.readFileSync('assets/art/phase7/characters.json')).people.map(p=>p.id)];
const clips=[];
for(const actor of actors){
 const sheet=createCanvas(128,48*POSES.length*4),ctx=sheet.getContext('2d');
 for(let d=0;d<4;d++){
  const direction=DIRECTIONS[d],image=await loadImage(`${base}/runtime/${actor}-idle-${direction}.png`);
  for(let p=0;p<POSES.length;p++){
   const pose=POSES[p],row=d*POSES.length+p;
   for(let f=0;f<4;f++)drawActorRig(ctx,image,f*32+16,row*48+46,1,pose,f,direction);
   clips.push({id:`${actor}-${pose}-${direction}`,actor,pose,direction,source:`${base}/runtime/${actor}-motion.png`,frameSize:[32,48],frames:Array.from({length:4},(_,f)=>[f*32,row*48,32,48]),frameMs:FRAME_MS,pivot:[16,46],loop:!['enter','exit','celebrate','upset'].includes(pose),reducedMotionFrame:0,technique:'cutout-rig'});
  }
 }
 fs.writeFileSync(`${base}/runtime/${actor}-motion.png`,sheet.toBuffer('image/png'));
 if(actor==='courier')for(let i=0;i<POSES.length;i++){
  c.fillStyle='#f0e8d7';c.font='14px sans-serif';c.fillText(POSES[i],12,(i+1)*58-40);
  for(let f=0;f<4;f++)c.drawImage(sheet,f*32,i*48,32,48,140+f*100,i*58,32,48);
 }
}
fs.writeFileSync(`${base}/animations.json`,JSON.stringify({version:1,clips},null,2)+'\n');
fs.writeFileSync(`${base}/qa/rig-contact.png`,contact.toBuffer('image/png'));
console.log(`${clips.length} four-frame directional clips across ${actors.length} rigs.`);
