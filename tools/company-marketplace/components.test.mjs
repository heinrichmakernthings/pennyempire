import assert from'node:assert/strict';import{esc,money,parseMinor,validateTrade,depthLevels}from'./components.js';
assert.equal(esc('<img src=x onerror="bad">'),'&lt;img src=x onerror=&quot;bad&quot;&gt;');
assert.equal(parseMinor('2.40'),240);assert.equal(parseMinor('2.401'),null);assert.equal(parseMinor('1e3'),null);assert.equal(parseMinor('-1'),null);assert.equal(money(null),'Unavailable');
const input={quantity:40,price:'2.40',side:'buy',availableUnits:36,availableMinor:600000};assert.equal(validateTrade(input),null);assert.match(validateTrade({...input,quantity:10000}),/funds/);assert.match(validateTrade({...input,quantity:1.5}),/whole/);assert.match(validateTrade({...input,side:'sell'}),/inventory/);
assert.deepEqual(depthLevels([{side:'sell',priceMinor:240,remainingUnits:4},{side:'sell',priceMinor:235,remainingUnits:2},{side:'sell',priceMinor:240,remainingUnits:3},{side:'buy',priceMinor:250,remainingUnits:8}], 'sell'),[{price:235,quantity:2,total:2},{price:240,quantity:7,total:9}]);
console.log('PASS: escaped user text, exact minor-unit parsing, invalid quantity, full reservation, stock reservation, aggregated price-time depth.');
