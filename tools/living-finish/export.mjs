// Mechanical crop/scale/packing only. All source illustrations were made with imagegen.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? process.cwd()] }));
const base = 'assets/art/phase8';
const assets = [];
async function exportFrame(id, input, width, height, footprint, usage, extract) {
  let src = sharp(input);
  if (extract) src = sharp(await src.extract(extract).toBuffer());
  const trimmed = await src.trim().toBuffer();
  await sharp(trimmed).resize(width - 4, height - 4, { fit: 'inside', kernel: 'nearest' }).extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#00000000' }).png().toFile(`${base}/runtime/${id}-crop.png`);
  const crop = await sharp(`${base}/runtime/${id}-crop.png`).metadata();
  await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{ input: `${base}/runtime/${id}-crop.png`, left: Math.floor((width-crop.width)/2), top: height-crop.height }]).png().toFile(`${base}/runtime/${id}.png`);
  fs.unlinkSync(`${base}/runtime/${id}-crop.png`);
  assets.push({id,source:`${base}/runtime/${id}.png`,sourceSize:[width,height],frame:[0,0,width,height],logicalSize:[width,height],pivot:[width/2,height],footprint,usage,status:'runtime',productionCertified:false,sourceArtwork:input});
}
await exportFrame('cargo-ship-sw',`${base}/source/cargo-ship.png`,384,224,[4,2],'prop');
await exportFrame('cargo-aircraft-sw',`${base}/source/cargo-aircraft.png`,256,192,[3,3],'prop');
await exportFrame('executive-office',`${base}/source/executive-office.png`,384,320,[3,3],'prop');
const directions = ['sw','se','ne','nw'];
// Only neutral column 2 is used. The imagegen stride attempts were rejected, not shipped as walk cycles.
const meta = await sharp(`${base}/source/courier-directions.png`).metadata();
for(let i=0;i<4;i++) await exportFrame(`courier-idle-${directions[i]}`,`${base}/source/courier-directions.png`,24,40,[1,1],'actor',{left:Math.floor(meta.width/4),top:Math.floor(i*meta.height/4),width:Math.floor(meta.width/4),height:Math.floor(meta.height/4)});
async function cell(input, cols, rows, c, r) {
  const m = await sharp(input).metadata();
  return {left:Math.floor(c*m.width/cols),top:Math.floor(r*m.height/rows),width:Math.floor((c+1)*m.width/cols)-Math.floor(c*m.width/cols),height:Math.floor((r+1)*m.height/rows)-Math.floor(r*m.height/rows)};
}
for (let i=0;i<4;i++) {
  const input=`${base}/source/pickup-directions.png`;
  await exportFrame(`farm-pickup-${directions[i]}`,input,128,91,[2,1],'prop',await cell(input,2,2,i%2,Math.floor(i/2)));
}
const owners=JSON.parse(fs.readFileSync('assets/art/phase7/characters.json')).people;
for (let i=0;i<owners.length;i++) {
  const p=owners[i];
  for (const [offset,dir] of [[1,'ne'],[2,'nw']]) {
    const input=`${base}/source/owner-back-directions.png`;
    await exportFrame(`${p.id}-idle-${dir}`,input,24,40,[1,1],'actor',await cell(input,6,6,(i%2)*3+offset,Math.floor(i/2)));
  }
  const input=`${base}/source/owner-se-directions.png`;
  // Explicit measured row boundaries avoid including a neighbouring boot or hat.
  const m=await sharp(input).metadata(), ys=[0,312,610,907,m.height];
  const r=Math.floor(i/3),c=i%3;
  await exportFrame(`${p.id}-idle-se`,input,24,40,[1,1],'actor',{left:Math.floor(c*m.width/3),top:ys[r],width:Math.floor(m.width/3),height:ys[r+1]-ys[r]});
  await exportFrame(`${p.id}-idle-sw`,p.assets.world,24,40,[1,1],'actor',{left:0,top:0,width:24,height:40});
}
const workers=['farm-worker','mill-worker','dairy-worker','pizza-chef','barista','timber-worker','delivery-driver','warehouse-worker'];
for(const role of workers)for(let d=0;d<4;d++){
 const input=`${base}/source/${role}-directions.png`;
 await exportFrame(`${role}-idle-${directions[d]}`,input,24,40,[1,1],'actor',await cell(input,4,1,d,0));
}
fs.writeFileSync(`${base}/manifest.json`,JSON.stringify({version:8,tile:[128,64],projection:'2:1 orthographic isometric',assets},null,2)+'\n');
console.log(`${assets.length} runtime frames exported.`);
