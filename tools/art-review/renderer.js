// Framework-independent reference renderer. Positions and sizes use logical pixels.
export const project=(c,r)=>[(c-r)*64,(c+r)*32];
export function diamond(ctx,x,y,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+64,y+32);ctx.lineTo(x,y+64);ctx.lineTo(x-64,y+32);ctx.closePath();ctx.fill();}
// Adjacency bits connect edge midpoints: +column=1, +row=2, -column=4, -row=8.
export function terrain(ctx,x,y,kind='paving',mask=0){
 diamond(ctx,x,y,kind==='water'?'#23606b':kind==='road'?'#343c40':kind==='grass'?'#64724b':'#80796b');
 if(kind==='road') {ctx.save();ctx.strokeStyle='#d6c8a6';ctx.lineWidth=2;ctx.setLineDash([5,5]);const ends=[[32,48],[-32,48],[-32,16],[32,16]];ends.forEach(([dx,dy],i)=>{if(mask&(1<<i)){ctx.beginPath();ctx.moveTo(x,y+32);ctx.lineTo(x+dx,y+dy);ctx.stroke();}});ctx.restore();}
 if(kind==='water'){ctx.strokeStyle='#377887';ctx.lineWidth=1;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(x-20+i*10,y+16+i*8);ctx.lineTo(x-6+i*10,y+16+i*8);ctx.stroke();}}
}
export function quay(ctx,x,y,mask){const edges=[[[64,32],[0,64]],[[0,64],[-64,32]],[[-64,32],[0,0]],[[0,0],[64,32]]];ctx.strokeStyle='#b3a48b';ctx.lineWidth=5;edges.forEach(([a,b],i)=>{if(mask&(1<<i)){ctx.beginPath();ctx.moveTo(x+a[0],y+a[1]);ctx.lineTo(x+b[0],y+b[1]);ctx.stroke();}});}
export async function loadAssets(root='../../'){
 const manifest=await fetch(root+'assets/art/runtime/manifest.json').then(r=>r.json());const images={};
 await Promise.all([...new Set(manifest.assets.map(a=>a.source))].map(async s=>{const im=new Image();im.src=root+s;await im.decode();images[s]=im;}));return {manifest,images};
}
export function drawSprite(ctx,assets,id,x,y,zoom=1){const a=assets.manifest.assets.find(a=>a.id===id);if(!a)throw Error('Unknown asset '+id);const [sx,sy,sw,sh]=a.frame;const [w,h]=a.logicalSize;ctx.imageSmoothingEnabled=false;ctx.drawImage(assets.images[a.source],sx,sy,sw,sh,Math.round(x-a.pivot[0]*zoom),Math.round(y-a.pivot[1]*zoom),w*zoom,h*zoom);}
