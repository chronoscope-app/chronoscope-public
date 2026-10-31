import { withLocalApp } from "./local-browser.mjs";
import assert from "node:assert/strict";
import path from "node:path";

await withLocalApp("kabr-demo", async ({page,api,out,pass}) => {
  const demo=(await api("demo_catalog")).demos.find(d=>d.id==="kabr-uav");
  assert(demo);assert.equal(demo.previews.length,2);
  await page.locator("#help").click();
  await page.locator("#demo-datasets").click();
  const previews=page.locator('[data-demo-preview="kabr-uav"]');
  await previews.first().waitFor();
  assert.equal(await previews.count(),2);
  for (const image of await previews.locator("img").all()) {
    await image.evaluate(async image=>{await image.decode();if(image.naturalWidth!==480 || image.naturalHeight!==300) throw Error("Missing UAV thumbnail");});
  }
  await page.keyboard.press("Escape");
  pass("Gallery presents exactly two working UAV thumbnails");
  await page.evaluate(async()=>{
    const c=window.__chronoscope;
    const opened=await c.call("demo_open",{id:"kabr-uav"});
    await c.restoreScene(opened.scene);
  });
  await page.waitForFunction(()=>window.__chronoscope.snapshot.count===25924 && !window.__chronoscope.busy);
  let snapshot=await api("snapshot");
  assert.equal(snapshot.visible,7189);assert.equal(snapshot.layers.length,1);
  assert.equal(snapshot.scene.mode,"globe");assert(snapshot.scene.globe_altitude);
  await page.waitForFunction(()=>window.__chronoscope.view.points.length===7189);
  let state=await page.evaluate(()=>{
    const v=window.__chronoscope.view;
    return {diagnostics:v.diagnostics(),heights:v.points.map(p=>v.resources.altitudeHeight(p))};
  });
  assert.equal(state.diagnostics.renderErrorCount,0);
  assert(Math.abs(Math.max(...state.heights)-54.8)<.001);
  assert(state.heights.some(h=>h===0));
  assert.match(await page.locator(".measurement-legend").innerText(),/Height above takeoff/);
  assert.equal(await page.locator("[data-layer-source]").count(),1);
  await page.screenshot({path:path.join(out,"globe-height-above-takeoff.png")});
  pass("One layer opens on January 12 only, with labelled relative Globe heights and zero-height endpoints");
  const restore=async index=>{
    await page.evaluate(async index=>{
      const c=window.__chronoscope,r=await c.call("restore_view",{index});await c.restoreScene(r.scene);
    },index);
    await page.waitForFunction(()=>!window.__chronoscope.busy);
  };
  await restore(0);
  state=await page.evaluate(()=>{
    const v=window.__chronoscope.view;return {mode:v.mode,altitude:v.globeAltitude,lo:v.lo,hi:v.hi,errors:v.diagnostics().renderErrorCount};
  });
  assert.equal(state.mode,"space-time");assert.equal(state.altitude,false);
  assert.equal(state.hi-state.lo,719);assert.equal(state.errors,0);
  await page.screenshot({path:path.join(out,"time-single-flight.png")});
  pass("Time saved view shows the original 719-second UTC window separately from physical height");
  for (const [index,count] of [[2,6240],[3,12495],[4,25924],[1,7189]]) {
    await restore(index);snapshot=await api("snapshot");
    assert.equal(snapshot.count,25924);assert.equal(snapshot.visible,count);assert.equal(snapshot.layers.length,1);
  }
  pass("Saved views switch between all three original flight dates without dropping records");
  const row=(await api("events",{id:"6241"})).events[0];
  assert.equal(row.attrs.source_file,"Jan-12th-2023-02-37PM-Flight-Airdata.csv");
  assert(row.attrs.reported_amsl_m);assert(row.note.includes("above takeoff"));
  pass("Inspector data retains original file, separate AMSL altitude, and explicit height interpretation");
});
