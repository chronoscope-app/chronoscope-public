import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/playback-speed");
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
  await page.evaluate(() => window.__chronoscope.ready);
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
    window.__chronoscope.view.onSceneChange = () => {};
  });
  const openPlayback = async () => {
    if (await page.locator("#time-rail-playback-popup").isHidden())
      await page.locator("#time-rail-playback").click();
  };
  await openPlayback();
  const trigger = page.locator("#playback-speed");
  const menu = page.getByRole("menu", { name: "Playback speed", exact: true });
  const choose = async (rate) => {
    await openPlayback();
    await trigger.click();
    await menu.locator(`[data-speed="${rate}"]`).click();
  };
  const bounds = await page.evaluate(
    () => window.__chronoscope.snapshot.time_bounds,
  );
  const span = bounds[1] - bounds[0];
  const sample = () =>
    page.evaluate(() => ({
      focus: window.__chronoscope.view.focusFraction,
      now: performance.now(),
      count: window.__chronoscope.view.renderPoints.length,
      filter: window.__chronoscope.snapshot.filter,
      errors: window.__chronoscope.view.diagnostics().renderErrorCount,
    }));
  assert.equal(await trigger.innerText(), "1×");
  assert(await trigger.locator("svg").count());
  assert(
    await trigger.evaluate(
      (e) => e.closest("#time-rail-playback-settings") !== null,
    ),
  );
  await openPlayback();
  await trigger.click();
  assert.deepEqual(
    await menu
      .locator("button")
      .evaluateAll((els) => els.map((e) => Number(e.dataset.speed))),
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
  );
  assert.equal(
    await menu.locator('[aria-checked="true"]').innerText(),
    "1×\n✓",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await trigger.innerText(), "1.25×");
  await trigger.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await trigger.innerText(), "0.25×");
  await openPlayback();
  await trigger.click();
  await page.keyboard.press("Escape");
  assert(await menu.isHidden());
  assert(await trigger.evaluate((e) => e === document.activeElement));
  await openPlayback();
  await trigger.click();
  await page.locator("#scene").click();
  assert(await menu.isHidden());
  check(
    "Popup speed control; all eight rates; keyboard, Escape and outside dismissal",
    {},
  );

  const increment = page.locator("#playback-increment");
  const increments = page.getByRole("menu", {
    name: "Playback increment",
    exact: true,
  });
  assert.equal(await increment.innerText(), "Day");
  assert(
    await increment.evaluate(
      (e) =>
        e
          .closest("#time-rail-playback-settings")
          .querySelector("#playback-speed") !== null,
    ),
  );
  await openPlayback();
  await increment.click();
  assert.deepEqual(await increments.locator("button").allTextContents(), [
    "Millisecond✓",
    "Second✓",
    "Minute✓",
    "Hour✓",
    "Day✓",
    "Week✓",
  ]);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await increment.innerText(), "Week");
  await openPlayback();
  await increment.click();
  await increments
    .getByRole("menuitemradio", { name: "Hour", exact: true })
    .click();
  assert.equal(await increment.innerText(), "Hour");
  for (const [button, popup] of [
    [trigger, menu],
    [increment, increments],
  ]) {
    assert.equal(await button.getAttribute("title"), null);
    assert.equal(await button.getAttribute("data-tooltip"), null);
    assert.notEqual(await button.getAttribute("data-tooltip-disabled"), null);
    await page.mouse.move(600, 300);
    await button.hover();
    await page.waitForTimeout(500);
    await page.mouse.move(600, 300);
    await page.waitForTimeout(1200);
    assert(await popup.isHidden(), "Leaving must cancel the pending hover");
    await button.focus();
    await button.hover();
    await page.waitForTimeout(650);
    assert(await popup.isHidden(), "Menu must not open before one second");
    await popup.waitFor({ state: "visible", timeout: 700 });
    assert(await button.evaluate((e) => e === document.activeElement));
    assert.equal(await page.locator("#control-tooltip.visible").count(), 0);
    const target = popup.locator('[aria-checked="true"]');
    const rect = await target.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, {
      steps: 15,
    });
    assert(await popup.isVisible(), "Pointer can cross the gap into the menu");
    await page.mouse.move(600, 300);
    assert(await popup.isHidden(), "Hover menu closes when pointer leaves");
  }
  await openPlayback();
  await trigger.click();
  await increment.hover();
  await increments.waitFor({ state: "visible" });
  assert(await menu.isHidden(), "Only one playback menu can be open");
  await page.keyboard.press("Escape");
  assert(await increments.isHidden());
  await page.mouse.move(600, 300);
  await trigger.hover();
  await page.waitForTimeout(500);
  await trigger.press("Escape");
  await page.waitForTimeout(1200);
  assert(await menu.isHidden(), "Escape cancels a pending hover");
  await page.mouse.move(600, 300);
  check(
    "Both playback menus hover-open after 1s, cancel safely, share one popup and have no tooltips",
    {},
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy,
  );
  assert.equal(await increment.innerText(), "Hour");
  await page.evaluate(() => {
    window.__chronoscope.view.onViewportChange = () => {};
    window.__chronoscope.view.onSceneChange = () => {};
  });
  // A reload resets the speed but keeps the explicitly selected UTC increment.
  await choose(1);
  await page.locator("#play").click();
  const incrementRates = [];
  for (const [label, seconds] of [
    ["Hour", 3600],
    ["Day", 86400],
    ["Week", 604800],
  ]) {
    const before = await sample();
    if (label !== "Hour") {
      await openPlayback();
      await increment.click();
      await increments
        .getByRole("menuitemradio", { name: label, exact: true })
        .click();
    }
    const start = await sample();
    assert(
      Math.abs(start.focus - before.focus) < 0.001,
      "Increment change jumped cursor",
    );
    await page.waitForTimeout(1050);
    const end = await sample();
    const rate =
      ((end.focus - start.focus) * span) / ((end.now - start.now) / 1000);
    assert(
      Math.abs(rate / seconds - 1) < 0.08,
      JSON.stringify({ label, rate }),
    );
    incrementRates.push({ label, secondsPerSecond: rate });
  }
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  await openPlayback();
  await increment.click();
  await increments
    .getByRole("menuitemradio", { name: "Day", exact: true })
    .click();
  await choose(0.25);
  check(
    "Hour, Day and Week control actual UTC advancement, change live and persist",
    incrementRates,
  );

  await page.locator("#time-rail-range").click();
  await page.locator("#full-range").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      !window.__chronoscope.busy &&
      window.__chronoscope.snapshot.filter.start === null &&
      window.__chronoscope.snapshot.filter.end === null,
  );
  await page.locator("#play").click();
  const rates = [];
  for (const rate of [0.25, 1, 2]) {
    if (rate !== 0.25) {
      const before = await sample();
      await choose(rate);
      const after = await sample();
      assert(
        Math.abs(after.focus - before.focus) < 0.03,
        "Live speed change jumped cursor",
      );
    }
    const start = await sample();
    await page.waitForTimeout(1100);
    const end = await sample();
    const actual =
      (end.focus - start.focus) /
      ((((end.now - start.now) / 1000) * 86400) / span);
    assert(
      Math.abs(actual - rate) < 0.08,
      JSON.stringify({ rate, actual, start, end }),
    );
    assert.equal(end.count, 3568);
    assert.equal(end.filter.start, null);
    assert.equal(end.filter.end, null);
    rates.push({ rate, actual });
  }
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  const paused = await sample();
  await choose(0.75);
  await page.waitForTimeout(350);
  assert.equal((await sample()).focus, paused.focus);
  await page.locator("#play").click();
  const resumed = await sample();
  await page.waitForTimeout(1100);
  const end = await sample();
  const actual =
    (end.focus - resumed.focus) /
    ((((end.now - resumed.now) / 1000) * 86400) / span);
  assert(Math.abs(actual - 0.75) < 0.08, JSON.stringify({ actual }));
  await page.locator("#play").click();
  check(
    "Actual playback runs at quarter, normal and double speed; live changes, pause and resume",
    { rates, resume: actual },
  );

  await page.waitForFunction(() => !window.__chronoscope.busy);
  // Resize through the actual timeline so pending filter writes cannot race an external edit.
  const handle = await page.locator("#window-end").boundingBox();
  const track = await page.locator("#time-range-track").boundingBox();
  // Mouse events use integral CSS pixels. Compute the expected UTC bound
  // from the actual drag distance, independent of resizable pane widths.
  const startY = Math.round(handle.y + handle.height / 2);
  const targetY = Math.round(track.y + track.height * 0.2);
  const x = Math.round(handle.x + handle.width / 2);
  const expectedEnd = Math.round(
    bounds[0] +
      (bounds[1] - bounds[0]) * (1 + (targetY - startY) / track.height),
  );
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, targetY, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    (end) =>
      !window.__chronoscope.busy &&
      Math.abs(window.__chronoscope.snapshot.filter.end - end) < 60,
    expectedEnd,
  );
  const selected = await sample();
  const selectedWidth =
    selected.filter.end - (selected.filter.start ?? bounds[0]);
  await choose(2);
  await page.locator("#play").click();
  await page.waitForTimeout(1100);
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  const moved = await sample();
  assert(
    Math.abs(moved.filter.end - moved.filter.start - selectedWidth) <= 2,
    JSON.stringify({ selected, selectedWidth, bounds, moved }),
  );
  assert(moved.filter.start > bounds[0]);
  assert.equal(moved.errors, 0);
  check("Moving-window playback retains its width at 2×", moved.filter);

  assert.deepEqual(
    await page.locator(".inspector-tabs button").allTextContents(),
    ["Views", "Charts", "Inspect", "Patterns"],
  );
  await page.locator('[data-tab="views"]').click();
  assert.equal(await page.locator("#views-entities").count(), 0);
  assert.equal(await page.locator(".view-effect small").count(), 0);
  assert.equal(
    await page
      .locator('.view-effect [data-effect="trails"]')
      .locator("..")
      .locator(".view-effect-name")
      .innerText(),
    "Stems",
  );
  assert.equal(
    await page
      .locator('.view-effect [data-effect="heatmap"]')
      .locator("..")
      .locator(".view-effect-name")
      .innerText(),
    "Heat",
  );
  assert.equal(await page.locator(".view-effect-description").count(), 7);
  assert.equal(
    await page
      .locator(".view-effect-description")
      .first()
      .evaluate((e) => getComputedStyle(e).fontWeight),
    "400",
  );
  assert.equal(await page.locator("#scene .map-attribution").count(), 0);
  assert.equal(await page.locator(".statusbar #map-attribution").count(), 1);
  assert.equal(await page.locator("#geography-readout").innerText(), "");
  const footer = await page.locator(".statusbar").boundingBox();
  const creditLink = page.locator("#cesium-credits .cesium-credit-expand-link");
  if (await creditLink.isVisible()) {
    const box = await creditLink.boundingBox();
    assert(
      box.y >= footer.y && box.y + box.height <= footer.y + footer.height,
      "Provider credits stay inside the status bar, outside the canvas",
    );
  }

  await page.locator("#display-tracks").hover();
  await page.waitForTimeout(2100);
  assert.match(
    await page.locator("#control-tooltip").innerText(),
    /Lines connecting records/,
  );
  const color = page.locator("#entities [data-entity-color]").first();
  const name = await color.getAttribute("data-entity-color");
  await color.fill("#e1a344");
  await page.waitForFunction(
    (name) =>
      window.__chronoscope.snapshot.scene.entity_colors?.[name] === "#e1a344",
    name,
  );
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1000, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.locator("#display-advanced").evaluate((e) => (e.open = true));
    const before = await page.locator(".inspector-tabs").boundingBox();
    const scroll = await page.locator(".inspector-content").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
      return e.scrollTop;
    });
    assert(scroll > 0);
    assert.deepEqual(
      await page.locator(".inspector-tabs").boundingBox(),
      before,
    );
    for (const item of ["views", "inspect", "patterns", "charts"])
      assert(await page.locator(`[data-tab="${item}"]`).isVisible());
    const spacing = await page.evaluate(() => ({
      left: getComputedStyle(document.querySelector(".sidebar-scroll"))
        .paddingLeft,
      right: getComputedStyle(document.querySelector(".inspector-content"))
        .paddingLeft,
    }));
    assert.equal(spacing.left, spacing.right);
  }
  check(
    "Views descriptions, Stems label, footer credits, fixed tabs and left-side entity colors",
    {},
  );

  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    for (const [width, height] of [
      [1600, 1000],
      [1000, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await openPlayback();
      await trigger.click();
      const layout = await menu.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + 20, r.y + 20);
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          visible: e.contains(hit),
        };
      });
      assert(
        layout.visible &&
          layout.x >= 0 &&
          layout.y >= 0 &&
          layout.right <= width &&
          layout.bottom <= height,
        JSON.stringify(layout),
      );
      await page.screenshot({
        path: path.join(dir, `speed-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
    }
  }
  check(
    "Playback popup menu remains on screen in both themes and window sizes",
    {},
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
