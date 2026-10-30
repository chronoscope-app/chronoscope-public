import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("resource-pressure", async ({ page, api, out, pass }) => {
  const rows = ["entity,timestamp,latitude,longitude,value"];
  for (let i = 0; i < 12000; i++) rows.push(`Track ${i % 40},${new Date(Date.UTC(2026, 9, 29) + Math.floor(i / 40) * 1000).toISOString()},${40 + (i % 40) * .005},${-74 + Math.floor(i / 40) * .001},${i}`);
  const file = path.join(out, "pressure-fixture.csv"); fs.writeFileSync(file, rows.join("\n"));
  const preview = await api("import_preview", { path: file });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", { mode: "globe", globe_time: true, render_budget: 100000,
    display: { mode: "points", show_points: true, show_tracks: true, show_trails: true, bloom: false, spatial_culling: false } });
  await api("select", { ids: ["1", "12000"] });
  let memory = { supported: true, total_bytes: 32 * 1024 ** 3, available_bytes: 20 * 1024 ** 3,
    swap_used_bytes: 0, sample_age_ms: 0, scope: "synthetic-qa-only" };
  await page.route("**/api/invoke", async route => {
    const request = route.request().postDataJSON();
    if (request?.command === "system_resources")
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: memory }) });
    return route.fallback();
  });
  await page.reload();
  await page.waitForFunction(() => window.__chronoscope?.snapshot?.count === 12000 && !window.__chronoscope.busy);
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  const before = await page.evaluate(() => window.__chronoscope.view.diagnostics());
  assert.equal(before.pointCount, 12000);
  const scene = (await api("snapshot", { compact: true })).scene;
  const prefs = await api("preferences");
  memory = { ...memory, total_bytes: 8 * 1024 ** 3, available_bytes: 200 * 1024 ** 2 };
  await page.evaluate(async () => {
    await window.__chronoscope.view.checkResourcePressure();
    await window.__chronoscope.sceneIdle();
  });
  fs.writeFileSync(path.join(out, "pressure-applied.json"), JSON.stringify(await page.evaluate(() => window.__chronoscope.view.diagnostics()), null, 2));
  await page.waitForFunction(() => {
    const d = window.__chronoscope.view.diagnostics();
    return d.pointCount <= 2000 && d.graphics.framebuffer[0] * d.graphics.framebuffer[1] <= 500000;
  }, undefined, { timeout: 10000 });
  const after = await page.evaluate(() => window.__chronoscope.view.diagnostics());
  fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify({ injectedPressure: true, before, after }, null, 2));
  assert.equal(after.resourceGovernor.profile, "critical");
  assert(after.graphics.framebuffer[0] * after.graphics.framebuffer[1] <= 500000);
  assert(after.graphics.framebuffer[0] * after.graphics.framebuffer[1] < before.graphics.framebuffer[0] * before.graphics.framebuffer[1]);
  assert(after.allocatedMarkerSlots < before.allocatedMarkerSlots);
  assert(after.stemSegments < before.stemSegments);
  assert.equal(after.fadingPointCount, 0);
  assert.equal(after.renderErrorCount, 0);
  const snapshot = await api("snapshot", { compact: true });
  assert.equal(snapshot.visible, 12000); assert.equal(snapshot.selected_count, 2);
  assert.equal((await api("query", { limit: 1 })).count, 12000);
  assert.equal(snapshot.scene.render_budget, 100000);
  assert.deepEqual(await api("preferences"), prefs);
  // Native camera persistence can legitimately alter camera fields; the policy
  // must not overwrite any user display, time, fade, or budget choice.
  for (const key of ["display", "render_budget", "globe_time", "playback_fade", "playback_fade_amount"])
    assert.deepEqual(snapshot.scene[key], scene[key]);
  pass("Injected memory pressure lowers real framebuffer and retained geometry while exact records, selection and preferences remain intact");
  await page.evaluate(async () => {
    await window.__chronoscope.liveViewRequest("view_playback", { action: "configure", speed: 1, increment_seconds: 1 });
    await window.__chronoscope.liveViewRequest("view_playback", { action: "play" });
  });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await window.__chronoscope.liveViewRequest("view_playback", { action: "pause" });
    await window.__chronoscope.sceneIdle();
  });
  const final = await page.evaluate(() => window.__chronoscope.view.diagnostics());
  assert.equal(final.renderErrorCount, 0);
  assert.equal(final.fadingPointCount, 0);
  pass("Playback remains available under critical limits without afterimage allocations");
  // A cheap real animation isolates recovery policy from overload. Keep the
  // actual clock, render loop and resource-check timer: no synthetic time jumps.
  memory = { ...memory, total_bytes: 32 * 1024 ** 3, available_bytes: 20 * 1024 ** 3 };
  await page.evaluate(async () => {
    const view = window.__chronoscope.view;
    view.setDisplayOptions({ ...view.display, show_points: false, show_tracks: false, show_trails: false });
    await window.__chronoscope.liveViewRequest("view_playback", { action: "play" });
  });
  await page.waitForFunction(() => {
    const d = window.__chronoscope.view.diagnostics();
    return d.resourceGovernor.profile === "full";
  }, undefined, { timeout: 175000 });
  const recovered = await page.evaluate(() => window.__chronoscope.view.diagnostics());
  assert.equal(recovered.renderErrorCount, 0);
  assert.equal(await page.evaluate(() => window.__chronoscope.view.playback), true);
  await page.evaluate(() => window.__chronoscope.liveViewRequest("view_playback", { action: "pause" }));
  pass("Real continuous playback recovers through all capped profiles when memory and render headroom return");
  await page.screenshot({ path: path.join(out, "automatic-critical.png") });
  fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify({ injectedPressure: true, before, after, final, recovered }, null, 2));
});
