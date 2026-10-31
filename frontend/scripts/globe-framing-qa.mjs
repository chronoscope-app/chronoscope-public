import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';

await withLocalApp('globe-framing',async({page,api,out,pass})=>{
 await api('demo');const records=await api('query',{limit:2,fields:['id']});await api('select',{ids:records.events.map(p=>p.id)});
 const change=await api('view_set',{mode:'globe',fit:true,display:{mode:'points',show_points:true,show_tracks:false,show_trails:false,bloom:false,spatial_culling:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},change.scene);
 const evidence=[];
 const pose=async(lon=-80,lat=20,range=25000000,heading=135,tilt=65)=>page.evaluate(({lon,lat,range,heading,tilt})=>{const v=window.__chronoscope.view;v.lookAtGeographic([lon,lat,0],range,heading,tilt);v.viewer.render();},{lon,lat,range,heading,tilt});
 const state=()=>page.evaluate(()=>{
  const c=window.__chronoscope,v=c.view,p=v.camera.positionWC,w=v.host.clientWidth,h=v.host.clientHeight;
  v.viewer.render();const origin=v.scene.cartesianToCanvasCoordinates({x:0,y:0,z:0});
  const planes=v.camera.frustum.computeCullingVolume(v.camera.positionWC,v.camera.directionWC,v.camera.upWC).planes;
  return {origin:origin?{x:origin.x,y:origin.y}:null,viewport:[w,h],distance:Math.hypot(p.x,p.y,p.z),bearing:v.bearing(),tilt:v.tilt(),range:v.navigationDistance(),focus:(()=>{const p=v.centerGround();return [p.x,p.y,p.z];})(),centerHit:!!v.camera.pickEllipsoid({x:w/2,y:h/2}),sideDistances:planes.slice(0,4).map(p=>p.w),count:c.snapshot.count,selected:[...c.snapshot.selected],filter:c.snapshot.filter,renderErrors:v.diagnostics().renderErrorCount};
 });
 const canvas=page.locator('.cesium-widget canvas');
 for(const viewport of [{width:1200,height:1000},{width:2000,height:1000}]){
 await page.setViewportSize(viewport);await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__chronoscope.view.viewer.resize();});
 for(const control of ['n','Home']){
  await pose();const before=await state();await(control==='n'?canvas:page.locator('.navigation-sphere')).focus();await page.keyboard.press(control);const after=await state();
  assert(after.origin);assert(Math.hypot(after.origin.x-after.viewport[0]/2,after.origin.y-after.viewport[1]/2)<2,JSON.stringify({control,after}));
  assert(Math.min(after.bearing,360-after.bearing)<.02,JSON.stringify(after));
  assert(Math.abs(after.distance-before.distance)<1,'North recenter changed orbital zoom');assert.equal(after.count,before.count);assert.deepEqual(after.filter,before.filter);assert.deepEqual(after.selected,before.selected);
  evidence.push({control,before,after});
 }
 }
 pass('N and compass Home recenter an Earth overview facing north without changing orbital zoom, records, selection or filters');
 for(const [lon,lat] of [[-80,20],[179,80],[-179,-80],[0,0]]){
  await pose(lon,lat,25000000,45,20);const before=await state();
  // Valid legacy/saved poses can aim past Earth; exercise the real camera
  // render constraint, rather than only the explicit reset action.
  await page.evaluate(antipodal=>{const v=window.__chronoscope.view;if(antipodal)v.lookAtGeographic([0,0,0],25000000,0,0);v.camera.lookRight(antipodal?Math.PI:.95);v.viewer.render();},lon===0&&lat===0);
  const after=await state();assert(after.sideDistances.every(d=>d>=0),JSON.stringify(after));if(lon!==0||lat!==0)assert(Math.abs(after.distance-before.distance)<1);assert.equal(after.renderErrors,0);evidence.push({legacyPose:[lon,lat],before,after});
 }
 pass('An overview globe center stays inside the viewport after an off-screen pose, including date-line and polar views');
 await pose(-80,20,14000000,0,80);const oblique=await state();assert(Math.abs(oblique.tilt-80)<.02,JSON.stringify(oblique));evidence.push({partlyClippedOblique:oblique});
 await pose(-80,20,25000000,0,0);const before=await state();
 const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.61,box.y+box.height*.55);
 for(let i=0;i<36;i++){await page.mouse.wheel(80,40);if(i%6===0)await page.waitForTimeout(20);}
 for(let i=0;i<16;i++){
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:5});await page.mouse.up();
 }
 const after=await state();assert(after.sideDistances.every(d=>d>=0),JSON.stringify(after));assert.equal(after.renderErrors,0);assert.equal(after.count,before.count);assert.deepEqual(after.filter,before.filter);evidence.push({wheelAndDrags:{before,after}});
 await pose();await page.locator('#navigation-zoom').focus();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.wheel(0,50);await page.keyboard.press('n');
 const wheelNorth=await state();assert(await canvas.evaluate(c=>document.activeElement===c));assert(Math.hypot(wheelNorth.origin.x-wheelNorth.viewport[0]/2,wheelNorth.origin.y-wheelNorth.viewport[1]/2)<2);evidence.push({wheelNorth});
 // North must also recover from a close saved camera looking into the sky.
 await pose(-80,20,4000,100,35);await page.evaluate(()=>{const v=window.__chronoscope.view;v.camera.lookUp(1.4);v.viewer.render();});await canvas.focus();await page.keyboard.press('n');const recovered=await state();assert(recovered.centerHit);assert(Math.min(recovered.bearing,360-recovered.bearing)<.02);evidence.push({closeRecovery:recovered});
 pass('Repeated wheel/drag input keeps the overview reachable; wheel focuses the map for N, which also recovers a close camera aimed at the sky');
 await pose(-80,20,4000,100,35);const regionalBefore=await state();await canvas.focus();await page.keyboard.press('n');const regionalAfter=await state();assert(Math.abs(regionalAfter.tilt-regionalBefore.tilt)<.02);assert(Math.abs(regionalAfter.range-regionalBefore.range)<.02);assert(Math.hypot(...regionalAfter.focus.map((n,i)=>n-regionalBefore.focus[i]))<.02);evidence.push({regionalBefore,regionalAfter});
 pass('Regional North preserves the current ground focus, tilt and zoom');
 await pose();await canvas.focus();await page.keyboard.press('n');await page.screenshot({path:path.join(out,'globe-framing.png')});fs.writeFileSync(path.join(out,'details.json'),JSON.stringify(evidence,null,2));
});
