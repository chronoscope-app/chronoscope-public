// Capture the real frontend and Rust engine. No source data or app pixels are mocked.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "../..");
const out =
  process.env.CHRONOSCOPE_CAPTURE_OUT ||
  path.join(root, "docs/screenshots/current");
fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
const work = fs.mkdtempSync(path.join(root, ".qa/readme-"));
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(work, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const engine = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    path.join(work, "profile"),
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
let browser, service;
const report = {
  source: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  captured: new Date().toISOString(),
  renderer: "Chromium / SwiftShader on Linux",
  publicRequests: 0,
  errors: [],
  captures: [],
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(
      () => reject(Error("Engine startup timeout")),
      30000,
    );
    engine.on("error", reject);
    engine.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[0]);
      }
    });
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
    assert(r.ok, JSON.stringify(d));
    return d.result;
  };
  const offline = async (theme = "dark") => {
    const p = await api("preferences");
    await api("preferences", {
      preferences: {
        ...p,
        theme,
        basemap: "none",
        map: { ...p.map, enabled: false },
        map_layers: [],
      },
    });
  };
  await api("demo_open", { id: "stork-migration" });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      theme: "dark",
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
    },
  });
  await api("wmts_access", { settings: { offline: true } });
  await api("view_set", {
    mode: "space-time",
    inspector_tab: "views",
    render_budget: 20000,
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      show_trails: false,
      point_scale: 0.6,
      trail_gap_minutes: 720,
      trail_pixels: 0,
      track_opacity: 0.8,
    },
  });
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    timezoneId: "UTC",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const dest = route.request().url();
    if (/^https?:/.test(dest) && !dest.startsWith(url + "/")) {
      report.publicRequests++;
      return route.abort();
    }
    return route.continue();
  });
  context.on("page", (page) =>
    page.on("pageerror", (e) => report.errors.push(e.message)),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const ready = async (count) => {
    await page.waitForFunction(
      (count) =>
        window.__chronoscope?.snapshot?.count === count &&
        !window.__chronoscope.busy,
      count,
    );
    await page.evaluate(async () => {
      const a = window.__chronoscope;
      await a.filterIdle();
      await a.displayIdle();
    });
  };
  const chartIdle = async () => {
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
  const capture = async (name, target, details) => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1200);
    await target.screenshot({ path: path.join(out, name) });
    const bytes = fs.readFileSync(path.join(out, name));
    const png = PNG.sync.read(bytes);
    assert(bytes.length > 10000);
    report.captures.push({
      file: name,
      width: png.width,
      height: png.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...details,
    });
    console.log("Captured", name, `${png.width}×${png.height}`);
  };
  await page.goto(url + "/#token=" + token);
  await ready(6090);
  await page.locator("#collapse-right-pane").click();
  await page.locator("#fit").click();
  await ready(6090);
  await capture("space-time.png", page, {
    demo: "stork-migration",
    events: 6090,
    mode: "space-time",
    imagery: "Bundled Natural Earth public-domain reference map; Streets disabled for offline capture",
  });

  // Unload the previous UI before replacing its workspace, so its pending
  // scene writes cannot overwrite the next demo's capture configuration.
  await page.goto("about:blank");
  await api("demo_open", { id: "elephant-seals" });
  await offline();
  await api("view_set", {
    mode: "map",
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      point_scale: 0.5,
      show_tracks: true,
      show_trails: false,
      track_opacity: 0.8,
      spatial_culling: false,
    },
  });
  await api("view_set", { chart: null });
  await api("view_set", {
    inspector_tab: "charts",
    chart: {
      kind: "bar",
      x: "entity",
      y: "value",
      aggregate: "max",
      scope: "all",
      title: "Deepest recorded dive by seal",
      x_label: "Seal",
      y_label: "Maximum dive depth (m)",
    },
  });
  await page.goto(url + "/#token=" + token);
  await ready(15501);
  await page
    .getByRole("button", { name: "Expand right pane", exact: true })
    .click();
  await chartIdle();
  await page.locator("#fit").click();
  await ready(15501);
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.mode),
    "map",
  );
  // Click a real ECharts bar so selection is linked through the normal UI.
  const bar = await page.locator("#chart-preview").evaluate((el) => {
    const d = el.workspaceChart
      .getModel()
      .getSeriesByIndex(0)
      .getData()
      .getItemLayout(0);
    return [d.x + d.width / 2, d.y + d.height / 2];
  });
  const box = await page.locator("#chart-preview").boundingBox();
  await page.mouse.click(box.x + bar[0], box.y + bar[1]);
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count > 0,
  );
  await page.locator("#chart-table").click();
  await page.waitForSelector("#table-panel.open");
  await page.waitForSelector('#table-body tr[aria-selected="true"]');
  await page.locator("#inspector-content").evaluate((e) => (e.scrollTop = 0));
  const selected = (await api("snapshot")).selected_count;
  await capture("linked-workspace.png", page, {
    demo: "elephant-seals",
    events: 15501,
    selected,
    chart:
      "Deepest recorded dive by seal; exact bar selection linked to map and table",
  });

  await page.goto("about:blank");
  await api("demo_open", { id: "local-wildlife" });
  await offline();
  await api("view_set", { mode: "map", inspector_tab: "charts" });
  await page.goto(url + "/#token=" + token);
  await ready(3439);
  await chartIdle();
  await page.locator('[data-chart-task="patterns"]').click();
  await chartIdle();
  await page.setViewportSize({ width: 1760, height: 1000 });
  await page.locator("#theme").click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await chartIdle();
  assert.equal(await page.locator("[data-chart-task]").count(), 8);
  await page.locator("#inspector-content").evaluate((e) => (e.scrollTop = 0));
  await capture("repeating-patterns.png", page.locator(".inspector"), {
    demo: "local-wildlife",
    events: 3439,
    chart: "UTC weekday/hour recorded Event counts",
    theme: "light",
    crop: "Application inspector element",
  });

  await page.goto("about:blank");
  await api("demo_open", { id: "noaa-ais" });
  await offline("light");
  let calls = 0;
  const tool = (name, args) => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "readme-" + calls,
              type: "function",
              function: {
                name: "chronoscope_" + name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  });
  service = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      calls++;
      let response;
      if (calls === 1)
        response = tool("analytics_run", {
          plan: {
            capability: "group",
            scope: "all",
            parameters: {
              group_by: ["category"],
              field: "value",
            },
          },
        });
      else if (calls === 2) {
        const result = JSON.parse(request.messages.at(-1).content);
        assert.equal(result.input_count, 8473);
        response = tool("present_result", {
          kind: "analysis",
          result_id: result.result_id,
          chart: "bar",
          x: "group_0",
          y: "mean",
          title: "Mean recorded vessel speed by type (knots)",
        });
      } else
        response = {
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "## Compare vessel speeds\n\nRust evaluated **8,473 AIS Events** from ten vessels in San Francisco Bay on 1 January 2024, calculating mean recorded speed by **vessel type** in **knots**.\n\nThese are recorded positions, not independent voyages. Transmission rates and time spent stationary affect these sample means.",
              },
            },
          ],
        };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (e) {
      report.errors.push(e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  await api("si_configure", {
    url: `http://127.0.0.1:${service.address().port}/v1`,
    model: "readme-local-demo",
  });
  await page.goto(url + "/#token=" + token);
  await ready(8473);
  await page.locator("#si").click();
  await page.fill(
    "#si-prompt",
    "Compare mean recorded vessel speed by vessel type.",
  );
  await page.click("#si-send");
  await page.waitForSelector(".si-result-card .si-result-chart");
  await page.waitForFunction(() =>
    document
      .querySelector(".si-markdown")
      ?.textContent.includes("independent voyages"),
  );
  const popupEvent = context.waitForEvent("page");
  await page.click("#si-popout");
  const popup = await popupEvent;
  await popup.setViewportSize({ width: 960, height: 1100 });
  await popup.waitForSelector(".si-result-card .si-result-chart");
  await popup.waitForFunction(() =>
    document
      .querySelector(".si-markdown")
      ?.textContent.includes("independent voyages"),
  );
  await capture("si-analysis.png", popup, {
    demo: "noaa-ais",
    events: 8473,
    service: "Deterministic localhost demonstration, not a live model",
    calculation: "Actual Rust analytics_run + present_result",
    crop: "Detached SI app window",
  });
  assert.equal(report.publicRequests, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  await browser?.close();
  service?.closeAllConnections();
  service?.close();
  engine.kill();
  fs.writeFileSync(
    path.join(out, "capture-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
