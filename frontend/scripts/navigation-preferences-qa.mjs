import {
  chromium,
  spawn,
  localServerUrl,
  createApi,
  qaPaths,
} from "./qa-runtime.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir = qaPaths.out;
const profile = fs.mkdtempSync(path.join(qaPaths.data, "profile-"));
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(profile, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI ||
    path.join(
      root,
      "target/debug/chronoscope" + (process.platform === "win32" ? ".exe" : ""),
    ),
  [
    "--data-dir",
    profile,
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
const report = { passed: false, checks: [], errors: [], screenshots: [] };
let browser;
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);

  const defaults = await api("preferences");
  assert.equal(defaults.theme, "system");
  assert.equal(defaults.date_format, "system");
  assert.equal(defaults.time_format, "system");
  await api("preferences", {
    preferences: {
      theme: "dark",
      basemap: "none",
      map_layers: [],
      map: { ...defaults.map, enabled: false },
      auto_save_unsaved: false,
      terrain_builtin: false,
      terrain_path: null,
    },
  });
  await api("wmts_access", { settings: { offline: true } });
  const csv = path.join(profile, "second-events.csv"),
    base = Date.UTC(2026, 9, 25) / 1000;
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,category,value\n" +
      Array.from(
        { length: 120 },
        (_, i) =>
          `Track ${i % 2},${new Date((base + i) * 1000).toISOString()},${37.78 + i * 0.00005},${-122.41 + i * 0.00005},${i % 3},${i}`,
      ).join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "space-time",
    inspector_tab: "views",
    display: {
      mode: "points",
      spatial_culling: false,
      trail_gap_minutes: 0,
      trail_pixels: 0,
    },
  });
  const source = (await api("events", { limit: 200 })).events;
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("Cesium render failure"))
      report.errors.push(m.text());
  });
  await page.route("**/*", (r) =>
    /^https?:/.test(r.request().url()) &&
    !r
      .request()
      .url()
      .startsWith(url + "/")
      ? r.abort()
      : r.continue(),
  );
  const boot = async () => {
    await page.waitForFunction(
      () =>
        window.__chronoscope?.snapshot?.count === 120 &&
        !window.__chronoscope.busy,
    );
    await page.evaluate(() => window.__chronoscope.ready);
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.filterIdle();
      await c.displayIdle();
      await c.refresh(true, false);
    });
  };
  await page.goto(url + "/#token=" + token);
  await boot();
  const capture = async (name) => {
    const file = path.join(qaPaths.screenshots, name + ".png");
    await page.screenshot({
      path: file,
      animations: "disabled",
    });
    report.screenshots.push(path.relative(dir, file));
  };
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const camera = JSON.stringify(window.__chronoscope.view.captureCamera());
    const previous = window.__appearanceSettling;
    if (!previous || previous.camera !== camera) {
      window.__appearanceSettling = { camera, since: performance.now() };
      return false;
    }
    return (
      !window.__chronoscope.busy && performance.now() - previous.since > 300
    );
  });
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    window.__appearanceProbe = {
      viewer: v.viewer,
      provider: v.scene.terrainProvider,
      camera: JSON.stringify(v.captureCamera()),
      rasterCalls: 0,
      terrainCalls: 0,
    };
    for (const [name, key] of [
      ["setRasters", "rasterCalls"],
      ["setTerrain", "terrainCalls"],
    ]) {
      const original = v[name].bind(v);
      v[name] = (...args) => {
        window.__appearanceProbe[key]++;
        return original(...args);
      };
    }
  });
  await page.locator("#settings").click();
  await page.locator("#pref-theme").selectOption("system");
  await page.locator("#save-preferences").click();
  await page.waitForSelector(".preferences-dialog", { state: "detached" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "light" &&
      !window.__chronoscope.busy,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dark" &&
      !window.__chronoscope.busy,
  );
  await page.locator("#theme").click();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "light" &&
      !window.__chronoscope.busy,
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await page.locator("#theme").click();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dark" &&
      !window.__chronoscope.busy,
  );
  const retained = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      p = window.__appearanceProbe;
    return {
      viewer: v.viewer === p.viewer,
      provider: v.scene.terrainProvider === p.provider,
      camera: JSON.stringify(v.captureCamera()) === p.camera,
      rasterCalls: p.rasterCalls,
      terrainCalls: p.terrainCalls,
    };
  });
  if (!retained.camera)
    console.log(
      "CAMERA EVIDENCE",
      await page.evaluate(() => ({
        before: window.__appearanceProbe.camera,
        after: JSON.stringify(window.__chronoscope.view.captureCamera()),
      })),
    );
  assert.deepEqual(retained, {
    viewer: true,
    provider: true,
    camera: true,
    rasterCalls: 0,
    terrainCalls: 0,
  });
  assert.equal(await page.locator("#geography-readout").count(), 0);
  check(
    "System appearance follows live OS changes; explicit themes retain camera, viewer and map resources; terrain banner removed",
  );
  assert.equal(
    await page.locator("#fullscreen,#screenshot,#globe-time").count(),
    0,
  );
  assert(
    (await page.locator("#navigate svg path").getAttribute("d")).includes(
      "M18 11",
    ),
  );
  check("Redundant canvas icons removed; hand icon identifies drag navigation");
  await page.locator("#settings").click();
  await page.locator("#pref-theme").selectOption("light");
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await page.locator("#pref-render-budget").selectOption("100000");
  await page.getByRole("tab", { name: "General", exact: true }).click();
  assert.equal(await page.inputValue("#pref-theme"), "light");
  await page.locator("#pref-coordinates").selectOption("utm");
  await page.locator("#pref-date-format").selectOption("mdy-short");
  await page.locator("#pref-time-format").selectOption("24h-seconds");
  const nav = await page.locator(".preferences-nav").boundingBox(),
    panel = await page.locator(".preferences-panels").boundingBox();
  assert(nav.x + nav.width < panel.x);
  await capture("preferences-dark");
  await page.getByRole("tab", { name: "General", exact: true }).focus();
  await page.keyboard.press("End");
  assert.equal(
    await page
      .getByRole("tab", { name: "Agent access", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: "General", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await api("preferences")).theme, "dark");
  assert.equal((await api("preferences")).date_format, "system");
  check(
    "Preferences use keyboard-accessible left categories/right settings, preserve drafts, and Cancel discards edits",
  );
  await page.locator("#settings").click();
  await page.locator("#pref-theme").selectOption("light");
  await page.locator("#pref-coordinates").selectOption("utm");
  await page.locator("#pref-date-format").selectOption("mdy-short");
  await page.locator("#pref-time-format").selectOption("24h-seconds");
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await page.locator("#pref-render-budget").selectOption("100000");
  await page.locator("#save-preferences").click();
  await page.waitForSelector(".preferences-dialog", { state: "detached" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal((await api("preferences")).coordinates, "utm");
  assert.equal((await api("preferences")).date_format, "mdy-short");
  assert.equal((await api("preferences")).time_format, "24h-seconds");
  assert(
    (await page.locator("#range-label").textContent()).includes("10/25/26"),
  );
  assert(
    (await page.locator("#range-label").textContent()).includes("00:00:00"),
  );
  assert(
    (await page.inputValue("#exact-start")) === "" ||
      (await page.inputValue("#exact-start")).startsWith("2026-10-25"),
  );
  check(
    "Saved date/time choices update UTC readouts while exact edit fields keep canonical timestamps",
  );
  await page.locator("#settings").click();
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  assert.equal(await page.inputValue("#pref-render-budget"), "100000");
  await capture("preferences-light");
  await page.setViewportSize({ width: 540, height: 850 });
  const bounds = await page.locator(".preferences-dialog").boundingBox();
  assert(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 540 &&
      bounds.y + bounds.height <= 850,
  );
  await page.getByRole("tab", { name: "Agent access", exact: true }).click();
  assert.equal(
    await page
      .locator(".preferences-panels")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 1000 });
  check(
    "Preferences save across categories and remain usable in light/dark themes and narrow windows",
  );
  const setSlider = async (selector, value) => {
    await page.locator(selector).evaluate((e, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  await page.locator('[data-view="globe"]').click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.mode === "globe" && !window.__chronoscope.busy,
  );
  await page.locator("#time-elevation").hover();
  await page.waitForSelector("#time-elevation-popup:not([hidden])");
  assert(await page.locator("#globe-time-height").isEnabled());
  assert.equal(await page.inputValue("#globe-time-height"), "0");
  await capture("single-elevation-slider");
  await page.locator("#globe-time-height").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.scene.globe_time &&
      window.__chronoscope.view.globeTime,
  );
  assert(
    (await page.evaluate(() => window.__chronoscope.view.globeTimeScale)) >=
      0.05,
  );
  await setSlider("#globe-time-height", 100);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.scene.globe_time_scale === 20,
  );
  await page.locator("#globe-time-height").focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () =>
      !window.__chronoscope.snapshot.scene.globe_time &&
      !window.__chronoscope.view.globeTime,
  );
  assert(await page.locator("#globe-time-height").isEnabled());
  assert.equal(
    await page.locator("#time-elevation-value").textContent(),
    "Ground",
  );
  await page.keyboard.press("Escape");
  check(
    "Globe elevation has one enabled slider: zero flattens Events; keyboard/nonzero/max enable elevation",
  );
  await page.locator('[data-view="space-time"]').click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.mode === "space-time" &&
      !window.__chronoscope.busy,
  );
  await page.locator("#time-elevation").hover();
  await setSlider("#time-height", 0);
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.timeHeightMeters),
    0,
  );
  assert.equal(
    await page.locator("#time-elevation-value").textContent(),
    "Ground",
  );
  await page.keyboard.press("Escape");
  await page.locator("#time-rail-playback").click();
  assert.equal(await page.locator("#playback-fade").inputValue(), "50");
  assert(
    (await page.locator("#time-rail-playback-popup").boundingBox()).width <=
      220,
  );
  const sliderStyle = await page.locator("#playback-fade").evaluate((e) => ({
    type: e.type,
    width: e.getBoundingClientRect().width,
    height: e.getBoundingClientRect().height,
  }));
  assert.equal(sliderStyle.type, "range");
  assert(sliderStyle.width >= 100 && sliderStyle.height >= 16);
  await capture("playback-fade-controls");
  await setSlider("#playback-fade", 0);
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.captureScene().playback_fade,
    ),
    false,
  );
  await page.keyboard.press("Escape");
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  const file = path.join(profile, "zero-height.chronoscope");
  await api("save", { path: file, scene });
  await api("open", { path: file });
  await page.reload();
  await boot();
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.timeHeight),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.playbackFade),
    false,
  );
  assert.deepEqual((await api("events", { limit: 200 })).events, source);
  check(
    "Zero Space-time height and Fade off survive portable save/reopen; original coordinates/timestamps stay unchanged",
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene({ ...c.captureScene(), expanded: true });
  });
  assert.equal(
    await page
      .locator("body")
      .evaluate((e) => e.classList.contains("fullscreen")),
    false,
  );
  assert(
    await page
      .getByRole("button", { name: "Expand left pane", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Expand left pane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand right pane", exact: true })
    .click();
  check(
    "Old expanded workspaces migrate to normal, reversible pane collapse controls",
  );
  const resetWindow = async () =>
    page.evaluate(
      async ({ start, end }) => {
        const c = window.__chronoscope;
        await c.filterIdle();
        await c.call("filter", { filter: { start, end } });
        await c.refresh(true, false);
      },
      { start: base + 10, end: base + 30 },
    );
  const configured = await page.evaluate(async () => {
    const c = window.__chronoscope;
    const on = await c.liveViewRequest("view_playback", {
      action: "configure",
      fade: true,
    });
    const off = await c.liveViewRequest("view_playback", {
      action: "configure",
      fade: false,
    });
    return {
      on,
      off,
      amount: Number(document.querySelector("#playback-fade").value),
    };
  });
  assert.equal(configured.on.fade, true);
  assert.equal(configured.off.fade, false);
  assert.equal(configured.amount, 0);
  check(
    "The attached CLI/MCP playback configure action shares the UI Fade setting",
  );
  await resetWindow();
  await page.locator("#time-rail-playback").click();
  await page.locator("#playback-increment").click();
  await page.locator('#playback-increment-menu [data-speed="1"]').click();
  await page.keyboard.press("Escape");
  const initial = await page.evaluate(() => ({
    ids: window.__chronoscope.view.points.map((p) => p.id),
    start: window.__chronoscope.snapshot.filter.start,
  }));
  await page.locator("#play").click();
  await page.waitForFunction(
    // The metadata snapshot can arrive before its queued renderer publication.
    // Observe the retained Events as well as clock progress before asserting.
    ({end,count}) => window.__chronoscope.snapshot.filter.end > end &&
      window.__chronoscope.view.points.length > count,
    {end:base + 33,count:initial.ids.length},
  );
  let playback = await page.evaluate(() => ({
    filter: window.__chronoscope.snapshot.filter,
    ids: window.__chronoscope.view.points.map((p) => p.id),
  }));
  assert.equal(playback.filter.start, initial.start);
  assert(initial.ids.every((id) => playback.ids.includes(id)));
  assert(playback.ids.length > initial.ids.length);
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.view.playback);
  check(
    "Fade off retains earlier playback Events/trails using a growing, exact filter window",
    { initial: initial.ids.length, retained: playback.ids.length },
  );
  await resetWindow();
  await page.locator("#time-rail-playback").click();
  await setSlider("#playback-fade", 50);
  await page.keyboard.press("Escape");
  await page.locator("#play").click();
  await page.waitForFunction(
    (start) => window.__chronoscope.snapshot.filter.start > start,
    base + 13,
  );
  playback = await page.evaluate(() => window.__chronoscope.snapshot.filter);
  assert(
    Math.abs(playback.end - playback.start - 20) < 0.001,
    JSON.stringify(playback),
  );
  await page.locator("#time-rail-playback").click();
  await setSlider("#playback-fade", 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const f = window.__chronoscope.snapshot.filter;
    return f.end - f.start > 20.25;
  });
  const anchored = await page.evaluate(
    () => window.__chronoscope.snapshot.filter,
  );
  await page.waitForFunction(
    (end) => window.__chronoscope.snapshot.filter.end > end,
    anchored.end + 2,
  );
  const accumulated = await page.evaluate(
    () => window.__chronoscope.snapshot.filter,
  );
  assert(Math.abs(accumulated.start - anchored.start) < 0.001);
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.view.playback);
  check(
    "Fade on moves a fixed-width window; toggling off live anchors history without stopping playback",
  );
  await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    v.setPlayback(false);
    v.setPlaybackFade(true);
    v.timeHeight = 2.8;
    v.setDisplayOptions({
      ...v.display,
      show_points: true,
      show_tracks: true,
      show_trails: true,
      trail_gap_minutes: 0,
      trail_pixels: 0,
    });
    const points = Array.from({ length: 20 }, (_, i) => ({
      id: `fade-${i}`,
      entity: 0,
      lon: -122.41 + i * 0.0001,
      lat: 37.78 + i * 0.0001,
      time: i,
      value: i,
      inferred: false,
    }));
    await v.setData(
      points,
      ["Fade fixture"],
      [-122.42, 37.77, -122.4, 37.79],
      [0, 20],
    );
    v.setPlayback(true);
    await v.setData(
      points.slice(10),
      ["Fade fixture"],
      [-122.42, 37.77, -122.4, 37.79],
      [0, 20],
    );
  });
  const fading = await page.evaluate(() =>
    window.__chronoscope.view.diagnostics(),
  );
  assert.deepEqual(fading.fadeDurationsMs, { arrival: 180, departure: 800 });
  assert(
    fading.fadingPointCount > 0 &&
      fading.fadingTrackSegments > 0 &&
      fading.fadingTrailSegments > 0 &&
      fading.fadingStemSegments > 0,
    JSON.stringify(fading),
  );
  await page.waitForFunction(() => {
    const d = window.__chronoscope.view.diagnostics();
    return (
      d.fadingPointCount === 0 &&
      d.fadingTrackSegments === 0 &&
      d.fadingTrailSegments === 0
    );
  });
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.diagnostics().renderErrorCount,
    ),
    0,
  );
  check(
    "Markers, entity tracks, ground trails and stems fade out within the faster 800 ms lifetime",
  );
  const crowded = await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    v.setPlayback(false);
    const points = Array.from({ length: 120 }, (_, i) => ({
      id: `crowd-${i}`,
      entity: i % 40,
      lon: -122.41 + i * 0.00001,
      lat: 37.78 + i * 0.00001,
      time: i,
      value: i,
      inferred: false,
    }));
    const names = Array.from({ length: 40 }, (_, i) => `Track ${i}`);
    await v.setData(points, names, [-122.42, 37.77, -122.4, 37.79], [0, 120]);
    v.setPlayback(true);
    await v.setData(
      points.slice(80),
      names,
      [-122.42, 37.77, -122.4, 37.79],
      [0, 120],
    );
    return { batches: v.fadeTrails.length, diagnostics: v.diagnostics() };
  });
  assert(crowded.batches <= 3, JSON.stringify(crowded));
  assert(
    crowded.diagnostics.fadingTrackSegments > 0 &&
      crowded.diagnostics.fadingTrailSegments > 0,
  );
  check(
    "Crowded departing tracks share bounded GPU batches instead of one primitive per entity",
    { batches: crowded.batches },
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  // Windows keeps the profile database locked until the child has exited.
  if(server.exitCode===null && server.signalCode===null) {
    const closed=new Promise(resolve=>server.once('close',resolve));
    server.kill();await closed;
  }
  const cleanup=fs.realpathSync(profile),base=fs.realpathSync(qaPaths.data);
  if(path.dirname(cleanup)!==base || !path.basename(cleanup).startsWith('profile-'))
    throw Error('Unexpected test profile cleanup scope');
  await fs.promises.rm(cleanup, { recursive: true, force: true, maxRetries:8, retryDelay:100 });
}
