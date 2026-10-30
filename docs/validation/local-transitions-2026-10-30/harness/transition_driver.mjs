import {chromium} from './chronoscope-transitions-local/frontend/node_modules/playwright/index.mjs';
import readline from 'node:readline';
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`);
let page;
for(const c of browser.contexts())for(const p of c.pages())if(await p.evaluate(()=>!!window.__chronoscope).catch(()=>false))page=p;
if(!page)throw Error('Native target unavailable');await page.bringToFront();
const browserErrors=[];page.on('pageerror',error=>browserErrors.push(error.message));page.on('console',message=>{if(['info','error'].includes(message.type()))process.stderr.write(message.type()+': '+message.text()+'\n');});
process.stdout.write(JSON.stringify({ready:true})+'\n');
for await(const line of readline.createInterface({input:process.stdin})) {
 const r=JSON.parse(line);let result;
 try {
  if(r.command==='pixels') {
   result=await page.evaluate(async()=>{
    const v=window.__chronoscope.view,gl=v.viewer.canvas.getContext('webgl2'),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
    const read=()=>{const b=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
    const objects=[v.glyphs,v.triangles,v.arrivingPoints,v.arrivingTriangles,v.selections,v.fading,...v.resident.primitives];
    const visibility=objects.map(o=>o.show);objects.forEach(o=>o.show=false);await v.screenshot();const blank=read();
    objects.forEach((o,i)=>o.show=visibility[i]);await v.screenshot();const full=read();let best={count:0,x:0,y:0};
    for(let y=0;y<h-64;y+=64)for(let x=0;x<w-64;x+=64){let count=0;for(let a=0;a<64;a++)for(let b=0;b<64;b++){const i=((y+a)*w+x+b)*4;if(Math.max(...[0,1,2].map(k=>Math.abs(full[i+k]-blank[i+k])))>20)count++;}if(count>best.count)best={count,x,y};}
    const bg=new Uint8Array(64*64*4);for(let y=0;y<64;y++)bg.set(blank.subarray(((best.y+y)*w+best.x)*4,((best.y+y)*w+best.x+64)*4),y*64*4);
    window.__nativePixels=[];window.__removeNativePixels=v.scene.postRender.addEventListener(()=>{
     const b=new Uint8Array(bg.length);gl.readPixels(best.x,best.y,64,64,gl.RGBA,gl.UNSIGNED_BYTE,b);let count=0;for(let i=0;i<b.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(b[i+k]-bg[i+k])))>20)count++;window.__nativePixels.push({count,active:v.residentPlaybackActive});
    });return best;
   });
   for(let i=0;i<20;i++){const enabled=i%2===1;await page.locator('#vfx-smooth-playback').setChecked(enabled);await page.evaluate(()=>window.__chronoscope.sceneIdle());await page.waitForFunction(e=>window.__chronoscope.view.residentPlaybackActive===e,enabled);await page.waitForTimeout(50);}
   result={roi:result,frames:await page.evaluate(()=>{window.__removeNativePixels();return window.__nativePixels;})};
  }
  else if(r.command==='idle')result=await page.evaluate(async()=>{const c=window.__chronoscope;await c.filterIdle();await c.sceneIdle();return true;});
  else if(r.command==='toggle') {await page.locator('#vfx-smooth-playback').setChecked(r.arguments.enabled);await page.evaluate(()=>window.__chronoscope.sceneIdle());result=true;}
  else if(r.command==='play')result=await page.evaluate(async action=>{const c=window.__chronoscope;if(c.view.playback!==(action==='play'))await c.liveViewRequest('view_playback',{action});await c.filterIdle();await c.sceneIdle();return true;},r.arguments.action);
  else if(r.command==='attach')result=await page.evaluate(()=>{
   window.__soakHealth={frames:0,unreadyFrames:0,errors:[],cancellations:[],preparations:[]};
   const v=window.__chronoscope.view,old=v.beginResidentPlayback;
   v.beginResidentPlayback=async function(...args){const start=performance.now();try{const result=await old.apply(this,args);window.__soakHealth.preparations.push({ms:performance.now()-start,accepted:result});return result;}catch(e){if(e?.name==='AbortError'||/stale|revision|cancelled/i.test(String(e)))window.__soakHealth.cancellations.push(String(e));else window.__soakHealth.errors.push(String(e));throw e;}};
   v.scene.postRender.addEventListener(()=>{const h=window.__soakHealth,r=v.resident;h.frames++;if(r && (!r.primitives.every(p=>p.ready)|| (r.lines&&!r.lines.ready)))h.unreadyFrames++;});
   return true;
  });
  else if(r.command==='heat')result=await page.evaluate(async()=>{
   const c=window.__chronoscope;await c.refresh(false);await c.sceneIdle();const p=c.view.displayLayer.packet;
   if(!p)throw Error('Weighted heatmap packet missing');
   const exact=await c.call('display_data',{level:p.level,time_bin_minutes:0,partition:'all',weight:'value',max_cells:4000,flat:false});
   return {equal:JSON.stringify(p.bins)===JSON.stringify(exact.bins),actual_cells:p.bins.length,expected_cells:exact.bins.length,error:c.view.diagnostics().effectError};
  });
  else if(r.command==='health')result={...await page.evaluate(()=>window.__soakHealth),browserErrors:[...browserErrors]};
  else if(r.command==='ready') {
   await page.waitForFunction(()=>!window.__chronoscope.busy);
   if(r.arguments.improved)await page.evaluate(()=>{const c=window.__chronoscope,v=c.view;window.__labExpected=true;window.__residentEnds=[];const old=v.endResidentPlayback;v.endResidentPlayback=function(...args){if(this.resident)window.__residentEnds.push({stack:new Error().stack,profile:this.resourceGovernor.diagnostics(),filter:c.snapshot.filter,scene:c.snapshot.scene,at:performance.now()});return old.apply(this,args);};});
   if(r.arguments.improved)await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:45000});
   await page.evaluate(()=>window.__chronoscope.sceneIdle());result=true;
  } else if(r.command==='state')result=await page.evaluate(()=>({playing:window.__chronoscope.view.playback,label:document.querySelector('#vfx-playback-state').textContent,reason:window.__chronoscope.view.residentPlaybackReason(),preferences:window.__chronoscope.snapshot.preferences,scene:window.__chronoscope.snapshot.scene,diag:window.__chronoscope.view.diagnostics()}));
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
   return {count:exact.ids.length,drawn:c.view.points.length,limited:!!c.view.renderLOD,summaryOnly:c.view.display.mode==='heatmap'&&!c.view.display.show_points&&!c.view.display.show_tracks&&!c.view.display.show_trails&&c.view.displayLayer.active,unique:new Set(c.view.points.map(p=>p.id)).size===c.view.points.length,subset:c.view.points.every(p=>ids.has(p.id)),equal:c.view.points.length===exact.ids.length};
  });
  else if(r.command==='close'){await browser.close();process.stdout.write(JSON.stringify({id:r.id,result:true})+'\n');break;}
  else throw Error('Unknown command '+r.command);
  process.stdout.write(JSON.stringify({id:r.id,result})+'\n');
 } catch(error){process.stdout.write(JSON.stringify({id:r.id,error:String(error)})+'\n');}
}
