// Offline integration test of actual Rust analytics, persistence and Results UI.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/analytics-ui"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenPath = path.join(out, "token");
fs.writeFileSync(tokenPath, token, { mode: 0o600 });
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  cli,
  [
    "--data-dir",
    path.join(out, "profile"),
    "--project",
    path.join(root, "samples/atlantic-hurricanes-2021-2025-tracks.chronoscope"),
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenPath,
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
const report = { passed: false, publicRequests: 0, checks: [], errors: [] };
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) resolve(m[0]);
    });
    server.on("error", reject);
    setTimeout(() => reject(Error("Startup timeout")), 15000).unref();
  });
  const api = async (command, args = {}) => {
    const r = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const data = await r.json();
    assert(r.ok, JSON.stringify(data));
    return data.result;
  };
  const preferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...preferences,
      basemap: "none",
      map: { ...preferences.map, enabled: false },
      map_layers: [],
    },
  });
  const grouped = await api("analytics_run", {
    plan: {
      capability: "group",
      scope: "all",
      parameters: { group_by: ["year_utc"], field: "attribute:max_wind_kt" },
    },
  });
  const outliers = await api("analytics_run", {
    plan: {
      capability: "outliers",
      scope: "all",
      parameters: {
        field: "attribute:max_wind_kt",
        method: "zscore",
        threshold: 1.5,
      },
    },
  });
  const pageRows = await api("analytics_result", {
    result_id: outliers.result_id,
    section: "rows",
  });
  assert(pageRows.rows.length > 0);
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium"),
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(url))
      report.publicRequests++;
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 1604 &&
      !window.__chronoscope.busy,
  );
  await page.click("#analytics-results");
  await page
    .locator("#analytics-dialog nav button")
    .filter({ hasText: /^group$/ })
    .click();
  await page.waitForSelector("#analytics-dialog svg rect");
  assert.equal(await page.locator("#analytics-dialog tbody tr").count(), 5);
  assert.match(
    await page.locator("#analytics-dialog").textContent(),
    /1,604 input Events/,
  );
  await page.screenshot({ path: path.join(out, "hurricane-analysis.png") });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: path.join(out, "hurricane-analysis-light.png"),
  });
  assert.equal(
    await page
      .locator("#analytics-dialog")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(17, 24, 39)",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  report.checks.push(
    "Persistent full-scope hurricane group result opens with five year rows, findings, denominators and chart",
  );
  await page
    .locator("#analytics-dialog nav button")
    .filter({ hasText: /^outliers$/ })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#analytics-dialog h3")?.textContent ===
      "outliers",
  );
  const first = page.locator("#analytics-dialog tbody tr").first();
  await first.click();
  await page.waitForSelector("#analytics-dialog tbody tr.selected");
  const selected = (await api("snapshot", { compact: true })).selected;
  assert.equal(selected.length, 1);
  assert.equal(selected[0], pageRows.rows[0].event_id);
  report.checks.push(
    "Exact source Event row selection reaches live workspace/map and attribute-table selection",
  );
  await page.getByRole("button", { name: "Close analysis results" }).click();
  await page.locator("#analytics-dialog").waitFor({ state: "detached" });
  await api("edit", {
    id: selected[0],
    changes: { note: "QA edit to invalidate prior results" },
  });
  await page.click("#analytics-results");
  await page
    .locator("#analytics-dialog nav button")
    .filter({ hasText: /^outliers/ })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#analytics-dialog h3")?.textContent ===
      "outliers",
  );
  assert.match(
    await page.locator("#analytics-dialog").textContent(),
    /Source data has changed/,
  );
  assert.equal(
    await page.locator("#analytics-dialog tbody tr[tabindex]").count(),
    0,
  );
  report.checks.push(
    "Changed-source evidence is visibly stale and cannot select current source rows",
  );
  await page
    .getByRole("button", { name: "Remove result", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#analytics-dialog nav button").length === 1,
  );
  assert.equal((await api("analytics_list")).results.length, 1);
  assert.equal((await api("snapshot", { compact: true })).count, 1604);
  report.checks.push("Removing a derived artifact retains all source Events");
  const save = path.join(out, "portable.chronoscope");
  await api("save", { path: save, overwrite: true });
  await api("open", { path: save });
  assert.equal((await api("analytics_list")).results.length, 1);
  report.checks.push(
    "Small workspace saves use portable SQLite and retain result artifacts after reopen",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report, null, 2));
