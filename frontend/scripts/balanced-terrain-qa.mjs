import { chromium, spawn, localServerUrl } from "./qa-runtime.mjs";
// Real bundled terrain, offline browser rendering and persistent lifecycle.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { randomBytes } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/balanced-terrain");
const out = process.env.CHRONOSCOPE_QA_SCREENSHOTS || dir;
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
let server, browser, page, url;
const errors = [],
  external = [],
  states = [];
async function api(command, args = {}) {
  const response = await fetch(url + "/api/invoke", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, args }),
  });
  const body = await response.json();
  assert(response.ok, JSON.stringify(body));
  return body.result;
}
async function start() {
  server = spawn(
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
  url = await localServerUrl(server);
}
async function stop() {
  if (page) {
    await page.close();
    page = null;
  }
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
}
async function open() {
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log(
        "Browser console:",
        message.text().replaceAll(token, "[token]"),
      );
  });
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (
      ["http:", "https:"].includes(u.protocol) &&
      u.hostname !== "127.0.0.1"
    ) {
      external.push(u.origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(() => window.__chronoscope?.ready);
  await page.evaluate(() =>
    Promise.race([
      window.__chronoscope.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("UI initialization timed out")), 60000),
      ),
    ]),
  );
  await page.waitForFunction(() => !window.__chronoscope.busy);
  // The empty terrain-only fixture must enter the workspace before measuring
  // visible pixels or interacting with the renderer's attribution dialog.
  const enter = page.locator("#welcome-empty");
  if (await enter.isVisible()) await enter.click();
}
async function terrain(active) {
  await page.waitForFunction(
    (active) =>
      window.__chronoscope.view.resources.status.terrainActive === active,
    active,
    { timeout: 60000 },
  );
}
async function reopen() {
  await page.close();
  await open();
}
const launchBrowser = () => chromium.launch();

async function navigationContinuity(mode) {
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    const provider = v.viewer.terrainProvider;
    window.__terrainNavigation = {
      provider,
      generation: v.terrainGeneration,
      frames: 0,
      replacements: 0,
      emptyGroundFrames: 0,
    };
    window.__terrainNavigation.stop = v.scene.postRender.addEventListener(
      () => {
        const s = window.__terrainNavigation;
        s.frames++;
        if (v.viewer.terrainProvider !== provider) s.replacements++;
        if (!v.scene.globe._surface._tilesToRender.length)
          s.emptyGroundFrames++;
      },
    );
  });
  await page.locator(".cesium-widget canvas").click();
  for (const key of ["ArrowRight", "ArrowDown", "+", "-", "ArrowLeft"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  }
  const canvas = await page.locator(".cesium-widget canvas").boundingBox();
  const x = canvas.x + canvas.width / 2,
    y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y + 12, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.terrainGeneration >
      window.__terrainNavigation.generation,
  );
  const result = await page.evaluate(() => {
    const s = window.__terrainNavigation;
    s.stop();
    return {
      frames: s.frames,
      replacements: s.replacements,
      emptyGroundFrames: s.emptyGroundFrames,
      sameProvider:
        s.provider === window.__chronoscope.view.viewer.terrainProvider,
    };
  });
  assert.equal(
    result.sameProvider,
    true,
    `${mode}: navigation discarded the terrain/imagery quadtree: ${JSON.stringify(result)}`,
  );
  assert.equal(result.replacements, 0, JSON.stringify(result));
  assert.equal(result.emptyGroundFrames, 0, JSON.stringify(result));
  assert(result.frames > 0);
  states.push({ label: mode + "-navigation-continuity", ...result });
}

