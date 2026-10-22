import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/pan-direction");
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
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
    window.__chronoscope.view.onSceneChange = () => {};
  });
  const results = [];
  for (const mode of ["space-time", "globe", "map"]) {
    await page.locator(`[data-view="${mode}"]`).click();
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    for (const heading of mode === "map" ? [0] : [0, 90, 215]) {
      for (const input of ["api", "keyboard"]) {
        for (const action of ["pan-left", "pan-right", "pan-up", "pan-down"]) {
          await page.evaluate((h) => {
            const v = window.__chronoscope.view;
            v.fit();
            if (v.mode !== "map") {
              v.setBearing(h);
              v.setTilt(30);
            }
            v.requestRender();
            v.viewer.render();
            window.__panAnchor = v.cameraWorldPosition(v.centerGround());
          }, heading);
          const project = () =>
            page.evaluate(() => {
              const v = window.__chronoscope.view;
              v.requestRender();
              v.viewer.render();
              const p = v.scene.cartesianToCanvasCoordinates(
                window.__panAnchor,
              );
              return { x: p.x, y: p.y };
            });
          const before = await project();
          const selection = await page.evaluate(() => [
            ...window.__chronoscope.view.selected,
          ]);
          if (input === "api")
            await page.evaluate((action) => {
              window.__chronoscope.view.panPixels(
                action === "pan-left" ? -60 : action === "pan-right" ? 60 : 0,
                action === "pan-up" ? -60 : action === "pan-down" ? 60 : 0,
              );
            }, action);
          else {
            await page.locator(".cesium-widget canvas").focus();
            await page.keyboard.press(
              {
                "pan-left": "ArrowLeft",
                "pan-right": "ArrowRight",
                "pan-up": "ArrowUp",
                "pan-down": "ArrowDown",
              }[action],
            );
          }
          const after = await project();
          const dx = after.x - before.x,
            dy = after.y - before.y;
          const expected =
            action === "pan-left" || action === "pan-up" ? -1 : 1;
          const horizontal = action === "pan-left" || action === "pan-right";
          const primary = horizontal ? dx : dy,
            cross = horizontal ? dy : dx;
          const evidence = { mode, heading, input, action, dx, dy };
          assert(primary * expected > 1, JSON.stringify(evidence));
          assert(
            Math.abs(cross) < Math.abs(primary) * 0.2,
            JSON.stringify(evidence),
          );
          assert.deepEqual(
            await page.evaluate(() => [...window.__chronoscope.view.selected]),
            selection,
          );
          results.push(evidence);
        }
      }
    }
  }
  check(
    "Pan API and arrow keys move geography in the indicated screen direction at rotated headings",
    results,
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
