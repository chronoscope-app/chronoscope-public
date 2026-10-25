import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust + Cesium + MapLibre. Offline synthetic vector fixture by default;
// CHRONOSCOPE_BASEMAP_LIVE=1 explicitly enables the public-provider showcase.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const live = process.env.CHRONOSCOPE_BASEMAP_LIVE === "1";
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-basemap-"));
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS || path.join(dir, "screenshots");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const report = {
  live,
  passed: false,
  checks: [],
  errors: [],
  csp: [],
  screenshots: [],
};
const record = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
const server = spawn(
  process.env.CHRONOSCOPE_CLI ||
    path.join(
      root,
      "target/debug/chronoscope" + (process.platform === "win32" ? ".exe" : ""),
    ),
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
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const defaults = await api("preferences");
  assert.equal(defaults.basemap, "streets");
  assert.deepEqual(defaults.map_layers, []);
  const catalog = await api("wmts_servers");
  assert.deepEqual(catalog.presets, []);
  record("one default Streets basemap; no built-in WMTS catalog");
  await api("demo");
  await api("preferences", {
    preferences: {
      theme: "light",
      basemap: "streets",
      map_layers: [],
      map: { ...defaults.map, enabled: false },
    },
  });
  if (!live) {
    const cache = (await api("wmts_access")).directory;
    const seed = (url, value) =>
      fs.writeFileSync(
        path.join(cache, createHash("sha256").update(url).digest("hex")),
        typeof value === "string"
          ? value
          : Buffer.isBuffer(value)
            ? value
            : JSON.stringify(value),
      );
    // One west-hemisphere polygon in an actual MVT tile, not a fake renderer.
    const varint = (n) => {
      const b = [];
      while (n > 127) {
        b.push((n & 127) | 128);
        n >>>= 7;
      }
      b.push(n);
      return Buffer.from(b);
    };
    const field = (n, value) =>
      Buffer.concat([varint(n * 8 + 2), varint(value.length), value]);
    const geometry = Buffer.concat(
      [9, 0, 0, 26, 4096, 0, 0, 8192, 4095, 0, 15].map(varint),
    );
    const feature = Buffer.concat([varint(24), varint(3), field(4, geometry)]);
    const layer = Buffer.concat([
      field(1, Buffer.from("land")),
      field(2, feature),
      varint(40),
      varint(4096),
      varint(120),
      varint(2),
    ]);
    seed("https://tiles.openfreemap.org/styles/positron", {
      version: 8,
      sources: {
        fixture: {
          type: "vector",
          tiles: [
            "https://tiles.openfreemap.org/planet/chronoscope-test/{z}/{x}/{y}.pbf",
          ],
          maxzoom: 0,
        },
      },
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#c9dce8" },
        },
        {
          id: "land",
          type: "fill",
          source: "fixture",
          "source-layer": "land",
          paint: { "fill-color": "#e1d8ce" },
        },
      ],
    });
    seed(
      "https://tiles.openfreemap.org/planet/chronoscope-test/0/0/0.pbf",
      field(3, layer),
    );
  }
  await api("wmts_access", {
    settings: {
      offline: !live,
      concurrency: 2,
      request_interval_ms: live ? 200 : 0,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1720, height: 1080 },
  });
  page.on("pageerror", (e) => report.errors.push(e.stack || String(e)));
  await page.addInitScript(() => {
    window.__basemapCsp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__basemapCsp.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
      }),
    );
  });
  const csp = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")),
  ).app.security.csp;
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
    { timeout: 30000 },
  );
  const settled = async () => {
    await page.waitForFunction(
      () => {
        const v = window.__chronoscope.view;
        const s = v.resources.status;
        return (
          s.basemapError ||
          (s.basemapRenderedTiles > 0 &&
            s.basemapPending === 0 &&
            v.scene.globe.tilesLoaded)
        );
      },
      null,
      { timeout: 90000 },
    );
    await page.waitForTimeout(250);
    const status = await page.evaluate(
      () => window.__chronoscope.view.resources.status,
    );
    assert.equal(status.basemapError, "", JSON.stringify(status));
    assert(status.basemapAlignmentErrorPixels < 0.1, JSON.stringify(status));
    return status;
  };
  const navigate = async (mode, tilt = 0) => {
    await page.locator(`[data-view="${mode}"]`).click();
    await page.waitForFunction(
      (mode) =>
        window.__chronoscope.view.mode === mode && !window.__chronoscope.busy,
      mode,
    );
    await page.waitForTimeout(700);
    await page.evaluate(
      async ({ mode, tilt }) => {
        const q = window.__chronoscope;
        q.view.viewer.render();
        q.view.lookAtGeographic(
          [-122.407, 37.789, 0],
          mode === "space-time" ? 5200 : 3600,
          0,
          tilt,
        );
        q.view.requestRender();
      },
      { mode, tilt },
    );
    return settled();
  };
  const capture = async (name) => {
    const file = path.join(out, name + ".png");
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  };
  let state = await navigate("map");
  record("2D native street tiles; WGS84/mercator pixel alignment", state);
  await capture("streets-2d");
  await page.locator("#maps").click();
  await page.waitForSelector("#streets-enabled");
  assert(await page.locator("#streets-enabled").isChecked());
  assert.equal(await page.locator("#wmts-server").count(), 0);
  assert.equal(
    await page.getByText("Built-in maps", { exact: true }).count(),
    0,
  );
  record("simple Map dialog shows Streets; custom servers are advanced");
  await capture("streets-settings");
  await page.locator("#streets-enabled").uncheck();
  await page.locator("#apply-basemap").click();
  await page.waitForFunction(
    () => window.__chronoscope.view.resources.status.basemap === "none",
  );
  assert.equal((await api("preferences")).basemap, "none");
  await page.locator("#maps").click();
  await page.locator("#streets-enabled").check();
  await page.locator("#apply-basemap").click();
  await settled();
  record("Streets toggle persists and releases/recreates the vector renderer");
  state = await navigate("space-time", 38);
  record("space-time imagery stays on the ground", state);
  await capture("streets-space-time");
  state = await navigate("globe", 30);
  record("globe uses the same native tiled street basemap", state);
  await capture("streets-globe");
  state = await navigate("map");
  await api("wmts_access", { settings: { offline: true } });
  const before = (await api("wmts_access")).bytes;
  await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    await v.setBasemap("none");
    await v.setBasemap("streets");
  });
  await settled();
  assert.equal((await api("wmts_access")).bytes, before);
  record(
    "fresh vector renderer reloads style, tiles and fonts from private disk cache offline",
    { bytes: before },
  );
  await page.locator("#maps").click();
  await page
    .locator("summary")
    .filter({ hasText: "Advanced map settings" })
    .click();
  await page.locator("#custom-map-server").click();
  await page.waitForSelector("#wmts-url");
  assert.equal(
    await page.locator('optgroup[label="Built-in maps"]').count(),
    0,
  );
  assert.equal(await page.locator("#nasa-preset").count(), 0);
  record(
    "custom WMTS connection editor remains available without provider catalog",
  );
  report.csp = await page.evaluate(() => window.__basemapCsp);
  assert.deepEqual(report.csp, []);
  assert.deepEqual(report.errors, []);
  record("strict desktop CSP and both renderers produce no uncaught errors");
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
}
