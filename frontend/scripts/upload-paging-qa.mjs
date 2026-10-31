import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';
await withLocalApp('upload-paging',async({page,api,out,pass})=>{
 const csv=path.join(out,'one-entity.csv');
 fs.writeFileSync(csv,'entity,timestamp,latitude,longitude\n'+Array.from({length:20000},(_,i)=>
  `one,${new Date(Date.UTC(2026,0,1)+i*1000).toISOString()},${30+Math.floor(i/200)*.01},${-80+(i%200)*.01}`).join('\n'));
 const ticket=await api('import_preview',{path:csv});await api('import_commit',{import_id:ticket.import_id,append:false});
 await api('select',{ids:[]});await api('filter',{filter:{start:null,end:null}});
 const changed=await api('view_set',{mode:'map',fit:true,display:{mode:'points',show_points:true,show_tracks:false,show_trails:false,point_scale:.65,bloom:false,spatial_culling:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},changed.scene);
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
 const picks=await page.evaluate(async()=>{
  const v=window.__chronoscope.view;await v.screenshot();
  const points=v.resident.visiblePoints().sort((a,b)=>a.time-b.time);
  return {diagnostics:v.resident.diagnostics(),hits:[500,8191,8192,12000,19900].map(i=>{
   const p=points[i],xy=v.projectEvent(p.id);return {index:i,expected:p.id,actual:xy?v.pickId(xy.x,xy.y):null};
  })};
 });
 assert.equal(picks.diagnostics.pointCount,20000);assert(picks.diagnostics.uploadBatches>=3);assert(picks.diagnostics.largestUploadVertices<=8192);
 for(const hit of picks.hits)assert.deepEqual(hit.actual,{kind:'event',id:hit.expected},JSON.stringify(hit));
 pass('One entity spanning multiple point-upload pages remains exactly GPU-pickable on both sides of page boundaries');
 await page.evaluate(()=>{
  const c=window.__chronoscope,v=c.view;window.__allowUpload=true;window.__uploadOld=v.resident;window.__primitiveCount=v.scene.primitives.length;
  window.__pendingUpload=v.beginResidentPlayback([...v.resident.byId.values()],[...v.names],c.snapshot.time_bounds,()=>window.__allowUpload,c.snapshot.revision);
 });
 await page.waitForFunction(()=>{const p=window.__chronoscope.view.pendingResident;return p?.primitives.some(x=>x.ready)&&p.uploads.length>0;});
 const canceled=await page.evaluate(async()=>{
  window.__allowUpload=false;const accepted=await window.__pendingUpload,v=window.__chronoscope.view;
  return {accepted,before:window.__primitiveCount,after:v.scene.primitives.length,oldRetained:v.resident===window.__uploadOld,pending:!!v.pendingResident,ready:v.resident.primitives.every(p=>p.ready)};
 });
 assert.equal(canceled.accepted,false);assert.equal(canceled.before,canceled.after);assert(canceled.oldRetained&&canceled.ready&&!canceled.pending);
 pass('Cancellation after a real GPU page upload releases installed and queued pages while retaining the ready old drawing');
 fs.writeFileSync(path.join(out,'details.json'),JSON.stringify({picks,canceled},null,2));
});
