import { chromium } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "../.."),
  out =
    process.env.CHRONOSCOPE_QA_DATA_DIR ||
    path.join(root, ".qa/chart-workflow");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
fs.writeFileSync(out + "/token", token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || root + "/target/debug/chronoscope",
  [
    "--data-dir",
    out + "/profile",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    out + "/token",
    "--frontend",
    root + "/frontend/dist",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
let report = {
  passed: false,
  errors: [],
  timezones: [],
  publicRequests: 0,
  checks: [],
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error("Engine startup timeout")),
      20000,
    );
    timer.unref();
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    server.on("error", reject);
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
    const d = await r.json();
    if (!r.ok) throw Error(JSON.stringify(d));
    return d.result;
  };
  const setup = async (id, config) => {
    await api("demo_open", { id });
    const p = await api("preferences");
    await api("preferences", {
      preferences: {
        ...p,
        basemap: "none",
        map: { ...p.map, enabled: false },
        map_layers: [],
        theme: "dark",
      },
    });
    await api("view_set", {
      mode: "map",
      inspector_tab: "charts",
      render_budget: 20000,
      display: { mode: "auto", show_tracks: false, show_trails: false },
    });
    if (config)
      await api("scene_sync", {
        scene: { chart: config, inspector_tab: "charts" },
      });
  };
  await setup("elephant-seals");
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
    timezoneId: "America/New_York",
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const commands = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/invoke"))
      commands.push(r.postDataJSON()?.command);
  });
  await page.route("**/*", (r) => {
    if (
      r.request().url().startsWith(url) ||
      /^(blob|data):/.test(r.request().url())
    )
      return r.continue();
    report.publicRequests++;
    return r.abort();
  });
  const idle = async () => {
    await page.waitForFunction(
      () => document.querySelector("#chart-preview")?.workspaceChart,
    );
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    await page.waitForFunction(() =>
      document
        .querySelector("#chart-status")
        ?.textContent.includes("scoped records"),
    );
  };
  const option = () =>
    page
      .locator("#chart-preview")
      .evaluate((e) => e.workspaceChart.getOption());
  const config = async (key, value) => {
    if (!["scope", "source"].includes(key))
      await page.locator("#chart-customize").evaluate((e) => (e.open = true));
    await page.locator("#chart-" + key).selectOption(value);
    await idle();
  };
  const check = (name) => {
    report.checks.push(name);
    console.log("PASS", name);
  };
  const load = async (id) => {
    // A navigation to the same fragment URL is not a fresh application load.
    await page.goto("about:blank");
    await setup(id);
    await page.goto(url + "/#token=" + token);
    await idle();
  };
  await page.goto(url + "/#token=" + token);
  await idle();
  assert.equal(
    await page.locator("#chart-title").innerText(),
    "Daily deepest dive (m)",
  );
  assert.equal(await page.locator(".charts-panel select:visible").count(), 1);
  assert.equal(
    await page.locator("#chart-customize").evaluate((e) => e.open),
    false,
  );
  assert.equal(await page.locator("#chart-source").count(), 0);
  assert.match((await option()).yAxis[0].name, /Maximum Value \(m\)/);
  assert.match(
    await page.locator("#chart-caption").innerText(),
    /Maximum depth during dive/,
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  check(
    "Saved seal name, explicit source units and description appear with one visible selector and no modal",
  );
  const labels = await page.locator("#chart-preview").evaluate((e) =>
    e.workspaceChart
      .getModel()
      .getComponent("xAxis")
      .axis.getViewLabels()
      .map((t) => t.formattedLabel),
  );
  assert(labels.some((l) => /Feb|Mar|Apr|May|Jun/.test(l)));
  check(
    "UTC date ticks include month/year context instead of bare day numbers",
  );
  const mapBefore = await page.locator("#scene").boundingBox();
  const paneBefore = await page.locator(".inspector").boundingBox();
  const calls = commands.filter((c) => c === "chart_data").length;
  await page.locator("#resize-inspector").focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  const paneAfter = await page.locator(".inspector").boundingBox();
  assert(paneAfter.width > paneBefore.width);
  const handle = await page.locator("#resize-inspector").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + 55, handle.y + 100, { steps: 5 });
  await page.mouse.up();
  assert((await page.locator("#scene").boundingBox()).width >= 260);
  assert(mapBefore.width >= 260);
  assert.equal(
    commands.filter((c) => c === "chart_data").length,
    calls,
    "Resizing must not recalculate source data",
  );
  await page.screenshot({ path: out + "/seals-charts-dark.png" });
  check(
    "Keyboard and pointer resizing retain an interactive map and do not rerun analytics",
  );
  await page.locator('[data-chart-task="compare"]').click();
  await idle();
  assert.equal((await option()).series[0].type, "bar");
  assert.equal(
    (await option()).series[0].data.reduce((n, d) => n + d.chartRow.y, 0),
    15501,
  );
  await page.locator('[data-chart-task="time"]').click();
  await idle();
  assert.equal((await option()).xAxis[0].type, "time");
  await page.locator('[data-chart-task="distribution"]').click();
  await idle();
  assert.equal(
    (await option()).series[0].data.reduce((n, d) => n + d.chartRow.count, 0),
    15501,
  );
  await page.locator('[data-chart-task="relationship"]').click();
  await idle();
  assert.equal((await option()).series[0].type, "scatter");
  const relationship = (await api("snapshot", { compact: true })).scene.chart;
  assert.notEqual(relationship.x, relationship.y);
  assert(!["time", "lat", "lon"].includes(relationship.x));
  check(
    "All four task starters produce schema-backed count, time, distribution and relationship charts",
  );
  await config("kind", "line");
  await config("x", "time");
  await config("aggregate", "max");
  await config("y", "value");
  await page.locator("#chart-labels").evaluate((e) => (e.open = true));
  for (const [key, value] of [
    ["title", "Dive depth <review>"],
    ["x_label", "Dive-start date"],
    ["y_label", "Daily maximum dive depth (m)"],
  ]) {
    const input = page.locator('[data-chart-key="' + key + '"]');
    await input.fill(value);
    await input.press("Tab");
    await idle();
  }
  assert.equal(
    await page.locator("#chart-title").innerText(),
    "Dive depth <review>",
  );
  assert.equal((await option()).yAxis[0].name, "Daily maximum dive depth (m)");
  assert.match((await option()).xAxis[0].name, /Dive-start date.*UTC/);
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator("#chart-preset-name").fill("Reviewed depth");
  await page.locator("#chart-save-preset").click();
  await idle();
  const save = out + "/reviewed-chart.chronoscope";
  await api("save", { path: save });
  await api("open", { path: save });
  await page.reload();
  await idle();
  assert.equal(
    await page.locator("#chart-title").innerText(),
    "Dive depth <review>",
  );
  assert.equal((await option()).yAxis[0].name, "Daily maximum dive depth (m)");
  const restored = (await api("snapshot", { compact: true })).scene;
  assert.equal(
    restored.chart_presets.at(-1).config.y_label,
    "Daily maximum dive depth (m)",
  );
  check(
    "Custom titles and units render as text and survive named presets and portable save/reopen",
  );
  await page.locator("#theme").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await idle();
  await page.locator("#chart-customize").evaluate((e) => (e.open = false));
  await page.locator("#chart-presets").evaluate((e) => (e.open = false));
  await page.locator("#inspector-content").evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: out + "/seals-charts-light.png" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  check("The docked chart renders in light and dark modes");
  await config("scope", "selected");
  assert.match(
    await page.locator("#chart-guidance").innerText(),
    /Select Events/,
  );
  await config("scope", "all");
  await config("time_bucket", "hour");
  await page.locator("#chart-options").evaluate((e) => (e.open = true));
  await page.locator("#chart-limit").fill("10");
  await page.locator("#chart-limit").press("Tab");
  await idle();
  assert.match(
    await page.locator("#chart-guidance").innerText(),
    /Selection covers displayed marks only/,
  );
  await page.locator('[data-chart-suggest="coarser"]').click();
  await idle();
  assert.equal(
    (await api("snapshot", { compact: true })).scene.chart.time_bucket,
    "day",
  );
  assert.equal((await api("snapshot", { compact: true })).count, 15501);
  check(
    "Empty selection and bounded marks explain scope; coarser intervals require an explicit click",
  );
  await load("stork-migration");
  await config("kind", "histogram");
  await config("y", "value");
  assert.match(
    await page.locator("#chart-guidance").innerText(),
    /No usable numeric values/,
  );
  await page.locator('[data-chart-suggest="counts"]').click();
  await idle();
  assert.equal(
    (await option()).series[0].data.reduce((n, d) => n + d.chartRow.count, 0),
    6090,
  );
  assert.equal((await api("snapshot", { compact: true })).count, 6090);
  await page.screenshot({ path: out + "/storks-event-counts.png" });
  check(
    "Missing stork measurements offer a working one-click Event-count fallback without altering records",
  );
  await load("animal-gps");
  await config("aggregate", "mean");
  await config("y", "value");
  assert.match(
    await page.locator("#chart-guidance").innerText(),
    /86 of 15,697/,
  );
  assert.match(await page.locator("#chart-guidance").innerText(), /283\.3037/);
  assert.equal(
    (await option()).yAxis[0].name,
    "Average Value",
    "Gull files declare units in external documentation, not a source column; never guess",
  );
  await page.locator('[data-chart-suggest="spread"]').click();
  await idle();
  assert.equal((await option()).series[0].type, "boxplot");
  assert.equal((await api("snapshot", { compact: true })).count, 15697);
  await page.screenshot({ path: out + "/gulls-boxplot.png" });
  check(
    "Gull missing counts and original extreme values remain visible with one-click boxplots; undeclared units are not guessed",
  );
  await page.locator("#chart-table").click();
  await idle();
  assert(
    await page
      .locator("#table-panel")
      .evaluate((e) => e.classList.contains("open")),
  );
  assert.equal(await page.locator("#chart-preview canvas").count(), 1);
  await page.locator("#close-table").click();
  await page.locator("#chart-expand").click();
  assert.equal(await page.locator(".workspace.chart-docked").count(), 0);
  await page.locator("#chart-expand").click();
  await page.locator('[data-tab="views"]').click();
  await page.locator(".workspace.chart-docked").waitFor({ state: "detached" });
  assert.equal(await page.locator("#resize-inspector").count(), 1);
  assert.equal(await page.locator(".workspace.chart-docked").count(), 0);
  check(
    "Charts coexist with the source table and restore normal pane sizing when switching tabs",
  );
  await page.locator('[data-tab="charts"]').click();
  await idle();
  const beforeRefresh = commands.filter((c) => c === "chart_data").length;
  await page.locator("#chart-refresh-fields").click();
  await idle();
  assert(commands.filter((c) => c === "chart_data").length > beforeRefresh);
  await load("local-wildlife");
  await config("aggregate", "mean");
  assert.match((await option()).yAxis[0].name, /m\/s/);
  assert.equal((await api("snapshot", { compact: true })).count, 3439);
  check(
    "Refresh fields recalculates the chart; bobcat/fisher units use consistent explicit source metadata",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  fs.writeFileSync(
    out + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
