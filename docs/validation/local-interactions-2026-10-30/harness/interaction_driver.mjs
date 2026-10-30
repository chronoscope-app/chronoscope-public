import {chromium} from './chronoscope-interactions-local/frontend/node_modules/playwright/index.mjs';
import readline from 'node:readline';
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`);
let page;
for(const c of browser.contexts())for(const p of c.pages())if(await p.evaluate(()=>!!window.__chronoscope).catch(()=>false))page=p;
if(!page)throw Error('Native target unavailable');await page.bringToFront();
process.stdout.write(JSON.stringify({ready:true})+'\n');
for await(const line of readline.createInterface({input:process.stdin})) {
 const r=JSON.parse(line);let result;
 try {
  if(r.command==='ready') {
   await page.waitForFunction(()=>!window.__chronoscope.busy);
   if(r.arguments.improved)await page.evaluate(()=>{const c=window.__chronoscope,v=c.view;window.__labExpected=true;window.__residentEnds=[];const old=v.endResidentPlayback;v.endResidentPlayback=function(...args){if(this.resident)window.__residentEnds.push({stack:new Error().stack,profile:this.resourceGovernor.diagnostics(),filter:c.snapshot.filter,scene:c.snapshot.scene,at:performance.now()});return old.apply(this,args);};});
   if(r.arguments.improved)await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:45000});
   await page.evaluate(()=>window.__chronoscope.sceneIdle());result=true;
  } else if(r.command==='state')result=await page.evaluate(()=>({playing:window.__chronoscope.view.playback,diag:window.__chronoscope.view.diagnostics()}));
  else if(r.command==='window')result=await page.evaluate(async()=>{
   const c=window.__chronoscope,[lo,hi]=c.snapshot.time_bounds;
   await c.call('filter',{filter:{start:lo+(hi-lo)*.35,end:lo+(hi-lo)*.55}});await c.refresh(false);await c.sceneIdle();return true;
  });
  else if(r.command==='settled') {await page.waitForFunction(()=>!window.__labExpected || window.__chronoscope.view.residentPlaybackActive || window.__chronoscope.view.resourceLimits.name!=='full',null,{timeout:45000});result=true;}
  else if(r.command==='select')result=await page.evaluate(async()=>{
   const c=window.__chronoscope,p=await c.call('render_data',{max_points:100000});
   const ids=p.ids.filter((_,i)=>i%Math.max(1,Math.floor(p.ids.length/1000))===0).slice(0,1000);
   await c.select(ids);await c.sceneIdle();return ids.length;
  });
  else if(r.command==='screenshot'){await page.screenshot({path:r.arguments.path});result=true;}
  else if(r.command==='measure') {
   const {motion,milliseconds}=r.arguments;
   let grab;
   if(motion==='scrub'){
    const b=await page.locator('#time-range-window').boundingBox();grab={x:b.x+Math.min(6,b.width/2),y:b.y+b.height/2};
    await page.mouse.move(grab.x,grab.y);await page.mouse.down();
   }
   result=await page.evaluate(async({milliseconds,motion,grab})=>{
    const c=window.__chronoscope,v=c.view,frames=[],focusEvents=[];
    const state=()=>({focused:document.hasFocus(),visibility:document.visibilityState,viewport:[innerWidth,innerHeight,devicePixelRatio],visibleEvents:c.snapshot.visible,diagnostics:v.diagnostics()});
    const initial=state(),start=performance.now(),started_unix_ms=performance.timeOrigin+start;
    let frame=0,renderedFrames=0,last,previousPan=[0,0],previousZoom=0;
    let selectionIndex=0;
    const tilt=v.tilt();const node=document.querySelector('#time-range-window');
    const move=now=>{
     const p=(now-start)/1000*Math.PI*2/5;
     if(motion==='navigation'){
      const pan=[90*Math.sin(p),45*Math.sin(p*.5)],zoom=.16*Math.sin(p);
      v.panPixels(pan[0]-previousPan[0],pan[1]-previousPan[1]);v.zoom(Math.exp(zoom-previousZoom));
      if(v.mode!=='map')v.setTilt(Math.max(0,Math.min(80,tilt+4*Math.sin(p))));previousPan=pan;previousZoom=zoom;
     }else if(motion==='scrub')node.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',buttons:1,clientX:grab.x,clientY:grab.y+70*Math.sin(p),bubbles:true}));
     else if(motion==='geometry-selection')v.setSelection([v.geometryFeatures[selectionIndex++ % v.geometryFeatures.length].id]);
     frame=requestAnimationFrame(move);
    };
    if(motion)frame=requestAnimationFrame(move);
    const remove=v.scene.postRender.addEventListener(()=>{const now=performance.now();renderedFrames++;if(last!==undefined)frames.push(now-last);last=now;});
    const focus=()=>focusEvents.push({elapsed_ms:performance.now()-start,focused:document.hasFocus()});addEventListener('blur',focus);
    await new Promise(resolve=>setTimeout(resolve,milliseconds));cancelAnimationFrame(frame);remove();removeEventListener('blur',focus);
    return {started_unix_ms,elapsed_ms:performance.now()-start,intervals_ms:frames,rendered_frames:renderedFrames,initial,final:state(),focusEvents,residentEnds:window.__residentEnds||[]};
   },{milliseconds,motion,grab});
   if(grab){await page.mouse.up();await page.evaluate(async()=>{const c=window.__chronoscope;await c.filterIdle();await c.sceneIdle();});}
  } else if(r.command==='exact')result=await page.evaluate(async()=>{
   const c=window.__chronoscope;await c.filterIdle();await c.sceneIdle();
   const exact=await c.call('render_data',{max_points:100000});const ids=new Set(exact.ids);
   return {count:exact.ids.length,drawn:c.view.points.length,subset:c.view.points.every(p=>ids.has(p.id)),equal:c.view.points.length===exact.ids.length};
  });
  else if(r.command==='close'){await browser.close();process.stdout.write(JSON.stringify({id:r.id,result:true})+'\n');break;}
  else throw Error('Unknown command '+r.command);
  process.stdout.write(JSON.stringify({id:r.id,result})+'\n');
 } catch(error){process.stdout.write(JSON.stringify({id:r.id,error:String(error)})+'\n');}
}
