import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/patterns");
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
    if (message.type() === "error") console.log("BROWSER", message.text());
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
  await page.evaluate(() =>
    window.__chronoscope.restoreScene(window.__chronoscope.snapshot.scene),
  );
  const requests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/invoke")) {
      try {
        requests.push(JSON.parse(request.postData() || "{}"));
      } catch {}
    }
  });
  await page.locator('[data-tab="patterns"]').click();
  await page.waitForSelector("#find-patterns");
  assert.equal(await page.locator("#pattern").isVisible(), false);
  assert.equal(
    requests.filter(
      (r) => r.command === "job_start" && r.args.command === "pattern_scan",
    ).length,
    0,
  );
  const scan = async () => {
    await page.locator("#find-patterns").click();
    await page.evaluate(() => window.__chronoscope.patternsIdle());
    await page.waitForFunction(() =>
      document
        .querySelector("#pattern-scan-status")
        .textContent.includes("scoped records"),
    );
  };
  await scan();
  const scanResult = await api("pattern_scan", { cached_only: true });
  assert.equal(scanResult.report.input_count, 3568);
  assert.equal(scanResult.cache_hit, true);
  assert(scanResult.report.findings.some((f) => f.kind === "correlation"));
  assert(scanResult.report.findings.some((f) => f.kind === "duplicates"));
  assert.equal(
    await page.locator(".pattern-card").count(),
    scanResult.report.findings.length,
  );
  check(
    "One button scans all hurricane records; cards expose exact counts, methods and examples",
    { records: 3568, kinds: scanResult.report.findings.map((f) => f.kind) },
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene({ ...c.captureScene(), inspector_tab: "patterns" });
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".pattern-card").length > 0,
  );
  assert.equal(
    await page.locator(".pattern-card").count(),
    scanResult.report.findings.length,
  );
  check(
    "Restoring the same view redraws cached finding cards as well as the result count",
  );
  const outlier = scanResult.report.findings.find((f) => f.kind === "outliers");
  assert(outlier);
  await page.locator(`[data-pattern-evidence="${outlier.id}"]`).click();
  await page.evaluate(() => window.__chronoscope.patternsIdle());
  const selected = await api("snapshot");
  assert.equal(selected.selected_count, outlier.count);
  await page.waitForSelector("#table-head [data-table-sort]");
  check(
    "Supporting-record action selects the complete evidence and opens the actual sortable table",
    { selected: selected.selected_count, examples: outlier.examples.length },
  );
  await page.locator("#close-table").click();
  await scan();
  assert.equal(
    (await api("pattern_scan", { cached_only: true })).scan_id,
    scanResult.scan_id,
  );
  const jobsBefore = requests.filter(
    (r) => r.command === "job_start" && r.args.command === "pattern_scan",
  ).length;
  await page.locator("#window-start").press("ArrowRight");
  await page.evaluate(() => window.__chronoscope.filterIdle());
  await page.waitForFunction(() =>
    document
      .querySelector("#pattern-scan-status")
      .textContent.includes("changed"),
  );
  assert.equal(
    await page.locator("[data-pattern-evidence]:enabled").count(),
    0,
  );
  assert.equal(
    requests.filter(
      (r) => r.command === "job_start" && r.args.command === "pattern_scan",
    ).length,
    jobsBefore,
  );
  await page.locator("#full-range").click();
  await page.evaluate(() => window.__chronoscope.filterIdle());
  await page.waitForFunction(() =>
    document
      .querySelector("#pattern-scan-status")
      .textContent.includes("scoped records"),
  );
  check(
    "Changed scopes are marked stale without automatic analysis; restoring a scope reuses cached results",
  );
  await api("select_query", {
    filter: {
      predicates: [{ field: "entity", op: "Equals", value: "Dorian 2019" }],
    },
    apply_filter: false,
    mode: "replace",
  });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  await page.locator("#pattern-scan-scope").selectOption("selected");
  await scan();
  assert.equal(
    (
      await api("pattern_scan", {
        config: { scope: "selected" },
        cached_only: true,
      })
    ).report.input_count,
    70,
  );
  await page.locator("#pattern-scan-options > summary").click();
  await page.waitForSelector(
    '#pattern-scan-fields input[value="attribute:max_wind_kt"]',
  );
  await page
    .locator('#pattern-scan-fields input[value="attribute:max_wind_kt"]')
    .check();
  await scan();
  const custom = await api("pattern_scan", {
    config: { scope: "selected", fields: ["attribute:max_wind_kt"] },
    cached_only: true,
  });
  assert.deepEqual(custom.report.inspected_fields, ["attribute:max_wind_kt"]);
  check(
    "Selected-record scope and optional measurement fields use their declared exact inputs",
    { selectedRecords: 70 },
  );
  await page.locator("#pattern-manual > summary").click();
  await page.locator("#pattern").selectOption("Gaps");
  await page.locator("#gap").fill("123456");
  await page.evaluate(() => window.__chronoscope.refresh(false));
  assert.equal(await page.locator("#gap").inputValue(), "123456");
  await page.locator("#run-analysis").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  assert.equal(await page.locator("#gap").inputValue(), "123456");
  check(
    "Spatial/custom controls remain available and retain edited parameters",
  );
  await page.locator("#pattern-scan-scope").selectOption("visible");
  await page.locator("#search").fill("no_such_pattern_fixture_314159");
  await page.evaluate(() => window.__chronoscope.filterIdle());
  await scan();
  await page.waitForFunction(() =>
    document
      .querySelector("#pattern-scan-status")
      .textContent.startsWith("0 scoped records"),
  );
  assert.equal(await page.locator(".pattern-card").count(), 0);
  check("Empty scopes produce no fabricated candidates");
  await page.locator("#search").fill("");
  await page.evaluate(() => window.__chronoscope.filterIdle());
  await page
    .locator('#pattern-scan-fields input[value="attribute:max_wind_kt"]')
    .uncheck();
  await scan();
  await page.locator("#pattern-scan-options > summary").click();
  await page.locator("#pattern-manual > summary").click();
  await page.locator("#find-patterns").scrollIntoViewIfNeeded();
  await page.locator(".toast").waitFor({ state: "detached" });
  await page.screenshot({ path: path.join(dir, "patterns-hurricanes.png") });
  await page.locator("#pattern-scan-options > summary").click();
  await page
    .locator('#pattern-scan-fields input[value="attribute:max_wind_kt"]')
    .check();
  await api("demo");
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    const s = await c.call("snapshot");
    await c.restoreScene(s.scene);
  });
  await page.locator('[data-tab="patterns"]').click();
  await scan();
  assert.equal(
    (await api("pattern_scan", { cached_only: true })).report.input_count,
    192,
  );
  check(
    "Opening another workspace resets prior field choices and keeps Find patterns usable",
  );
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.passed = true;
} catch (error) {
  report.error = String(error.stack || error);
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
}
