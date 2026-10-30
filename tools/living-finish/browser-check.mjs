import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??process.cwd()]}));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const [route,name]of [['/city','city'],['/competitors/co-brunel-mill','portrait'],['/dev/art','art']]){
   await page.goto(`http://127.0.0.1:4173${route}`,{waitUntil:'networkidle'});
   await page.locator('main h1').waitFor();
   await page.waitForTimeout(400);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${width} ${route} overflow`);
   const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src));assert.deepEqual(broken,[],`${route} images`);
   if(name==='portrait')assert.ok(await page.locator('img[alt*="representative"]').count());
   if(name==='art'){await page.getByRole('button',{name:'Play animation'}).click();await page.waitForTimeout(400);await page.getByRole('button',{name:'Pause animation'}).click();}
   await page.screenshot({path:`assets/art/phase8/qa/${width}-${name}.png`});results.push({width,route,overflow,broken});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:4173/dev/art',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Play animation'}).click();
  const canvas=page.locator('canvas');const a=await canvas.evaluate(c=>c.toDataURL());await page.waitForTimeout(400);assert.equal(await canvas.evaluate(c=>c.toDataURL()),a,'reduced motion must stay still');
  assert.deepEqual(errors,[]);await page.close();
 }
 fs.writeFileSync('assets/art/phase8/qa/browser-report.json',JSON.stringify({passed:true,results},null,2)+'\n');console.log('Desktop/mobile city, portrait, art preview and reduced-motion checks passed.');
}finally{await browser.close();}
