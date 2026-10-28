import http from'node:http';import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';
const require=createRequire(import.meta.url);const{chromium}=require('playwright');const R=path.resolve(import.meta.dirname,'../..'),out=path.join(R,'docs/art/phase4/qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}const file=path.resolve(R,'.'+pathname+(pathname.endsWith('/')?'index.html':''));if(!file.startsWith(R+path.sep)){res.writeHead(403);res.end();return;}try{const body=fs.readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const results=[];const base=`http://127.0.0.1:${server.address().port}/tools/company-marketplace/`;
for(const[device,width,height]of[['desktop',1440,1000],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 async function snap(name){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(160);await page.evaluate(()=>scrollTo(0,0));const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);results.push({device,name,noPageOverflow:!overflow});await page.screenshot({path:path.join(out,`${device}-${name}.png`),fullPage:!(await page.locator('dialog[open]').count())});}
 await page.goto(base+'#manage');await page.waitForTimeout(600);await snap('company-overview');
 await page.getByRole('tab',{name:'Operations',exact:true}).click();await snap('company-operations');
 await page.locator('[name=planned]').fill('10');await page.getByRole('button',{name:'Save changes',exact:true}).click();if(!await page.getByText('Settings saved in preview',{exact:true}).isVisible())throw Error('save failed');
 await page.getByRole('tab',{name:'Inventory',exact:true}).click();if(device==='desktop')await snap('company-inventory');
 await page.getByRole('tab',{name:'Growth',exact:true}).click();if(device==='desktop')await snap('company-growth');
 await page.getByRole('button',{name:'Review upgrade',exact:true}).click();if(device==='desktop')await snap('upgrade-review');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('tab',{name:'Ownership',exact:true}).click();if(device==='desktop')await snap('company-ownership');
 await page.goto(base+'?capture=create# create'.replace('# create','#create'));await page.waitForTimeout(400);await snap('create-opportunity');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await snap('create-premises');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('[name=businessName]').fill('Bristol Slice');if(device==='desktop')await snap('create-budget');
 await page.getByRole('button',{name:'Continue',exact:true}).click();await snap('create-review');
 await page.locator('#creation-consent').check();await page.getByRole('button',{name:'Create company · preview',exact:true}).click();await page.getByRole('heading',{name:'Bristol Slice is ready',exact:true}).waitFor();if(device==='desktop')await snap('first-production');
 await page.getByRole('button',{name:'Save production plan',exact:true}).click();await page.getByRole('tab',{name:'Operations',exact:true}).waitFor();
 await page.goto(base+'?capture=market#market');await snap('marketplace');
 if(device==='mobile')await page.getByRole('button',{name:'Open trading ticket',exact:true}).click();
 await page.getByRole('button',{name:'Review buy order',exact:true}).click();await snap('trade-review');
 await page.getByRole('button',{name:'Confirm buy · preview',exact:true}).click();await page.getByText('Order confirmed in preview',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Cancel 15 remaining',exact:true}).click();await page.getByRole('button',{name:'Cancel remainder',exact:true}).click();if(!await page.getByText('Remainder cancelled',{exact:true}).isVisible())throw Error('cancel failed');
 await page.getByRole('button',{name:'Supplier contracts',exact:true}).click();await snap('supplier-contract');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.goto(base+'?capture=chain#chain');await snap('supply-chain');
 await page.goto(base+'#states');if(device==='desktop')await snap('component-states');
 results.push({device,consoleErrors:errors,flows:'settings save, 4-step creation, first setup, quote/confirm, partial remainder cancellation, contract dialog'});await page.close();
}
await browser.close();server.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.noPageOverflow===false||r.consoleErrors?.length))process.exitCode=1;
