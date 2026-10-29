import {
  chromium,
  spawn,
  localServerUrl,
  createApi,
  qaPaths,
} from "./qa-runtime.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../.."),
  dir = qaPaths.data;
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    dir,
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
const report = { passed: false, checks: [], errors: [] };
try {
  const url = await localServerUrl(server),
    api = createApi(url, token);
  const csv = path.join(dir, "altitude.csv");
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,altitude_m,altitude_reference\n" +
      [
        "zero,2026-01-01,0,0,0,ellipsoid",
        "egm,2026-01-02,0,0,1000,egm96",
        "rocket,2026-01-03,1,1,250000,reported",
        "unknown,2026-01-04,1,1,3000,unspecified",
        "missing,2026-01-05,1,1,,",
      ].join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  const p = await api("preferences");
  await api("preferences", {
    preferences: {
      ...p,
      map: { ...p.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_builtin: false,
      terrain_path: null,
    },
  });
  await api("view_set", {
    mode: "globe",
    globe_altitude: true,
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      show_trails: true,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (route) =>
    /^https?:/.test(route.request().url()) &&
    !route
      .request()
      .url()
      .startsWith(url + "/")
      ? route.abort()
      : route.continue(),
  );
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 5 && !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    await window.__chronoscope.view.ready;
    window.__chronoscope.view.onViewportChange = () => {};
  });
  await page.waitForFunction(
    () => window.__chronoscope.view.renderPoints.length === 3,
  );
  const waitMode = async (time, altitude) => {
    await page.waitForFunction(
      ([t, a]) => {
        const c = window.__chronoscope;
        return (
          !c.busy &&
          c.view.globeTime === t &&
          c.view.globeAltitude === a &&
          c.snapshot.scene.globe_time === t &&
          c.snapshot.scene.globe_altitude === a
        );
      },
      [time, altitude],
    );
  };
  const restore = () =>
    page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh();
      await c.restoreScene(c.snapshot.scene);
    });
  const state = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        diagnostics: v.diagnostics(),
        count: v.points.length,
        points: v.renderPoints.map((p) => ({
          ...p,
          position: v.glyphById.get(p.id)?.position,
        })),
        camera: v.captureCamera(),
      };
    });
  let s = await state();
  assert.equal(s.points.length, 3);
  assert.equal(s.diagnostics.globeAltitude, true);
  // Independent WGS84 ECEF, with published PROJ EGM96 control at 0°,0°.
  for (const point of s.points) {
    const h =
      point.altitude.meters +
      (point.altitude.reference === "egm96" ? 17.16 : 0);
    const lat = (point.lat * Math.PI) / 180,
      lon = (point.lon * Math.PI) / 180,
      e2 = 6.6943799901413165e-3,
      n = 6378137 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const expected = [
      (n + h) * Math.cos(lat) * Math.cos(lon),
      (n + h) * Math.cos(lat) * Math.sin(lon),
      (n * (1 - e2) + h) * Math.sin(lat),
    ];
    ["x", "y", "z"].forEach((k, i) =>
      assert(
        Math.abs(point.position[k] - expected[i]) < 0.006,
        `WGS84 altitude coordinate ${point.id} ${k}`,
      ),
    );
  }
  // Exercise the actual importer, including detected fields and editable units/reference.
  page.once("dialog", (dialog) => dialog.accept(csv));
  await page.locator("#open").click();
  await page.locator("#review-import").waitFor();
  assert.equal(await page.locator('[data-map="altitude"]').inputValue(), "4");
  assert.equal(
    await page.locator('[data-map="altitude_reference_column"]').inputValue(),
    "5",
  );
  await page.locator("#altitude-unit").selectOption("feet");
  await page.locator("#altitude-reference").selectOption("reported");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-field="altitude"]').dataset.state ===
      "valid",
  );
  await page.locator("[data-close]").click();
  report.checks.push(
    "zero, EGM96 conversion and 250 km reported altitude match independent WGS84 coordinates; missing/unknown omitted",
  );
  await page.locator("#time-elevation").hover();
  assert.equal(
    await page.locator("#height-mode-altitude").getAttribute("aria-checked"),
    "true",
  );
  const layout = await page.locator(".height-mode-selector").evaluate((el) =>
    [...el.children].map((b) => ({
      x: b.getBoundingClientRect().x,
      y: b.getBoundingClientRect().y,
    })),
  );
  assert.equal(layout[0].y, layout[1].y);
  assert(layout[1].x > layout[0].x);
  await page.locator("#height-mode-time").click();
  await waitMode(true, false);
  await page.waitForFunction(
    () => window.__chronoscope.view.points.length === 5,
  );
  const slider = page.locator("#globe-time-height");
  assert(await slider.isVisible());
  assert(!(await slider.isDisabled()));
  const retainedScale = await slider.inputValue();
  await page.locator("#height-mode-altitude").click();
  await waitMode(false, true);
  assert(await slider.isVisible());
  assert(await slider.isDisabled());
  assert.equal(await slider.inputValue(), retainedScale);
  await page.locator("#height-mode-altitude").press("ArrowLeft");
  await waitMode(true, false);
  assert(!(await slider.isDisabled()));
  await slider.evaluate((el) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitMode(false, false);
  assert.equal(
    await page.locator("#height-mode-time").getAttribute("aria-checked"),
    "true",
  );
  await page.locator("#height-mode-altitude").click();
  await waitMode(false, true);
  const save = path.join(dir, "altitude.chronoscope");
  await api("save", { path: save });
  await api("view_set", { globe_time: true });
  await api("open", { path: save });
  await restore();
  await waitMode(false, true);
  report.checks.push(
    "single sliding selector is mutually exclusive; slider stays visible and disabled in Altitude, retains scale, and zero Time Height gives ground; altitude survives save/reopen",
  );
  await api("view_set", { mode: "space-time" });
  await restore();
  await page.locator("#time-elevation").hover();
  assert.equal(await page.locator("#height-mode-altitude").isDisabled(), true);
  await api("view_set", { mode: "globe" });
  await restore();
  // Default Enter and Escape cancel, neither may recreate the renderer.
  const before = await state();
  const order = await page.evaluate(
    () => document.querySelector("#settings").nextElementSibling.id,
  );
  assert.equal(order, "backend");
  assert.equal(await page.locator("#backend").innerText(), "");
  await page.locator("#backend").click();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "reset-map-cancel",
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#reset-map-confirm").count(), 0);
  assert.equal(
    (await state()).diagnostics.contextRecoveries,
    before.diagnostics.contextRecoveries,
  );
  await page.locator("#backend").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#reset-map-confirm").count(), 0);
  await page.locator("#backend").click();
  await page.locator("#reset-map-confirm").click();
  await page.waitForFunction((n) => {
    const v = window.__chronoscope.view;
    return (
      v.diagnostics().contextRecoveries === n + 1 && !v.diagnostics().recovering
    );
  }, before.diagnostics.contextRecoveries);
  s = await state();
  assert.equal(s.points.length, 3);
  for (const key of ["position", "direction", "up"])
    s.camera.cesium_camera[key].forEach((value, i) =>
      assert(Math.abs(value - before.camera.cesium_camera[key][i]) < 1e-8),
    );
  assert(
    s.points.find((p) => p.altitude.reference === "egm96").position.x > 6379130,
  );
  const automationReset = await page.evaluate(async () => {
    const c = window.__chronoscope;
    for (const confirm of [undefined, false]) {
      try {
        await c.liveViewRequest("view_reset", { confirm });
        throw Error("unconfirmed reset accepted");
      } catch (error) {
        if (!String(error).includes("requires confirm:true")) throw error;
      }
    }
    return c.liveViewRequest("view_reset", { confirm: true });
  });
  assert.equal(automationReset.reset, true);
  assert.equal(
    automationReset.diagnostics.contextRecoveries,
    before.diagnostics.contextRecoveries + 2,
  );
  assert.equal(automationReset.diagnostics.globeAltitude, true);
  assert.equal(automationReset.diagnostics.pointCount, 3);
  report.checks.push(
    "automation reset requires explicit confirmation and returns live altitude state after successful recovery",
  );
  report.checks.push(
    "reset icon follows Preferences; Enter/Escape cancel; confirmed reset retains altitude, camera and dataset",
  );
  for (const [stem, count, entities, visible] of [
    ["flights-philippines-week-2026", 11018, 175, 11018],
    ["starlink-128-predicted-orbits-2024", 46208, 128, 11648],
  ]) {
    await api("open", {
      path: path.join(root, "samples", stem + ".chronoscope"),
    });
    await restore();
    await page.waitForFunction(
      (n) => window.__chronoscope.view.points.length === n,
      visible,
      { timeout: 90000 },
    );
    await page.evaluate(() => window.__chronoscope.view.fit());
    s = await state();
    assert.equal(s.diagnostics.globeAltitude, true);
    assert.equal(new Set(s.points.map((p) => p.entity)).size, entities);
    assert.equal(s.points.length, visible);
    assert(
      s.points.every(
        (p) => p.position && Object.values(p.position).every(Number.isFinite),
      ),
    );
    await page.locator("#time-elevation").hover();
    await page.screenshot({
      path: path.join(qaPaths.screenshots, stem + ".png"),
    });
    report[stem] = {
      points: visible,
      records: count,
      entities,
      altitude: s.diagnostics.altitude,
      stems: s.diagnostics.stemSegments,
    };
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(qaPaths.out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
console.log(JSON.stringify(report));
