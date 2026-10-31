import assert from 'node:assert/strict';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';

await withLocalApp('playback-recovery',async({page,api,root,pass})=>{
 await api('open',{path:path.join(root,'samples/starlink-128-predicted-orbits-2024.chronoscope')});
 const s=await api('snapshot',{compact:true}),[lo,hi]=s.time_bounds;
 await api('filter',{filter:{start:lo,end:lo+(hi-lo)*.2}});
 const changed=await api('view_set',{mode:'globe',fit:true,globe_altitude:true,display:{mode:'points',show_points:true,show_tracks:true,show_trails:false,bloom:false,spatial_culling:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},changed.scene);
 await page.evaluate(()=>{
  const v=window.__chronoscope.view, original=v.beginResidentPlayback;
  window.__transientPreparationFailures=0;
  v.beginResidentPlayback=async function(...args){
   if(!window.__transientPreparationFailures++) throw Error('CONFLICT: revision changed during scene configuration');
   return original.apply(this,args);
  };
 });
 await page.locator('#vfx-smooth-playback').setChecked(false);
 await page.evaluate(()=>window.__chronoscope.sceneIdle());
 await page.locator('#vfx-smooth-playback').setChecked(true);
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});
 assert(await page.evaluate(()=>window.__transientPreparationFailures>=2));
 pass('A transient revision conflict retries preparation without reopening the workspace');
 await page.evaluate(async()=>{const c=window.__chronoscope;await c.liveViewRequest('view_playback',{action:'configure',speed:1,increment_seconds:60,fade_amount:50});await c.liveViewRequest('view_playback',{action:'play'});});
 await page.locator('[data-view="map"]').click();
 await page.waitForFunction(()=>window.__chronoscope.view.mode==='map' && window.__chronoscope.view.playback && window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});
 await page.waitForTimeout(1500);
 const result=await page.evaluate(()=>({playing:window.__chronoscope.view.playback,active:window.__chronoscope.view.residentPlaybackActive,diagnostics:window.__chronoscope.view.diagnostics()}));
 assert(result.playing && result.active);assert.equal(result.diagnostics.renderErrorCount,0);
 pass('Playback resumes prepared graphics after a Globe-to-Map transition');
 await page.locator('[data-view="space-time"]').click();
 await page.waitForFunction(()=>window.__chronoscope.view.mode==='space-time' && window.__chronoscope.view.playback && window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});
 await page.locator('[data-view="globe"]').click();
 await page.locator('[data-view="map"]').click();
 await page.waitForFunction(()=>window.__chronoscope.view.mode==='map' && window.__chronoscope.view.playback && window.__chronoscope.view.residentPlaybackActive,null,{timeout:60000});
 pass('Time and rapid view changes recover the final prepared renderer');
 await page.evaluate(async()=>{const c=window.__chronoscope;await c.liveViewRequest('view_playback',{action:'pause'});await c.filterIdle();await c.sceneIdle();});
 const exact=await api('render_data',{max_points:100000});const ids=await page.evaluate(()=>window.__chronoscope.view.points.map(p=>p.id));assert.deepEqual(ids.slice().sort(),exact.ids.slice().sort());
 pass('Pause after recovery retains exact visible event membership');
});
