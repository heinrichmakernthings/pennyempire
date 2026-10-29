import { useEffect, useRef, useState } from 'react';
import clips from '@art/phase8/animations.json';
import { artUrl } from '@/assets/artAssets';
const layouts=import.meta.glob('/assets/art/phase8/qa/*-layout.png',{query:'?url',import:'default',eager:true}) as Record<string,string>;
const names:Record<string,string>={london:'London',lisbon:'Lisbon','mexico-city':'Mexico City',port:'Freight port',airport:'Air freight airport'};
/** Read-only asset acceptance surface, deliberately separate from economic actions. */
export function ArtReviewScreen(){
 const [actor,setActor]=useState('courier'),[pose,setPose]=useState('walk'),[direction,setDirection]=useState('sw');
 const [playing,setPlaying]=useState(false); const ref=useRef<HTMLCanvasElement>(null);
 const clip=clips.clips.find(c=>c.actor===actor&&c.pose===pose&&c.direction===direction);
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx||!clip)return;
  let disposed=false,frame=0,timer:ReturnType<typeof setInterval>|undefined;
  const image=new Image();image.onload=()=>{
   const draw=()=>{if(disposed)return;ctx.clearRect(0,0,128,192);ctx.imageSmoothingEnabled=false;const f=clip.frames[frame%4]!;ctx.drawImage(image,f[0]!,f[1]!,32,48,0,0,128,192);frame++;};draw();
   if(playing&&!matchMedia('(prefers-reduced-motion: reduce)').matches)timer=setInterval(draw,clip.frameMs);
  };image.src=artUrl(clip.source)??'';
  return()=>{disposed=true;if(timer)clearInterval(timer);};
 },[clip,playing]);
 return <section><h1>Art review</h1><p>Read-only previews of the living-city assets. International layouts are visual compositions; they do not enable trading or expansion.</p>
 <h2>Character motion</h2><div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'end'}}>
 <label>Character<select value={actor} onChange={e=>setActor(e.target.value)}>{[...new Set(clips.clips.map(c=>c.actor))].map(a=><option key={a}>{a}</option>)}</select></label>
 <label>Action<select value={pose} onChange={e=>setPose(e.target.value)}>{[...new Set(clips.clips.map(c=>c.pose))].map(a=><option key={a}>{a}</option>)}</select></label>
 <label>Direction<select value={direction} onChange={e=>setDirection(e.target.value)}>{['sw','se','ne','nw'].map(a=><option key={a}>{a}</option>)}</select></label>
 <button className="pe-btn" onClick={()=>setPlaying(!playing)}>{playing?'Pause animation':'Play animation'}</button></div>
 <canvas ref={ref} width={128} height={192} className="pe-pixel-art" role="img" aria-label={`${actor}, ${pose}, ${direction}`} style={{background:'#23343b',marginTop:20}} />
 <p>Shared cutout animation rig. Reduced-motion preferences keep the preview still. Entry and exit clips require a door aperture in their consuming scene.</p>
 <h2>Transport and interior</h2><div style={{display:'flex',flexWrap:'wrap',gap:24}}>{['cargo-ship-sw','cargo-aircraft-sw','executive-office'].map(id=><figure key={id} style={{margin:0,maxWidth:'100%'}}><img className="pe-pixel-art" src={artUrl(`assets/art/phase8/runtime/${id}.png`)} alt={id.replaceAll('-',' ')} style={{maxWidth:'100%',height:'auto'}}/><figcaption>{id.replaceAll('-',' ')}</figcaption></figure>)}</div>
 <h2>World layouts</h2>{Object.entries(names).map(([id,name])=><figure key={id} style={{margin:'24px 0'}}><figcaption><h3>{name}</h3></figcaption><img loading="lazy" className="pe-pixel-art" src={layouts[`/assets/art/phase8/qa/${id}-layout.png`]} alt={`${name} isometric environment layout`} width={1920} height={1180} style={{width:'100%',height:'auto'}}/></figure>)}
 </section>;
}
