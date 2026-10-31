import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("flight-pan", async ({ page, api, out, pass }) => {
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    const opened = await c.call("demo_open", { id: "flight-altitude" });
    await c.refresh();
    await c.restoreScene(opened.scene);
    await c.sceneIdle();
  });
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 11018 &&
      window.__chronoscope.view.residentPlaybackActive &&
      !window.__chronoscope.busy,
  );
  const canvas = page.locator(".cesium-widget canvas");
  const box = await canvas.boundingBox();
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.55 };
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    window.__panChecks = {
      picks: 0,
      updates: 0,
      draws: 0,
      cadences: [],
      trackBuildsDuringDrag: 0,
    };
    const pick = v.pickId;
    v.pickId = function (...args) {
      window.__panChecks.picks++;
      return pick.apply(this, args);
    };
    v.scene.preUpdate.addEventListener(() => window.__panChecks.updates++);
    v.scene.postRender.addEventListener(() => window.__panChecks.draws++);
    const update = v.resourceGovernor.update;
    v.resourceGovernor.update = function (...args) {
      window.__panChecks.cadences.push(args[4]);
      return update.apply(this, args);
    };
    const trails = v.rebuildTrails;
    v.rebuildTrails = function (...args) {
      if (v.drag && !v.residentPlaybackActive)
        window.__panChecks.trackBuildsDuringDrag++;
      return trails.apply(this, args);
    };
  });
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__panChecks.picks), 0);
  await page.mouse.down();
  const began = Date.now();
  let next = began;
  while (Date.now() - began < 18000) {
    const t = (Date.now() - began) / 1000;
    await page.mouse.move(
      start.x + 70 * Math.sin((t * Math.PI) / 2),
      start.y + 25 * Math.sin((t * Math.PI) / 3),
    );
    next = Math.max(next + 1000 / 30, Date.now());
    const delay = next - Date.now();
    if (delay > 0) await page.waitForTimeout(delay);
  }
  // Hold still long enough for the camera's trailing timer, while retaining the button.
  await page.waitForTimeout(250);
  await page.mouse.up();
  const slow = await page.evaluate(() => ({
    checks: window.__panChecks,
    diagnostics: window.__chronoscope.view.diagnostics(),
  }));
  assert.equal(
    slow.checks.picks,
    0,
    "pan hover/down/move/up must not pick the GPU scene",
  );
  assert(
    slow.checks.cadences.length >= 3,
    "real five-second governor checks were exercised",
  );
  assert(
    slow.checks.cadences.every((v) => v < 45),
    JSON.stringify(slow.checks.cadences),
  );
  assert.equal(slow.diagnostics.resourceGovernor.profile, "full");
  assert.equal(slow.diagnostics.experimentalPlayback.active, true);
  assert(
    slow.checks.updates > slow.checks.draws * 1.1,
    "update cadence must remain distinct from demand-driven drawing",
  );
  assert.equal(slow.diagnostics.pointCount, 11018);
  pass(
    "Slow held Globe pan performs no scene picks and retains prepared geometry through three real governor checks",
  );
  const locate = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      for (const p of v.points) {
        const s = v.projectEvent(p.id);
        if (
          s &&
          s.x > 150 &&
          s.x < v.host.clientWidth - 120 &&
          s.y > 150 &&
          s.y < v.host.clientHeight - 120
        )
          return { x: s.x, y: s.y };
      }
      throw Error("No visible flight marker");
    });
  let location = await locate();
  let rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + location.x, rect.y + location.y);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__panChecks.picks), 0);
  await page.waitForSelector(".scene-tooltip", { state: "visible" });
  assert.equal(
    await page.evaluate(() => window.__panChecks.picks),
    1,
    "one pick when the pointer rests, without a second tooltip verification pick",
  );
  pass(
    "Hover hints defer scene picking until the existing one-second tooltip delay",
  );
  await page.mouse.click(rect.x + location.x, rect.y + location.y);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count > 0,
  );
  assert.equal(
    await page.evaluate(() => window.__panChecks.picks),
    2,
    "a real click still picks once, on release",
  );
  pass("Deferred hover/pan picking preserves genuine flight selection");
  // The globe's right and middle drags also bypass scene picking.
  const picks = await page.evaluate(() => window.__panChecks.picks);
  for (const button of ["right", "middle"]) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 50, start.y + 12, { steps: 6 });
    await page.mouse.up({ button });
  }
  assert.equal(await page.evaluate(() => window.__panChecks.picks), picks);
  await page.click('[data-view="space-time"]');
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.mode === "space-time" &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.view.fit());
  await page.waitForTimeout(250);
  const handle = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    for (let i = 0; i < v.handles.length; i++) {
      const h = v.handles.get(i),
        p = v.project(h.position);
      if (p && p.x > 0 && p.y > 0) return { ...p, bearing: v.bearing() };
    }
    throw Error("No navigation handle");
  });
  rect = await canvas.boundingBox();
  const before = await page.evaluate(() => window.__panChecks.picks);
  await page.mouse.move(rect.x + handle.x, rect.y + handle.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + handle.x + 45, rect.y + handle.y + 15, {
    steps: 6,
  });
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    picks: window.__panChecks.picks,
    bearing: window.__chronoscope.view.bearing(),
  }));
  assert.equal(after.picks, before);
  assert(Math.abs(after.bearing - handle.bearing) > 1);
  pass(
    "Time navigation handles use their screen-space hit test and still orbit without a GPU scene pick",
  );
  // A real memory limit still frees the resident representation and caps drawing.
  await page.route("**/api/invoke", async (route) => {
    const request = route.request().postDataJSON();
    if (request?.command === "system_resources")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            supported: true,
            total_bytes: 16 * 1024 ** 3,
            available_bytes: 200 * 1024 ** 2,
            swap_used_bytes: 0,
            sample_age_ms: 0,
            scope: "synthetic-qa-only",
          },
        }),
      });
    return route.fallback();
  });
  await page.evaluate(async () => {
    await window.__chronoscope.view.checkResourcePressure();
    await window.__chronoscope.sceneIdle();
  });
  await page.waitForFunction(() => {
    const d = window.__chronoscope.view.diagnostics();
    return (
      d.resourceGovernor.profile === "critical" &&
      !d.experimentalPlayback.active &&
      d.pointCount <= 2000
    );
  });
  assert.equal((await api("snapshot")).count, 11018);
  pass(
    "Real memory-pressure policy still caps geometry without changing the 11,018 source records",
  );
  fs.writeFileSync(
    path.join(out, "measurements.json"),
    JSON.stringify(slow, null, 2) + "\n",
  );
  await page.screenshot({ path: path.join(out, "flight-pan.png") });
});
