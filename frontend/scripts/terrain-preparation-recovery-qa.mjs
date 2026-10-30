import assert from 'node:assert/strict';
import path from 'node:path';
import {withLocalApp} from './local-browser.mjs';
await withLocalApp('terrain-preparation-recovery',async({page,api,root,pass})=>{
 await api('open',{path:path.join(root,'samples/animal-gps-black-rock-forest-2023-03.chronoscope')});
 const prefs=await api('preferences');await api('preferences',{preferences:{...prefs,terrain_builtin:true,terrain_path:null,terrain_vertical_datum:'egm96'}});
 const changed=await api('view_set',{mode:'globe',fit:true,globe_time:false,globe_altitude:false,display:{mode:'points',spatial_culling:false,show_points:true,show_tracks:true,show_trails:false,bloom:false}});
 await page.evaluate(async scene=>{const c=window.__chronoscope;await c.restoreScene(scene);await c.refresh();await c.sceneIdle();},changed.scene);
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive);
 await page.locator('#vfx-smooth-playback').setChecked(false);await page.evaluate(()=>window.__chronoscope.sceneIdle());
 await page.evaluate(()=>{const v=window.__chronoscope.view,old=v.beginResidentPlayback;window.__restoreBegin=()=>v.beginResidentPlayback=old;window.__failedPrep=false;v.beginResidentPlayback=async()=>{window.__failedPrep=true;throw Error('Terrain source not ready yet');};});
 await page.locator('#vfx-smooth-playback').setChecked(true);
 await page.waitForFunction(()=>window.__failedPrep);await page.waitForTimeout(100);
 await page.evaluate(async()=>{const c=window.__chronoscope;window.__restoreBegin();await c.view.setTerrain(null);await c.rebuildTerrain();await c.sceneIdle();});
 await page.waitForFunction(()=>window.__chronoscope.view.residentPlaybackActive,null,{timeout:5000});
 assert(await page.evaluate(()=>window.__chronoscope.view.diagnostics().terrain.terrainActive));
 pass('Newly installed terrain retries a preparation blocked by an earlier failure');
});
