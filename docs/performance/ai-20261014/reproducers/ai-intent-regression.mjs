import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import ts from 'typescript';
const source=fs.readFileSync('frontend/src/main.ts','utf8');
let handler=source.slice(source.indexOf('let rangeTimer: number | undefined;'),source.indexOf('on("#full-range"'));
let timeWindow=source.slice(source.indexOf('async function timeWindow('),source.indexOf('let searchTimer:'));
let sliderWrite=source.slice(source.indexOf('  if (rangeAppliedVersion === rangeIntentVersion) {')>=0?source.indexOf('  if (rangeAppliedVersion === rangeIntentVersion) {'):source.indexOf('  ($("#window-start") as HTMLInputElement).value = String('),source.indexOf('  ($("#exact-start")'));
let currentFilter={start:null,end:null},calls=[],callbacks={},scheduled,values={'#window-start':{value:'0'},'#window-end':{value:'1000'}},resolveBlocked;
let block=false;let snap={time_bounds:[0,10000],filter:{...currentFilter}};
const ctx={snapshot:snap,rangeTimer:undefined,input:id=>values[id].value,$:id=>({...values[id],addEventListener:(_,fn)=>callbacks[id]=fn}),setTimeout:fn=>(scheduled=fn,1),clearTimeout:()=>{},toast:()=>{},call:async(_,{filter})=>{calls.push(filter.start);if(block&&filter.start===2000)await new Promise(r=>resolveBlocked=r);currentFilter=filter;},filter:async f=>{calls.push(f.start);currentFilter=f;},refresh:async()=>{},console};
ctx.$=id=>{let x=values[id];x.addEventListener=(_,fn)=>callbacks[id]=fn;return x};
vm.createContext(ctx);vm.runInContext(ts.transpile(timeWindow+handler),ctx);
values['#window-start'].value='200';callbacks['#window-start']();
// Observer writes an older backend snapshot before the debounce fires.
vm.runInContext(ts.transpile('const s=snapshot;const [lo,hi]=s.time_bounds;'+sliderWrite),ctx);
await scheduled();await new Promise(r=>setImmediate(r));const afterObserver=calls.at(-1);
console.log(JSON.stringify({test:'capture-before-observer-write',expected:2000,actual:afterObserver,pass:afterObserver===2000}));
if(source.includes('rangeIntentVersion')){
 // Run 20 -> 40 -> 60 while first request is blocked; only last should settle.
 calls.length=0;block=true;values['#window-start'].value='200';callbacks['#window-start']();scheduled();await Promise.resolve();let draining=vm.runInContext("drainRangeIntent()",ctx);await Promise.resolve();values['#window-start'].value='400';callbacks['#window-start']();values['#window-start'].value='600';callbacks['#window-start']();resolveBlocked();await draining;await new Promise(r=>setImmediate(r));assert.equal(currentFilter.start,6000);assert.equal(calls.at(-1),6000);assert.equal(afterObserver,2000);console.log(JSON.stringify({test:'serialized-latest-intent',calls,pass:true}));
}else assert.notEqual(afterObserver,2000,'baseline should reproduce observer reset');
