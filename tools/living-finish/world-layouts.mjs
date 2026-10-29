// Code-native terrain and authored object placement. Illustrations come from existing manifests.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??process.cwd()]}));
const base='assets/art/phase8';
const frames=new Map([6,8].flatMap(p=>JSON.parse(fs.readFileSync(`assets/art/phase${p}/manifest.json`)).assets).map(a=>[a.id,a]));
const layouts=[
 {id:'london',name:'London commercial quarter',ground:'#777866',water:true,objects:[['london-office',3,2],['london-commercial',6,2],['terrace-module',9,2],['london-commercial',3,6],['shop-module',6,6],['london-office',9,6],['customer-sw',5,8],['lorry-sw',8,9]]},
 {id:'lisbon',name:'Lisbon hillside and waterfront',ground:'#b7a988',water:true,hills:true,objects:[['lisbon-tiled-shop',3,2],['lisbon-tiled-shop',6,2],['terrace-module',9,2],['lisbon-waterfront-store',3,7],['lisbon-tiled-shop',7,6],['lisbon-retaining-wall',5,4],['lisbon-retaining-wall',6,4],['lisbon-retaining-wall',7,4],['customer-sw',6,8]]},
 {id:'mexico-city',name:'Mexico City market district',ground:'#b69c77',objects:[['mexico-city-shop',3,2],['mexico-city-workshop',7,2],['mexico-city-shop',3,7],['mexico-city-workshop',9,7],['mexico-city-market-stall',5,6],['mexico-city-market-stall',6,7],['mexico-city-market-stall',5,8],['customer-sw',6,8],['farm-pickup-sw',9,10]]},
 {id:'port',name:'Freight port and berth',ground:'#7e827a',water:true,port:true,objects:[['warehouse-module',3,2],['customs-office',7,2],['freight-container',3,6],['freight-container',5,6],['crane',9,6],['cargo-ship-sw',12,8],['lorry-sw',8,6],['forklift-sw',4,8],['crates',5,8]]},
 {id:'airport',name:'Air freight apron and runway',ground:'#7c896b',airport:true,objects:[['air-freight-terminal',3,2],['customs-office',7,2],['cargo-aircraft-sw',4,6],['freight-container',2,5],['lorry-se',8,4],['crates',3,5]]}
];
const xy=(x,y,z=0)=>[960+(x-y)*64,210+(x+y)*32-z];
function polygon(ctx,points,fill){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
for(const layout of layouts){
 const canvas=createCanvas(1920,1180),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#152226';ctx.fillRect(0,0,1920,1180);
 const tiles=[];
 for(let depth=0;depth<28;depth++)for(let x=0;x<14;x++){const y=depth-x;if(y<0||y>=14)continue;
 const water=layout.water&&(layout.port?x>=10:y>=10),road=!water&&(x===5||x===6||y===4||y===5),runway=layout.airport&&y>=9&&y<=11;
 const elevation=layout.hills&&y<4?32:0;
 const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([a,b])=>xy(a,b,layout.hills&&y===3?(b===3?32:0):elevation));
 if(elevation){const [a,b,c,d]=corners;polygon(ctx,[b,c,[c[0],c[1]+32],[b[0],b[1]+32]],'#786b59');polygon(ctx,[c,d,[d[0],d[1]+32],[c[0],c[1]+32]],'#998568');}
 polygon(ctx,corners,water?'#285967':runway?'#3c4749':road?'#646c6a':layout.ground);
 ctx.strokeStyle=water?'#306371':'#ffffff0c';ctx.lineWidth=1;ctx.stroke();
 if(runway&&y===10&&x%2===0)polygon(ctx,[[x+.2,y+.48],[x+.8,y+.48],[x+.8,y+.55],[x+.2,y+.55]].map(([a,b])=>xy(a,b)),'#e4dfc8');
 if(layout.airport&&y===7)polygon(ctx,[[x,y+.48],[x+1,y+.48],[x+1,y+.52],[x,y+.52]].map(([a,b])=>xy(a,b)),'#e2bc5e');
 tiles.push({x,y,elevation,surface:water?'water':runway?'runway':road?'road':'paving'});
 }
 const objects=layout.objects.map(([assetId,x,y])=>({assetId,x,y,elevation:layout.hills&&y<4?32:0})).sort((a,b)=>a.x+a.y-b.x-b.y);
 for(const o of objects){const f=frames.get(o.assetId);if(!f)throw Error(o.assetId);const img=await loadImage(f.source);const [x,y]=xy(o.x,o.y,o.elevation);ctx.drawImage(img,...f.frame,x-f.pivot[0],y-f.pivot[1],...f.logicalSize);}
 fs.writeFileSync(`${base}/qa/${layout.id}-layout.png`,canvas.toBuffer('image/png'));
 fs.writeFileSync(`${base}/${layout.id}-layout.json`,JSON.stringify({id:layout.id,name:layout.name,kind:'visual-layout',economicSimulation:false,tile:[128,64],canvas:[1920,1180],origin:[960,210],tiles,objects},null,2)+'\n');
}
// Reusable 2:1 terrain elevation/ramp geometry, authored as vectors like existing terrain.
const terrain=[];
for(const direction of ['flat','north','east','south','west']){
 const h=direction==='flat'?[32,32,32,32]:direction==='north'?[32,32,0,0]:direction==='east'?[0,32,32,0]:direction==='south'?[0,0,32,32]:[32,0,0,32];
 const pts=[[64,32-h[0]],[128,64-h[1]],[64,96-h[2]],[0,64-h[3]]];
 const points=p=>p.map(v=>v.join(',')).join(' ');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><path fill="#776b55" d="M128 64L64 96V${pts[2][1]}L128 ${pts[1][1]}Z"/><path fill="#958466" d="M0 64L64 96V${pts[2][1]}L0 ${pts[3][1]}Z"/><polygon points="${points(pts)}" fill="#b7a988" stroke="#9d9177"/></svg>`;
 fs.writeFileSync(`${base}/runtime/terrain-${direction}.svg`,svg);terrain.push({id:`terrain-${direction}`,source:`${base}/runtime/terrain-${direction}.svg`,size:[128,96],cornerHeights:h});
}
fs.writeFileSync(`${base}/terrain.json`,JSON.stringify({tile:[128,64],heightStep:32,tiles:terrain},null,2)+'\n');
console.log('5 visual layouts and 5 terrain elevation tiles exported.');
