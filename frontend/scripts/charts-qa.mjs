import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/charts");
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
  await page.locator('[data-tab="charts"]').click();
  const idle = async () => {
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    await page.waitForFunction(
      () =>
        document
          .querySelector("#chart-status")
          ?.textContent?.includes("scoped records") &&
        document.querySelector("#chart-preview")?.workspaceChart,
    );
  };
  const config = async (id, value) => {
    if (!["scope", "source"].includes(id))
      await page.locator("#chart-customize").evaluate((e) => (e.open = true));
    await page.locator("#chart-" + id).selectOption(value);
    await idle();
  };
  const option = () =>
    page
      .locator("#chart-preview")
      .evaluate((e) => e.workspaceChart.getOption());
  await idle();
  assert.equal((await option()).series[0].type, "bar");
  assert.match(
    await page.locator("#chart-status").innerText(),
    /3,568 scoped records/,
  );
  assert(
    await page
      .locator('#chart-y option[value="attribute:max_wind_kt"]')
      .count(),
  );
  check("Exact count chart and imported numeric fields are available", {});
  const positions = await page.evaluate(() => ({
    nav: document.querySelector(".sphere-navigator").getBoundingClientRect()
      .top,
    canvas: document.querySelector(".scene-top-right").getBoundingClientRect()
      .top,
  }));
  assert.equal(positions.nav, positions.canvas);
  await page.mouse.move(600, 300);
  await page.locator("#chart-expand").hover();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#control-tooltip.visible").count(), 0);
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#control-tooltip.visible").count(), 1);
  check(
    "Navigation aligns with canvas tools; tooltips wait one second",
    positions,
  );
  await config("aggregate", "mean");
  await config("y", "attribute:max_wind_kt");
  await config("x", "time");
  await config("time_bucket", "day");
  await config("kind", "line");
  assert.equal((await option()).xAxis[0].type, "time");
  assert.equal((await option()).series[0].type, "line");
  await page.locator("#chart-options").evaluate((e) => (e.open = true));
  await config("y2", "attribute:min_pressure_mb");
  assert.equal((await option()).yAxis.length, 2);
  assert.equal((await option()).series[1].yAxisIndex, 1);
  await config("kind", "area");
  assert((await option()).series[0].areaStyle);
  await config("group", "attribute:status");
  await page.locator('[data-chart-key="stacked"]').check();
  await idle();
  assert.equal((await option()).series[0].stack, "primary");
  check(
    "Line, area, UTC bins, grouping, stacking and second Y axes render actual fields",
    {},
  );
  await config("group", "");
  await config("kind", "scatter");
  await config("x", "attribute:max_wind_kt");
  await config("y", "attribute:min_pressure_mb");
  await page.locator("#chart-options").evaluate((e) => (e.open = true));
  await page.locator("#chart-trendline").check();
  await idle();
  const scatter = await option();
  assert.equal(scatter.series[0].type, "scatter");
  assert(scatter.series.some((s) => s.id === "ols-trend"));
  assert.match(
    await page.locator("#chart-warnings").innerText(),
    /3,568 complete pairs/,
  );
  // The one-second plot hover delay and disposal cancellation are exercised
  // with real pointer events in chart-shortcuts-qa, rather than inspecting
  // ECharts native timers (which must stay synchronous for safe disposal).
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator("#chart-preset-name").fill("Wind versus pressure");
  await page.locator("#chart-save-preset").click();
  await idle();
  await page.locator("#chart-data-details").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-row="0"]').click();
  await idle();
  const first = scatter.series[0].data[0].chartRow;
  const selected = await api("snapshot");
  assert.equal(selected.selected_count, first.count);
  const exact = await api("query", {
    apply_filter: false,
    fields: ["id"],
    filter: {
      predicates: [
        {
          field: "attribute:max_wind_kt",
          op: "Equals",
          value: String(first.x),
        },
        {
          field: "attribute:min_pressure_mb",
          op: "Equals",
          value: String(first.y),
        },
      ],
    },
    limit: 1000,
  });
  assert.deepEqual(
    [...selected.selected].sort(),
    exact.events.map((e) => e.id).sort(),
  );
  check(
    "Scatter, full-scope OLS and chart-row selection identify the exact source IDs",
    { selected: first.count },
  );
  await config("scope", "selected");
  assert.match(
    await page.locator("#chart-status").innerText(),
    new RegExp(first.count + " scoped records"),
  );
  await config("scope", "all");
  await page.locator("#chart-select-all").click();
  await idle();
  assert.equal((await api("snapshot")).selected_count, 3568);
  await page.locator("#chart-table").click();
  await page.waitForFunction(() =>
    document.querySelector("#table-panel").classList.contains("open"),
  );
  await page.waitForSelector('[data-table-sort="attribute:max_wind_kt"]');
  assert(
    (await page.locator('#table-body tr[aria-selected="true"]').count()) > 0,
  );
  await page.locator("#close-table").click();
  check(
    "All and Selected scopes and the actual sortable attribute table share selection",
    {},
  );
  await config("kind", "histogram");
  await config("y", "attribute:max_wind_kt");
  await page.locator("#chart-options").evaluate((e) => (e.open = true));
  await page.locator("#chart-bins").fill("10");
  await page.locator("#chart-bins").press("Tab");
  await idle();
  const hist = await option();
  assert.equal(hist.series[0].type, "bar");
  assert.equal(
    hist.series[0].data.reduce((n, d) => n + d.chartRow.count, 0),
    3568,
  );
  await page.locator("#chart-data-details").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-row="0"]').click();
  await idle();
  assert.equal(
    (await api("snapshot")).selected_count,
    hist.series[0].data[0].chartRow.count,
  );
  await config("kind", "boxplot");
  await config("x", "category");
  await config("y", "attribute:max_wind_kt");
  const boxes = await option();
  assert.equal(boxes.series[0].type, "boxplot");
  assert.equal(boxes.series[0].data.length, 10);
  assert.equal(boxes.series[0].data[0].chartRow.box.length, 5);
  check("Exact histogram bins and Tukey boxplots cover all ten seasons", {});
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-load="0"]').click();
  await idle();
  assert.equal(await page.locator("#chart-kind").inputValue(), "scatter");
  assert.equal(
    await page.locator("#chart-y").inputValue(),
    "attribute:min_pressure_mb",
  );
  const save = path.join(dir, "chart-presets.chronoscope");
  await api("save", { path: save });
  await api("open", { path: save });
  await page.evaluate(async () => {
    await window.__chronoscope.refresh();
    await window.__chronoscope.restoreScene(
      window.__chronoscope.snapshot.scene,
    );
  });
  await idle();
  assert.equal(await page.locator("#chart-kind").inputValue(), "scatter");
  assert.equal(
    await page.locator('[data-chart-load="0"]').innerText(),
    "Wind versus pressure",
  );
  if (
    !(await page
      .locator(".workspace")
      .evaluate((e) => e.classList.contains("chart-docked")))
  )
    await page.locator("#chart-expand").click();
  await page.locator("#chart-customize").evaluate((e) => (e.open = false));
  await page.locator("#chart-presets").evaluate((e) => (e.open = false));
  await page.locator("#chart-data-details").evaluate((e) => (e.open = false));
  const scatterHost = page.locator("#chart-preview");
  await scatterHost.scrollIntoViewIfNeeded();
  const brush = await scatterHost.evaluate((e) => {
    const c = e.workspaceChart;
    c.dispatchAction({
      type: "takeGlobalCursor",
      key: "brush",
      brushOption: { brushType: "rect", brushMode: "single" },
    });
    return {
      a: c.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [97, 991.5]),
      b: c.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [153, 918.5]),
    };
  });
  const box = await scatterHost.boundingBox();
  const brushResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.request().postDataJSON()?.command === "select_query",
  );
  let brushRequests = 0;
  const recordBrushRequest = (request) => {
    if (
      request.url().endsWith("/api/invoke") &&
      request.postDataJSON()?.command === "select_query"
    )
      brushRequests++;
  };
  page.on("request", recordBrushRequest);
  await page.mouse.move(box.x + brush.a[0], box.y + brush.a[1]);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(
      box.x + brush.a[0] + ((brush.b[0] - brush.a[0]) * step) / 8,
      box.y + brush.a[1] + ((brush.b[1] - brush.a[1]) * step) / 8,
    );
    // Let each intermediate preview exceed ECharts' debounce interval. A slow
    // gesture must still select only the final rectangle, once, on release.
    await page.waitForTimeout(260);
  }
  assert.equal(brushRequests, 0, "Brush previews must not mutate selection");
  await page.mouse.up();
  await brushResponse;
  await page.waitForTimeout(100);
  await idle();
  const brushed = await api("snapshot");
  const expectedBrush = scatter.series[0].data.reduce(
    (n, d) =>
      n +
      (d.chartRow.x >= 97 &&
      d.chartRow.x <= 153 &&
      d.chartRow.y >= 918.5 &&
      d.chartRow.y <= 991.5
        ? d.chartRow.count
        : 0),
    0,
  );
  assert.equal(brushed.selected_count, expectedBrush);
  const revision = brushed.revision;
  await page.waitForTimeout(650);
  assert.equal(
    (await api("snapshot")).revision,
    revision,
    "Brush redraw must not repeat selection mutations",
  );
  assert.equal(brushRequests, 1, "One completed drag makes one selection");
  page.off("request", recordBrushRequest);
  check(
    "Dragging the native ECharts brush selects exact underlying records without a redraw loop",
    { selected: brushed.selected_count },
  );
  await config("kind", "histogram");
  await idle();
  assert.equal(await page.locator("#chart-kind").inputValue(), "histogram");
  assert.equal(
    await scatterHost.evaluate(
      (e) => e.workspaceChart.getOption().series[0].type,
    ),
    "bar",
  );
  for (const [width, height] of [
    [1600, 1000],
    [1000, 700],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await page.locator(".inspector").boundingBox();
    assert(
      layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= width + 1,
      JSON.stringify(layout),
    );
    await page.screenshot({ path: path.join(dir, "charts-" + width + ".png") });
  }
  await page.locator("#chart-expand").click();
  assert.equal(await page.locator(".workspace.chart-docked").count(), 0);
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-remove="0"]').click();
  await idle();
  assert.equal(await page.locator("[data-chart-load]").count(), 0);
  check(
    "Chart presets survive save/reopen; docked charts fit desktop sizes and presets can be removed",
    {},
  );
  await api("select", { ids: [] });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  await config("scope", "selected");
  assert.match(
    await page.locator("#chart-status").innerText(),
    /0 scoped records/,
  );
  await config("scope", "visible");
  await page.locator("#full-range").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  await page.evaluate(async () => {
    await window.__chronoscope.filterIdle();
    await window.__chronoscope.refresh(false);
  });
  await idle();
  const requests = [];
  const onRequest = (r) => {
    if (r.url().endsWith("/api/invoke"))
      requests.push(r.postDataJSON().command);
  };
  page.on("request", onRequest);
  await page.locator("#play").click();
  await page.waitForTimeout(1200);
  page.off("request", onRequest);
  await page.locator("#play").click();
  console.log("Playback requests", requests);
  assert.equal(requests.filter((c) => c === "chart_data").length, 0);
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.diagnostics().renderErrorCount,
    ),
    0,
  );
  check(
    "Empty selections remain empty; full-range playback does not recalculate unchanged charts",
    { requests },
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  if (browser) {
    const p = browser.contexts()[0]?.pages()[0];
    if (p) {
      console.log(await p.locator("#inspector-content").innerText());
      await p.screenshot({ path: path.join(dir, "failure.png") });
    }
  }
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
