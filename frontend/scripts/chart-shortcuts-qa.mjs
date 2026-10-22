import { chromium } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { PNG } from "pngjs";
const root = path.resolve(import.meta.dirname, "../.."),
  out =
    process.env.CHRONOSCOPE_QA_DATA_DIR ||
    path.join(root, ".qa/chart-shortcuts");
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

  const csv = out + "/hourly-records.csv";
  const start = Date.parse("2026-01-05T00:00:00Z") / 1000;
  fs.writeFileSync(
    csv,
    [
      "timestamp,latitude,longitude,entity,value,category,Amount,Latency",
      ...Array.from({ length: 72 }, (_, i) =>
        [
          new Date((start + i * 3600 + 0.125) * 1000).toISOString(),
          34 + i * 0.0001,
          -84 + i * 0.0001,
          i % 2 ? "South" : "North",
          100 + i,
          i % 2 ? "Mobile" : "Stationary",
          100 + i,
          2 * i + 3,
        ].join(","),
      ),
    ].join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", {
    import_id: preview.import_id,
    mapping: { time: 0, lat: 1, lon: 2, entity: 3, value: 4, category: 5 },
  });
  await api("field_roles_set", {
    assignments: {
      "attribute:Amount": "measurement",
      "attribute:Latency": "measurement",
      category: "category",
    },
  });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      theme: "dark",
    },
  });
  await api("view_set", {
    mode: "map",
    inspector_tab: "charts",
    display: { mode: "points", bloom: false, show_tracks: false },
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
    timezoneId: "America/New_York",
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => report.errors.push(e.stack || e.message));

  let requests = 0;
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/invoke") &&
      r.postDataJSON()?.command === "chart_data"
    )
      requests++;
  });
  await page.route("**/*", (route) => {
    if (
      route.request().url().startsWith(url) ||
      /^(blob|data):/.test(route.request().url())
    )
      return route.continue();
    report.publicRequests++;
    return route.abort();
  });
  const check = (name) => {
    report.checks.push(name);
    console.log("PASS", name);
  };
  const idle = async () => {
    await page.waitForFunction(() => window.__chronoscope?.chartsIdle);
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    await page.waitForFunction(
      () =>
        document
          .querySelector("#chart-status")
          ?.textContent.includes("scoped records") &&
        document.querySelector("#chart-preview")?.workspaceChart,
    );
  };
  const theme = async (value) => {
    if ((await page.locator("html").getAttribute("data-theme")) !== value)
      await page.locator("#theme").click();
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      value,
    );
    await idle();
  };
  const option = () =>
    page
      .locator("#chart-preview")
      .evaluate((e) => e.workspaceChart.getOption());
  const snapshot = () => api("snapshot", { compact: true });
  const starter = async (task) => {
    await page.locator(`[data-chart-task="${task}"]`).click();
    await idle();
    assert.equal(
      await page
        .locator(`[data-chart-task="${task}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
  };
  const config = async (key, value) => {
    if (!["scope", "source"].includes(key))
      await page.locator("#chart-customize").evaluate((e) => (e.open = true));
    await page.locator("#chart-" + key).selectOption(value);
    await idle();
  };
  const chartTotal = async () =>
    (await option()).series.reduce(
      (sum, s) =>
        sum + s.data.reduce((n, d) => n + (d.chartRow?.count || 0), 0),
      0,
    );
  const clickMark = async (seriesIndex, index, shift = false) => {
    const pixel = await page.locator("#chart-preview").evaluate(
      (e, { seriesIndex, index }) => {
        const c = e.workspaceChart,
          s = c.getOption().series[seriesIndex],
          v = s.data[index].value;
        if (s.type === "bar") {
          const layout = c
            .getModel()
            .getSeriesByIndex(seriesIndex)
            .getData()
            .getItemLayout(index);
          return [layout.x + layout.width / 2, layout.y + layout.height / 2];
        }
        return c.convertToPixel(
          { xAxisIndex: 0, yAxisIndex: 0 },
          v.slice(0, 2),
        );
      },
      { seriesIndex, index },
    );
    const box = await page.locator("#chart-preview").boundingBox();
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(box.x + pixel[0], box.y + pixel[1]);
    if (shift) await page.keyboard.up("Shift");
    await idle();
  };
  const exportChart = async (name) => {
    const host = page.locator("#chart-preview");
    await host.scrollIntoViewIfNeeded();
    const icon = await host.evaluate((e) => {
      const chart = e.workspaceChart;
      const model = chart.getModel().getComponent("toolbox");
      const view = chart.getViewOfComponentModel(model);
      const path =
        view._features.get("saveAsImage").model.iconPaths.saveAsImage;
      const bounds = path.getBoundingRect().clone();
      bounds.applyTransform(path.getComputedTransform());
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        width: chart.getWidth(),
        height: chart.getHeight(),
      };
    });
    const box = await host.boundingBox();
    const download = page.waitForEvent("download");
    await page.mouse.click(box.x + icon.x, box.y + icon.y);
    const file = await download;
    assert.match(file.suggestedFilename(), /\.png$/);
    const output = out + "/" + name + ".png";
    await file.saveAs(output);
    const png = PNG.sync.read(fs.readFileSync(output));
    assert.equal(png.width, Math.round(icon.width * 2));
    assert.equal(png.height, Math.round(icon.height * 2));
    assert(fs.statSync(output).size > 2000);
    check("Native ECharts PNG export works: " + name);
  };
  await page.goto(url + "/#token=" + token);
  await idle();
  assert.equal(await page.locator("[data-chart-task]").count(), 8);
  const cols = await page
    .locator(".chart-starters")
    .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 4);
  assert.equal(await page.locator(".charts-panel select:visible").count(), 1);
  check(
    "Eight question shortcuts fit a compact 2×4 grid with detailed controls collapsed",
  );
  for (const task of [
    "compare",
    "time",
    "distribution",
    "relationship",
    "spread",
  ]) {
    await starter(task);
    const c = (await snapshot()).scene.chart;
    assert.equal(c.scope, "visible");
    if (task === "spread") {
      assert.equal((await option()).series[0].type, "boxplot");
      assert.equal(c.x, "category");
      assert.equal(c.y, "attribute:Amount");
    }
    if (["compare", "time", "distribution"].includes(task))
      assert.equal(await chartTotal(), 72);
    if (task === "relationship") await exportChart("scatter-export-dark");
  }
  check(
    "Original four starters and Compare spread use exact counts and explicit field roles",
  );
  await starter("patterns");
  await exportChart("heatmap-export-dark");
  let o = await option();
  assert.equal(o.series[0].type, "heatmap");
  assert.equal(o.series[0].data.length, 168);
  assert.equal(await chartTotal(), 72);
  const cell = o.series[0].data.findIndex(
    (d) => d.chartRow.x === 7 && d.chartRow.series === 0,
  );
  assert.equal(o.series[0].data[cell].chartRow.count, 1);
  await clickMark(0, cell);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 1,
  );
  assert.equal((await snapshot()).selected_count, 1);
  o = await option();
  const cell2 = o.series[0].data.findIndex(
    (d) => d.chartRow.x === 8 && d.chartRow.series === 0,
  );
  await clickMark(0, cell2, true);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 2,
  );
  check(
    "UTC weekday/hour cells retain correct hours in New York and click/Shift-click select exact source Events",
  );
  await page.locator("#chart-preview").evaluate((e) => {
    e.qaTooltipCount = 0;
    e.workspaceChart.on("showTip", () => e.qaTooltipCount++);
  });
  const hoverPixel = await page
    .locator("#chart-preview")
    .evaluate((e) =>
      e.workspaceChart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [5, 1]),
    );
  const hoverBox = await page.locator("#chart-preview").boundingBox();
  await page.mouse.move(hoverBox.x + hoverPixel[0], hoverBox.y + hoverPixel[1]);
  await page.waitForTimeout(550);
  assert.equal(
    await page.locator("#chart-preview").evaluate((e) => e.qaTooltipCount),
    0,
  );
  await page.waitForFunction(
    () => document.querySelector("#chart-preview").qaTooltipCount > 0,
  );
  await page.mouse.move(50, 50);
  check(
    "Plot tooltips retain the one-second hover delay without uncancellable native callbacks",
  );
  await config("scope", "selected");
  assert.equal(await chartTotal(), 2);
  await config("scope", "visible");
  await config("aggregate", "mean");
  await config("y", "attribute:Amount");
  o = await option();
  assert.equal(
    o.series[0].data.find((d) => d.chartRow.x === 7 && d.chartRow.series === 0)
      .chartRow.y,
    107,
  );
  assert.equal(
    o.series[0].data.find((d) => d.chartRow.series === 6).chartRow.y,
    null,
  );
  check(
    "Pattern grids support exact measurement aggregation and keep missing measurements distinct from zero counts",
  );
  await page.locator("#chart-labels").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-key="y_label"]').fill("Average amount (USD)");
  await page.locator('[data-chart-key="y_label"]').press("Tab");
  await idle();
  assert.equal((await option()).visualMap[0].text[0], "Average amount (USD)");
  await starter("composition");
  o = await option();
  assert.equal(o.series.length, 2);
  assert(
    o.series.every(
      (s) => s.type === "line" && s.stack === "primary" && s.areaStyle,
    ),
  );
  assert.deepEqual(
    o.series[0].data.map((d) => d.value[0]),
    o.series[1].data.map((d) => d.value[0]),
  );
  assert.equal(await chartTotal(), 72);
  check(
    "Composition uses stacked counts with sparse groups aligned to common timestamp keys",
  );
  await starter("periods");
  o = await option();
  assert.equal(o.series.length, 2);
  assert(o.series.every((s) => s.type === "bar"));
  assert.equal(await chartTotal(), 72);
  assert.match(await page.locator("#chart-comparison").innerText(), /Change %/);
  await page.locator("#chart-periods").evaluate((e) => (e.open = true));
  for (const [name, value] of [
    ["a-start", "2026-01-05 00:00:00.125"],
    ["a-end", "2026-01-06 00:00:00.125"],
    ["b-start", "2026-01-06 00:00:00.125"],
    ["b-end", "2026-01-07 00:00:00.125"],
  ])
    await page.locator("#chart-period-" + name).fill(value);
  await page.locator("#chart-apply-periods").click();
  await idle();
  let c = (await snapshot()).scene.chart;
  assert.deepEqual(c.period_a, [start + 0.125, start + 86400 + 0.125]);
  assert.deepEqual(c.period_b, [start + 86400 + 0.125, start + 172800 + 0.125]);
  assert.equal(await chartTotal(), 48);
  assert.match(
    await page.locator("#chart-guidance").innerText(),
    /24 scoped Events fall outside/,
  );
  assert.equal(
    await page.locator("#chart-periods").evaluate((e) => e.open),
    true,
  );
  await page.locator("#chart-period-a-end").fill("2026-01-07 00:00:00.125");
  const before = requests;
  await page.locator("#chart-apply-periods").click();
  await page.evaluate(() => window.__chronoscope.chartsIdle());
  assert.equal(requests, before);
  assert.match(
    await page
      .locator("#chart-period-a-start")
      .evaluate((e) => e.validationMessage),
    /non-overlapping/,
  );
  await page.locator("#chart-auto-periods").click();
  await idle();
  assert.equal((await snapshot()).scene.chart.period_a, null);
  assert.equal(await chartTotal(), 72);
  check(
    "Period defaults work immediately; fractional UTC windows apply, overlaps are blocked, and outside-window counts are disclosed",
  );
  let delayParses = true;
  await page.route("**/api/invoke", async (route) => {
    if (delayParses && route.request().postDataJSON()?.command === "time_parse")
      await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fallback();
  });
  await page.locator("#chart-apply-periods").click();
  await starter("patterns");
  assert.equal((await snapshot()).scene.chart.kind, "heatmap");
  delayParses = false;
  await starter("periods");
  check(
    "Switching charts cancels pending date validation without changing the new chart or touching detached controls",
  );
  const pick = (await option()).series[1].data[0];
  await clickMark(1, 0);
  await page.waitForFunction(
    (n) => window.__chronoscope.snapshot.selected_count === n,
    pick.chartRow.count,
  );
  await page.locator("#chart-table").click();
  await idle();
  assert.equal(
    await page
      .locator("#table-panel")
      .evaluate((e) => e.classList.contains("open")),
    true,
  );
  await page.locator("#close-table").click();
  check(
    "Comparison bars select their own time window and share selection with the attribute table",
  );
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator("#chart-preset-name").fill("Period comparison");
  await page.locator("#chart-save-preset").click();
  await idle();
  await starter("patterns");
  await page.locator("#chart-preset-name").fill("Weekday patterns");
  await page.locator("#chart-save-preset").click();
  await idle();
  const saved = out + "/eight-shortcuts.chronoscope";
  await api("save", { path: saved });
  await api("open", { path: saved });
  await page.reload();
  await idle();
  assert.equal((await option()).series[0].type, "heatmap");
  assert.equal((await snapshot()).scene.chart_presets.length, 2);
  check(
    "Both new Rust chart kinds survive named presets and portable workspace save/reopen",
  );
  await theme("light");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal((await option()).series[0].type, "heatmap");
  await exportChart("heatmap-export-light");
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector(".chart-starters"),
      ).gridTemplateColumns.split(" ").length === 2,
  );
  assert.equal(
    await page
      .locator(".chart-starters")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  check(
    "Pattern rendering supports light/dark themes and responsive two-column starters in compact panes",
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await starter("composition");
  await page.locator("#chart-customize").evaluate((e) => (e.open = true));
  await page.locator("#chart-labels").evaluate((e) => (e.open = true));
  await page.locator('[data-chart-key="x_label"]').fill("Previous axis units");
  await page.locator('[data-chart-key="x_label"]').press("Tab");
  await idle();
  await config("kind", "heatmap");
  assert.equal((await option()).xAxis[0].name, "Hour (UTC)");
  await starter("composition");
  await config("kind", "boxplot");
  assert.equal((await snapshot()).scene.chart.stacked, false);
  assert((await option()).series.some((s) => s.type === "boxplot"));
  for (const kind of [
    "scatter",
    "histogram",
    "bar",
    "line",
    "area",
    "heatmap",
    "period",
  ]) {
    await config("kind", kind);
    assert.equal((await snapshot()).scene.chart.kind, kind);
  }
  check(
    "Switching chart types clears incompatible stacking and renders every chart kind",
  );

  await page.locator("#chart-periods").evaluate((e) => (e.open = true));
  for (const [name, value] of [
    ["a-start", "2026-01-05 00:00:00.125"],
    ["a-end", "2026-01-06 00:00:00.125"],
    ["b-start", "2026-01-06 00:00:00.125"],
    ["b-end", "2026-01-07 00:00:00.125"],
  ])
    await page.locator("#chart-period-" + name).fill(value);
  await page.locator("#chart-apply-periods").click();
  await idle();
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator("#chart-preset-name").fill("Custom window comparison");
  await page.locator("#chart-save-preset").click();
  await idle();
  const customSaved = out + "/custom-windows.chronoscope";
  await api("save", { path: customSaved });
  await api("open", { path: customSaved });
  await page.reload();
  await idle();
  assert.equal(
    await page.locator("#chart-title").innerText(),
    "Custom window comparison",
  );
  check(
    "A saved custom-period chart retains its preset title after portable save/reopen",
  );

  const firstEvent = (await api("query", { limit: 1 })).events[0];
  await api("edit", { id: firstEvent.id, changes: { value: null } });
  await api("view_set", {
    chart: {
      kind: "line",
      x: "time",
      x_axis: "time",
      time_bucket: "none",
      aggregate: "mean",
      y: "value",
      y2: "attribute:Amount",
      group: "",
      stacked: false,
      period_a: null,
      period_b: null,
    },
  });
  await page.reload();
  await idle();
  await page.locator("#chart-data-details").evaluate((e) => (e.open = true));
  const firstRow = page.locator("#chart-data tbody tr").first();
  assert.equal(await firstRow.locator("td").nth(2).innerText(), "[Missing]");
  assert.equal(await firstRow.locator("td").nth(3).innerText(), "100");
  await firstRow.locator("button").click();
  await idle();
  assert.equal((await snapshot()).selected_count, 1);
  assert.equal((await snapshot()).selected[0], firstEvent.id);
  await page.locator("#chart-select-all").click();
  await idle();
  assert.equal((await snapshot()).selected_count, 72);
  await page.screenshot({ path: out + "/secondary-axis-table.png" });
  check(
    "Chart data exposes both axes, and row/all selection includes secondary-axis-only Events",
  );

  const repeated = (await api("query", { limit: 2 })).events;
  await api("edit_many", {
    ids: repeated.map((e) => e.id),
    changes: { value: 42 },
  });
  await api("view_set", {
    chart: {
      kind: "scatter",
      x: "value",
      x_axis: "number",
      y: "attribute:Amount",
      y2: "",
    },
  });
  await page.reload();
  await idle();
  const scatterData = (await option()).series[0].data;
  assert.equal(scatterData.filter((d) => d.chartRow.x === 42).length, 2);
  assert.equal(new Set(scatterData.map((d) => d.id)).size, scatterData.length);
  check(
    "Scatter pairs with identical X values retain unique rendering identities",
  );

  // Portable/public configs can retain a stacking flag from an older chart.
  await api("view_set", {
    chart: {
      kind: "boxplot",
      x: "time",
      x_axis: "time",
      time_bucket: "none",
      group: "category",
      stacked: true,
      y: "value",
    },
  });
  await page.reload();
  await idle();
  assert(
    (await option()).series
      .filter((s) => s.type === "boxplot")
      .every((s) => s.data.every((d) => d.chartRow.box.length === 5)),
  );
  check(
    "Public boxplot configurations with inherited stacking render sparse groups safely",
  );

  // Real bundled public wildlife data for actual rendered screenshots.
  await api("demo_open", { id: "local-wildlife" });
  await api("view_set", {
    mode: "map",
    inspector_tab: "charts",
    display: { mode: "points", bloom: false, show_tracks: true },
  });
  await page.reload();
  await idle();
  await theme("dark");
  for (const task of ["spread", "patterns", "composition", "periods"]) {
    await starter(task);
    await page.locator("#chart-customize").evaluate((e) => (e.open = false));
    await page.locator("#chart-presets").evaluate((e) => (e.open = false));
    await page.locator("#inspector-content").evaluate((e) => (e.scrollTop = 0));
    await page.mouse.move(50, 50);
    await page.screenshot({ path: out + "/wildlife-" + task + "-dark.png" });
    await page
      .locator(".inspector")
      .screenshot({ path: out + "/wildlife-" + task + "-chart-dark.png" });
  }
  await theme("light");
  await starter("patterns");
  await page.locator("#inspector-content").evaluate((e) => (e.scrollTop = 0));
  await page.mouse.move(50, 50);
  await page.screenshot({ path: out + "/wildlife-patterns-light.png" });
  await page
    .locator(".inspector")
    .screenshot({ path: out + "/wildlife-patterns-chart-light.png" });
  // A delayed tooltip must not outlive chart replacement or disposal.
  const heatCell = await page
    .locator("#chart-preview")
    .evaluate((e) =>
      e.workspaceChart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [7, 1]),
    );
  const heatBox = await page.locator("#chart-preview").boundingBox();
  await page.mouse.move(heatBox.x + heatCell[0], heatBox.y + heatCell[1]);
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    document.querySelector('[data-tab="views"]').click(),
  );
  await page.waitForTimeout(1200);
  await page.locator('[data-tab="charts"]').click();
  await idle();
  check(
    "Pending chart tooltip callbacks are cancelled safely when the chart is disposed",
  );
  assert.equal((await snapshot()).count, 3439);
  check(
    "All four additions render using the bundled 3,439-record public bobcat/fisher dataset; real screenshots captured",
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
