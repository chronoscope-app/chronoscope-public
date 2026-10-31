import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust bridge, real pointer/keyboard input, no public map requests.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-sphere-"));
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
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  passed: false,
  checks: [],
  errors: [],
  csp: [],
  publicRequests: 0,
  screenshots: [],
};
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  await api("demo");
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      theme: "light",
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1720, height: 1080 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const csp = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")),
  ).app.security.csp;
  await page.addInitScript(() => {
    window.__sphereCsp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__sphereCsp.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      return route.abort();
    }
    if (route.request().resourceType() === "document") {
      const response = await route.fetch();
      return route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    }
    return route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  const state = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        bearing: v.bearing(),
        tilt: v.tilt(),
        distance: v.navigationDistance(),
        height: v.timeHeight,
        scale: v.globeTimeScale,
        globeTime: v.globeTime,
        range: [v.lo, v.hi],
        selected: [...v.selected],
        count: window.__chronoscope.snapshot.count,
      };
    });
  const frame = async (mode) => {
    await page.locator(`[data-view="${mode}"]`).click();
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    await page.evaluate((mode) => {
      const v = window.__chronoscope.view;
      v.viewer.render();
      v.lookAtGeographic(
        [-122.407, 37.789, 0],
        mode === "space-time" ? 5200 : 3600,
        mode === "map" ? 0 : 30,
        mode === "map" ? 0 : 35,
      );
      v.requestRender();
    }, mode);
    await page.waitForTimeout(300);
  };
  const drag = async (selector, dx, dy) => {
    const b = await page.locator(selector).boundingBox();
    assert(b);
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    const during = await state();
    await page.mouse.up();
    return during;
  };
  const delta = (a, b) => ((b - a + 540) % 360) - 180;
  assert.equal(
    await page
      .locator(
        '#zoom-in,#zoom-out,[data-nav="top"],#globe-overview,.canvas-control',
      )
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator('#navigation-zoom[type="range"],#navigation-tilt[type="range"]')
      .count(),
    2,
  );
  check(
    "One compass and vertical slider rail; obsolete buttons and bottom strip removed",
  );
  const design = await page.evaluate(() => {
    const sphere = document.querySelector(".navigation-sphere"),
      a = sphere.getBoundingClientRect(),
      b = document.querySelector(".navigation-toolbar").getBoundingClientRect();
    return {
      width: a.width,
      railWidth: b.width,
      centered: Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1,
      stacked: a.bottom < b.top,
      globeDetails: sphere.querySelectorAll(
        "img,.sphere-graticule,.sphere-surface,radialGradient,ellipse",
      ).length,
      roses: sphere.querySelectorAll(".compass-rotation").length,
      cardinals: [...sphere.querySelectorAll(".compass-cardinals text")]
        .map((e) => e.textContent)
        .join(""),
    };
  });
  assert(design.width <= 64 && design.railWidth <= 56, JSON.stringify(design));
  assert(design.centered && design.stacked, JSON.stringify(design));
  assert.equal(design.globeDetails, 0);
  assert.equal(design.roses, 1);
  assert.equal(design.cardinals, "NESW");
  check(
    "Flat compass rose is centered above the slim rail without sphere artwork",
    design,
  );
  for (const mode of ["globe", "space-time"]) {
    await frame(mode);
    assert.equal(await page.locator(".navigation-compass").count(), 1);
    const file = path.join(dir, `compass-${mode}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(path.basename(file));
    const before = await state();
    const during = await drag(".navigation-sphere", 24, -15);
    assert(
      Math.abs(delta(before.bearing, during.bearing) + 16.8) < 1.5,
      JSON.stringify({ before, during }),
    );
    assert(during.tilt > before.tilt + 5, JSON.stringify({ before, during }));
    const after = await state();
    await page.waitForTimeout(200);
    const stopped = await state();
    assert(Math.abs(delta(after.bearing, stopped.bearing)) < 0.1);
    assert.deepEqual(after.selected, before.selected);
    assert.deepEqual(after.range, before.range);
    await page.locator("#navigation-zoom").focus();
    await page.keyboard.press("ArrowUp");
    assert((await state()).distance < stopped.distance, `${mode}: zoom slider`);
    await page.locator(".navigation-sphere").focus();
    await page.keyboard.press("Home");
    assert(Math.abs(delta(0, (await state()).bearing)) < 0.2);
    check(
      `${mode}: compass follows horizontal/vertical drag live, stops on release and preserves data/time/selection`,
      { before, during },
    );
  }
  await frame("globe");
  for (const bearing of [0, 90, 180, 270, 359]) {
    await page.evaluate((heading) => {
      window.__chronoscope.view.setBearing(heading);
    }, bearing);
    await page.waitForTimeout(150);
    const orientation = await page.evaluate(() => {
      const north = document.querySelector(".compass-north-label");
      return {
        bearing: window.__chronoscope.view.bearing(),
        x: Number(north.getAttribute("x")),
        y: Number(north.getAttribute("y")),
        upright: !north.hasAttribute("transform"),
        label: document
          .querySelector(".navigation-compass")
          .getAttribute("aria-label"),
      };
    });
    const angle = (orientation.bearing * Math.PI) / 180;
    assert(Math.abs(orientation.x - (50 - 43 * Math.sin(angle))) < 0.01);
    assert(Math.abs(orientation.y - (50 - 43 * Math.cos(angle))) < 0.01);
    assert(orientation.upright);
    assert(orientation.label.includes("Drag compass to orbit"));
  }
  check(
    "Compass north tracks camera heading through all quadrants; cardinal labels stay upright",
  );
  await frame("globe");
  const zoom = await page.locator("#navigation-zoom").boundingBox();
  const z0 = await state();
  await page.mouse.move(zoom.x + zoom.width / 2, zoom.y + zoom.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(zoom.x + zoom.width / 2, zoom.y + zoom.height * 0.35, {
    steps: 5,
  });
  const z1 = await state();
  assert(z1.distance < z0.distance, JSON.stringify({ z0, z1 }));
  await page.mouse.up();
  const tilt = await page.locator("#navigation-tilt").boundingBox();
  await page.mouse.move(tilt.x + tilt.width / 2, tilt.y + tilt.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(tilt.x + tilt.width / 2, tilt.y + tilt.height * 0.6, {
    steps: 5,
  });
  const t1 = await state();
  assert(t1.tilt > 40 && t1.tilt < 65, JSON.stringify(t1));
  await page.mouse.up();
  await page.locator("#navigation-tilt").focus();
  const tk = await state();
  await page.keyboard.press("ArrowDown");
  assert((await state()).tilt !== tk.tilt);
  check(
    "Zoom and tilt sliders update before release and accept native keyboard input",
  );
  await frame("globe");
  await page.locator("#time-elevation").hover();
  await page.waitForSelector("#time-elevation-popup:not([hidden])");
  await page.waitForTimeout(450);
  assert.equal(
    await page.locator("#control-tooltip.visible").count(),
    0,
    "The time popup must not compete with a redundant generic tooltip",
  );
  assert.equal(
    await page.locator("#time-elevation-title").textContent(),
    "Vertical display",
  );
  if (!(await state()).globeTime)
    await page.locator("#globe-time-height").evaluate((el) => {
      el.value = "51";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.waitForFunction(
    () => window.__chronoscope.view.globeTime && !window.__chronoscope.busy,
  );
  const scaleBefore = (await state()).scale;
  await page.locator("#globe-time-height").focus();
  await page.keyboard.press("ArrowRight");
  assert((await state()).scale > scaleBefore);
  await page.keyboard.press("Escape");
  assert(await page.locator("#time-elevation-popup").isHidden());
  await page.locator("#time-elevation").click();
  assert(await page.locator("#time-elevation-popup").isVisible());
  await page.locator("#navigate").click();
  assert(await page.locator("#time-elevation-popup").isHidden());
  check(
    "Time icon opens on hover/focus; zero-based globe scale works; Escape closes popup",
  );
  await frame("space-time");
  await page.locator("#time-elevation").hover();
  assert.equal(
    await page.locator("#time-elevation-title").textContent(),
    "Vertical display",
  );
  const h0 = await state();
  await page.locator("#time-height").focus();
  await page.keyboard.press("ArrowRight");
  const h1 = await state();
  assert(h1.height > h0.height);
  assert.equal(h1.scale, h0.scale);
  assert.deepEqual(h1.range, h0.range);
  await page.keyboard.press("Escape");
  check(
    "Same popup controls space-time height, independently of globe scale and timestamps",
  );
  await frame("map");
  assert(await page.locator("#navigation-tilt-group").isHidden());
  assert(await page.locator("#navigation-time-group").isHidden());
  const mapScreenshot = path.join(dir, "compass-map.png");
  await page.screenshot({ path: mapScreenshot });
  report.screenshots.push(path.basename(mapScreenshot));
  assert.equal(await page.locator(".navigation-compass").count(), 1);
  const m0 = await state();
  await drag(".navigation-sphere", 20, 12);
  // Cesium's Cartesian round trip can produce 359.999999 degrees at north.
  assert(Math.abs(delta(0, (await state()).bearing)) < 0.0001);
  assert(Math.abs((await state()).tilt) < 0.0001);
  assert.equal((await state()).count, m0.count);
  const flatDistance = (await state()).distance;
  await page.locator("#navigation-zoom").focus();
  await page.keyboard.press("ArrowUp");
  assert((await state()).distance < flatDistance);
  check("2D compass pans; tilt/time controls hide; Events remain intact");
  await page.locator("#box-select").click();
  assert.equal(
    await page.locator("#box-select").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#navigate").click();
  assert.equal(
    await page.locator("#navigate").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#fit").click();
  await page.waitForFunction(
    () =>
      !window.__chronoscope.busy && !document.querySelector("#fit").disabled,
  );
  check("Rail selection/orbit modes and Fit retain their application handlers");
  for (const size of [
    { width: 1720, height: 1080 },
    { width: 1000, height: 700 },
    { width: 1000, height: 580 },
  ]) {
    await page.setViewportSize(size);
    await frame("globe");
    for (const table of [false, true]) {
      const open = await page
        .locator("#table-panel")
        .evaluate((e) => e.getBoundingClientRect().height > 0);
      if (open !== table) {
        if (open) await page.locator("#close-table").click();
        else {
          await page.locator("#toggle-table").click();
          await page
            .locator("#tables-menu [data-table-layer-source]")
            .first()
            .click();
        }
      }
      await page.waitForTimeout(250);
      const bounds = await page.evaluate(() => {
        const read = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          scene: read("#scene"),
          rail: read(".navigation-toolbar"),
          orb: read(".navigation-sphere"),
        };
      });
      assert(
        bounds.rail.bottom <= bounds.scene.bottom + 1,
        JSON.stringify({ size, table, bounds }),
      );
      assert(
        bounds.orb.right <= bounds.scene.right &&
          bounds.orb.x >= bounds.scene.x,
        JSON.stringify(bounds),
      );
    }
  }
  check(
    "Compass and rail fit large/small windows, with and without attribute table",
  );
  await page.setViewportSize({ width: 1720, height: 1080 });
  if (
    await page
      .locator("#table-panel")
      .evaluate((e) => e.getBoundingClientRect().height > 0)
  )
    await page.locator("#close-table").click();
  const cached = process.env.CHRONOSCOPE_QA_BASEMAP_CACHE;
  if (cached) {
    const cache = (await api("wmts_access")).directory;
    fs.cpSync(cached, cache, { recursive: true });
    await api("wmts_access", { settings: { offline: true } });
    await api("preferences", { preferences: { basemap: "streets" } });
  }
  for (const theme of ["light", "dark"]) {
    await api("preferences", { preferences: { theme } });
    await page.reload();
    await page.waitForFunction(
      () =>
        window.__chronoscope?.snapshot?.count === 192 &&
        !window.__chronoscope.busy,
    );
    // Restore can reopen the saved table; close it for the large map showcase.
    if (
      await page
        .locator("#table-panel")
        .evaluate((e) => e.classList.contains("open"))
    )
      await page.locator("#close-table").click();
    await frame("globe");
    if (cached)
      await page.waitForFunction(
        () => {
          const v = window.__chronoscope.view;
          return (
            v.resources.status.basemapRenderedTiles > 0 &&
            v.resources.status.basemapPending === 0 &&
            v.scene.globe.tilesLoaded
          );
        },
        null,
        { timeout: 90000 },
      );
    await page.locator("#time-elevation").hover();
    const file = path.join(dir, `sphere-globe-${theme}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(path.basename(file));
    const scene = await page.locator("#scene").boundingBox();
    const closeup = path.join(dir, `sphere-controls-${theme}.png`);
    await page.screenshot({
      path: closeup,
      clip: {
        x: scene.x + scene.width - 410,
        y: scene.y + 2,
        width: 408,
        height: 490,
      },
    });
    report.screenshots.push(path.basename(closeup));
  }
  await frame("space-time");
  // Frame the exact previously cached study before creating a fresh provider;
  // mode transitions can otherwise request uncached neighboring views offline.
  if (cached)
    await page.evaluate(async () => {
      const v = window.__chronoscope.view;
      await v.setBasemap("none");
      v.lookAtGeographic([-122.407, 37.789, 0], 5200, 0, 38);
      v.viewer.render();
      await v.setBasemap("streets");
    });
  if (cached)
    await page.waitForFunction(
      () => {
        const v = window.__chronoscope.view;
        return (
          v.resources.status.basemapPending === 0 && v.scene.globe.tilesLoaded
        );
      },
      null,
      { timeout: 90000 },
    );
  if (cached) {
    const resources = await page.evaluate(
      () => window.__chronoscope.view.resources.status,
    );
    assert.equal(resources.basemapError, "", JSON.stringify(resources));
    report.streetMap = resources;
  }
  await page.locator("#time-elevation").hover();
  const space = path.join(dir, "sphere-space-time.png");
  await page.screenshot({ path: space });
  report.screenshots.push(path.basename(space));
  check(
    "Light/dark screenshot captures; cached real street source only when explicitly supplied",
  );
  // A regional globe showcase uses the bundled reference map, never public tiles.
  await api("open", {
    path: path.join(
      root,
      "samples/atlantic-hurricanes-2021-2025-tracks.chronoscope",
    ),
  });
  // Opening a saved project restores its map stack; disable it afterwards so
  // this showcase uses only the bundled globe rather than uncached NASA tiles.
  const hurricanePreferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...hurricanePreferences,
      basemap: "none",
      map: { ...hurricanePreferences.map, enabled: false },
      map_layers: [],
      theme: "dark",
    },
  });
  await api("view_set", {
    mode: "globe",
    globe_time: false,
    display: {
      mode: "points",
      bloom: false,
      show_tracks: true,
      show_points: true,
    },
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 1604 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.lookAtGeographic([-57, 25, 0], 14000000, 0, 20);
    v.requestRender();
    v.viewer.render();
  });
  await page.locator("#time-elevation").hover();
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.resources.status.basemapError,
    ),
    "",
  );
  await page.screenshot({
    path: path.join(dir, "stacked-controls-atlantic.png"),
  });
  report.screenshots.push("stacked-controls-atlantic.png");
  assert.equal((await api("snapshot", { compact: true })).count, 1604);
  check(
    "Stacked navigation also frames 1,604 public hurricane Events with tracks",
  );
  report.csp = await page.evaluate(() => window.__sphereCsp);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.csp, []);
  assert.equal(report.publicRequests, 0);
  check(
    "Strict desktop CSP, zero uncaught errors, zero browser requests to public services",
  );
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
}
