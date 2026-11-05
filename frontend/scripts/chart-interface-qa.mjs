import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
import { roundTripChart } from "./workspace-qa-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const out = process.env.CHRONOSCOPE_QA_DATA_DIR;
const token = randomBytes(32).toString("hex");
fs.writeFileSync(path.join(out, "token"), token, { mode: 0o600 });
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
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
let browser, page;
try {
  const url = await localServerUrl(server),
    api = createApi(url, token);
  await api("demo_open", { id: "elephant-seals" });
  const preferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...preferences,
      basemap: "none",
      map: { ...preferences.map, enabled: false },
      map_layers: [],
    },
  });
  await api("view_set", {
    mode: "map",
    inspector_tab: "inspect",
    display: { show_tracks: false, show_trails: false },
  });
  browser = await chromium.launch();
  page = await browser.newPage({
    viewport: { width: 1600, height: 1050 },
    timezoneId: "America/New_York",
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
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
    await page.waitForFunction(
      () =>
        window.__chronoscope?.chartsIdle &&
        document.querySelector("#chart-preview"),
    );
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    await page.waitForFunction(
      () =>
        document
          .querySelector("#chart-status")
          ?.textContent.includes("scoped records") &&
        document.querySelector("#chart-preview")?.workspaceChart,
    );
  };
  const config = async () =>
    (await api("snapshot", { compact: true })).scene.chart;
  const select = async (key, value) => {
    await page.locator("#chart-" + key).selectOption(value);
    await idle();
  };
  const kind = async (value) => {
    await page.locator(`button[data-chart-kind="${value}"]`).click();
    await idle();
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await config()).kind === value) return;
      await page.waitForTimeout(50);
    }
    assert.equal((await config()).kind, value, "Chart type finished saving");
  };
  const option = () =>
    page
      .locator("#chart-preview")
      .evaluate((e) => e.workspaceChart.getOption());
  const oneRow = async () => {
    const boxes = await page
      .locator(".chart-type-toolbar button")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, right: r.right };
        }),
      );
    assert.equal(boxes.length, 8);
    assert(
      boxes.every(
        (r, i) =>
          Math.abs(r.top - boxes[0].top) < 1 &&
          (!i || r.left >= boxes[i - 1].right),
      ),
    );
  };
  const navigatorFits = async () => {
    await page.waitForFunction(() => {
      const host = document.querySelector("#chart-preview"),
        chart = host?.workspaceChart;
      return (
        chart &&
        Math.abs(chart.getWidth() - host.clientWidth) < 1 &&
        Math.abs(chart.getHeight() - host.clientHeight) < 1
      );
    });
    const bounds = await page.locator("#chart-preview").evaluate((e) => {
      const chart = e.workspaceChart;
      const model = chart.getModel().getComponent("dataZoom", 1);
      const view = chart.getViewOfComponentModel(model);
      const rect = view.group.getBoundingRect().clone();
      rect.applyTransform(view.group.getComputedTransform());
      return {
        top: rect.y,
        bottom: rect.y + rect.height,
        height: chart.getHeight(),
      };
    });
    assert(
      bounds.top >= 0 && bounds.bottom <= bounds.height,
      `Complete chart navigator fits canvas: ${JSON.stringify(bounds)}`,
    );
  };
  const pinnedNavigationFits = async () => {
    assert.equal(await page.locator(".inspector > .pane-heading").count(), 0);
    const navigation = page.locator(".inspector-tabs");
    assert(await navigation.locator("#collapse-right-pane").isVisible());
    assert(await navigation.locator("#inspector-chat").isVisible());
    const buttons = await navigation.locator("button").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: el.clientWidth,
          content: el.scrollWidth,
        };
      }),
    );
    assert.equal(buttons.length, 6);
    assert(
      buttons.every(
        (r, i) =>
          Math.abs(r.top - buttons[0].top) < 1 &&
          r.content <= r.width &&
          (!i || r.left >= buttons[i - 1].right),
      ),
      JSON.stringify(buttons),
    );
    assert(await navigation.evaluate((el) => el.scrollWidth <= el.clientWidth));
  };
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(() => window.__chronoscope?.snapshot);
  assert(await page.locator('[data-tab="charts"]').isEnabled());
  await page.locator('[data-tab="charts"]').click();
  await idle();
  assert.equal(
    await page.locator(".chart-quick-controls select:visible").count(),
    3,
  );
  assert.equal(
    await page.locator("#chart-customize").evaluate((e) => e.open),
    false,
  );
  await oneRow();
  await navigatorFits();
  await pinnedNavigationFits();
  await page.locator("#resize-inspector").press("Home");
  await pinnedNavigationFits();
  await page.locator("#inspector-chat").click();
  await page.locator("#si-chat").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#inspector-chat").getAttribute("aria-expanded"),
    "true",
  );
  await page.locator("#si-close").click();
  assert.equal(
    await page.locator("#inspector-chat").getAttribute("aria-expanded"),
    "false",
  );
  await page.locator("#resize-inspector").press("Enter");
  await idle();
  check(
    "Pinned pane uses one navigation row without an Inspector heading; SI chat opens/closes at the minimum 250px pane width",
  );
  assert.equal(
    await page
      .locator('[data-pane-section="charts"]')
      .getAttribute("aria-disabled"),
    null,
  );
  await page.locator("#collapse-right-pane").click();
  await page.locator('[data-pane-section="charts"]').click();
  await idle();
  await page
    .getByRole("button", { name: "Pin right pane open", exact: true })
    .click();
  await idle();
  for (const button of await page.locator(".chart-type-toolbar button").all()) {
    assert(await button.getAttribute("aria-label"));
    assert(await button.getAttribute("data-tooltip"));
    assert.equal((await button.innerText()).trim(), "");
  }
  check(
    "Charts opens from its enabled button with eight icon types, tooltips and visible axes",
  );

  await select("scope", "all");
  await select("x", "end");
  await select("y", "attribute:DURATION");
  assert.equal(
    (await config()).aggregate,
    "max",
    "Saved numeric calculation is retained",
  );
  assert.equal((await config()).x, "end");
  assert.equal((await config()).y, "attribute:DURATION");
  await select("y", "__count");
  assert.equal((await config()).aggregate, "count");
  await select("y", "value");
  assert.equal((await config()).aggregate, "mean");
  await kind("bar");
  await select("x", "entity");
  assert.equal((await config()).aggregate, "mean");
  const reference = await api("chart_data", { config: await config() });
  const chartRows = (await option()).series.flatMap((s) =>
    s.data.map((d) => d.chartRow),
  );
  for (const row of reference.rows) {
    const found = chartRows.find(
      (r) => r.x === row.x && r.series === row.series,
    );
    assert.equal(found.count, row.count);
    assert.equal(found.y, row.y);
  }
  check(
    "Visible X/Y choices change real fields; count and mean switch correctly and bars match Rust results",
  );

  // Select through a real plotted bar, then test the exact selection in scope.
  const plot = page.locator("#chart-preview");
  const point = await plot.evaluate((e) => {
    const row = e.workspaceChart
      .getModel()
      .getSeriesByIndex(0)
      .getData()
      .getItemLayout(0);
    return [row.x + row.width / 2, row.y + row.height / 2];
  });
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  await page.mouse.click(box.x + point[0], box.y + point[1]);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count > 0,
  );
  await idle();
  const selected = (await api("snapshot", { compact: true })).selected_count;
  assert.equal(selected, reference.rows[0].count);
  await select("scope", "selected");
  assert.match(
    await page.locator("#chart-status").innerText(),
    new RegExp(selected.toLocaleString("en-US") + " scoped records"),
  );
  await select("scope", "all");
  check(
    "Clicking a plotted bar selects its exact original dives and Selected Events uses that scope",
  );

  for (const value of [
    "line",
    "bar",
    "histogram",
    "scatter",
    "heatmap",
    "boxplot",
    "area",
    "period",
  ]) {
    await kind(value);
    assert.equal((await config()).kind, value);
    assert.equal(
      await page
        .locator(`button[data-chart-kind="${value}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
    await oneRow();
    if (value === "scatter") {
      const c = await config();
      assert.notEqual(c.x, c.y);
      await select("x", "attribute:DURATION");
      await select("y", "value");
    }
    if (value === "histogram") {
      assert.match(
        await page.locator(".chart-fixed-axis").innerText(),
        /Event count/,
      );
      await select("y", "attribute:DURATION");
    }
    if (value === "heatmap")
      assert.equal(await page.locator(".chart-fixed-axis").count(), 2);
    else await navigatorFits();
  }
  check(
    "All eight chart types render; scatter axes are independent and fixed statistical axes are labeled",
  );
  await page.locator("#chart-customize").evaluate((e) => (e.open = true));
  await page.locator("#chart-periods").evaluate((e) => (e.open = true));
  assert(await page.locator("#chart-apply-periods").isVisible());
  await page.locator("#chart-customize").evaluate((e) => (e.open = false));
  await kind("line");
  await select("x", "end");
  await select("y", "attribute:DURATION");
  await page.locator("#chart-presets").evaluate((e) => (e.open = true));
  await page.locator("#chart-preset-name").fill("Dive duration test");
  await page.locator("#chart-save-preset").click();
  await idle();
  await roundTripChart(page, api, out + "/chart-first.chronoscope");
  await idle();
  assert.equal(await page.locator("#chart-x").inputValue(), "end");
  assert.equal(
    await page.locator("#chart-y").inputValue(),
    "attribute:DURATION",
  );
  assert.equal(
    await page.locator('[data-tab="charts"]').getAttribute("class"),
    "active",
  );
  check(
    "Chart fields, presets and the active Charts pane survive portable save/reopen",
  );
  await page.locator("#chart-presets").evaluate((e) => (e.open = false));
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    await idle();
    for (const width of [1600, 1000]) {
      await page.setViewportSize({ width, height: 1050 });
      await oneRow();
      await pinnedNavigationFits();
      await navigatorFits();
      assert(await page.locator("#chart-x").isVisible());
    }
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.locator("#chart-expand").click();
  await navigatorFits();
  await page.locator("#chart-expand").click();
  await navigatorFits();
  check(
    "Navigator, drag handles and borders stay inside the canvas across chart types, themes and compact/wide sizes",
  );
  await page.screenshot({ path: out + "/chart-first-mac.png" });
  check(
    "Single-row icons and axis controls remain usable in both themes and compact/wide panes",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (error) {
  if (page) {
    await page.screenshot({ path: out + "/failure.png" }).catch(() => {});
    const state = await page
      .evaluate(() => ({
        local: window.__chronoscope?.captureScene().chart,
        saved: window.__chronoscope?.snapshot.scene.chart,
        status: document.querySelector("#chart-status")?.textContent,
      }))
      .catch(() => null);
    fs.writeFileSync(
      out + "/failure-state.json",
      JSON.stringify(state, null, 2),
    );
  }
  throw error;
} finally {
  fs.writeFileSync(
    out + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
