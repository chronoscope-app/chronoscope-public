import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("resident-references", async ({page,api,out,pass})=>{
  const file=path.join(out,"references.csv");
  fs.writeFileSync(file,"entity,timestamp,latitude,longitude,altitude_m,altitude_reference\n"+[
    "zero,2026-01-01,0,0,0,ellipsoid",
    "egm,2026-01-02,0,0,1000,egm96",
    "rocket,2026-01-03,1,1,250000,reported",
    "unknown,2026-01-04,46.5,10.5,3000,unspecified",
    "missing,2026-01-05,46.5,10.6,,",
  ].join("\n"));
  const preview=await api("import_preview",{path:file});
  await api("import_commit",{import_id:preview.import_id,append:false});
  await api("select",{ids:[]});
  await api("filter",{filter:{start:null,end:null}});
  async function scene(extra={}){
    const r=await api("view_set",{mode:"globe",fit:true,globe_time:false,globe_altitude:false,
      display:{mode:"points",show_points:true,show_tracks:true,show_trails:true,bloom:false,spatial_culling:false},...extra});
    await page.evaluate(async s=>{const c=window.__chronoscope;await c.restoreScene(s);await c.refresh();await c.sceneIdle();},r.scene);
    await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
  }
  await scene({globe_altitude:true});
  const altitude=await page.evaluate(()=>{
    const v=window.__chronoscope.view;
    return {points:v.points,drawn:v.renderPoints.map(p=>({point:p,position:v.resident.pointPosition(p.id)})),
      omitted:v.diagnostics().altitude,unknown:v.points.filter(p=>!v.renderPoints.some(q=>q.id===p.id)).map(p=>v.projectEvent(p.id))};
  });
  assert.equal((await api("snapshot",{compact:true})).count,5);
  assert.equal(altitude.points.length,3);assert.equal(altitude.drawn.length,3);
  assert(altitude.unknown.every(p=>p===null));
  function ecef(lat,lon,h){
    lat*=Math.PI/180;lon*=Math.PI/180;
    const e2=6.6943799901413165e-3,n=6378137/Math.sqrt(1-e2*Math.sin(lat)**2);
    return [(n+h)*Math.cos(lat)*Math.cos(lon),(n+h)*Math.cos(lat)*Math.sin(lon),(n*(1-e2)+h)*Math.sin(lat)];
  }
  for(const {point:p,position} of altitude.drawn){
    const h=p.altitude.meters+(p.altitude.reference==="egm96"?17.16:0),expected=ecef(p.lat,p.lon,h);
    for(const [i,k] of ["x","y","z"].entries())assert(Math.abs(position[k]-expected[i])<.006);
  }
  await page.evaluate(async()=>{const c=window.__chronoscope;await c.select(c.view.points.map(p=>p.id));await c.sceneIdle();});
  assert.equal(await page.evaluate(()=>window.__chronoscope.view.resident.diagnostics().selectedCount),3);
  const unresolved=await page.evaluate(async()=>{
    const v=window.__chronoscope.view,points=[...v.points],names=[...v.names],prepare=v.resources.prepareAltitude,geoid=v.resources.altitudeGeoid;
    try {
      v.resources.prepareAltitude=async()=>{};v.resources.altitudeGeoid=undefined;
      await v.beginResidentPlayback(points,names,[v.lo,v.hi]);v.residentPlaybackWindow(v.lo,v.hi,true);
      return {source:v.points.length,drawn:v.renderPoints.map(p=>p.altitude.reference)};
    } finally {
      v.resources.prepareAltitude=prepare;v.resources.altitudeGeoid=geoid;
      await v.beginResidentPlayback(points,names,[v.lo,v.hi]);v.residentPlaybackWindow(v.lo,v.hi,true);
    }
  });
  assert.equal(unresolved.source,3);assert.deepEqual(unresolved.drawn.sort(),["ellipsoid","reported"]);
  pass("Prepared altitude retains engine membership, omits unknown heights and preserves independent WGS84/EGM96 controls");
  await api("select",{ids:[]});
  const snapshot=await api("snapshot",{compact:true}),[lo,hi]=snapshot.time_bounds;
  await api("filter",{filter:{start:lo+(hi-lo)*.2,end:lo+(hi-lo)*.8}});
  await scene({globe_time:true});
  const box=await page.locator("#time-range-window").boundingBox();
  await page.mouse.move(box.x+Math.min(6,box.width/2),box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+Math.min(6,box.width/2),box.y+box.height/2+12);await page.mouse.up();
  async function frame(){
    await page.evaluate(async()=>{const c=window.__chronoscope;await c.filterIdle();await c.sceneIdle();});
    await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
    const state=await page.evaluate(()=>{
      const c=window.__chronoscope,v=c.view;
      return {bounds:[v.lo,v.hi],expected:c.snapshot.time_bounds,
        errors:v.renderPoints.map(p=>{const a=v.resident.pointPosition(p.id),b=v.pos(p);return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}),count:v.renderPoints.length,prepared:v.resident.pointCount};
    });
    assert.deepEqual(state.bounds,state.expected);assert.equal(state.prepared,5);
    assert(state.errors.every(x=>x<1e-6),JSON.stringify(state));return state;
  }
  await api("filter",{filter:{start:lo,end:lo+(hi-lo)*.55}});
  await page.evaluate(async()=>{const c=window.__chronoscope;await c.refresh();await c.sceneIdle();});
  const scrub=await frame();
  await page.evaluate(()=>window.__chronoscope.liveViewRequest("view_playback",{action:"play"}));
  await page.waitForTimeout(1000);
  await page.evaluate(()=>window.__chronoscope.liveViewRequest("view_playback",{action:"pause"}));
  const paused=await frame();
  pass("Globe time elevation preserves its full-study axis and canonical geographic height scale after filtering and pause");
  await api("filter",{filter:{start:null,end:null}});
  const prefs=await api("preferences");
  await api("preferences",{preferences:{...prefs,terrain_builtin:true,terrain_path:null,terrain_exaggeration:2,terrain_vertical_datum:"egm96"}});
  await scene();
  await page.evaluate(async()=>{const c=window.__chronoscope;await c.rebuildTerrain();await c.refresh();await c.sceneIdle();});
  await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive && window.__chronoscope.view.diagnostics().terrain.terrainActive);
  const ground=await page.evaluate(async()=>{
    const c=window.__chronoscope,v=c.view,points=v.renderPoints,coordinates=points.map(p=>[p.lon,p.lat]);
    const r=await c.call("terrain_sample",{longitude:coordinates[0][0],latitude:coordinates[0][1],coordinates});
    return points.map((p,i)=>({lat:p.lat,lon:p.lon,sample:r.elevations_m[i],geoid:v.resources.altitudeHeight({...p,altitude:{meters:0,reference:"egm96"}}),position:v.resident.pointPosition(p.id)}));
  });
  assert(ground.some(p=>p.sample>100));
  for(const p of ground){
    const expected=ecef(p.lat,p.lon,(p.sample??0)*2+(p.sample===null?0:p.geoid)+2);
    for(const [i,k] of ["x","y","z"].entries())assert(Math.abs(p.position[k]-expected[i])<.01,JSON.stringify(p));
  }
  pass("Prepared ground positions preserve sampled terrain, exaggeration and EGM96 references");
  fs.writeFileSync(path.join(out,"references.json"),JSON.stringify({altitude,scrub,paused,ground},null,2));
});
