import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust bridge, native Globe elevations and compact legend; no public tile requests.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(root, ".qa/globe-time-"));
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    dir,
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
const report = {
  passed: false,
  checks: [],
  errors: [],
  publicRequests: 0,
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const csv = path.join(dir, "time-elevation.csv");
  const entity =
    "An_extremely_long_entity_identifier_to_verify_narrow_legend_wrapping_without_overflow";
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,label\n" +
      Array.from(
        { length: 12 },
        (_, i) =>
          `${entity},2026-10-15T${String(10 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}Z,${20 + i * 0.4},${-60 + i * 0.6},Event ${i}`,
      ).join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  const disableMaps = async () => {
    const p = await api("preferences");
    await api("preferences", {
      preferences: {
        ...p,
        map: { ...p.map, enabled: false },
        basemap: "none",
        map_layers: [],
        terrain_path: null,
        terrain_builtin: false,
        theme: "dark",
      },
    });
  };
  await disableMaps();
  await api("view_set", {
    mode: "globe",
    globe_time: false,
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      show_trails: true,
      trail_gap_minutes: 0,
    },
  });
  const sourceEvents = (await api("events", { limit: 100 })).events;
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1100 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const target = route.request().url();
    if (/^https?:/.test(target) && !target.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 12 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.view.ready;
    c.view.onViewportChange = () => {};
  });
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
        mode: v.mode,
        enabled: v.globeTime,
        lo: v.lo,
        hi: v.hi,
        height: v.timeHeightMeters,
        stems: v.diagnostics().stemSegments,
        culling: v.visibleDataBounds(),
        points: v.points.map((p) => ({
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          time: p.time,
          position: v.glyphById.get(p.id).position,
          ground: v.groundPosition(p.lat, p.lon),
        })),
        tracks: v.trails.length,
      };
    });
  const verifyECEF = (s, elevated) => {
    const a = 6378137,
      e2 = 6.6943799901413165e-3;
    for (const p of s.points) {
      const lat = (p.lat * Math.PI) / 180,
        lon = (p.lon * Math.PI) / 180,
        sin = Math.sin(lat),
        cos = Math.cos(lat);
      const n = a / Math.sqrt(1 - e2 * sin * sin);
      // Current app convention: oldest is highest, newest is at the surface.
      // Keep the WGS84 reference independent of the renderer/time-axis helper.
      const age =
        s.hi > s.lo
          ? Math.max(0, Math.min(1, (s.hi - p.time) / (s.hi - s.lo)))
          : 0;
      const h = 2 + (elevated ? age * s.height : 0);
      const xyz = [
        (n + h) * cos * Math.cos(lon),
        (n + h) * cos * Math.sin(lon),
        (n * (1 - e2) + h) * sin,
      ];
      for (const [i, key] of ["x", "y", "z"].entries())
        assert(
          Math.abs(p.position[key] - xyz[i]) < 1e-5,
          `Independent WGS84 ECEF ${key} for ${p.id}`,
        );
    }
  };
  const toggle = async (enabled) => {
    const before = await page.evaluate(() =>
      window.__chronoscope.view.captureCamera(),
    );
    await page.locator("#time-elevation").hover();
    await page.locator("#globe-time-height").evaluate((el, enabled) => {
      el.value = enabled ? "50" : "0";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, enabled);
    await page.waitForFunction(
      (value) =>
        window.__chronoscope.view.globeTime === value &&
        window.__chronoscope.snapshot.scene.globe_time === value,
      enabled,
    );
    assert.equal((await api("snapshot")).scene.globe_time, enabled);
    await page.waitForFunction(() => !window.__chronoscope.busy);
    const after = await page.evaluate(() =>
      window.__chronoscope.view.captureCamera(),
    );
    // Cesium may renormalize unit vectors at machine precision while idle.
    for (const key of ["position", "direction", "up"])
      for (let i = 0; i < 3; i++)
        assert(
          Math.abs(after.cesium_camera[key][i] - before.cesium_camera[key][i]) <
            (key === "position" ? 1e-5 : 1e-12),
          "Globe elevation toggle preserves camera " + key,
        );
    assert.equal(
      after.cesium_camera.frustum_width,
      before.cesium_camera.frustum_width,
    );
    report.cameraPreservedOnToggle = true;
  };
  assert.equal(await page.locator("#globe-time").count(), 0);
  assert(await page.locator("#time-height").isHidden());
  assert(await page.locator("#globe-time-height").isEnabled());
  assert.equal(await page.inputValue("#globe-time-height"), "0");
  const flat = await state();
  verifyECEF(flat, false);
  assert.equal(flat.stems, 0);
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.camera.moveRight(15000);
    v.camera.moveForward(7000);
    v.requestRender();
  });
  await toggle(true);
  assert(await page.locator("#globe-time-height").isVisible());
  assert(await page.locator("#time-height").isHidden());
  const raised = await state();
  verifyECEF(raised, true);
  assert.equal(raised.stems, 12);
  assert(raised.tracks > 0);
  assert.equal(raised.culling, null);
  assert.deepEqual(
    raised.points.map((p) => p.ground),
    flat.points.map((p) => p.ground),
  );
  report.checks.push(
    "Nonzero Globe slider raises native markers along independently checked WGS84 normals, preserves the ground, enables stems and avoids ground-footprint culling",
  );
  assert(
    raised.height <= 50000,
    "Default Globe height is capped at 50 km rather than millions of metres",
  );
  await page.locator("#globe-time-height").evaluate((el) => {
    el.value = "100";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const taller = await state();
  verifyECEF(taller, true);
  assert(Math.abs(taller.height / raised.height - 20) < 1e-9);
  assert.equal(
    await page.inputValue("#time-height"),
    "2.8",
    "Globe slider does not change Space-time height",
  );
  await page.locator("#legend .legend-toggle").click();
  const legend = await page.locator("#legend").evaluate((el) => {
    const content = el.querySelector(".legend-content"),
      label = el.querySelector(".legend-label");
    return {
      width: el.getBoundingClientRect().width,
      contentWidth: content.clientWidth,
      scrollWidth: content.scrollWidth,
      labelHeight: label.getBoundingClientRect().height,
    };
  });
  assert(legend.width <= 212 && legend.width >= 160);
  assert(legend.scrollWidth <= legend.contentWidth);
  assert(legend.labelHeight > 25);
  report.legend = legend;
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  await api("save_view", { name: "Globe time", scene });
  const saved = path.join(dir, "time.chronoscope");
  await api("save", { path: saved, scene });
  await toggle(false);
  verifyECEF(await state(), false);
  assert(await page.locator("#globe-time-height").isEnabled());
  await api("restore_view", { index: 0 });
  await restore();
  assert((await state()).enabled);
  verifyECEF(await state(), true);
  await api("open", { path: saved });
  await restore();
  assert((await state()).enabled);
  assert.equal(await page.inputValue("#globe-time-height"), "100");
  assert.equal((await api("snapshot")).scene.globe_time_scale, 20);
  assert.deepEqual((await api("events", { limit: 100 })).events, sourceEvents);
  await api("view_set", { globe_time_scale: 1 });
  await restore();
  assert((await state()).height <= 50000);
  verifyECEF(await state(), true);
  await api("view_set", { globe_time_scale: 20 });
  await restore();
  assert(Math.abs((await state()).height / raised.height - 20) < 1e-9);
  verifyECEF(await state(), true);
  report.checks.push(
    "Slider updates height, named views and portable documents restore the elevation/scale, switching off restores surface positions, source events stay unchanged",
  );
  for (const mode of ["map", "space-time", "globe"]) {
    await api("view_set", { mode });
    await restore();
    if (mode !== "map") {
      await page.mouse.move(50, 30);
      await page.locator("#time-elevation").hover();
      await page.waitForSelector("#time-elevation-popup:not([hidden])");
    }
    assert.equal(
      await page.locator("#time-height").isVisible(),
      mode === "space-time",
    );
    assert.equal(
      await page.locator("#globe-time-height").isVisible(),
      mode === "globe",
    );
    const s = await state();
    verifyECEF(s, mode !== "map");
  }
  await page.setViewportSize({ width: 1100, height: 850 });
  const controls = await page.evaluate(() => {
    const a = document
        .querySelector(".navigation-toolbar")
        .getBoundingClientRect(),
      b = document.querySelector("#scene").getBoundingClientRect();
    return {
      left: a.left,
      right: a.right,
      sceneLeft: b.left,
      sceneRight: b.right,
    };
  });
  assert(
    controls.left >= controls.sceneLeft &&
      controls.right <= controls.sceneRight + 1,
  );
  await page.setViewportSize({ width: 1800, height: 1100 });
  report.checks.push(
    "Time controls stay scoped to Globe; flat views retain their behavior and controls fit a narrower window; long legend labels wrap within 210 pixels",
  );
  // Show the feature using the bundled, attributed real NOAA hurricane dataset.
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  await disableMaps();
  await api("filter", {
    filter: { start: Date.parse("2021-01-01T00:00Z") / 1000 },
  });
  await api("view_set", {
    mode: "globe",
    globe_time: true,
    time_height: 2.8,
    globe_time_scale: 1,
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      show_trails: false,
      trail_gap_minutes: 0,
    },
  });
  await restore();
  await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    v.fit();
    await v.screenshot();
  });
  await page.screenshot({
    path: path.join(dir, "hurricanes-globe-time-dark.png"),
  });
  await page.click("#theme");
  await page.evaluate(() => window.__chronoscope.view.screenshot());
  await page.screenshot({
    path: path.join(dir, "hurricanes-globe-time-light.png"),
  });
  report.hurricanes = await state();
  report.hurricanes.framing = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    const pixels = v.points.map((p) => v.project(v.pos(p))).filter(Boolean);
    return {
      projected: pixels.length,
      outside: pixels.filter(
        (p) =>
          p.x < 0 ||
          p.y < 0 ||
          p.x > v.host.clientWidth ||
          p.y > v.host.clientHeight,
      ).length,
    };
  });
  assert(report.hurricanes.framing.projected > 100);
  assert.equal(
    report.hurricanes.framing.outside,
    0,
    "Fit must frame elevated hurricane events, not just the ground rectangle",
  );
  delete report.hurricanes.points;
  assert.equal(await page.locator(".toast.error").count(), 0);
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
}
