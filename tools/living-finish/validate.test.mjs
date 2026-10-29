import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {activityCounts,activityIsFresh,DeliveryReplay,customerMotion} from '../../src/city/activityMotion.ts';
import {rigPose} from '../../src/city/actorRig.ts';
const require=createRequire(import.meta.url),sharp=require(require.resolve('sharp',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??process.cwd()]}));
const activity={companyId:'test',state:'delivery',customers:3,workers:2,vans:1,productionActive:true};
test('stale, closed and construction buildings cannot show activity',()=>{
 for(const a of [{...activity,state:'closed'},{...activity,state:'construction'}])assert.deepEqual(activityCounts(a,true),{customers:0,workers:0,vans:0,working:false});
 assert.equal(activityCounts(activity,false).customers,0);assert.equal(activityIsFresh(100,20101),false);assert.equal(activityIsFresh(100,20099),true);assert.equal(activityIsFresh(NaN,100),false);assert.equal(activityIsFresh(101,100),false);
 assert.deepEqual(activityCounts({...activity,customers:NaN,workers:999,vans:-1},true),{customers:0,workers:3,vans:0,working:true});
});
test('delivery replay rejects history, duplicate days and reconnect backlogs',()=>{
 const r=new DeliveryReplay(),items=new Map([['test',activity]]);r.accept(10,items,0);assert.equal(r.sample('test',0),null);
 r.accept(11,items,100);assert.equal(r.sample('test',101).stage,'arrive');r.accept(11,items,2000);assert.equal(r.sample('test',2000).stage,'unload');assert.equal(r.sample('test',4500).stage,'depart');assert.equal(r.sample('test',6100),null);
 r.accept(15,items,7000);assert.equal(r.sample('test',7000),null);
});
test('walk phases alternate; reduced motion freezes legs and positions',()=>{
 assert.equal(rigPose('walk',0).step,-rigPose('walk',2).step);assert.equal(rigPose('walk',1).lift,1);assert.equal(rigPose('walk',2,true).step,0);
 assert.deepEqual(customerMotion(0,0,true),customerMotion(0,1234,true));assert.notDeepEqual(customerMotion(0,0,false),customerMotion(0,1234,false));
});
test('runtime sprites have alpha and atlas coordinates fit each source',async()=>{
 const m=JSON.parse(fs.readFileSync('assets/art/phase8/manifest.json'));assert.equal(m.assets.length,91);
 for(const a of m.assets){const meta=await sharp(a.source).metadata();assert.equal(meta.width,a.sourceSize[0],a.id);assert.equal(meta.height,a.sourceSize[1],a.id);assert.ok(meta.hasAlpha,a.id);const stats=await sharp(a.source).stats();assert.equal(stats.channels[3].min,0,a.id);assert.ok(stats.channels[3].max>0,a.id);}
 const clips=JSON.parse(fs.readFileSync('assets/art/phase8/animations.json')).clips;assert.equal(clips.length,672);
 for(const c of clips){const meta=await sharp(c.source).metadata();for(const [x,y,w,h]of c.frames){assert.ok(x>=0&&y>=0&&x+w<=meta.width&&y+h<=meta.height,c.id);}}
});
test('world layouts reference existing assets and preserve economic isolation',()=>{
 const ids=new Set([6,8].flatMap(p=>JSON.parse(fs.readFileSync(`assets/art/phase${p}/manifest.json`)).assets.map(a=>a.id)));
 for(const id of ['london','lisbon','mexico-city','port','airport']){const l=JSON.parse(fs.readFileSync(`assets/art/phase8/${id}-layout.json`));assert.equal(l.economicSimulation,false);for(const o of l.objects)assert.ok(ids.has(o.assetId));assert.equal(l.tiles.length,196);}
});
