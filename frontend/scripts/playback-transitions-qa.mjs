import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/playback-transitions");
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
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  passed: false,
  checks: [],
  errors: [],
  rustBuildProfile: process.env.CHRONOSCOPE_QA_RUST_PROFILE || "unspecified",
};
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
      bloom: true,
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
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
    window.__chronoscope.view.onSceneChange = () => {};
  });
  report.renderer = await page.evaluate(() => {
    const gl = window.__chronoscope.view.viewer.canvas.getContext("webgl2");
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  if (process.env.CHRONOSCOPE_QA_HARDWARE === "1")
    assert(!/SwiftShader|llvmpipe|software/i.test(report.renderer));
  const times = await page.evaluate(
    () => window.__chronoscope.snapshot.time_bounds,
  );
  const lo = times[0];
  await api("filter", {
    filter: { start: lo + 180 * 86400, end: lo + 210 * 86400 },
  });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh();
    await c.displayIdle();
  });
  await page.waitForFunction(
    () => !window.__chronoscope.view.displayLayer.diagnostics.pending,
  );
  await page.click("#time-rail-playback");
  await page.click("#playback-increment");
  await page.locator('#playback-increment-menu [data-speed="86400"]').click();
  await page.evaluate(() => {
    const c = window.__chronoscope,
      v = c.view;
    window.playbackSamples = [];
    window.playbackInstalls = [];
    const install = v.setData.bind(v);
    v.setData = async (...args) => {
      const result = await install(...args);
      if (result) window.playbackInstalls.push(performance.now());
      return result;
    };
    window.collectPlayback = true;
    const sample = () => {
      const layers = v.viewer.imageryLayers;
      const alphas = [];
      for (let i = 0; i < layers.length; i++) {
        const l = layers.get(i);
        if (l.chronoscopeEffects) alphas.push(l.alpha);
      }
      window.playbackSamples.push({
        at: performance.now(),
        lo: v.lo,
        hi: v.hi,
        alphas,
        errors: v.diagnostics().renderErrorCount,
      });
      if (window.collectPlayback) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.click("#play");
  await page.waitForTimeout(3500);
  await page.click("#play");
  const samples = await page.evaluate(() => {
    window.collectPlayback = false;
    return {
      frames: window.playbackSamples,
      installs: window.playbackInstalls,
    };
  });
  fs.writeFileSync(
    path.join(dir, "frames.json"),
    JSON.stringify(samples, null, 2),
  );
  const intervals = samples.installs
    .slice(1)
    .map((v, i) => v - samples.installs[i])
    .sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  assert(
    samples.installs.length >= 20,
    `Only ${samples.installs.length} live updates in 3.5 seconds`,
  );
  assert(median < 180, `Data presentation still steps every ${median}ms`);
  assert(
    samples.frames.some(
      (f) =>
        f.alphas.length === 2 && f.alphas.some((a) => a > 0.01 && a < 0.99),
    ),
    "No real overlap/crossfade of atlas layers",
  );
  assert(
    samples.frames.every((f) => f.alphas.length <= 2),
    "Unbounded imagery layers",
  );
  assert(samples.frames.every((f) => f.errors === 0));
  check("Day playback presents smaller steps without blocking on bloom", {
    installs: samples.installs.length,
    medianIntervalMs: median,
  });
  check(
    "Bloom crossfades with at most two real imagery layers and no renderer errors",
    { frames: samples.frames.length },
  );
  await page.waitForFunction(
    () => !window.__chronoscope.view.displayLayer.diagnostics.pending,
  );
  await page.waitForTimeout(150);
  const layers = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      a = v.viewer.imageryLayers;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a.get(i).chronoscopeEffects) n++;
    return n;
  });
  assert.equal(layers, 1, "Paused playback must release the old atlas");
  await page.screenshot({ path: path.join(dir, "day-playback-bloom.png") });
  check("Pause settles to one bloom atlas", { layers });
  await api("filter", { filter: {} });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh();
  });
  let filters = 0;
  const listener = (req) => {
    if (
      req.url().endsWith("/api/invoke") &&
      req.postDataJSON()?.command === "filter"
    )
      filters++;
  };
  page.on("request", listener);
  await page.click("#play");
  await page.waitForTimeout(700);
  await page.click("#play");
  page.off("request", listener);
  assert.equal(
    filters,
    0,
    "Full-range playback must retain its no-refresh fast path",
  );
  check("Full-range playback still avoids redundant filtering", { filters });
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
