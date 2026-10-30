import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';
await withLocalApp('prepared-handoffs',async({page,api,root,out,pass})=>{
 await api('open',{path:path.resolve(root,'../chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope')});
 const s=await api('snapshot',{compact:true}),[lo,hi]=s.time_bounds;
 await api('filter',{filter:{start:lo,end:lo+(hi-lo)*.2}});
 const change=await api('view_set',{mode:'map',fit:true,display:{mode:'points',show_points:true,show_tracks:false,show_trails:false,spatial_culling:false,bloom:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},change.scene);
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
 // Hold altitude preparation during the reverse handoff. The old renderer must
 // remain present until replacement data is ready to be committed.
 await page.evaluate(()=>{
  const c=window.__chronoscope,v=c.view,old=v.resources.prepareAltitude.bind(v.resources);
  window.__oldResident=v.resident;
  window.__releaseAltitude=null;
  let held=false;
  v.resources.prepareAltitude=async(...args)=>{if(!held){held=true;await new Promise(r=>window.__releaseAltitude=r);}return old(...args);};
  window.__restoreAltitude=()=>v.resources.prepareAltitude=old;
  window.__handoff=c.refresh(true,false,true);
 });
 await page.waitForFunction(()=>!!window.__releaseAltitude);
 assert(await page.evaluate(()=>window.__chronoscope.view.resident===window.__oldResident));
 await page.evaluate(async()=>{window.__restoreAltitude();window.__releaseAltitude();await window.__handoff;});
 pass('Canonical replacement retains the prepared renderer through delayed altitude preparation');
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
 const roi=await page.evaluate(async()=>{
  const v=window.__chronoscope.view,gl=v.viewer.canvas.getContext('webgl2');
  const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
  const read=()=>{const b=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
  const objects=[v.glyphs,v.triangles,v.arrivingPoints,v.arrivingTriangles,v.selections,v.fading,...v.resident.primitives];
  const visibility=objects.map(o=>o.show);objects.forEach(o=>o.show=false);await v.screenshot();const blank=read();
  objects.forEach((o,i)=>o.show=visibility[i]);await v.screenshot();const full=read();
  let best={count:0,x:0,y:0};
  for(let y=0;y<h-64;y+=64)for(let x=0;x<w-64;x+=64){let count=0;for(let a=0;a<64;a++)for(let b=0;b<64;b++){const i=((y+a)*w+x+b)*4;if(Math.max(...[0,1,2].map(k=>Math.abs(full[i+k]-blank[i+k])))>20)count++;}if(count>best.count)best={count,x,y};}
  const bg=new Uint8Array(64*64*4);for(let y=0;y<64;y++)bg.set(blank.subarray(((best.y+y)*w+best.x)*4,((best.y+y)*w+best.x+64)*4),y*64*4);
  window.__pixelFrames=[];
  window.__removePixels=v.scene.postRender.addEventListener(()=>{
   const b=new Uint8Array(bg.length);gl.readPixels(best.x,best.y,64,64,gl.RGBA,gl.UNSIGNED_BYTE,b);
   let count=0;for(let i=0;i<b.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(b[i+k]-bg[i+k])))>20)count++;
   window.__pixelFrames.push({count,resident:v.residentPlaybackActive,ready:v.resident?.primitives.every(p=>p.ready)??null});
  });
  return best;
 });
 assert(roi.count>30,JSON.stringify(roi));
 for(let i=0;i<20;i++){
  const enabled=i%2===1;
  await page.locator('#vfx-smooth-playback').setChecked(enabled);
  await page.evaluate(()=>window.__chronoscope.sceneIdle());
  await page.waitForFunction(e=>window.__chronoscope.view.residentPlaybackActive===e,enabled);
  await page.waitForTimeout(50);
 }
 const frames=await page.evaluate(()=>{window.__removePixels();return window.__pixelFrames;});
 fs.writeFileSync(path.join(out,'pixels.json'),JSON.stringify({roi,frames},null,2));
 assert(frames.length>20);
 assert.equal(frames.filter(f=>f.count<10).length,0,'Blank event pixels during a handoff');
 assert.equal(frames.filter(f=>f.ready===false).length,0,'Resident exposed before GPU readiness');
 pass(`${frames.length} actual framebuffer samples across 20 renderer handoffs contain event pixels`);
 await page.screenshot({path:path.join(out,'handoffs.png')});
 await page.locator('#vfx-smooth-playback').setChecked(false);
 await page.evaluate(()=>window.__chronoscope.sceneIdle());
 const canceled=await page.evaluate(async()=>{
  const v=window.__chronoscope.view,before=v.scene.primitives.length;
  const pending=v.beginResidentPlayback([...v.points],[...v.names],[v.lo,v.hi]);
  setTimeout(()=>v.rebuild(true),0);
  const accepted=await pending;
  return {accepted,before,after:v.scene.primitives.length,resident:v.residentPlaybackActive};
 });
 assert.equal(canceled.accepted,false);assert.equal(canceled.resident,false);assert.equal(canceled.before,canceled.after);
 pass('Canceled GPU preparation leaves no resident renderer or orphan primitives');
 const timeScene=await api('view_set',{mode:'space-time',fit:true});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},timeScene.scene);
 const timeCancel=await page.evaluate(async()=>{
  const c=window.__chronoscope,v=c.view,before=[v.lo,v.hi];let accepted=true;
  const pending=v.beginResidentPlayback([...v.points],[...v.names],c.snapshot.time_bounds,()=>accepted);
  setTimeout(()=>accepted=false,0);
  return {result:await pending,before,after:[v.lo,v.hi]};
 });
 assert.equal(timeCancel.result,false);assert.deepEqual(timeCancel.after,timeCancel.before);
 pass('Canceling Time-view preparation preserves the stopped time-axis bounds');
 const disposed=await page.evaluate(async()=>{
  const v=window.__chronoscope.view,pending=v.beginResidentPlayback([...v.points],[...v.names],[v.lo,v.hi]);
  setTimeout(()=>v.dispose(),0);
  return await pending;
 });
 assert.equal(disposed,false);
 pass('Disposing the renderer during preparation cancels without touching a destroyed scene');
});
