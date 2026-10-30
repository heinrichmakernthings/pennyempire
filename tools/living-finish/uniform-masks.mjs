// Conservative garment-only stencils: central torso, excluding hands, face and equipment.
// Masks are separate exports; original illustrations are never changed.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp=require(require.resolve('sharp',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??process.cwd()]}));
const roles=['farm-worker','mill-worker','dairy-worker','pizza-chef','barista','timber-worker','delivery-driver','warehouse-worker'];
const masks=[];
for(const role of roles)for(const direction of ['sw','se','ne','nw']){
 const source=`assets/art/phase8/runtime/${role}-idle-${direction}.png`;
 const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});const out=Buffer.alloc(info.width*info.height*4);
 for(let y=16;y<25;y++)for(let x=7;x<17;x++){
  const i=(y*24+x)*4,[r,g,b,a]=data.subarray(i,i+4);
  // Orange skin is excluded. Yellow uniform cloth is included only for apron/hi-vis roles.
  const warmUniform=['barista','delivery-driver','warehouse-worker'].includes(role);
  const cloth=warmUniform?r>g&&g>b*1.5&&r<g*1.65:role==='dairy-worker'?Math.min(r,g,b)>90&&Math.max(r,g,b)-Math.min(r,g,b)<65:role==='mill-worker'||role==='pizza-chef'?b>r&&b>g: g>r&&g>b;
  if(a&&cloth){out[i]=out[i+1]=out[i+2]=255;out[i+3]=a;}
 }
 const target=`assets/art/phase8/runtime/${role}-uniform-${direction}.png`;
 await sharp(out,{raw:{width:24,height:40,channels:4}}).png().toFile(target);
 masks.push({actor:role,direction,source,target,region:[7,16,10,9],purpose:'central-garment-accent',wholeUniform:false});
}
fs.writeFileSync('assets/art/phase8/uniform-masks.json',JSON.stringify({version:1,masks},null,2)+'\n');console.log(`${masks.length} conservative garment masks exported.`);
