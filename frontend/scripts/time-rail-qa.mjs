import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/time-rail");
fs.mkdirSync(dir, { recursive: true });
const profile = fs.mkdtempSync(path.join(dir, "profile-"));
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
const report = { passed: false, checks: [], errors: [], screenshots: [] };
let browser;
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  await api("demo_open", { id: "local-wildlife" });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
      theme: "dark",
    },
  });
  await api("wmts_access", { settings: { offline: true } });
  await api("view_set", {
    mode: "space-time",
    inspector_tab: "views",
    display: {
      mode: "points",
      bloom: false,
      spatial_culling: false,
      show_points: true,
      show_tracks: true,
      show_trails: true,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1720, height: 1080 },
  });
  page.setDefaultTimeout(30000);
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
      window.__chronoscope?.view.renderPoints.length === 3439 &&
      !window.__chronoscope.busy,
  );
  // Initialization restores the saved camera after the first data packet.
  await page.waitForTimeout(500);
  await page.locator("#fit").click();
  await page.waitForFunction(() => !document.querySelector("#fit").disabled);
  await page.waitForFunction(() => window.__chronoscope.view.bounds[0] > -80);
  await page.evaluate(async () => {
    const app = window.__chronoscope,
      v = app.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    await app.filterIdle();
    await app.displayIdle();
    // A button click starts asynchronous refresh; explicitly drain it before
    // measuring a fixed source extent and camera over successive zoom frames.
    await app.refresh(true, false);
    v.fit();
  });
  const idle = () =>
    page.evaluate(async () => {
      await window.__chronoscope.filterIdle();
      await window.__chronoscope.displayIdle();
    });
  const geometry = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      return {
        rail: rect("#time-rail"),
        left: rect(".sidebar"),
        scene: rect("#scene"),
        workspace: rect(".workspace"),
        right: rect(".inspector"),
      };
    });
  const original = await api("snapshot");
  let g = await geometry();
  assert.equal(g.rail.width, 64);
  assert(Math.abs(g.rail.right - g.scene.x) < 1);
  assert(g.rail.x >= g.left.right && g.rail.x - g.left.right <= 7);
  assert(Math.abs(g.scene.height - g.workspace.height) < 1);
  assert.equal(await page.locator("#resize-timeline").count(), 0);
  assert.equal(
    await page.locator("#window-start").getAttribute("aria-orientation"),
    "vertical",
  );
  check(
    "64px rail sits after entities; full map height; vertical accessible range and no bottom timeline",
  );
  await page.click("#collapse-time-rail");
  assert.equal((await geometry()).rail.width, 24);
  assert.equal((await geometry()).left.width, g.left.width);
  await page.click("#collapse-left-pane");
  assert.equal((await geometry()).left.width, 44);
  assert.equal((await geometry()).rail.width, 24);
  await page
    .getByRole("button", { name: "Expand left pane", exact: true })
    .click();
  await page.click("#collapse-time-rail");
  assert.equal((await geometry()).rail.width, 64);
  assert.deepEqual((await api("snapshot")).filter, original.filter);
  check(
    "Entity and time rails collapse independently without changing filters",
  );
  const [lo, hi] = await page.evaluate(
    () => window.__chronoscope.snapshot.time_bounds,
  );
  const rangeStart = lo + (hi - lo) * 0.2,
    rangeEnd = lo + (hi - lo) * 0.7;
  await page.click("#time-rail-range");
  await page.fill(
    "#rail-exact-start",
    new Date(rangeStart * 1000).toISOString(),
  );
  await page.fill("#rail-exact-end", new Date(rangeEnd * 1000).toISOString());
  await page.evaluate(() => window.__chronoscope.refresh(false, false));
  assert((await page.inputValue("#rail-exact-start")).includes("T"));
  await page.click("#rail-exact-apply");
  await page.waitForFunction(
    () => document.querySelector("#time-rail-range-popup").hidden,
  );
  await idle();
  let s = await api("snapshot");
  assert(Math.abs(s.filter.start - rangeStart) < 0.001);
  assert(Math.abs(s.filter.end - rangeEnd) < 0.001);
  assert(s.visible > 0 && s.visible < s.count);
  check(
    "Range popup applies exact UTC timestamps to real Rust filters and retains drafts during refresh",
  );
  for (const which of ["start", "end"]) {
    const other = which === "start" ? "end" : "start";
    const handle = page.locator("#window-" + which),
      label = handle.locator(".time-range-date");
    const before = Number(await handle.getAttribute("aria-valuenow"));
    const r = await handle.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    assert(!(await label.isVisible()));
    await page.mouse.down();
    assert(await label.isVisible());
    assert(
      !(await page
        .locator("#window-" + other + " .time-range-date")
        .isVisible()),
    );
    assert(
      (await label.innerText()).includes(which === "start" ? "Start" : "End"),
    );
    const text = await label.innerText();
    await page.mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2 + 28, {
      steps: 5,
    });
    assert(await label.isVisible());
    assert.notEqual(await label.innerText(), text);
    assert(
      (await label.innerText()).includes("2023") &&
        (await label.innerText()).includes("UTC"),
    );
    const after = Number(await handle.getAttribute("aria-valuenow"));
    assert(after > before);
    await page.screenshot({ path: path.join(dir, "drag-" + which + ".png") });
    report.screenshots.push("drag-" + which + ".png");
    await page.mouse.up();
    await idle();
    assert(!(await label.isVisible()));
    s = await api("snapshot");
    assert(Math.abs(s.filter[which] - (lo + (hi - lo) * after)) < 0.002);
    check(
      which +
        " drag shows only its live date outside the rail; release commits the correct backend timestamp",
    );
  }
  const start = page.locator("#window-start");
  const before = Number(await start.getAttribute("aria-valuenow"));
  await start.press("ArrowUp");
  await idle();
  assert(Number(await start.getAttribute("aria-valuenow")) < before);
  await start.press("ArrowDown");
  await idle();
  assert(
    Math.abs(Number(await start.getAttribute("aria-valuenow")) - before) < 1e-8,
  );
  const windowControl = page.locator("#time-range-window");
  const endBefore = Number(
    await page.locator("#window-end").getAttribute("aria-valuenow"),
  );
  await windowControl.press("ArrowDown");
  await idle();
  assert(
    Number(await page.locator("#window-end").getAttribute("aria-valuenow")) >
      endBefore,
  );
  check(
    "Up/down keys match vertical chronology; moving the window translates both bounds",
  );
  const bin = await page.evaluate(() => {
    const s = window.__chronoscope.snapshot,
      [lo, hi] = s.time_bounds;
    const a = (s.filter.start - lo) / (hi - lo),
      b = (s.filter.end - lo) / (hi - lo);
    return s.histogram
      .map((count, i) => ({ count, i }))
      .filter((x) => x.i / 100 > a && x.i / 100 < b)
      .sort((x, y) => y.count - x.count)[0].i;
  });
  await page
    .locator(`#histogram [data-bin="${bin}"]`)
    .click({ position: { x: 30, y: 2 } });
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count > 0,
  );
  assert((await api("snapshot")).selected_count > 0);
  await api("select", { ids: [] });
  await page.evaluate(() => window.__chronoscope.refresh(false, false));
  check("Vertical density bars retain exact histogram-bin evidence selection");
  await page.click("#toggle-table");
  await page.locator("#tables-menu [data-table-layer-source]").first().click();
  await page.waitForSelector("#table-body [data-event]");
  assert.equal(
    (await geometry()).rail.height,
    (await geometry()).workspace.height,
  );
  assert((await geometry()).scene.height < (await geometry()).workspace.height);
  await page.click("#close-table");
  assert(
    Math.abs(
      (await geometry()).scene.height - (await geometry()).workspace.height,
    ) < 1,
  );
  check(
    "Attribute table shares map height while the time rail spans the workspace",
  );

  await page.click("#time-rail-playback");
  await page.click("#playback-speed");
  await page.locator('#playback-speed-menu [data-speed="1.5"]').click();
  await page.click("#playback-increment");
  await page.locator('#playback-increment-menu [data-speed="3600"]').click();
  await page.click("#time-rail-popup-play");
  await page.waitForFunction(
    () =>
      document.querySelector("#play").getAttribute("aria-pressed") === "true",
  );
  const moving = (await api("snapshot")).filter.start;
  await page.waitForFunction(
    (moving) => window.__chronoscope.snapshot.filter.start !== moving,
    moving,
  );
  await page.click("#time-rail-popup-play");
  await idle();
  assert.equal(
    await page.locator("#play").getAttribute("aria-pressed"),
    "false",
  );
  check(
    "Playback popup controls existing speed, time step and live play/pause",
  );
  await page.click("#close-time-playback");
  await page.click("#collapse-time-rail");
  await page.click("#time-rail-playback");
  assert(await page.locator("#time-rail-popup-play").isVisible());
  await page.click("#time-rail-popup-play");
  await page.waitForFunction(
    () =>
      document.querySelector("#play").getAttribute("aria-pressed") === "true",
  );
  await page.click("#time-rail-popup-play");
  await idle();
  await page.keyboard.press("Escape");
  assert(!(await page.locator("#time-rail-playback-popup").isVisible()));
  assert.equal((await geometry()).rail.width, 24);
  check(
    "Collapsed rail retains popup playback and Escape restores the trigger focus",
  );
  await page.click("#time-rail-range");
  assert(await page.locator("#rail-exact-start").isVisible());
  await page.click("#full-range");
  await idle();
  s = await api("snapshot");
  assert.equal(s.filter.start, null);
  assert.equal(s.filter.end, null);
  await page.keyboard.press("Escape");
  check("Collapsed range popup can restore full data coverage");
  await page.click("#collapse-time-rail");
  await page.click("#fullscreen");
  g = await geometry();
  assert.equal(g.rail.width, 64);
  assert(g.scene.width > g.workspace.width - 70);
  await page.click("#fullscreen");
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1720, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.click("#time-rail-playback");
    const popup = await page.locator("#time-rail-playback-popup").boundingBox();
    assert(
      popup.x >= 0 &&
        popup.y >= 0 &&
        popup.x + popup.width <= size.width &&
        popup.y + popup.height <= size.height,
    );
    await page.keyboard.press("Escape");
    g = await geometry();
    assert(Math.abs(g.scene.height - g.workspace.height) < 1);
  }
  check(
    "Full-height rail survives expanded workspace and resized displays; popups remain on screen",
  );
  await page.screenshot({ path: path.join(dir, "expanded.png") });
  report.screenshots.push("expanded.png");
  await page.click("#collapse-time-rail");
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  const savedFilter = (await api("snapshot")).filter;
  const workspace = path.join(profile, "time-rail.chronoscope");
  await api("save", { path: workspace, scene });
  await api("open", { path: workspace });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3439 &&
      !window.__chronoscope.busy,
  );
  assert.equal((await geometry()).rail.width, 24);
  assert.deepEqual((await api("snapshot")).filter, savedFilter);
  await page.click("#collapse-time-rail");
  assert.equal((await geometry()).rail.width, 64);
  check(
    "Local collapse persists across reload; portable workspace roundtrip retains real filters",
  );
  const diagnostics = await page.evaluate(() =>
    window.__chronoscope.view.diagnostics(),
  );
  assert.equal(diagnostics.renderErrorCount, 0);
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
  server.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
