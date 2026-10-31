import {chromium} from './chronoscope-upload-local/frontend/node_modules/playwright/index.mjs';
import readline from 'node:readline';
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`);
let page;
for(const context of browser.contexts())for(const candidate of context.pages())if(await candidate.evaluate(()=>!!window.__chronoscope).catch(()=>false))page=candidate;
if(!page)throw Error('No full native Chronoscope window');
await page.bringToFront();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(['info','error'].includes(m.type()))process.stderr.write(m.type()+': '+m.text()+'\n');});
console.log(JSON.stringify({ready:true}));
for await(const line of readline.createInterface({input:process.stdin})){
 const r=JSON.parse(line);let result;
 try{
  if(r.command==='attach') result=await page.evaluate(async()=>{
   const c=window.__chronoscope,v=c.view;await c.ready;window.__uploadTransitions=[];
   const end=v.endResidentPlayback;v.endResidentPlayback=function(...args){if(this.resident)window.__uploadTransitions.push({at:performance.now(),playing:this.playback,stack:new Error().stack,governor:this.resourceGovernor.diagnostics(),label:document.querySelector('#vfx-playback-state')?.textContent});return end.apply(this,args);};return true;
  });
  else if(r.command==='ready') {await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});await page.evaluate(()=>window.__chronoscope.sceneIdle());result=true;}
  else if(r.command==='reset'){
   await page.locator('#vfx-smooth-playback').setChecked(false);await page.evaluate(()=>window.__chronoscope.sceneIdle());
   await page.locator('#vfx-smooth-playback').setChecked(true);await page.evaluate(()=>window.__chronoscope.sceneIdle());
   await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});result=true;
  }
  else if(r.command==='rebuild'||r.command==='cancel')result=await page.evaluate(async({cancel})=>{
   const c=window.__chronoscope,v=c.view,old=v.resident;
   if(!old)throw Error('Expected prepared renderer');
   const points=[...old.byId.values()],names=[...v.names],bounds=c.snapshot.time_bounds;
   const start=c.snapshot.filter.start??bounds[0],end=c.snapshot.filter.end??bounds[1];
   const intervals=[],rafIntervals=[];let last=performance.now(),lastRaf=last,frame=0,previousPan=[0,0],previousZoom=0,unready=0,missing=0,oldLost=0,accept=true;
   const started=performance.now(),started_unix_ms=performance.timeOrigin+started,before=v.scene.primitives.length;
   const remove=v.scene.postRender.addEventListener(()=>{const now=performance.now();intervals.push(now-last);last=now;if(!v.resident)missing++;if(v.resident?.primitives.some(p=>!p.ready)||v.resident?.lines&&!v.resident.lines.ready)unready++;if(v.pendingResident&&v.resident!==old)oldLost++;});
   const move=now=>{rafIntervals.push(now-lastRaf);lastRaf=now;const p=(now-started)/1000*Math.PI*2/5,pan=[90*Math.sin(p),45*Math.sin(p*.5)],zoom=.16*Math.sin(p);v.panPixels(pan[0]-previousPan[0],pan[1]-previousPan[1]);v.zoom(Math.exp(zoom-previousZoom));previousPan=pan;previousZoom=zoom;frame=requestAnimationFrame(move);};
   frame=requestAnimationFrame(move);
   let timer;if(cancel)timer=setTimeout(()=>accept=false,50);
   let accepted,preparationMs;
   try{accepted=await v.beginResidentPlayback(points,names,bounds,()=>accept,c.snapshot.revision);preparationMs=performance.now()-started;v.residentPlaybackWindow(start,end,true);await new Promise(resolve=>setTimeout(resolve,100));}
   finally{clearTimeout(timer);cancelAnimationFrame(frame);remove();}
   return{accepted,preparationMs,elapsed_ms:performance.now()-started,started_unix_ms,intervals_ms:intervals,raf_intervals_ms:rafIntervals,missing,unready,oldLost,sameOld:v.resident===old,before,after:v.scene.primitives.length,pending:!!v.pendingResident,sourceCount:points.length,resident:v.resident?.diagnostics(),governor:v.resourceGovernor.diagnostics(),renderErrors:v.diagnostics().renderErrorCount};
  },{cancel:r.command==='cancel'});
  else if(r.command==='measure')result=await page.evaluate(async({milliseconds})=>{
   const c=window.__chronoscope,v=c.view,frames=[],start=performance.now(),started_unix_ms=performance.timeOrigin+start;
   let last=start,frame,previousPan=[0,0],previousZoom=0,missing=0,unready=0;
   const state=()=>({focused:document.hasFocus(),visibility:document.visibilityState,viewport:[innerWidth,innerHeight,devicePixelRatio],diagnostics:v.diagnostics()});const initial=state(),tilt=v.tilt();
   const remove=v.scene.postRender.addEventListener(()=>{const now=performance.now();frames.push(now-last);last=now;if(!v.resident)missing++;if(v.resident?.primitives.some(p=>!p.ready))unready++;});
   const move=now=>{const p=(now-start)/1000*Math.PI*2/5,pan=[90*Math.sin(p),45*Math.sin(p*.5)],zoom=.16*Math.sin(p);v.panPixels(pan[0]-previousPan[0],pan[1]-previousPan[1]);v.zoom(Math.exp(zoom-previousZoom));if(v.mode!=='map')v.setTilt(Math.max(0,Math.min(80,tilt+4*Math.sin(p))));previousPan=pan;previousZoom=zoom;frame=requestAnimationFrame(move);};frame=requestAnimationFrame(move);
   await new Promise(resolve=>setTimeout(resolve,milliseconds));cancelAnimationFrame(frame);remove();return{started_unix_ms,elapsed_ms:performance.now()-start,intervals_ms:frames,rendered_frames:frames.length,inactive_prepared_frames:missing,unready,initial,final:state(),rendererTransitions:window.__uploadTransitions};
  },r.arguments);
  else if(r.command==='exact')result=await page.evaluate(async()=>{const c=window.__chronoscope;await c.filterIdle();await c.sceneIdle();const exact=await c.call('render_data',{max_points:100000}),ids=new Set(exact.ids),drawn=c.view.points.map(p=>p.id);return{count:exact.ids.length,drawn:drawn.length,unique:new Set(drawn).size===drawn.length,equal:drawn.length===exact.ids.length&&drawn.every(id=>ids.has(id)),diag:c.view.diagnostics()};});
  else if(r.command==='screenshot'){await page.screenshot({path:r.arguments.path});result=true;}
  else if(r.command==='health')result=errors;
  else if(r.command==='close'){await browser.close();console.log(JSON.stringify({id:r.id,result:true}));break;}
  else throw Error('Unknown command '+r.command);
  console.log(JSON.stringify({id:r.id,result}));
 }catch(error){console.log(JSON.stringify({id:r.id,error:String(error)}));}
}
