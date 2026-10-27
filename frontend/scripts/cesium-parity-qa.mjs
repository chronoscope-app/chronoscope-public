import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust bridge + native Cesium WebGL integration. No public map requests.
import { PNG } from "pngjs";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
const desktopCsp = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
).app.security.csp;
assert.equal(typeof desktopCsp, "string");
const dir = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/cesium-parity"),
);
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_SCREENSHOTS || path.join(dir, "screenshots"),
);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const report = {
  passed: false,
  renderer: "CesiumJS WebGL",
  desktopContentSecurityPolicy: desktopCsp,
  publicMapRequests: 0,
  checks: [],
  screenshots: [],
  errors: [],
  failures: [],
  started: new Date().toISOString(),
};
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
let browser, page;
const writeReport = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  writeReport();
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      theme: "dark",
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  const loadedPreferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...loadedPreferences,
      map: { ...loadedPreferences.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  await api("view_set", {
    mode: "space-time",
    display: {
      mode: "points",
      bloom: false,
      show_tracks: true,
      trail_gap_minutes: 0,
    },
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.setDefaultTimeout(60000);
  await page.addInitScript(() => {
    window.__chronoscopeCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__chronoscopeCspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI.startsWith("http")
          ? new URL(event.blockedURI).origin
          : event.blockedURI,
      }),
    );
  });
  page.on("pageerror", (e) => {
    report.errors.push(e.message);
    (report.errorDetails ||= []).push({
      message: e.message,
      stack: e.stack,
      afterCheck: report.checks.at(-1)?.name,
    });
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Cesium|WebGL|shader/i.test(message.text())
    )
      report.errors.push(message.text());
  });
  // Cesium assets are local. Any remote browser request would be a regression.
  await page.route("**/*", async (route) => {
    const target = route.request().url();
    if (/^https?:/.test(target) && !target.startsWith(url + "/")) {
      report.publicMapRequests++;
      await route.abort("blockedbyclient");
    } else if (
      route.request().isNavigationRequest() &&
      route.request().resourceType() === "document" &&
      !route.request().frame().parentFrame()
    ) {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": desktopCsp,
        },
      });
    } else await route.continue();
  });
  await page.addInitScript(() => {
    window.__chronoscopeScriptErrors = [];
    const record = (kind, reason) => {
      if (window.__chronoscopeScriptErrors.length >= 20) return;
      window.__chronoscopeScriptErrors.push({
        kind,
        name: String(reason?.name || ""),
        message: String(reason?.message || reason),
        stack: String(reason?.stack || "").slice(0, 16384),
      });
    };
    window.addEventListener("error", (event) =>
      record("error", event.error || event.message),
    );
    window.addEventListener("unhandledrejection", (event) =>
      record("rejection", event.reason),
    );
  });
  const documentResponse = await page.goto(url + "/#token=" + token);
  assert.equal(
    documentResponse.headers()["content-security-policy"],
    desktopCsp,
    "Actual native desktop CSP must govern the test document",
  );
  await page.waitForFunction(
    () =>
      window.__chronoscope?.view.viewer &&
      !window.__chronoscope.busy &&
      window.__chronoscope.snapshot?.count === 3568 &&
      window.__chronoscope.view.points.length > 0,
  );
  await page.evaluate(() => window.__chronoscope.ready);
  await page.evaluate(async () => {
    await window.__chronoscope.view.ready;
    window.__chronoscopeQAViewportChange =
      window.__chronoscope.view.onViewportChange;
    window.__chronoscope.view.onViewportChange = () => {};
  });
  const native = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      s = v.viewer.scene;
    return {
      context: !!s.canvas.getContext("webgl2"),
      cesium: v.viewer.constructor.name,
      canvasWidth: s.canvas.width,
      pointCount: v.points.length,
      mode: s.mode,
    };
  });
  assert(
    native.context && native.canvasWidth > 600 && native.pointCount > 0,
    JSON.stringify(native),
  );
  check(
    "Authenticated Rust bridge renders real hurricane data in native Cesium WebGL",
    native,
  );
  await page.waitForTimeout(250);
  const reuse = await page.evaluate(async () => {
    const c = window.__chronoscope,
      v = c.view;
    await c.refresh(true, false);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    v.rebuildTrails();
    const stems = v.stemsPrimitive,
      glyphs = v.glyphs;
    await c.refresh(true, false);
    const unchanged = stems === v.stemsPrimitive && glyphs === v.glyphs;
    // Cesium may adjust its clipping frustum while new tiles settle. Verify
    // track reuse against identical current camera inputs synchronously.
    v.rebuildTrails();
    const track = v.trails.get(0);
    v.rebuildTrails();
    const tracksReused = track === v.trails.get(0);
    const options = { ...v.display };
    v.setSelection([v.points[0].id]);
    v.rebuildTrails();
    const selected =
      v.selections.length === 1 &&
      stems !== v.stemsPrimitive &&
      track !== v.trails.get(0);
    v.setDisplayOptions({ ...options, show_trails: false });
    const hidden = v.stemSegments === 0;
    v.setDisplayOptions(options);
    const restored = v.stemSegments > 0;
    const camera = v.captureCamera(),
      beforeDrift = v.trails.get(0);
    // Simulate Cesium's observed stationary-camera normalization roundoff.
    v.camera.direction.x += 1e-14;
    v.rebuildTrails();
    const roundoffReused = beforeDrift === v.trails.get(0);
    v.camera.moveRight(0.001);
    v.rebuildTrails();
    const smallMovementInvalidated = beforeDrift !== v.trails.get(0);
    v.restoreCamera(camera);
    v.rebuildTrails();
    const beforeZoom = v.trails.get(0);
    v.zoom(1.2);
    v.rebuildTrails();
    const cameraInvalidated = beforeZoom !== v.trails.get(0);
    v.restoreCamera(camera);
    v.rebuildTrails();
    v.setFocus(0.25);
    const focus = v.focusLines.get(0);
    v.setFocus(0.75);
    const focusReused = focus === v.focusLines.get(0);
    v.setFocus(0.5);
    await c.refresh(true, false);
    return {
      unchanged,
      tracksReused,
      selected,
      hidden,
      restored,
      cameraInvalidated,
      roundoffReused,
      smallMovementInvalidated,
      focusReused,
    };
  });
  assert(Object.values(reuse).every(Boolean), JSON.stringify(reuse));
  check(
    "Unchanged refreshes retain GPU resources; selection, style and camera invalidate them",
    reuse,
  );
  // Renderer-only fixture: preserve every glyph and its fade, then count actual
  // WebGL uploads. This detects the sparse-upload bottleneck independently of
  // Cesium's implementation details and keeps source/backend testing separate.
  const fadeBatch = await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    const saved = {
      points: v.points,
      names: v.names,
      bounds: [...v.bounds],
      time: [v.lo, v.hi],
      geometries: v.geometryFeatures,
      options: { ...v.display },
      packet: v.displayLayer.packet,
      camera: v.captureCamera(),
      viewport: v.onViewportChange,
      changed: v.onSceneChange,
    };
    const gl = v.viewer.canvas.getContext("webgl2"),
      originalUpload = gl.bufferSubData;
    let uploads = 0;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    try {
      const options = {
        ...saved.options,
        mode: "points",
        bloom: false,
        show_points: true,
        show_tracks: true,
        show_trails: true,
      };
      v.setPlayback(false);
      v.setSelection([]);
      v.setDisplayOptions(options);
      await v.displayLayer.set(null, options);
      const count = 10000,
        epoch = 1735689600;
      const points = Array.from({ length: count }, (_, i) => ({
        ...saved.points[0],
        id: `fade-${i}`,
        entity: 0,
        lat: 25 + Math.floor(i / 100) * 0.01,
        lon: -85 + (i % 100) * 0.01,
        time: epoch + i * 2,
        inferred: false,
        centroid: false,
      }));
      await v.setData(
        points,
        ["Fade fixture"],
        [-86, 24, -83, 28],
        [epoch, epoch + count * 2],
      );
      v.fit();
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      v.setPlayback(true);
      const arriving = points.slice(0, 100).map((p, i) => ({
        ...p,
        id: `arriving-${i}`,
        lat: p.lat + 0.002,
        time: p.time + 300,
        inferred: i >= 90,
      }));
      const next = [...points.slice(100), ...arriving];
      await v.setData(
        next,
        ["Fade fixture"],
        [-86, 24, -83, 28],
        [epoch, epoch + count * 2],
      );
      cancelAnimationFrame(v.fadeFrame);
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      gl.bufferSubData = function (...args) {
        uploads++;
        return originalUpload.apply(this, args);
      };
      const alpha = (value) => {
        for (const glyph of v.incoming) {
          const c = glyph.color.clone();
          c.alpha = value;
          glyph.color = c;
        }
        for (const { glyph, alpha } of v.outgoing) {
          const c = glyph.color.clone();
          c.alpha = alpha * (1 - value);
          glyph.color = c;
        }
      };
      for (let i = 1; i <= 12; i++) {
        const f = i / 13;
        alpha(f * f * (3 - 2 * f));
        v.requestRender();
        v.viewer.render();
        await new Promise(requestAnimationFrame);
      }
      const bufferSubDataCalls = uploads;
      gl.bufferSubData = originalUpload;
      alpha(0.5);
      const half = await v.screenshot();
      const ids = [next[0].id, arriving[0].id, arriving[95].id];
      v.setSelection(ids);
      v.rebuildTrails();
      const mapped = next.every((p) => v.glyphById.get(p.id)?.id.id === p.id);
      const during = v.diagnostics(),
        incoming = v.incoming.length,
        outgoing = v.outgoing.length;
      const halfAlphas = v.incoming.every(
        (g) => Math.abs(g.color.alpha - 0.5) < 1e-6,
      );
      v.setPlayback(false);
      const settled = await v.screenshot(),
        after = v.diagnostics();
      return {
        bufferSubDataCalls,
        half,
        settled,
        mapped,
        halfAlphas,
        incoming,
        outgoing,
        during,
        after,
        expectedCount: count,
        context: gl.getContextAttributes(),
      };
    } finally {
      gl.bufferSubData = originalUpload;
      v.setPlayback(false);
      v.setSelection([]);
      v.setDisplayOptions(saved.options);
      await v.setData(
        saved.points,
        saved.names,
        saved.bounds,
        saved.time,
        saved.geometries,
      );
      await v.displayLayer.set(saved.packet, saved.options);
      v.restoreCamera(saved.camera);
      v.onViewportChange = saved.viewport;
      v.onSceneChange = saved.changed;
    }
  });
  for (const key of ["half", "settled"]) {
    fs.writeFileSync(
      path.join(out, `fade-${key}.png`),
      Buffer.from(fadeBatch[key].split(",")[1], "base64"),
    );
    delete fadeBatch[key];
  }
  fs.writeFileSync(
    path.join(out, "fade-batching.json"),
    JSON.stringify(fadeBatch, null, 2),
  );
  assert(fadeBatch.mapped && fadeBatch.halfAlphas);
  assert.equal(fadeBatch.incoming, 100);
  assert.equal(fadeBatch.outgoing, 100);
  assert.equal(
    fadeBatch.during.pointCount + fadeBatch.during.triangleCount,
    fadeBatch.expectedCount,
  );
  assert.equal(fadeBatch.during.selectionCount, 3);
  assert.equal(
    fadeBatch.after.pointCount + fadeBatch.after.triangleCount,
    fadeBatch.expectedCount,
  );
  assert.equal(fadeBatch.after.arrivingPointCount || 0, 0);
  assert.equal(fadeBatch.after.arrivingTriangleCount || 0, 0);
  assert(
    fadeBatch.bufferSubDataCalls < 200,
    `Fade uploads must be batched: ${fadeBatch.bufferSubDataCalls} GL calls for 12 frames`,
  );
  check(
    "Playback preserves point/triangle fades, IDs and selection with bounded GPU uploads",
    fadeBatch,
  );
  const persistence = await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    const saved = {
      points: v.points,
      names: v.names,
      bounds: [...v.bounds],
      time: [v.lo, v.hi],
      geometries: v.geometryFeatures,
      options: { ...v.display },
      packet: v.displayLayer.packet,
      camera: v.captureCamera(),
      viewport: v.onViewportChange,
      changed: v.onSceneChange,
    };
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      v.setPlayback(false);
      v.setDisplayOptions({
        ...saved.options,
        mode: "points",
        bloom: true,
        show_points: true,
        show_trails: true,
      });
      await v.displayLayer.set(null, v.display);
      const epoch = 1735689600;
      const points = Array.from({ length: 12 }, (_, i) => ({
        ...saved.points[0],
        id: `persist-${i}`,
        lat: 25 + i * 0.03,
        lon: -85 + i * 0.02,
        time: epoch + 100 + i * 30,
        entity: 0,
        inferred: i === 0,
        centroid: false,
      }));
      await v.setData(
        points,
        ["Afterimages"],
        [-86, 24, -83, 28],
        [epoch, epoch + 800],
      );
      v.fit();
      v.setPlayback(true);
      await v.setData(
        points.slice(2),
        ["Afterimages"],
        [-86, 24, -83, 28],
        [epoch, epoch + 800],
      );
      const born = v.outgoing.find((x) => x.id === "persist-1").started;
      await wait(450);
      await v.setData(
        points.slice(3),
        ["Afterimages"],
        [-86, 24, -83, 28],
        [epoch, epoch + 800],
      );
      await wait(450);
      await v.setData(
        points.slice(4),
        ["Afterimages"],
        [-86, 24, -83, 28],
        [epoch, epoch + 800],
      );
      const ghost = v.outgoing.find((x) => x.id === "persist-1");
      const retained =
        !!ghost &&
        ghost.started === born &&
        ghost.glyph.color.alpha > 0.2 &&
        ghost.glyph.color.alpha < 0.95;
      const triangleRetained = v.fadingTriangles.length === 1;
      const stemsRetained = v.diagnostics().fadingStemSegments >= 3;
      const noPickIds = v.outgoing.every((x) => x.glyph.id === undefined);
      const currentOnly =
        v.pointById.size === 8 && !v.glyphById.has("persist-1");
      const image = await v.screenshot();
      await wait(1700);
      const oldestExpired =
        !v.outgoing.some((x) => x.id === "persist-1") &&
        v.fadingTriangles.length === 0;
      v.setPlayback(false);
      const clearedOnPause =
        v.outgoing.length === 0 && v.diagnostics().fadingStemSegments === 0;
      v.setPlayback(true);
      await v.setData(
        points.slice(6),
        ["Afterimages"],
        [-86, 24, -83, 28],
        [epoch, epoch + 800],
      );
      const createdAgain = v.outgoing.length === 2;
      v.setDisplayOptions({
        ...v.display,
        show_trails: false,
        show_points: false,
      });
      const clearedOnHide =
        v.outgoing.length === 0 && v.diagnostics().fadingStemSegments === 0;
      return {
        retained,
        triangleRetained,
        stemsRetained,
        noPickIds,
        currentOnly,
        oldestExpired,
        clearedOnPause,
        createdAgain,
        clearedOnHide,
        image,
      };
    } finally {
      v.setPlayback(false);
      v.setDisplayOptions(saved.options);
      await v.setData(
        saved.points,
        saved.names,
        saved.bounds,
        saved.time,
        saved.geometries,
      );
      await v.displayLayer.set(saved.packet, saved.options);
      v.restoreCamera(saved.camera);
      v.onViewportChange = saved.viewport;
      v.onSceneChange = saved.changed;
    }
  });
  fs.writeFileSync(
    path.join(out, "persistent-fade.png"),
    Buffer.from(persistence.image.split(",")[1], "base64"),
  );
  delete persistence.image;
  for (const [name, passed] of Object.entries(persistence))
    assert.equal(passed, true, name);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.setPlayback(true);
    const disabled = !v.playback;
    v.setPlayback(false);
    return disabled;
  });
  assert(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "Afterimages and vertical trails persist across refreshes, expire, clear on pause/hide and respect reduced motion",
    { ...persistence, reducedMotion: reduced },
  );
  const geographicReferences = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return [
      [0, 0],
      [0, 90],
      [40, -75],
      [-35, 151],
      [85, 179.9],
      [-85, -179.9],
    ].map(([lat, lon]) => {
      const p = (lat * Math.PI) / 180,
        l = (lon * Math.PI) / 180;
      const a = 6378137,
        e2 = 6.6943799901413165e-3,
        height = v.groundHeight(lat, lon) + 2;
      const n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
      const expected = [
        (n + height) * Math.cos(p) * Math.cos(l),
        (n + height) * Math.cos(p) * Math.sin(l),
        (n * (1 - e2) + height) * Math.sin(p),
      ];
      const actual = v.position(lat, lon, undefined, true);
      return {
        lat,
        lon,
        errorMeters: Math.hypot(
          actual.x - expected[0],
          actual.y - expected[1],
          actual.z - expected[2],
        ),
      };
    });
  });
  assert(
    geographicReferences.every((p) => p.errorMeters < 1e-6),
    JSON.stringify(geographicReferences),
  );
  check(
    "Independent WGS84 ECEF references agree at equator, hemispheres, poles and date line",
    geographicReferences,
  );
  assert.equal(await page.locator("#entities [data-entity]").count(), 10);
  await page.click("#entity-show-all");
  assert.equal(await page.locator("#entities [data-entity]").count(), 83);
  await page.click("#entity-sort-name");
  const names = await page.locator("#entities .entity-name").allTextContents();
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  await page.click("#entity-show-all");
  await page.locator("#entity-section summary > span").click();
  assert.equal(
    await page.locator("#entity-section").getAttribute("open"),
    null,
  );
  await page.locator("#entity-section summary > span").click();
  check(
    "Entity facets retain top-ten, show-all, clickable sorting and collapse controls",
    { totalEntities: names.length },
  );

  async function idle() {
    await page.evaluate(async () => {
      await window.__chronoscope.filterIdle();
      await window.__chronoscope.displayIdle();
      await window.__chronoscope.editorIdle();
    });
    await page.waitForFunction(() => !window.__chronoscope.busy);
  }
  async function refresh() {
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh(true, false);
    });
    await idle();
  }
  async function mode(name) {
    await page.click(`[data-view="${name}"]`);
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m,
      name,
    );
    await page.evaluate(() => window.__chronoscope.viewModeIdle());
    await idle();
    await page.evaluate(() => window.__chronoscope.view.fit());
    await page.waitForTimeout(300);
  }
  async function shot(name) {
    await page.evaluate(() =>
      window.__chronoscope.view.viewer.scene.requestRender(),
    );
    await page.waitForTimeout(200);
    const file = path.join(out, name + ".png");
    await page.screenshot({ path: file });
    const png = PNG.sync.read(fs.readFileSync(file));
    assert(png.width === 1800 && png.height === 1100);
    report.screenshots.push(file);
    writeReport();
  }
  // Detailed navigation, scrubbing, table selection and search live in their
  // focused suites. This suite owns the cross-component workspace round trip.
  await api("select", { ids: [] });
  await refresh();
  await mode("space-time");
  const originalHeight = await page.evaluate(
    () => window.__chronoscope.view.timeHeight,
  );
  await page.locator("#time-height").evaluate((el) => {
    el.value = "4.2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => window.__chronoscope.view.timeHeight === 4.2,
  );
  assert.notEqual(originalHeight, 4.2);
  await page.click('[data-tab="views"]');
  await page.click("#display-tracks");
  await idle();
  assert.equal((await api("snapshot")).scene.display.show_tracks, false);
  await page.click("#display-tracks");
  await idle();
  const saved = path.join(dir, "cesium-state.chronoscope");
  const savedScene = await page.evaluate(() =>
    window.__chronoscope.captureScene(),
  );
  await api("save", {
    path: saved,
    scene: savedScene,
  });
  await api("open", { path: saved });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh(false, false);
    await c.restoreScene(c.snapshot.scene);
  });
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.timeHeight),
    4.2,
  );
  const restoredCamera = await page.evaluate(
    () => window.__chronoscope.captureScene().cesium_camera,
  );
  for (const field of ["position", "direction", "up"])
    assert(
      savedScene.cesium_camera[field].every(
        (n, i) => Math.abs(n - restoredCamera[field][i]) < 1e-6,
      ),
      `Native camera ${field} must round-trip portable workspace`,
    );
  check(
    "Live time-height input, independent tracks and portable scene state persist",
    { workspace: path.basename(saved) },
  );

  // WKT and time-only interpolation use the real importer/renderer, never fake IDs.
  const timeOnly = path.join(dir, "time-only.csv");
  fs.writeFileSync(
    timeOnly,
    "entity,timestamp,latitude,longitude,label\nVehicle,2026-10-15T10:00:32Z,43.24,-79.97,Start\nVehicle,2026-10-15T10:30:59Z,,,Unknown location\nVehicle,2026-10-15T11:00:22Z,43.25,-79.95,End\n",
  );
  let preview = await api("import_preview", { path: timeOnly });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "space-time",
    display: { mode: "points", bloom: false },
  });
  await refresh();
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene(c.snapshot.scene);
  });
  await page.waitForFunction(
    () => window.__chronoscope.view.trianglePoints.length === 1,
  );
  const sourceUnknown = (await api("events", { limit: 10 })).events.find(
    (e) => e.label === "Unknown location",
  );
  assert.equal(sourceUnknown.lat, null);
  assert.equal(sourceUnknown.lon, null);
  for (const name of ["map", "globe", "space-time"]) {
    await mode(name);
    assert.equal(
      await page.evaluate(
        () => window.__chronoscope.view.trianglePoints.length,
      ),
      1,
    );
  }
  await shot("time-only-triangle");
  check(
    "Time-only triangle interpolation remains display-only in all geographic modes",
    { id: sourceUnknown.id },
  );

  // Dense local fixture exercises default clustering and all optional effects.
  const dense = path.join(dir, "dense.csv"),
    count = 12000;
  fs.writeFileSync(
    dense,
    "entity,timestamp,latitude,longitude,value\n" +
      Array.from(
        { length: count },
        (_, i) =>
          `Team ${i % 4},2026-10-15T${String(10 + Math.floor((i % 120) / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z,${43.24 + (i % 101) * 0.00004},${-79.97 + (i % 67) * 0.00004},${i % 20}`,
      ).join("\n"),
  );
  preview = await api("import_preview", { path: dense });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "map",
    display: { mode: "auto", bloom: false },
  });
  await refresh();
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene(c.snapshot.scene);
  });
  await mode("map");
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.displayLayer.active &&
      window.__chronoscope.view.displayLayer.packet.count === 12000,
  );
  const clusters = await page.evaluate(() => ({
    packet: window.__chronoscope.view.displayLayer.packet.bins.length,
    diagnostics: window.__chronoscope.view.displayLayer.diagnostics,
  }));
  assert(clusters.packet < count && clusters.diagnostics.clusterPoints > 0);
  const cell = await page.evaluate(() =>
    window.__chronoscope.view.displayLayer.packet.bins.find((b) => b.count > 1),
  );
  assert(cell);
  const exact = await api("attribute_table", {
    display_cell: cell.cell,
    apply_filter: true,
    limit: 10,
  });
  assert.equal(exact.count, cell.count);
  check(
    "Default dense display uses bounded native clusters with exact member counts",
    {
      clusterCount: clusters.packet,
      cellCount: cell.count,
      diagnostics: clusters.diagnostics,
    },
  );
  await shot("dense-clusters");
  await page.waitForFunction(() =>
    window.__chronoscope.view.displayLayer.hits.some((h) => h.bin.count > 1),
  );
  const nativeCell = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      r = v.host.getBoundingClientRect();
    return v.displayLayer.hits
      .filter((h) => h.bin.count > 1)
      .map((h) => ({
        x: r.x + h.x,
        y: r.y + h.y,
        count: h.bin.count,
        cell: h.bin.cell,
      }))
      .find((h) => document.elementFromPoint(h.x, h.y)?.tagName === "CANVAS");
  });
  assert(nativeCell, "A real native cluster must be visible and pickable");
  await page.mouse.click(nativeCell.x, nativeCell.y);
  await page.waitForSelector("#cell-table");
  await page.click("#cell-table");
  await page.waitForFunction(
    () =>
      document.querySelector("#table-tabs [role=tab][aria-selected=true]")
        .textContent === "Display cell members",
  );
  assert.equal(
    (
      await api("attribute_table", {
        display_cell: nativeCell.cell,
        apply_filter: true,
        limit: 10,
      })
    ).count,
    nativeCell.count,
  );
  await page.click("#close-table");
  await page.mouse.click(nativeCell.x, nativeCell.y);
  await page.waitForSelector("#cell-select");
  // A table resize can change screen bins, and partitioned clusters may overlap.
  // Verify the cell actually presented by GPU picking, not the old screen bin.
  const displayedCount = Number(
    (await page.locator(".modal strong").first().textContent())
      .split(" events")[0]
      .replaceAll(",", ""),
  );
  const selectingCell = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/invoke") &&
      request.postDataJSON()?.command === "select_query",
  );
  await page.click("#cell-select");
  const selectedCell = (await selectingCell).postDataJSON().args.display_cell;
  const exactSelection = await api("attribute_table", {
    display_cell: selectedCell,
    apply_filter: true,
    limit: 1000,
    fields: ["id"],
  });
  assert.equal(exactSelection.count, displayedCount);
  assert.equal(exactSelection.events.length, exactSelection.count);
  await page.waitForFunction(
    (n) => window.__chronoscope.snapshot.selected_count === n,
    exactSelection.count,
  );
  assert.deepEqual(
    (await api("snapshot")).selected.sort(),
    exactSelection.events.map((event) => event.id).sort(),
  );
  check(
    "Native cluster picking opens exact member table and selects every member through app controls",
    { count: exactSelection.count },
  );

  // Exercise the actual application viewport callback, not a manually supplied
  // backend rectangle: Columbus needs both its ground and elevated-time prism.
  await api("select", { ids: [] });
  await refresh();
  await mode("space-time");
  const upperEvents = (
    await api("query", {
      limit: 1000,
      sort_by: "time",
      descending: true,
      fields: ["id", "time", "lat", "lon"],
    })
  ).events;
  const beforeViewport = await page.evaluate((events) => {
    const v = window.__chronoscope.view,
      ground = v.visibleBounds(),
      data = v.visibleDataBounds(),
      width = v.viewer.canvas.clientWidth,
      height = v.viewer.canvas.clientHeight;
    let visibleUpper = 0,
      omittedUpper = 0;
    for (const e of events) {
      if (e.lat == null || e.lon == null) continue;
      const ecef = v.position(e.lat, e.lon, e.time),
        screen = v.project(ecef);
      const cartographic =
          v.scene.globe.ellipsoid.cartesianToCartographic(ecef),
        projected = v.scene.mapProjection.project(cartographic);
      const camera = v.camera.positionWC,
        direction = v.camera.directionWC;
      const forward =
        (projected.z - camera.x) * direction.x +
        (projected.x - camera.y) * direction.y +
        (projected.y - camera.z) * direction.z;
      if (
        forward <= 0 ||
        !screen ||
        screen.x < 0 ||
        screen.y < 0 ||
        screen.x > width ||
        screen.y > height
      )
        continue;
      visibleUpper++;
      if (
        !data ||
        e.lon < data[0] - 1e-8 ||
        e.lon > data[2] + 1e-8 ||
        e.lat < data[1] - 1e-8 ||
        e.lat > data[3] + 1e-8
      )
        omittedUpper++;
    }
    v.onViewportChange = window.__chronoscopeQAViewportChange;
    return {
      ground,
      data,
      mapZoom: v.mapZoom(),
      visibleUpper,
      omittedUpper,
      nativeRectangleAvailable: !!v.camera.computeViewRectangle(
        v.scene.globe.ellipsoid,
      ),
    };
  }, upperEvents);
  assert(
    beforeViewport.ground && beforeViewport.data,
    "Columbus must expose actual ground and data viewport bounds",
  );
  assert(
    beforeViewport.visibleUpper > 0,
    "Test must contain visible high-time records",
  );
  assert.equal(
    beforeViewport.omittedUpper,
    0,
    "Time-prism culling must retain visible elevated records",
  );
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  await page.evaluate(() => window.__chronoscope.view.zoom(1.8));
  await page.waitForTimeout(500);
  const zoomViewport = await page.evaluate(() =>
    window.__chronoscope.view.visibleBounds(),
  );
  assert(
    zoomViewport && area(zoomViewport) < area(beforeViewport.ground) * 0.85,
    "Native Columbus zoom must contract its geographic ground footprint",
  );
  const zoomMapZoom = await page.evaluate(() =>
    window.__chronoscope.view.mapZoom(),
  );
  assert(
    zoomMapZoom > beforeViewport.mapZoom + 0.1,
    "Columbus map-layer zoom must increase with its contracted geographic footprint",
  );
  const declustering = [];
  for (let i = 0; i < 4; i++) {
    const state = await page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        cells: v.displayLayer.packet?.bins.length || 0,
        count: v.displayLayer.packet?.count,
        aggregated: v.displayLayer.packet?.aggregated,
        level: v.displayLayer.packet?.level,
        mapZoom: v.mapZoom(),
        points: v.points.length,
        bounds: v.visibleDataBounds(),
      };
    });
    declustering.push(state);
    if (
      state.count > 0 &&
      state.count < 2000 &&
      !state.aggregated &&
      state.points > 0
    )
      break;
    await page.evaluate(() => {
      const v = window.__chronoscope.view;
      v.zoom(2);
      v.onViewportChange();
    });
    await page
      .waitForFunction(
        () => {
          const v = window.__chronoscope.view;
          return (
            v.displayLayer.packet?.count > 0 &&
            v.displayLayer.packet.count < 2000 &&
            !v.displayLayer.active &&
            v.points.length > 0
          );
        },
        {},
        { timeout: 2500 },
      )
      .catch(() => {});
  }
  const declustered = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      count: v.displayLayer.packet?.count,
      active: v.displayLayer.active,
      points: v.points.length,
      level: v.displayLayer.packet?.level,
      mapZoom: v.mapZoom(),
      exactTotal: window.__chronoscope.snapshot.visible,
    };
  });
  assert(
    declustered.count > 0 &&
      declustered.count < 2000 &&
      !declustered.active &&
      declustered.points > 0,
    JSON.stringify({ declustering, declustered }),
  );
  assert.equal(
    declustered.exactTotal,
    count,
    "Viewport declustering must not change exact source/filter totals",
  );
  assert(
    declustered.level > declustering[0].level,
    "Actual backend display-cell level must refine while Columbus zooms in",
  );
  check(
    "Live Columbus viewport contracts on zoom, retains elevated evidence and declusters exact records",
    { beforeViewport, zoomViewport, zoomMapZoom, declustering, declustered },
  );
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
  });
  await refresh();
  await mode("map");

  await api("select", { ids: [] });
  for (const representation of ["density", "heatmap", "bloom"]) {
    await api("view_set", {
      mode: "space-time",
      display: {
        mode: "points",
        bloom: false,
        show_points: false,
        show_tracks: false,
        show_trails: false,
      },
    });
    await refresh();
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.restoreScene(c.snapshot.scene);
    });
    await page.waitForFunction(
      () => window.__chronoscope.view.scene.globe.tilesLoaded,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.__chronoscope.view.scene.requestRender();
        await new Promise(requestAnimationFrame);
      }
    });
    const baselineCanvas = await page
      .locator(".cesium-widget canvas")
      .screenshot();
    const effectCamera = await page.evaluate(() =>
      window.__chronoscope.view.captureCamera(),
    );
    fs.writeFileSync(
      path.join(out, `dense-${representation}-off-canvas.png`),
      baselineCanvas,
    );
    await api("view_set", {
      mode: "space-time",
      display: {
        mode: representation === "bloom" ? "points" : representation,
        bloom: representation === "bloom",
        show_points: false,
        show_tracks: false,
        show_trails: false,
      },
    });
    await refresh();
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.restoreScene(c.snapshot.scene);
    });
    await page.waitForFunction((kind) => {
      const d = window.__chronoscope.view.displayLayer.diagnostics;
      return (
        !d.pending &&
        !d.error &&
        (kind === "density" ? d.densityInstances > 0 : d.atlasLayers > 0)
      );
    }, representation);
    await page.evaluate(
      (camera) => window.__chronoscope.view.restoreCamera(camera),
      effectCamera,
    );
    const diagnostics = await page.evaluate(
      () => window.__chronoscope.view.displayLayer.diagnostics,
    );
    // The preceding camera restore schedules a debounced viewport fetch. Keep
    // the packet fixed while checking effect-cache ownership, then restore it.
    await page.evaluate(() => {
      window.__effectViewportCallback =
        window.__chronoscope.view.onViewportChange;
      window.__chronoscope.view.onViewportChange = () => {};
    });
    await page.waitForTimeout(350);
    await page.waitForFunction(
      () =>
        !window.__chronoscope.busy &&
        !window.__chronoscope.view.displayLayer.diagnostics.pending,
    );
    const effectReuse = await page.evaluate(async () => {
      const v = window.__chronoscope.view,
        d = v.displayLayer;
      const resource = d.atlas || d.densityPrimitive;
      const packet = d.packet;
      await d.set(
        {
          ...packet,
          cache_hit: !packet.cache_hit,
          revision: packet.revision + 1,
        },
        v.display,
      );
      const unchanged = resource === (d.atlas || d.densityPrimitive);
      const options = { ...v.display };
      await d.set(packet, {
        ...options,
        bloom_strength: options.bloom_strength + 0.2,
        heat_max: 123,
      });
      const styleInvalidated = resource !== (d.atlas || d.densityPrimitive);
      await d.set(packet, options);
      const originalSet = d.set,
        originalBounds = [...v.bounds];
      let calls = 0,
        deferredPacket;
      d.set = function (...args) {
        calls++;
        return originalSet.apply(this, args);
      };
      try {
        const changedBounds = [...originalBounds];
        changedBounds[0] -= 0.001;
        await v.setData(
          v.points,
          v.names,
          changedBounds,
          [v.lo, v.hi],
          v.geometryFeatures,
          () => true,
          true,
        );
        const beforePacket = calls;
        await d.set(packet, options);
        deferredPacket =
          beforePacket === 0 && calls === 1 && !d.diagnostics.pending;
        await v.setData(
          v.points,
          v.names,
          originalBounds,
          [v.lo, v.hi],
          v.geometryFeatures,
          () => true,
          true,
        );
        await d.set(packet, options);
      } finally {
        d.set = originalSet;
      }
      return { unchanged, styleInvalidated, deferredPacket };
    });
    await page.evaluate(() => {
      window.__chronoscope.view.onViewportChange =
        window.__effectViewportCallback;
      delete window.__effectViewportCallback;
    });
    assert(
      Object.values(effectReuse).every(Boolean),
      JSON.stringify(effectReuse),
    );
    await page.waitForFunction(
      () => window.__chronoscope.view.scene.globe.tilesLoaded,
    );
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.__chronoscope.view.scene.requestRender();
        await new Promise(requestAnimationFrame);
      }
    });
    const effectedCanvas = await page
      .locator(".cesium-widget canvas")
      .screenshot();
    fs.writeFileSync(
      path.join(out, `dense-${representation}-on-canvas.png`),
      effectedCanvas,
    );
    const beforePixels = PNG.sync.read(baselineCanvas),
      afterPixels = PNG.sync.read(effectedCanvas);
    assert.equal(beforePixels.width, afterPixels.width);
    assert.equal(beforePixels.height, afterPixels.height);
    let changedPixels = 0;
    for (let i = 0; i < beforePixels.data.length; i += 4)
      if (
        Math.abs(beforePixels.data[i] - afterPixels.data[i]) +
          Math.abs(beforePixels.data[i + 1] - afterPixels.data[i + 1]) +
          Math.abs(beforePixels.data[i + 2] - afterPixels.data[i + 2]) >
        30
      )
        changedPixels++;
    assert(
      changedPixels > 150,
      `${representation} must alter actual canvas pixels with all markers and tracks disabled: ${changedPixels}`,
    );
    if (representation !== "density")
      assert(
        diagnostics.groundOnly,
        representation + " must remain on the ground",
      );
    assert.equal(
      await page.evaluate(() => window.__chronoscope.view.viewer.scene.mode),
      1,
    );
    check(
      "Native Columbus " +
        representation +
        (representation === "density"
          ? " creates native count cells"
          : " uses ground resources"),
      { ...diagnostics, changedCanvasPixels: changedPixels },
    );
    await shot("dense-" + representation);
  }

  // Terrain and WMTS installation/mode matrices have dedicated native suites.
  // Return to an ordinary workspace for import and save/open integration.
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange =
      window.__chronoscopeQAViewportChange;
  });
  await api("view_set", {
    mode: "space-time",
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      show_trails: true,
    },
  });
  await refresh();
  await page.evaluate(() => {
    const c = window.__chronoscope;
    return c.restoreScene(c.snapshot.scene);
  });
  async function importDialog(file) {
    page.once("dialog", (dialog) => dialog.accept(file));
    await page.click("#open");
    await page.waitForSelector("#review-import");
  }
  async function commitImport(count) {
    await page.click("#review-import");
    await page.click("#commit-import");
    await page.waitForFunction(
      (n) =>
        window.__chronoscope.snapshot.count === n &&
        !window.__chronoscope.busy &&
        !document.querySelector("#commit-import"),
      count,
    );
    await idle();
  }
  await importDialog(path.join(root, "tests/fixtures/import/small-study.xlsx"));
  assert.match(
    await page.locator("#import-dialog").innerText(),
    /Match source columns/,
  );
  await commitImport(5);
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.points.length),
    4,
  );
  assert(
    await page.evaluate(() => {
      const p = window.__chronoscope.view.glyphs;
      return Array.from({ length: p.length }, (_, i) => p.get(i).show).some(
        Boolean,
      );
    }),
    "Imported located events are actually visible after clearing effect-only display settings",
  );
  await shot("excel-imported");
  check(
    "Actual Excel import dialog detects worksheet and renders its located records",
    { rows: 5, located: 4 },
  );

  // One native-style picker routes workspaces and data without guessing content.
  assert.equal(await page.locator("#import").count(), 0);
  assert.equal(await page.locator("#open").count(), 1);
  const fileRoutes = [];
  const recordFileRoute = (request) => {
    if (!request.url().endsWith("/api/invoke")) return;
    const payload = request.postDataJSON();
    if (["open", "import_preview"].includes(payload?.command))
      fileRoutes.push({ command: payload.command, path: payload.args.path });
  };
  page.on("request", recordFileRoute);
  const workspacePaths = [
    path.join(dir, "Unified Open.CHRONOSCOPE"),
    path.join(dir, "legacy.chrono.JSON"),
  ];
  for (const [index, file] of workspacePaths.entries()) {
    await api("save", {
      path: file,
      scene: await page.evaluate(() => window.__chronoscope.captureScene()),
    });
    const opened = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/invoke") &&
        r.request().postDataJSON()?.command === "open" &&
        r.request().postDataJSON()?.args.path === file,
    );
    page.once("dialog", (dialog) => dialog.accept(file));
    if (index === 0) await page.click("#open");
    else await page.keyboard.press("Control+o");
    assert((await opened).ok());
    await idle();
    assert.equal((await api("snapshot")).count, 5);
    assert.equal(await page.locator("#commit-import").count(), 0);
    assert.deepEqual(fileRoutes.at(-1), { command: "open", path: file });
  }
  assert.equal(fileRoutes.length, 2, "Workspaces never enter data import");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => window.__chronoscope.openFile());
  assert.equal(fileRoutes.length, 2, "Cancelled picker does not dispatch");

  const source = path.join(root, "tests/fixtures/import/small-study.xlsx");
  const previewed = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.request().postDataJSON()?.command === "import_preview" &&
      r.request().postDataJSON()?.args.path === source,
  );
  page.once("dialog", (dialog) => dialog.accept(source));
  await page.keyboard.press("Control+i");
  assert((await previewed).ok());
  await page.waitForSelector("#review-import");
  await page.keyboard.press("Escape");
  assert.equal(
    (await api("snapshot")).count,
    5,
    "Preview cancellation preserves data",
  );

  const guardedPreferences = await api("preferences");
  await api("preferences", {
    preferences: { ...guardedPreferences, auto_save_unsaved: false },
  });
  await api("edit", { id: "1", changes: { note: "Unified Open safeguard" } });
  await refresh();
  const guardedRoutes = fileRoutes.length;
  for (const file of [source, workspacePaths[0]]) {
    page.once("dialog", (dialog) => dialog.accept(file));
    await page.click("#open");
    await page.waitForSelector("#unsaved-cancel");
    await page.click("#unsaved-cancel");
    assert.equal(
      fileRoutes.length,
      guardedRoutes,
      "Unsaved cancel prevents both routes",
    );
    assert.equal(
      (await api("events", { id: "1" })).events[0].note,
      "Unified Open safeguard",
    );
  }
  await api("preferences", { preferences: guardedPreferences });
  await refresh();

  const unsupported = path.join(dir, "unsupported.data");
  fs.writeFileSync(unsupported, "not a supported input");
  const rejectedSource = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.request().postDataJSON()?.command === "import_preview" &&
      r.request().postDataJSON()?.args.path === unsupported,
  );
  page.once("dialog", (dialog) => dialog.accept(unsupported));
  await page.click("#open");
  assert.equal((await rejectedSource).ok(), false);
  await page.waitForSelector("#import-dialog [role=alert]");
  await page.keyboard.press("Escape");
  await page.locator("#import-dialog").waitFor({ state: "detached" });
  await idle();
  assert.deepEqual(fileRoutes.at(-1), {
    command: "import_preview",
    path: unsupported,
  });
  assert.equal(
    (await api("snapshot")).count,
    5,
    "Unsupported input preserves existing data",
  );
  page.off("request", recordFileRoute);
  check(
    "Unified Open routes native and legacy workspaces, imports Excel, preserves data on cancel/error and guards unsaved edits",
    {
      fileRoutes,
      shortcuts: ["Ctrl+O", "Ctrl+I"],
      pickerCancellation: true,
      unsavedCancellation: ["workspace", "data"],
    },
  );

  // Pattern execution and playback pacing are checked once in focused suites.
  await api("select", { ids: ["1", "2"] });
  await refresh();
  const groupSelectionCount = (await api("snapshot")).selected_count;
  assert.equal(groupSelectionCount, 2);
  await page.click('[data-tab="views"]');
  await page.click('[data-views-action="saved"]');
  await page.fill("#view-name", "Cesium reviewed evidence");
  const saveGroupResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.request().postDataJSON()?.command === "save_group",
  );
  await page.click("#save-group");
  const groupResponse = await saveGroupResponse;
  assert(groupResponse.ok(), JSON.stringify(await groupResponse.json()));
  await page.waitForSelector("[data-group-index]");
  const groupCount = (await api("snapshot")).groups.length;
  await page.keyboard.press("Escape");
  await page.click("#clear");
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 0,
  );
  await page.click('[data-views-action="saved"]');
  await page.locator("[data-group-index]").last().click();
  await page.waitForFunction(
    (n) => window.__chronoscope.snapshot.selected_count === n,
    groupSelectionCount,
  );
  check(
    "Saved selection group round-trips exact evidence through application controls",
    { groupCount, selectionCount: groupSelectionCount },
  );
  await api("select", { ids: ["1"] });
  await refresh();
  await page.click('[data-tab="inspect"]');
  await page.waitForSelector("#edit-note");
  await page.fill("#edit-note", "Reviewed in Chronoscope");
  await page.click("#apply-edit");
  await idle();
  assert.equal(
    (await api("events", { id: "1" })).events[0].note,
    "Reviewed in Chronoscope",
  );
  await page.click("#undo");
  await idle();
  assert.notEqual(
    (await api("events", { id: "1" })).events[0].note,
    "Reviewed in Chronoscope",
  );
  await page.click("#redo");
  await idle();
  assert.equal(
    (await api("events", { id: "1" })).events[0].note,
    "Reviewed in Chronoscope",
  );
  check("Inspector editing and undo/redo still operate the shared Rust store", {
    id: "1",
  });

  const flexible = path.join(dir, "flexible-import.csv");
  fs.writeFileSync(
    flexible,
    "entity;date;time;grid\nA;13/10/2026;08:15:59.999;18T WL 8566 1131\nB;03/10/2026;8:16 AM;18TWL856113\n",
  );
  await importDialog(flexible);
  assert.equal(await page.inputValue("#date-order"), "dmy");
  assert.equal(await page.inputValue('[data-map="clock"]'), "2");
  assert.match(
    await page.locator("#normalized-preview").innerText(),
    /08:15.*10 m MGRS grid/s,
  );
  await page.click("#preview-mapping");
  await commitImport(2);
  const shortGrid = (await api("events", { id: "1" })).events[0];
  assert.equal(shortGrid.coordinate_formats.mgrs, "18TWL85661131");
  const shortGridTime = await api("time_parse", {
    value: "2026-10-13 08:15:59.999",
  });
  assert.equal(shortGrid.time, shortGridTime.epoch);
  check(
    "Import UI preserves fractional clocks and recognizes short/spaced MGRS without suffix padding",
    { mgrs: shortGrid.coordinate_formats.mgrs, epoch: shortGrid.time },
  );

  const ambiguous = path.join(dir, "ambiguous.csv");
  fs.writeFileSync(
    ambiguous,
    "entity,date,time,latitude,longitude\nA,03/04/2026,08:15:59.999,40.7483,-73.9857\n",
  );
  await importDialog(ambiguous);
  assert.match(
    await page.locator("#normalized-preview").innerText(),
    /Ambiguous/,
  );
  await page.selectOption("#date-order", "mdy");
  await page.click("#preview-mapping");
  await page.waitForFunction(() =>
    document
      .querySelector("#normalized-preview")
      .textContent.includes("2026-03-04 08:15"),
  );
  await commitImport(1);
  check(
    "Manual date-order override is previewed and committed through the real import controls",
    { expectedUTC: "2026-03-04 08:15" },
  );

  // Rejected-row review/acceptance belongs to guided-workflows-qa.mjs,
  // including rows beyond the preview and full rejection-report export.

  const polarFile = path.join(dir, "polar-events.csv");
  fs.writeFileSync(
    polarFile,
    "entity,timestamp,latitude,longitude\nNorth polar,2026-10-15T10:20Z,89,15\nSouth polar,2026-10-15T11:20Z,-89,-15\n",
  );
  await importDialog(polarFile);
  await commitImport(2);
  const initialPolarFrame = await page.evaluate(() => ({
    bounds: [...window.__chronoscope.view.bounds],
    points: window.__chronoscope.view.points.length,
  }));
  assert(
    initialPolarFrame.bounds[1] <= -89 &&
      initialPolarFrame.bounds[3] >= 89 &&
      initialPolarFrame.points === 2,
    "Import's initial frame and render packet must include both poles before any manual fit",
  );
  const polarSource = (await api("events", { limit: 10 })).events;
  assert.deepEqual(
    polarSource.map((e) => e.lat).sort((a, b) => a - b),
    [-89, 89],
  );
  const polarModes = [];
  for (const name of ["space-time", "map", "globe"]) {
    await mode(name);
    const state = await page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        mode: v.mode,
        frame: [...v.bounds],
        dataBounds: v.visibleDataBounds(),
        width: v.viewer.canvas.clientWidth,
        height: v.viewer.canvas.clientHeight,
        markers: Array.from({ length: v.glyphs.length }, (_, i) => {
          const marker = v.glyphs.get(i),
            source = v.scene.globe.ellipsoid.cartesianToCartographic(
              marker.position,
            ),
            pixel = v.projectEvent(marker.id.id);
          return {
            id: marker.id.id,
            lat: (source.latitude * 180) / Math.PI,
            show: marker.show,
            pixel,
            picked:
              pixel &&
              v.scene
                .drillPick(pixel, 20, 9, 9)
                .some(
                  (hit) =>
                    hit.id?.kind === "event" && hit.id.id === marker.id.id,
                ),
          };
        }),
      };
    });
    assert(
      state.frame[1] <= -89 && state.frame[3] >= 89,
      name + " initial data frame must include both polar events",
    );
    assert.equal(
      state.markers.length,
      2,
      name + " keeps both measured markers",
    );
    assert.deepEqual(
      state.markers.map((m) => Math.round(m.lat)).sort((a, b) => a - b),
      [-89, 89],
    );
    for (const marker of state.markers)
      assert(
        Math.abs(Math.abs(marker.lat) - 89) < 1e-9 && marker.show,
        name + " must retain exact polar marker positions",
      );
    if (name !== "globe") {
      assert(
        state.dataBounds &&
          state.dataBounds[1] <= -89 &&
          state.dataBounds[3] >= 89,
        name + " fitted visible data bounds must include polar records",
      );
      for (const marker of state.markers)
        assert(
          marker.pixel &&
            marker.pixel.x >= 0 &&
            marker.pixel.x <= state.width &&
            marker.pixel.y >= 0 &&
            marker.pixel.y <= state.height,
          name + " must actually frame the polar marker on the canvas",
        );
      assert(
        state.markers.some((m) => m.picked),
        name + " must expose an actual native GPU-pickable polar event",
      );
    }
    polarModes.push(state);
  }
  check(
    "Actual polar CSV import, initial fit and native marker picking retain ±89° data across geographic modes",
    { initialPolarFrame, modes: polarModes },
  );

  assert.equal(
    report.publicMapRequests,
    0,
    "No browser-side public provider traffic in local validation",
  );
  report.scriptErrors = await page.evaluate(
    () => window.__chronoscopeScriptErrors,
  );
  assert.deepEqual(report.errors, [], "No uncaught browser errors");
  report.cspViolations = await page.evaluate(
    () => window.__chronoscopeCspViolations,
  );
  assert.deepEqual(
    report.cspViolations,
    [],
    "No native desktop content-security-policy violations",
  );
  assert.deepEqual(
    report.failures,
    [],
    "All native navigation assertions must pass",
  );
  report.passed = true;
} catch (error) {
  report.failure = error.stack || String(error);
  if (page) {
    try {
      await page.screenshot({ path: path.join(out, "failure.png") });
      report.failureState = await page.evaluate(() => ({
        text: document.body.innerText.slice(-7000),
        mode: window.__chronoscope?.view.mode,
        diagnostics: window.__chronoscope?.view.displayLayer?.diagnostics,
        resources: window.__chronoscope?.view.resources?.status,
        cspViolations: window.__chronoscopeCspViolations,
      }));
    } catch {}
  }
  throw error;
} finally {
  report.finished = new Date().toISOString();
  writeReport();
  if (browser) await browser.close();
  server.kill("SIGTERM");
  console.log("Report:", path.join(out, "report.json"));
}
