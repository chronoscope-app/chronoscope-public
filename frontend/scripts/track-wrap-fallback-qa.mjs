import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';

await withLocalApp('track-wrap-fallback',async({page,api,out,pass})=>{
 const csv=path.join(out,'wide-timed-track.csv');
 fs.writeFileSync(csv,'entity,timestamp,latitude,longitude\nA,2026-01-01,10,-10\nA,2026-01-02,10,-11\nA,2026-01-10,30,-110\n');
 const ticket=await api('import_preview',{path:csv});await api('import_commit',{import_id:ticket.import_id,append:false});
 const s=await api('snapshot',{compact:true}),[lo,hi]=s.time_bounds;
 await api('filter',{filter:{start:lo,end:lo+86400}});
 const changed=await api('view_set',{mode:'space-time',fit:true,display:{mode:'points',show_points:true,show_tracks:true,show_trails:false,trail_gap_minutes:0,spatial_culling:false,bloom:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},changed.scene);
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
 assert.equal(await page.evaluate(()=>window.__chronoscope.view.resident.diagnostics().pointCount),2);
 const playing=await page.evaluate(async()=>{
  const c=window.__chronoscope;await c.liveViewRequest('view_playback',{action:'configure',speed:.25,increment_seconds:86400});
  await c.liveViewRequest('view_playback',{action:'play'});
  return {playing:c.view.playback,resident:c.view.residentPlaybackActive,diagnostics:c.view.diagnostics()};
 });
 fs.writeFileSync(path.join(out,'playing.json'),JSON.stringify(playing,null,2));
 assert(playing.playing);assert.equal(playing.resident,false,'A failed full-study replacement must not keep its old two-event subset active');
 pass('Time playback switches safely from an eligible stopped window to canonical rendering when full-study raw track wrapping is unsupported');
 await page.waitForTimeout(1200);
 await page.evaluate(async()=>{const c=window.__chronoscope;await c.liveViewRequest('view_playback',{action:'pause'});await c.filterIdle();await c.sceneIdle();});
 const exact=await api('render_data',{max_points:100000});const actual=await page.evaluate(()=>window.__chronoscope.view.points.map(p=>p.id));assert.deepEqual(actual.slice().sort(),exact.ids.slice().sort());
 const final=await page.evaluate(()=>window.__chronoscope.view.diagnostics());assert.equal(final.renderErrorCount,0);
 pass('Fallback playback/pause retains exact engine IDs and never installs geometry with invalid longitude-split attributes');
 fs.writeFileSync(path.join(out,'details.json'),JSON.stringify({playing,final,ids:actual,bounds:[lo,hi]},null,2));
});
