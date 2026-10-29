import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("playback-fade", async ({ page, api, out, pass }) => {
  const rows = ["entity,timestamp,latitude,longitude,value"];
  const epoch = Date.parse("2026-10-29T00:00:00Z");
  for (let i = 0; i <= 100; i++)
    for (let group = 0; group < 2; group++)
      rows.push(
        `Group ${group},${new Date(epoch + i * 1000).toISOString()},${40 + ((i % 10) - 5) * 0.05 + group * 0.015},${-74 + (Math.floor(i / 10) - 5) * 0.05},${i}`,
      );
  const file = path.join(out, "fade-fixture.csv");
  fs.writeFileSync(file, rows.join("\n") + "\n");
  const preview = await api("import_preview", { path: file });
  await api("import_commit", { import_id: preview.import_id });
  await api("preferences", { preferences: { theme: "light" } });
  await api("view_set", {
    mode: "globe",
    display: {
      mode: "points",
      point_scale: 0.4,
      show_points: true,
      show_tracks: false,
      show_trails: false,
      bloom: false,
      spatial_culling: false,
    },
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 202 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  const original = (await api("query", { apply_filter: false, limit: 1000 }))
    .events;
  let style = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      theme: v.theme,
      widths: [...v.glyphById.values()]
        .filter((g) => "outlineWidth" in g)
        .map((g) => g.outlineWidth),
    };
  });
  assert.equal(style.theme, "light");
  assert(style.widths.length > 0);
  assert(style.widths.every((w) => w === 0));
  await api("select", { ids: ["1"] });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh(false);
    await c.sceneIdle();
  });
  const selection = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      width: v.selections.get(0).outlineWidth,
      color: v.selections.get(0).outlineColor.toCssColorString(),
    };
  });
  assert.equal(selection.width, 1);
  assert(!/255,\s*255,\s*255/.test(selection.color));
  pass(
    "Light-mode ordinary markers have no white halos; selection retains a thin colored edge",
  );
  await page.locator("#time-rail-playback").click();
  const slider = page.locator("#playback-fade");
  assert.equal(await slider.getAttribute("type"), "range");
  await slider.focus();
  await page.keyboard.press("End");
  assert.equal(await slider.inputValue(), "100");
  assert.match(
    await slider.getAttribute("aria-valuetext"),
    /latest few time slices/,
  );
  await page.screenshot({ path: path.join(out, "fade-slider-light.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", {
      action: "configure",
      speed: 1,
      increment_seconds: 1,
    }),
  );
  await page.locator("#play").click();
  await page.waitForFunction(() => window.__chronoscope.snapshot.visible <= 6);
  await page.waitForTimeout(300);
  await page.locator("#play").click();
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  const high = await api("snapshot", { compact: true });
  const highStatus = await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", { action: "status" }),
  );
  assert.equal(highStatus.fade_amount, 100);
  assert(
    Math.abs(high.filter.end - high.filter.start - 2) < 0.01,
    JSON.stringify(high.filter),
  );
  assert(high.visible >= 2 && high.visible <= 6);
  const visible = await api("query", { limit: 1000 });
  assert.equal(visible.count, high.visible);
  assert.equal(new Set(visible.events.map((e) => e.entity)).size, 2);
  pass(
    "Maximum fade keeps only the latest few timestamps while retaining concurrent entities and exact table membership",
  );
  await page.locator("#play").click();
  await page.waitForTimeout(400);
  await page.locator("#play").click();
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  const resumed = await api("snapshot", { compact: true });
  assert(Math.abs(resumed.filter.end - resumed.filter.start - 2) < 0.01);
  pass(
    "Pausing and resuming does not progressively shrink the playback window",
  );
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", {
      action: "configure",
      fade_amount: 10,
    }),
  );
  assert.equal(await slider.inputValue(), "10");
  await page.locator("#play").click();
  await page.waitForTimeout(400);
  await page.locator("#play").click();
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  const low = await api("snapshot", { compact: true });
  const durations = await page.evaluate(
    () => window.__chronoscope.view.diagnostics().fadeDurationsMs,
  );
  assert(low.visible > high.visible);
  assert(durations.departure > 3000);
  pass(
    "Lower fade lengthens both history and departure lifetime; API changes update the slider",
  );
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  const saved = path.join(out, "fade.chronoscope");
  await api("save", { path: saved, scene });
  await api("open", { path: saved });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 202 &&
      !window.__chronoscope.busy,
  );
  assert.equal(await page.locator("#playback-fade").inputValue(), "10");
  assert.equal(
    (await api("snapshot", { compact: true })).scene.playback_fade_amount,
    10,
  );
  assert.deepEqual(
    (await api("query", { apply_filter: false, limit: 1000 })).events,
    original,
  );
  pass(
    "Fade percentage persists in portable workspaces and original records remain unchanged",
  );
});
