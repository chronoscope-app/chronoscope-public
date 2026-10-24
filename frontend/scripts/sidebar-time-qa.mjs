import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/sidebar-time");
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
  assert.equal(
    await page
      .locator("#project-chip,#dataset-name,#total,#entity-total")
      .count(),
    0,
  );
  assert.equal(
    await page.locator(".sidebar-scroll > :first-child").getAttribute("id"),
    "entity-section",
  );
  await page.waitForFunction(() =>
    Array.from(document.querySelector("#entity-field").options).some(
      (o) => o.value === "attribute:status",
    ),
  );
  assert.equal(
    await page.locator(".sidebar-pinned > #reset-filters").count(),
    1,
  );
  assert(
    await page
      .locator("#reset-filters")
      .evaluate((e) => e.previousElementSibling.id === "search"),
  );
  const idle = async () => {
    await page.evaluate(() => window.__chronoscope.filterIdle());
    await page.waitForFunction(() => !window.__chronoscope.busy);
  };
  await page.locator("#entity-field").selectOption("attribute:status");
  await idle();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.facets?.entity?.field ===
      "attribute:status",
  );
  const originalEntities = await page.evaluate(
    () => window.__chronoscope.snapshot.entities,
  );
  assert.equal(Object.keys(originalEntities).length, 83);
  const counts = await page.evaluate(
    () => window.__chronoscope.snapshot.facets.entity.counts,
  );
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    3568,
  );
  assert.equal(await page.locator("#entities .entity-color").count(), 0);
  await page.locator('#entities [data-select-entity="HU"]').click();
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  const selected = await api("snapshot");
  assert.equal(selected.selected_count, counts.HU);
  assert.equal(
    await page
      .locator('#entities [data-select-entity="HU"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('#entities [data-select-entity="HU"]').click();
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  assert.equal((await api("snapshot")).selected_count, 0);
  await page.locator('#entities [data-entity="HU"]').uncheck();
  await idle();
  assert.equal((await api("snapshot")).visible, 3568 - counts.HU);
  await page.locator('#entities [data-entity="HU"]').check();
  await idle();
  assert.equal((await api("snapshot")).visible, 3568);
  assert.deepEqual((await api("snapshot")).entities, originalEntities);
  check(
    "Entities starts the sidebar; imported-field groups filter/select exactly while preserving track identities",
    { counts },
  );
  await page.locator("#category-field").selectOption("attribute:season");
  await idle();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.facets?.category?.field ===
      "attribute:season",
  );
  const seasons = await page.evaluate(
    () => window.__chronoscope.snapshot.facets.category.counts,
  );
  await page.locator('#categories [data-category="2016"]').uncheck();
  await idle();
  assert.equal((await api("snapshot")).visible, 3568 - seasons["2016"]);
  await page.locator('#categories [data-category="2016"]').check();
  await idle();
  check("Categories can group/filter an imported column independently", {
    seasons,
  });
  await page.getByText("Exact time range", { exact: true }).click();
  const range = async (start, end) => {
    const expected = await Promise.all(
      [start, end].map(
        async (value) => (await api("time_parse", { value })).epoch,
      ),
    );
    await page.locator("#exact-start").fill(start);
    await page.locator("#exact-end").fill(end);
    await page.locator("#exact-apply").click();
    // Parsing precedes filter-intent publication; wait for this requested range,
    // rather than accepting the previous already-consistent snapshot.
    await page.waitForFunction(([start, end]) => {
      const f = window.__chronoscope.snapshot.filter;
      return f.start === start && f.end === end;
    }, expected);
    await idle();
    await page.waitForFunction(() => {
      const c = window.__chronoscope;
      return (
        c.view.lo === c.snapshot.filter.start &&
        c.view.hi === c.snapshot.filter.end
      );
    });
    return page.evaluate(() => {
      const c = window.__chronoscope;
      return {
        lo: c.view.lo,
        hi: c.view.hi,
        visible: c.snapshot.visible,
        errors: c.view.renderErrors,
        study: c.snapshot.time_bounds,
        focus: c.view.focusFraction,
      };
    });
  };
  const dates = ["2019-08-24 00:00", "2019-09-08 00:00"];
  const narrow = await range(...dates);
  assert.equal(narrow.lo, Date.parse(dates[0] + "Z") / 1000);
  assert.equal(narrow.hi, Date.parse(dates[1] + "Z") / 1000);
  assert(narrow.visible > 0);
  assert.equal(narrow.errors, 0);
  assert(narrow.study[1] - narrow.study[0] > narrow.hi - narrow.lo);
  const camera = await page.evaluate(() =>
    window.__chronoscope.view.captureCamera(),
  );
  await page.locator("#play").click();
  await page.waitForTimeout(1300);
  await page.locator("#play").click();
  await idle();
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.view.lo === c.snapshot.filter.start &&
      c.view.hi === c.snapshot.filter.end
    );
  });
  const moving = await page.evaluate(() => {
    const c = window.__chronoscope;
    return {
      lo: c.view.lo,
      hi: c.view.hi,
      camera: c.view.captureCamera(),
      errors: c.view.renderErrors,
    };
  });
  assert(moving.lo > narrow.lo);
  assert.equal(moving.hi - moving.lo, narrow.hi - narrow.lo);
  assert.equal(moving.errors, 0);
  for (const key of ["position", "direction", "up"]) {
    const before = camera.cesium_camera[key],
      after = moving.camera.cesium_camera[key];
    assert(
      before.every(
        (v, i) => Math.abs(v - after[i]) < (key === "position" ? 1e-6 : 1e-10),
      ),
    );
  }
  check(
    "Selected UTC window and moving playback rescale the vertical axis while retaining the geographic camera",
    { narrow, moving },
  );
  const empty = await range("2019-02-01 00:00", "2019-02-02 00:00");
  assert.equal(empty.visible, 0);
  assert.equal(empty.errors, 0);
  await page.locator('[data-view="globe"]').click();
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.view.mode === "globe" &&
      c.view.lo === c.snapshot.time_bounds[0] &&
      c.view.hi === c.snapshot.time_bounds[1]
    );
  });
  await page.locator('[data-view="space-time"]').click();
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.view.mode === "space-time" && c.view.lo === c.snapshot.filter.start
    );
  });
  if (await page.locator("#full-range").isHidden())
    await page.locator("#time-rail-range").click();
  await page.locator("#full-range").click();
  await idle();
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.view.lo === c.snapshot.time_bounds[0] &&
      c.view.hi === c.snapshot.time_bounds[1] &&
      c.snapshot.visible === 3568
    );
  });
  check(
    "Empty windows retain their UTC axis, other map modes retain study time, Full range restores the study",
  );
  await page.locator("#window-start").press("ArrowRight");
  await idle();
  await page.locator("#window-end").press("ArrowLeft");
  await idle();
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.snapshot.filter.start !== null &&
      c.snapshot.filter.end !== null &&
      c.view.lo === c.snapshot.filter.start &&
      c.view.hi === c.snapshot.filter.end
    );
  });
  const brackets = await page.evaluate(() => [
    window.__chronoscope.view.lo,
    window.__chronoscope.view.hi,
  ]);
  await page.locator("#time-range-window").press("ArrowRight");
  await idle();
  await page.waitForFunction(([lo, hi]) => {
    const v = window.__chronoscope.view;
    return v.lo > lo && v.hi > hi;
  }, brackets);
  check("Bracket and whole-window controls update the same space-time axis");
  if (await page.locator("#full-range").isHidden())
    await page.locator("#time-rail-range").click();
  await page.locator("#full-range").click();
  await idle();
  await page.locator("#entity-field").selectOption("entity");
  await idle();
  assert.equal(await page.locator("#entities .entity-color").count(), 10);
  assert.equal(await page.locator("#entity-section").getAttribute("open"), "");
  await page.locator("#entity-section").scrollIntoViewIfNeeded();
  // Review proposals: verify behavior across the desktop's supported sizes.
  await page.locator('[data-select-entity="Dorian 2019"]').click();
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  assert.equal(
    await page.locator("#pinned-selection-count").textContent(),
    "70 selected",
  );
  assert(
    await page
      .locator("#selection-tools")
      .evaluate((e) => e.classList.contains("has-selection")),
  );
  await page.locator("#clear").click();
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 0,
  );
  assert(await page.locator("#clear").isDisabled());
  assert.equal(
    await page
      .locator(".sphere-navigator")
      .evaluate((e) => getComputedStyle(e).opacity),
    "1",
  );
  // The vertical rail exposes date context in its range popup.
  await page.locator("#time-rail-range").click();
  const rangeLabel = await page.locator("#range-label").innerText();
  assert.match(rangeLabel, /2016/);
  assert.match(rangeLabel, /2025/);
  assert(rangeLabel.indexOf("2016") < rangeLabel.indexOf("2025"));
  await page.keyboard.press("Escape");
  for (const label of [
    "Marker size",
    "Track opacity",
    "Stem opacity",
    "Cluster size",
    "Cell size",
    "Smoothing radius",
    "Glow intensity",
  ])
    assert.equal(
      await page.getByRole("slider", { name: label, exact: true }).count(),
      1,
    );
  const marker = page.getByRole("slider", { name: "Marker size", exact: true });
  await marker.focus();
  await marker.press("ArrowRight");
  await page.evaluate(() => window.__chronoscope.displayIdle());
  const markerUnit = await marker.getAttribute("aria-valuetext");
  assert(markerUnit.endsWith("%"));
  const renderedScale = await page.evaluate(
    () => window.__chronoscope.snapshot.scene.display.point_scale,
  );
  assert.equal(Number.parseInt(markerUnit), Math.round(renderedScale * 100));
  check(
    "Pinned selection count/actions, visible navigation, descriptive slider units and year-aware range",
    { rangeLabel, markerUnit },
  );

  const size = (selector) => page.locator(selector).boundingBox();
  const railBefore = await size("#time-rail");
  const leftBefore = await size(".sidebar");
  await page.locator("#resize-sidebar").press("Shift+ArrowRight");
  assert.equal(
    Math.round((await size(".sidebar")).width - leftBefore.width),
    40,
  );
  const drag = async (selector, dx, dy) => {
    const box = await size(selector);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  const rightBefore = await size(".inspector");
  await drag("#resize-inspector", -60, 0);
  assert.equal(
    Math.round((await size(".inspector")).width - rightBefore.width),
    60,
  );
  assert.equal(
    Math.round((await size("#time-rail")).width),
    Math.round(railBefore.width),
    "The fixed-width time rail is independent of resizable side panes",
  );
  const persisted = await page.evaluate(() =>
    localStorage.getItem("chronoscope.workspace-layout.v1"),
  );
  assert(persisted);
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy,
  );
  assert.equal(
    Math.round((await size(".sidebar")).width),
    Math.round(leftBefore.width + 40),
  );
  assert.equal(
    Math.round((await size(".inspector")).width),
    Math.round(rightBefore.width + 60),
  );
  check("Pane resizing supports keyboard, pointer and reload persistence");

  await page.locator("#toggle-table").click();
  await page.locator("[data-table-layer-source]").first().click();
  await page.waitForSelector(".table-panel.open");
  const tableBefore = await size(".table-panel");
  await drag("#resize-table", 0, -45);
  assert.equal(
    Math.round((await size(".table-panel")).height - tableBefore.height),
    45,
  );
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    for (const [width, height] of [
      [1600, 1000],
      [1000, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      const pinned = await size(".sidebar-pinned");
      await page.locator(".sidebar-scroll").evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      assert.deepEqual(await size(".sidebar-pinned"), pinned);
      const scene = await size("#scene");
      const timeline = await size(".timeline");
      const sidebar = await size(".sidebar");
      assert(scene.width >= 359 && scene.height >= 219, JSON.stringify(scene));
      assert(
        timeline.y + timeline.height <= height - 27,
        JSON.stringify(timeline),
      );
      assert.equal(
        await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth),
        false,
      );
      assert(pinned.height < sidebar.height / 2);
      await page.screenshot({
        path: path.join(dir, `review-${theme}-${width}.png`),
      });
    }
  }
  await page.locator("#close-table").click();
  await page.locator("#fullscreen").click();
  assert.equal(
    Math.round(
      (await size(".center")).width + (await size(".time-rail")).width,
    ),
    1000,
  );
  assert(await page.locator("#resize-sidebar").isHidden());
  await page.locator("#fullscreen").click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const pane of ["sidebar", "inspector", "table"]) {
    if (pane !== "table") await page.locator(`#resize-${pane}`).press("Enter");
  }
  check(
    "Resizable table, pinned controls and bounded scene at 1600/1000px in both themes; expanded workspace",
  );
  // Exercise the rails here with the existing layout/resize coverage rather
  // than introducing another browser suite.
  const event = (await api("query", { limit: 1 })).events[0];
  await page.evaluate((id) => window.__chronoscope.select([id]), event.id);
  await page.locator('[data-tab="inspect"]').click();
  await page.locator("#edit-note").fill("Draft survives pane peeks");
  const expandedScene = await size("#scene");
  const expandedLeft = await size(".sidebar");
  const expandedRight = await size(".inspector");
  await page
    .getByRole("button", { name: "Collapse left pane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse right pane", exact: true })
    .click();
  assert.equal(Math.round((await size(".sidebar")).width), 44);
  assert.equal(Math.round((await size(".inspector")).width), 44);
  assert.equal(
    await page.locator("#resize-sidebar").getAttribute("aria-hidden"),
    "true",
  );
  const railScene = await size("#scene");
  assert(railScene.width > expandedScene.width + 400);
  const peek = async (side, section) => {
    await page.locator(`.${side} [data-pane-section="${section}"]`).hover();
    await page
      .locator(
        `.${side}.pane-peeking[data-peek-section="${section}"] .pane-content`,
      )
      .waitFor({ state: "visible" });
    assert.equal((await size("#scene")).width, railScene.width);
  };
  const dismiss = async (side) => {
    await page.mouse.move(railScene.x + railScene.width / 2, railScene.y + 300);
    await page.locator(`.${side} .pane-content`).waitFor({ state: "hidden" });
  };
  await peek("sidebar", "entity");
  await page.locator("#entity-search").fill("Dorian");
  await dismiss("sidebar");
  await peek("sidebar", "entity");
  assert.equal(await page.locator("#entity-search").inputValue(), "Dorian");
  assert(await page.locator("#category-section").isHidden());
  await page.locator("#entity-search").fill("");
  for (const section of [
    "search",
    "category",
    "time",
    "rules",
    "bounds",
    "layers",
  ])
    await peek("sidebar", section);
  await dismiss("sidebar");
  for (const section of ["views", "charts", "patterns", "si", "inspect"])
    await peek("inspector", section);
  await page.locator("#edit-note").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#edit-note").inputValue(),
    "Draft survives pane peeks",
  );
  await dismiss("inspector");
  await peek("inspector", "inspect");
  assert.equal(
    await page.locator("#edit-note").inputValue(),
    "Draft survives pane peeks",
  );
  await dismiss("inspector");
  check(
    "Both rails expose every section; floating panels preserve drafts and leave scene size unchanged",
  );

  const entitiesIcon = page.locator('.sidebar [data-pane-section="entity"]');
  await entitiesIcon.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "entity-field",
  );
  await page.keyboard.press("Escape");
  assert(await page.locator(".sidebar .pane-content").isHidden());
  assert.equal(
    await entitiesIcon.evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Control+f");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  await page.keyboard.press("Escape");
  await entitiesIcon.click();
  await page.locator("#status").click();
  assert(await page.locator(".sidebar .pane-content").isHidden());
  await peek("sidebar", "entity");
  await page
    .getByRole("button", { name: "Pin left pane open", exact: true })
    .click();
  assert.equal((await size(".sidebar")).width, expandedLeft.width);
  await page
    .getByRole("button", { name: "Collapse left pane", exact: true })
    .click();
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy,
  );
  assert.equal((await size(".sidebar")).width, 44);
  assert.equal((await size(".inspector")).width, 44);
  assert((await page.locator(".pane-peeking").count()) === 0);
  check(
    "Keyboard, Escape, click-away and pinning work; both collapsed preferences survive reload",
  );

  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    for (const width of [1600, 1000, 700]) {
      await page.setViewportSize({ width, height: 800 });
      for (const side of ["sidebar", "inspector"]) {
        await page
          .locator(
            `.${side} [data-pane-section="${side === "sidebar" ? "entity" : "views"}"]`,
          )
          .hover();
        const panel = page.locator(`.${side} .pane-content`);
        await panel.waitFor({ state: "visible" });
        const box = await panel.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width, JSON.stringify(box));
        assert.equal(
          await page
            .locator("body")
            .evaluate((e) => e.scrollWidth > innerWidth),
          false,
        );
        if (width === 1000)
          await page.screenshot({
            path: path.join(dir, `pane-${theme}-${side}.png`),
          });
        await page.mouse.move(width / 2, 20);
        await panel.waitFor({ state: "hidden" });
      }
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByRole("button", { name: "Expand left pane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand right pane", exact: true })
    .click();
  assert.equal((await size(".sidebar")).width, expandedLeft.width);
  assert.equal((await size(".inspector")).width, expandedRight.width);
  check(
    "Rail panels stay on screen at 700/1000/1600px in both themes; expanding restores pane sizes",
  );
  await page.screenshot({ path: path.join(dir, "sidebar-space-time.png") });
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
