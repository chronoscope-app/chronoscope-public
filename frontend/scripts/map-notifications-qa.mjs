import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/map-notifications");
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(dir, "token");
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
const report = { passed: false, checks: [], errors: [] };
let browser;
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
    server.on("error", reject);
    server.stderr.on("data", (d) => {
      log += d;
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
    const result = await response.json();
    assert(response.ok, JSON.stringify(result));
    return result.result;
  };
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
    },
  });
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
      trail_gap_minutes: 0,
      trail_pixels: 0,
      track_opacity: 0.25,
      trail_opacity: 0.25,
    },
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium"),
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Cesium render failure/.test(message.text()) &&
      !message.text().includes("QA injected")
    )
      report.errors.push(message.text());
  });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    return /^https?:/.test(u) && !u.startsWith(url + "/")
      ? route.abort()
      : route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy &&
      window.__chronoscope.view.renderPoints.length === 3568,
  );
  await page.evaluate(() => window.__chronoscope.ready);
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
    window.__chronoscope.view.onSceneChange = () => {};
  });
  await page.evaluate(() =>
    window.__chronoscope.restoreScene(window.__chronoscope.snapshot.scene),
  );
  const region = [-100, 5, -10, 60];
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const c = canvas.getContext("2d");
    c.fillStyle = "#318ba6";
    c.fillRect(0, 0, 32, 32);
    return canvas.toDataURL();
  });
  let failure = false,
    pending = false,
    jobs = 0,
    requestedRegion = region;
  await page.route("**/api/invoke", async (route) => {
    const r = route.request().postDataJSON();
    if (r.command === "job_start" && r.args.command === "wmts_rasters") {
      jobs++;
      requestedRegion = r.args.arguments.bounds;
      return route.fulfill({ json: { result: { job_id: "map-fixture" } } });
    }
    if (r.command === "job_result" && r.args.job_id === "map-fixture") {
      if (pending)
        return route.fulfill({ json: { result: { status: "running" } } });
      return route.fulfill({
        json: {
          result: failure
            ? {
                status: "failed",
                error: { message: "WMTS HTTP 503 (QA injected)" },
              }
            : {
                status: "completed",
                result: {
                  requests: 1,
                  cache_hits: 0,
                  attribution: "Local test imagery",
                  tiles: [
                    {
                      request: {
                        bounds: requestedRegion,
                        row: 0,
                        col: 0,
                        matrix: "0",
                        geographic: false,
                      },
                      data_url: image,
                      cache_hit: false,
                    },
                  ],
                  total_tiles: 1,
                  next_offset: null,
                },
              },
        },
      });
    }
    if (
      ["job_release", "job_cancel"].includes(r.command) &&
      r.args.job_id === "map-fixture"
    )
      return route.fulfill({ json: { result: {} } });
    return route.fallback();
  });
  await page.evaluate(() => {
    const c = window.__chronoscope;
    c.preferences.map_layers = [
      {
        id: "blue-marble-qa",
        name: "Blue Marble",
        server_name: "Local QA",
        opacity: 1,
        min_zoom: -30,
        max_zoom: 30,
        config: { ...c.preferences.map, enabled: true },
      },
    ];
  });
  const load = () =>
    page.evaluate((region) => window.__chronoscope.loadRasters(region), region);
  await load();
  const pixels = () =>
    page.evaluate(() => {
      const r = window.__chronoscope.view.resources.currentRaster;
      const c = r.tiles[0].image;
      return Array.from(
        c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data,
      );
    });
  const waitForPixels = (expected) => page.waitForFunction((expected) => {
    const c = window.__chronoscope.view.resources.currentRaster?.tiles[0]?.image;
    if (!c) return false;
    const actual = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return expected.every((value, index) => actual[index] === value);
  }, expected);
  await waitForPixels([49, 139, 166, 255]);
  const good = await pixels();
  assert.deepEqual(good, [49, 139, 166, 255]);
  failure = true;
  await load();
  await load();
  assert.deepEqual(await pixels(), good);
  assert.equal(await page.locator(".toast.error").count(), 0);
  await page.locator("#notifications").click();
  const notice = page.locator('[data-notification-id="map:blue-marble-qa"]');
  assert.equal(await notice.count(), 1);
  assert.match(await notice.innerText(), /HTTP 503/);
  assert(
    await notice
      .getByRole("button", { name: "Retry", exact: true })
      .isVisible(),
  );
  check(
    "Repeated map failures produce one actionable alert and retain exact imagery pixels",
    { good, jobs },
  );
  await notice
    .getByRole("button", { name: "Map settings", exact: true })
    .click();
  assert(await page.locator("#map-stack-list").isVisible());
  await page.locator(".modal [data-close]").first().click();
  // Reopen after settings dismissed the notification panel through outside click.
  if (!(await notice.isVisible())) await page.locator("#notifications").click();
  failure = false;
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await notice.waitFor({ state: "detached" });
  // The request resolves before the replacement raster canvas finishes painting.
  await waitForPixels(good);
  assert.deepEqual(await pixels(), good);
  check(
    "Retry loads imagery and clears the resolved alert; Map settings opens the layer configuration",
    {},
  );
  pending = true;
  const work = load();
  await page.waitForFunction(
    () => !document.querySelector("#cancel-map").hidden,
  );
  await page.locator("#cancel-map").click();
  pending = false;
  await work;
  assert.equal(await notice.count(), 0);
  assert.deepEqual(await pixels(), good);
  check(
    "Stopping an in-flight load keeps imagery and does not report a false failure",
    {},
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
  server.kill("SIGTERM");
  fs.rmSync(tokenFile, { force: true });
}
