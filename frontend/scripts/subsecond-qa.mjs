import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../.."),
  dir = process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/subsecond");
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const csv = path.join(dir, "precision.csv");
fs.writeFileSync(
  csv,
  "entity,timestamp,latitude,longitude,value\nA,2026-10-13T08:15:01.125Z,33.749,-84.388,10\nA,2026-10-13T08:15:01.375Z,33.750,-84.387,20\nA,2026-10-13T08:15:01.875Z,33.751,-84.386,30\n",
);
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    dir,
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
let browser;
const checks = [],
  errors = [];
const check = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const p = await api("preferences");
  await api("preferences", {
    preferences: {
      ...p,
      basemap: "none",
      map: { ...p.map, enabled: false },
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "space-time",
    inspector_tab: "views",
    display: { mode: "points", spatial_culling: false },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3 &&
      !window.__chronoscope.busy &&
      window.__chronoscope.view.renderPoints.length === 3,
  );
  const times = await page.evaluate(() =>
    window.__chronoscope.view.renderPoints.map((p) => p.time),
  );
  assert.equal(new Set(times).size, 3);
  assert(times.every((t) => t % 1 !== 0));
  check("Cesium receives distinct subsecond Events");
  await page.getByText("Exact time range", { exact: true }).click();
  await page.locator("#exact-start").fill("2026-10-13 08:15:01.2");
  await page.locator("#exact-end").fill("2026-10-13 08:15:01.5");
  await page.locator("#exact-apply").click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.visible === 1 && !window.__chronoscope.busy,
  );
  const filter = await api("snapshot");
  assert.equal(filter.filter.start, 1791879301.2);
  assert.equal(filter.filter.end, 1791879301.5);
  check("UTC text filters preserve fractions and select the correct Event");
  await page.locator("#time-rail-range").click();
  await page.locator("#full-range").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.visible === 3 && !window.__chronoscope.busy,
  );
  const bracket = await page.locator("#window-end").boundingBox();
  await page.mouse.move(
    bracket.x + bracket.width / 2,
    bracket.y + bracket.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bracket.x + bracket.width / 2,
    bracket.y + bracket.height / 2 - 180,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.evaluate(() => window.__chronoscope.filterIdle());
  const after = await api("snapshot");
  assert(
    after.filter.end > 1791879301.125 && after.filter.end < 1791879301.875,
  );
  assert(after.filter.end % 1 !== 0);
  check("Dragging brackets supports a window smaller than one second");
  await page.locator("#time-rail-range").click();
  await page.locator("#full-range").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.visible === 3 && !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.select(["2"]));
  await page.locator('[data-tab="inspect"]').click();
  await page.waitForSelector("#edit-time");
  assert((await page.locator("#edit-time").inputValue()).endsWith("01.375"));
  await page.locator("#edit-time").fill("2026-10-13 08:15:01.400123");
  await page.locator("#apply-edit").click();
  await page.waitForFunction(
    async () =>
      (await window.__chronoscope.call("events", { id: "2" })).events[0]
        .time === 1791879301.400123,
  );
  const row = (await api("events", { id: "2" })).events[0];
  assert.equal(row.time, 1791879301.400123);
  assert.equal(row.attrs.timestamp, "2026-10-13T08:15:01.375Z");
  check("Inspector edits retain microseconds and original source text");
  const chart = await api("chart_data", {
    config: {
      x: "time",
      x_axis: "time",
      time_bucket: "millisecond",
      scope: "all",
    },
  });
  assert.equal(chart.rows.length, 3);
  check("Millisecond chart intervals keep Events separate");
  await page.locator("#time-rail-playback").click();
  await page.locator("#playback-increment").click();
  await page
    .getByRole("menuitemradio", { name: "Second", exact: true })
    .click();
  await page.locator("#play").click();
  await page.waitForTimeout(250);
  await page.locator("#play").click();
  await page.evaluate(() => window.__chronoscope.filterIdle());
  check("Second-rate playback works on subsecond data");
  await page.screenshot({ path: path.join(dir, "precision.png") });
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser?.close();
  server.kill("SIGTERM");
}
