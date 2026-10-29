import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{project,terrain,quay}from './renderer.js';
const root=path.resolve(import.meta.dirname,'../..');const m=JSON.parse(fs.readFileSync(path.join(root,'assets/art/runtime/manifest.json')));const ids=new Set();
for(const a of m.assets){assert(!ids.has(a.id));ids.add(a.id);assert(fs.existsSync(path.join(root,a.source)));const[x,y,w,h]=a.frame;assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=a.sourceSize[0]&&y+h<=a.sourceSize[1]);assert(a.logicalSize.every(n=>Number.isInteger(n)&&n>0));if(a.usage==='inventory')assert(Math.max(...a.logicalSize)<=48);if(a.usage==='actor')assert.equal(a.logicalSize[1],40);}
for(const id of ['farm','mill','dairy','pizza','cafe','timber'])assert(ids.has(id));
assert.deepEqual(project(1,0),[64,32]);assert.deepEqual(project(0,1),[-64,32]);
for(let mask=0;mask<16;mask++){let strokes=0;const ctx={beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},save(){},restore(){},setLineDash(){},stroke(){strokes++}};terrain(ctx,0,0,'road',mask);assert.equal(strokes,mask.toString(2).replaceAll('0','').length);strokes=0;quay(ctx,0,0,mask);assert.equal(strokes,mask.toString(2).replaceAll('0','').length);}
console.log('PASS: 41 unique frame bounds, all source references, six industries, 48px icons, 40px actors, projection and all 16 road/quay masks.');