async function frame(label, mode, bounds) {
  await page.evaluate(
    async ({ mode, bounds }) => {
      const c = window.__chronoscope;
      await c.restoreScene({ mode, bounds });
      await c.rebuildTerrain(bounds);
      c.view.fit();
      await c.viewModeIdle();
    },
    { mode, bounds },
  );
  await terrain(true);
  // Viewport refinement may replace the provider just after an initially
  // ready frame. Require the same provider generation and loaded tiles across
  // the entire idle measurement, rather than measuring that transition.
  const deadline = Date.now() + 90000;
  let idleFrames;
  const readiness = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        ready:
          v.scene.globe.tilesLoaded &&
          v.scene.globe._surface._tilesToRender.length > 0,
        generation: v.resources.terrainGeneration,
        frames: v.diagnostics().performance.renderedFrames,
      };
    });
  while (Date.now() < deadline) {
    const before = await readiness();
    await page.waitForTimeout(1200);
    const after = await readiness();
    if (
      before.ready &&
      after.ready &&
      before.generation === after.generation &&
      after.frames - before.frames <= 2
    ) {
      idleFrames = after.frames - before.frames;
      break;
    }
  }
  assert.notEqual(
    idleFrames,
    undefined,
    "Terrain did not finish refinement and become idle",
  );
  const state = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      mode: v.mode,
      bounds: v.bounds,
      visible: v.visibleBounds(),
      resources: v.resources.status,
      diagnostics: v.diagnostics(),
      credit: document.querySelector(".cesium-widget-credits")?.textContent,
      providerCredit: v.viewer.terrainProvider.credit?.html,
      paintedHeight: v.scene.globe.getHeight(
        v.camera.positionCartographic.constructor.fromDegrees(
          (v.bounds[0] + v.bounds[2]) / 2,
          (v.bounds[1] + v.bounds[3]) / 2,
        ),
      ),
      camera: { position: v.camera.position, direction: v.camera.direction },
      globeShow: v.scene.globe.show,
      allImageryAndTerrainTilesLoaded: v.scene.globe.tilesLoaded,
      tiles: v.scene.globe._surface._tilesToRender.map((t) => ({
        level: t.level,
        x: t.x,
        y: t.y,
      })),
    };
  });
  state.idleFrames = idleFrames;
  states.push({ label, ...state });
  fs.writeFileSync(
    path.join(out, "browser-progress.json"),
    JSON.stringify(states, null, 2),
  );
  await page.screenshot({ path: path.join(out, label + ".png") });
  assert.equal(state.mode, mode);
  assert(state.resources.terrainCovered > 0);
  assert.equal(state.diagnostics.renderErrorCount, 0);
  assert(state.providerCredit.includes("USGS/NGA GMTED2010"));
  assert(Number.isFinite(state.paintedHeight), JSON.stringify(state));
  assert(state.idleFrames <= 2, JSON.stringify(state));
}
try {
  await start();
  const fresh = await api("preferences");
  assert.equal(fresh.terrain_builtin, true);
  assert.equal(fresh.terrain_vertical_datum, "egm96");
  const info = await api("terrain_info");
  assert.equal(info.tiles[0].width, 21600);
  await api("preferences", {
    preferences: {
      ...fresh,
      basemap: "none",
      map: { ...fresh.map, enabled: false },
      map_layers: [],
    },
  });
  browser = await launchBrowser();
  await open();
  await terrain(true);
  if (!process.env.CHRONOSCOPE_QA_POLAR_ONLY) {
    await frame("himalayas-globe", "globe", [85, 27, 89, 29]);
    await navigationContinuity("globe");
    await page.locator(".cesium-credit-expand-link").click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".cesium-credit-lightbox")].some(
        (e) =>
          e.textContent.includes("USGS/NGA GMTED2010") &&
          e.getBoundingClientRect().width > 0,
      ),
    );
    await page.screenshot({ path: path.join(out, "attribution.png") });
    await page.locator(".cesium-credit-lightbox-close").click();
    await frame("himalayas-map", "map", [85, 27, 89, 29]);
    await navigationContinuity("map");
    await frame("himalayas-space-time", "space-time", [85, 27, 89, 29]);
    await navigationContinuity("space-time");
    await frame("himalayas-refined", "globe", [86.7, 27.8, 87.1, 28.2]);
  }
  // The continuous Map/Globe/Time navigation checks above share one browser.
  // Start the separate polar/lifecycle cases with a fresh GPU allocation.
  await browser.close();
  browser = await launchBrowser();
  await open();
  await frame("antarctic-polar", "globe", [-15, -89.9, 15, -87]);
  await frame("greenland-polar", "globe", [-50, 80, -30, 83]);
  await page.click("#terrain");
  await page.click("#remove-terrain");
  await terrain(false);
  assert.equal((await api("preferences")).terrain_builtin, false);
  await stop();
  await start();
  assert.equal((await api("preferences")).terrain_builtin, false);
  assert.equal(await api("terrain_info"), null);
  await open();
  await terrain(false);
  await page.click("#terrain");
  await page.click("#restore-balanced");
  await terrain(true);
  assert.equal((await api("preferences")).terrain_builtin, true);
  const workspace = path.join(dir, "balanced.chronoscope");
  await api("save", { path: workspace });
  assert(fs.statSync(workspace).size < 1024 * 1024);
  await page.click("#terrain");
  await page.click("#remove-terrain");
  await terrain(false);
  await api("open", { path: workspace });
  // The browser development bridge has no native engine-event subscription.
  // Reopen its page after external CLI/API edits, as on an application restart.
  await reopen();
  await terrain(true);
  assert.equal((await api("preferences")).terrain_builtin, true);
  await api("terrain_load", {
    path: path.join(root, "tests/fixtures/terrain/synthetic-n43.dt0"),
  });
  await reopen();
  await terrain(false); // generic MSL needs the user's own explicit datum
  let prefs = await api("preferences");
  assert.equal(prefs.terrain_builtin, false);
  assert.equal(prefs.terrain_vertical_datum, "unresolved-msl");
  await api("preferences", {
    preferences: { ...prefs, terrain_vertical_datum: "egm96" },
  });
  await reopen();
  const customCoverage = (await api("terrain_info")).bounds;
  await page.evaluate(async (bounds) => {
    const c = window.__chronoscope;
    await c.restoreScene({ mode: "globe", bounds });
    await c.rebuildTerrain(bounds);
    c.view.fit();
  }, customCoverage);
  await terrain(true);
  const custom = path.join(dir, "custom.chronoscope");
  await api("save", { path: custom });
  await stop();
  await start();
  assert.equal((await api("preferences")).terrain_builtin, false);
  assert.equal((await api("terrain_info")).tiles[0].south, 43);
  await api("open", { path: custom });
  assert.equal((await api("terrain_info")).tiles[0].south, 43);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    states,
    errors,
    externalRequests: external,
    freshDefault: true,
    persistentUnload: true,
    restoredThroughMenu: true,
    builtinWorkspaceBytes: fs.statSync(workspace).size,
    customDtedReplacementAndReopen: true,
    note: "Real GMTED2010 pack; Metal on macOS, software WebGL elsewhere; maps disabled for offline terrain QA. DTED lifecycle uses the documented synthetic fixture.",
  };
  fs.writeFileSync(
    path.join(out, "browser-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  if (page && !page.isClosed()) {
    fs.writeFileSync(
      path.join(out, "failure-state.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          preferences: window.__chronoscope.preferences,
          resources: window.__chronoscope.view.resources.status,
          diagnostics: window.__chronoscope.view.diagnostics(),
          snapshot: window.__chronoscope.snapshot,
        })),
        null,
        2,
      ),
    );
    await page.screenshot({ path: path.join(out, "failure.png") });
  }
  throw error;
} finally {
  await stop();
  await browser?.close();
}
