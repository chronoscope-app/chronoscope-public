import { withLocalApp } from "./local-browser.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

await withLocalApp("flight-week", async ({ page, api, out, root, pass }) => {
  page.setDefaultTimeout(90000);
  const demo = (await api("demo_catalog")).demos.find(
    (entry) => entry.id === "flight-altitude",
  );
  assert.match(demo.name, /week.*6 Philippine airports/);
  assert.equal(demo.previews.length, 2);
  await page.locator("#help").click();
  await page.locator("#demo-datasets").click();
  const previews = page.locator('[data-demo-preview="flight-altitude"]');
  await previews.first().waitFor();
  assert.equal(await previews.count(), 2);
  for (const image of await previews.locator("img").all()) {
    await image.evaluate(async (element) => {
      await element.decode();
      if (!element.naturalWidth) throw new Error("Missing flight preview");
    });
  }
  await previews.nth(0).click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 11018 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  let snapshot = await api("snapshot", { compact: false });
  assert.equal(Object.keys(snapshot.entities).length, 175);
  assert.deepEqual(snapshot.time_bounds, [1772323644, 1772927900]);
  assert.equal(snapshot.filter.start, null);
  assert.equal(snapshot.filter.end, null);
  const status = await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_status"),
  );
  assert.equal(status.diagnostics.pointCount, 11018);
  assert.equal(status.diagnostics.globeAltitude, true);
  assert.equal(status.diagnostics.altitude.known, 11018);
  assert.equal(status.diagnostics.renderErrorCount, 0);
  await page.screenshot({ path: path.join(out, "full-week.png") });
  pass(
    "Demo picker opens a complete seven-day, 175-flight altitude dataset with two previews",
  );

  await page.evaluate(async () => {
    const c = window.__chronoscope;
    const restored = await c.call("restore_view", { index: 3 });
    await c.restoreScene(restored.scene);
  });
  await page.waitForFunction(
    () =>
      !window.__chronoscope.busy &&
      window.__chronoscope.snapshot.filter.start === 1772323644 &&
      window.__chronoscope.snapshot.filter.end === 1772410044,
  );
  await page.locator("#time-rail-playback").click();
  await page.locator("#playback-increment").click();
  await page
    .getByRole("menu", { name: "Playback increment", exact: true })
    .getByRole("menuitemradio", { name: "Day", exact: true })
    .click();
  await page.locator("#scene").click();
  await page.locator("#play").click();
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.filter.start > 1772410044,
  );
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  snapshot = await api("snapshot", { compact: false });
  assert.equal(snapshot.count, 11018);
  assert(snapshot.visible > 0 && snapshot.visible < snapshot.count);
  assert(snapshot.filter.start > 1772410044);
  assert(
    Math.abs(snapshot.filter.end - snapshot.filter.start - 86400) <= 2,
    JSON.stringify(snapshot.filter),
  );
  await page.screenshot({ path: path.join(out, "moving-day-window.png") });
  fs.writeFileSync(
    path.join(out, "playback.json"),
    JSON.stringify(
      {
        count: snapshot.count,
        visible: snapshot.visible,
        filter: snapshot.filter,
      },
      null,
      2,
    ) + "\n",
  );
  pass(
    "Day playback crosses UTC dates, retains a 24-hour window and continues showing flights",
  );

  const exported = await api("export", { path: path.join(out, "flights.csv") });
  const credit = JSON.parse(fs.readFileSync(exported.attribution, "utf8"));
  assert.equal(credit[0].license, "CC BY 4.0");
  assert.match(credit[0].creator, /Bañados/);
  const bundled = [
    "samples/flights-philippines-week-2026.chronoscope",
    "samples/public/flights-philippines-week-2026.csv.attribution.json",
    "frontend/public/demos/flight-altitude-globe.jpg",
    "frontend/public/demos/flight-altitude-time.jpg",
  ].reduce((sum, file) => sum + fs.statSync(path.join(root, file)).size, 0);
  assert(bundled < 5_000_000);
  pass(
    `Flight workspace, credit and previews remain compact (${bundled} bytes)`,
  );
});
