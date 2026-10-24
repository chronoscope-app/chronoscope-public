// Native WebGL loss/restoration with real Rust records and locally generated terrain/raster fixtures.
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const contextMode = process.env.CHRONOSCOPE_QA_CONTEXT_MODE || "space-time";
assert(["space-time", "map", "globe"].includes(contextMode));
const atlasCount = 1;
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/cesium-context");
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS || path.join(dir, "screenshots");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
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
const report = {
  passed: false,
  publicRequests: 0,
  checks: [],
  errors: [],
  fixture:
    "Synthetic ellipsoid-height terrain and local checker raster; no public requests",
  mode: contextMode,
};
let browser, page;
const write = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 15000);
    server.once("error", reject);
    server.stderr.on("data", (data) => {
      log += data;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  const api = async (command, args = {}) => {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const data = await response.json();
    assert(response.ok, JSON.stringify(data.error));
    return data.result;
  };
  await api("preferences", {
    preferences: {
      ...(await api("preferences")),
      basemap: "none",
      map: { ...(await api("preferences")).map, enabled: false },
      map_layers: [],
      terrain_path: null,
    },
  });
  const csv = path.join(dir, "recovery.csv");
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,label\nA,2026-10-15 10:00,33.749,-84.388,Start\nA,2026-10-15 10:10,,,Unknown location\nA,2026-10-15 10:20,33.752,-84.384,End\n",
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: contextMode,
    display: {
      mode: "points",
      bloom: true,
      spatial_culling: false,
      show_tracks: true,
      show_trails: true,
    },
  });
  const packet = await api("display_data", { level: 18 });
  const fixture = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4,
        c = (Math.floor(y / 4) + Math.floor(x / 4)) % 2;
      fixture.data.set(c ? [30, 145, 170, 255] : [35, 70, 105, 255], i);
    }
  const raster = {
    tiles: [
      {
        request: {
          bounds: [-84.392, 33.745, -84.38, 33.757],
          row: 0,
          col: 0,
          matrix: "fixture",
          geographic: true,
        },
        data_url:
          "data:image/png;base64," + PNG.sync.write(fixture).toString("base64"),
        cache_hit: true,
      },
    ],
    requests: 0,
    cache_hits: 1,
    attribution: "Synthetic local context-recovery fixture",
  };
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.setDefaultTimeout(30000);
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
    (expected) =>
      window.__chronoscope?.snapshot?.count === 3 &&
      window.__chronoscope.view.mode === expected &&
      !window.__chronoscope.busy,
    contextMode,
  );
  // Initialization installs viewport scheduling after restoring scene/resources; the initial callback is a no-op.
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.onViewportChange
        .toString()
        .replace(/\s/g, "") !== "()=>{}",
  );
  report.checks.push({
    name: "Backend scene mode is restored at app startup without a legacy Three.js camera",
    mode: contextMode,
  });
  await page.evaluate(async () => {
    const app = window.__chronoscope;
    app.view.onViewportChange = () => {};
    app.view.onSceneChange = () => {};
    await app.select(["2"], false);
  });
  await page.waitForTimeout(400);
  await page.evaluate(
    async ({ raster, packet }) => {
      const app = window.__chronoscope,
        v = app.view;
      await v.ready;
      v.onViewportChange = () => {};
      v.onSceneChange = () => {};
      v.setTerrainDatum("ellipsoid");
      await v.setTerrain({
        bounds: [-84.392, 33.745, -84.38, 33.757],
        width: 3,
        height: 3,
        elevations: [100, 120, 140, 110, 130, 150, 120, 140, 160],
        minimum: 100,
        maximum: 160,
        covered: 9,
        tiles: 1,
      });
      await v.setRasters(raster);
      v.setTheme("light");
      v.fit();
      v.zoom(1.2);
      if (v.mode !== "map") {
        v.setBearing(23);
        v.setTilt(55);
      }
      await v.displayLayer.set(packet, {
        ...v.display,
        mode: "points",
        bloom: true,
      });
    },
    { raster, packet },
  );
  await page.waitForFunction(
    (count) =>
      !window.__chronoscope.view.displayLayer.diagnostics.pending &&
      window.__chronoscope.view.displayLayer.diagnostics.atlasLayers === count,
    atlasCount,
  );
  await page.waitForFunction(
    () =>
      !window.__chronoscope.view.scene.globe.show ||
      window.__chronoscope.view.scene.globe.tilesLoaded,
  );
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    window.__oldCesiumCanvas = v.viewer.canvas;
    const extension = v.viewer.canvas
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context");
    if (!extension)
      throw Error(
        "WEBGL_lose_context is unavailable; cannot assert native graphics recovery",
      );
    window.__contextLoss = extension;
    return {
      camera: v.captureCamera(),
      ids: v.points.map((p) => p.id),
      selected: [...v.selected],
      terrain: v.resources.status,
      display: v.displayLayer.diagnostics,
      theme: v.theme,
      mode: v.mode,
    };
  });
  await page.screenshot({ path: path.join(out, "before-context-loss.png") });
  assert.equal(
    before.terrain.tileCount,
    1,
    "The local raster fixture must be visible before inducing context loss",
  );
  // Capture the loss phase in the native event itself: automatic recovery may
  // already advance to "refreshing" before a later Playwright DOM query runs.
  await page.evaluate(() => {
    const view = window.__chronoscope.view;
    view.viewer.canvas.addEventListener(
      "webglcontextlost",
      () => {
        const status = document.querySelector(".topbar #backend");
        window.__lossIndicator = {
          recovering: view.recovering,
          warning: status.getAttribute("data-warning"),
          label: status.getAttribute("aria-label"),
        };
        window.__lossCapture = view.screenshot().then(
          () => "",
          (error) => String(error),
        );
      },
      { once: true },
    );
    window.__contextLoss.loseContext();
  });
  await page.waitForFunction(() => window.__lossIndicator);
  const lost = await page.evaluate(() => window.__lossIndicator);
  report.lossIndicator = lost;
  write();
  assert.equal(lost.recovering, true);
  assert.equal(lost.warning, "true");
  assert.match(lost.label, /context lost/);
  const unavailableCapture = await page.evaluate(() => window.__lossCapture);
  assert.match(
    unavailableCapture,
    /Graphics context is unavailable|Graphics are initializing or restoring/,
  );
  await page.evaluate(() => window.__contextLoss.restoreContext());
  await page.waitForFunction((count) => {
    const v = window.__chronoscope.view;
    return (
      v.viewer.canvas !== window.__oldCesiumCanvas &&
      !v.recovering &&
      v.diagnostics().contextRecoveries === 1 &&
      !v.displayLayer.diagnostics.pending &&
      v.resources.status.terrainActive &&
      v.displayLayer.diagnostics.atlasLayers === count
    );
  }, atlasCount);
  await page.waitForFunction(
    () =>
      !window.__chronoscope.view.scene.globe.show ||
      window.__chronoscope.view.scene.globe.tilesLoaded,
  );
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.viewer.render();
    return {
      camera: v.captureCamera(),
      ids: v.points.map((p) => p.id),
      selected: [...v.selected],
      terrain: v.resources.status,
      display: v.displayLayer.diagnostics,
      theme: v.theme,
      mode: v.mode,
      diagnostics: v.diagnostics(),
      viewerCount: document.querySelectorAll(".cesium-viewer").length,
      glyphCount: v.viewer.scene.primitives.length,
    };
  });
  report.recoveryEvidence = { before, after };
  assert.deepEqual(after.ids, before.ids);
  assert.deepEqual(after.selected, before.selected);
  assert.equal(after.theme, "light");
  assert.equal(after.mode, contextMode);
  assert.equal(after.viewerCount, 1);
  assert.equal(after.terrain.mode, contextMode);
  assert.equal(after.terrain.tileCount, 1);
  assert.equal(after.terrain.verticalDatum, "ellipsoid");
  assert.equal(after.terrain.terrainActive, true);
  assert.equal(after.display.atlasLayers, atlasCount);
  if (before.camera.cesium_camera.frustum_width !== undefined)
    assert(
      Math.abs(
        after.camera.cesium_camera.frustum_width -
          before.camera.cesium_camera.frustum_width,
      ) < 1e-6,
    );
  assert.equal(after.diagnostics.effectError, "");
  assert.equal(
    await page.locator("#backend").getAttribute("data-warning"),
    "false",
  );
  assert.equal(await page.locator("#scene #backend").count(), 0);
  for (const key of ["position", "direction", "up"])
    for (let i = 0; i < 3; i++)
      assert(
        Math.abs(
          after.camera.cesium_camera[key][i] -
            before.camera.cesium_camera[key][i],
        ) < (key === "position" ? 1e-6 : 1e-9),
        `${key}[${i}] changed across graphics recreation: ${before.camera.cesium_camera[key][i]} -> ${after.camera.cesium_camera[key][i]}`,
      );
  assert.equal(
    (await api("events", { id: "2" })).events[0].lat,
    null,
    "Graphics recovery must never write inferred positions into the data",
  );
  const restoredSnapshot = await api("snapshot");
  assert.deepEqual(restoredSnapshot.selected, ["2"]);
  assert.equal(restoredSnapshot.count, 3);
  await page.screenshot({ path: path.join(out, "after-context-restored.png") });
  const captured = await page.evaluate(() =>
    window.__chronoscope.view.screenshot(),
  );
  const capturedBytes = Buffer.from(captured.split(",")[1], "base64");
  const capturedPng = PNG.sync.read(capturedBytes);
  assert(capturedPng.width > 500 && capturedPng.height > 400);
  fs.writeFileSync(
    path.join(out, "restored-canvas-capture.png"),
    capturedBytes,
  );
  const first = PNG.sync.read(
      fs.readFileSync(path.join(out, "before-context-loss.png")),
    ),
    second = PNG.sync.read(
      fs.readFileSync(path.join(out, "after-context-restored.png")),
    );
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  let difference = 0;
  for (let i = 0; i < first.data.length; i += 4)
    for (let c = 0; c < 3; c++)
      difference += Math.abs(first.data[i + c] - second.data[i + c]);
  const meanDifference = difference / (first.width * first.height * 3);
  assert(
    meanDifference < 1,
    `Restored screenshot changed unexpectedly: ${meanDifference}`,
  );
  report.checks.push({
    name: "Native WEBGL_lose_context creates exactly one replacement Cesium Viewer and restores camera/data/selection/theme/terrain/raster/bloom without changing unknown locations",
    before,
    after,
    meanPixelDifference: meanDifference,
  });
  assert.equal(report.publicRequests, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log("Native Cesium WebGL recovery passed, zero public requests");
} catch (error) {
  report.failure = String(error.stack || error);
  if (page)
    await page
      .screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  write();
  await browser?.close();
  server.kill();
}
