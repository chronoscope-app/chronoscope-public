import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
import path from "node:path";
import assert from "node:assert/strict";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "../.."),
  out =
    process.env.CHRONOSCOPE_QA_DATA_DIR ||
    path.join(root, ".qa/charts-timezone");
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
  const url = await localServerUrl(server);
  const api = createApi(url, token);
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
  browser = await chromium.launch();

  for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      timezoneId: zone,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.route("**/*", (r) => {
      if (r.request().url().startsWith(url)) return r.continue();
      report.publicRequests++;
      return r.abort();
    });
    await page.goto(url + "/#token=" + token);
    await page.waitForFunction(
      () =>
        document.querySelector("#chart-preview")?.workspaceChart &&
        document
          .querySelector("#chart-status")
          .textContent.includes("scoped records"),
    );
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    const axes = await page.locator("#chart-preview").evaluate((e) => {
      const c = e.workspaceChart;
      return {
        axisName: c.getOption().xAxis[0].name,
        firstX: c.getOption().series[0].data[0].value[0],
        useUTC: c.getOption().useUTC ?? false,
        labels: c
          .getModel()
          .getComponent("xAxis")
          .axis.getViewLabels()
          .map((t) => ({
            value: t.tickValue,
            raw: t.rawLabel,
            label: t.formattedLabel,
          })),
      };
    });
    report.timezones.push({ zone, ...axes });
    if (zone === "America/New_York") {
      report.visibleControls = await page
        .locator(".charts-panel select:visible")
        .count();
      await page.screenshot({ path: out + "/seals-chart-pane.png" });
      await page.waitForSelector("#chart-preview canvas");
      await page.screenshot({ path: out + "/seals-chart-expanded.png" });
    }
    await context.close();
  }
  for (const zone of report.timezones) {
    assert.equal(zone.useUTC, true, zone.zone + ": time axes must use UTC");
    assert(zone.axisName.includes("UTC"));
    assert.equal(zone.firstX, Date.UTC(2004, 1, 22));
    assert.deepEqual(
      zone.labels,
      report.timezones[0].labels,
      zone.zone + ": identical UTC buckets must have identical calendar labels",
    );
  }
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  assert.equal((await api("snapshot", { compact: true })).count, 15501);
  report.checks = [
    "UTC, New York (including DST) and Tokyo render identical daily UTC axis labels",
    "Daily elephant-seal buckets begin on the correct UTC calendar day",
    "Charts explicitly label the UTC time axis",
    "Rendering keeps all 15,501 source records unchanged and requests no public services",
  ];
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
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
