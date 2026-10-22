import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/cluster-identity");
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
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
  });
  const state = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view,
        layer = v.displayLayer;
      const colors = {};
      for (const p of v.renderPoints)
        colors[v.names[p.entity]] = v.glyphById
          .get(p.id)
          ?.color.toCssHexString();
      const clusters = [];
      for (let i = 0; layer.points && i < layer.points.length; i++) {
        const p = layer.points.get(i);
        clusters.push({
          entity: p.id.bin.cell.key,
          partition: p.id.bin.cell.partition,
          color: p.color.toCssHexString(),
          selected: p.id.bin.selected_count,
          outline: p.outlineColor.toCssHexString(),
        });
      }
      const tracks = [];
      for (let i = 0; i < v.trails.length; i++)
        tracks.push(
          v.trails.get(i).material.uniforms.color.toCssHexString().slice(0, 7),
        );
      return {
        colors,
        clusters,
        tracks,
        glyphsShown: [...v.glyphById.values()].filter((g) => g.show).length,
        events: v.renderPoints.length,
        selected: [...v.selected],
        diagnostics: v.diagnostics(),
      };
    });
  const update = async (args) => {
    await api("view_set", args);
    await page.evaluate(() => window.__chronoscope.refresh());
    await page.waitForFunction(
      () =>
        !window.__chronoscope.busy &&
        !window.__chronoscope.view.displayLayer.diagnostics.pending,
    );
  };
  let baseline;
  for (const [label, mode] of [
    ["Space-time", "space-time"],
    ["2D Map", "map"],
    ["Globe", "globe"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    await update({ display: { mode: "points", bloom: false } });
    baseline = await state();
    assert.equal(baseline.events, 3568);
    assert(baseline.tracks.length > 0);
    await update({ display: { mode: "auto", bloom: false, partition: "all" } });
    const clustered = await state();
    assert(clustered.clusters.length > 0);
    assert.equal(clustered.events, 3568);
    assert.equal(
      clustered.glyphsShown,
      0,
      "clusters replace individual glyphs, not track evidence",
    );
    assert.deepEqual(
      clustered.tracks,
      baseline.tracks,
      "track geometry/style survives clustering",
    );
    for (const cluster of clustered.clusters) {
      assert.equal(cluster.partition, "entity");
      assert.equal(
        cluster.color,
        baseline.colors[cluster.entity],
        cluster.entity,
      );
    }
    assert.equal(clustered.diagnostics.renderErrorCount, 0);
    check(`Entity-colored clusters retain tracks in ${mode}`, {
      clusters: clustered.clusters.length,
      events: clustered.events,
      polylines: clustered.tracks.length,
      stems: clustered.diagnostics.stemSegments,
    });
    await page.screenshot({ path: path.join(dir, `clusters-${mode}.png`) });
  }
  await page.getByRole("button", { name: "Space-time", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.mode === "space-time" &&
      !window.__chronoscope.busy,
  );
  await update({ display: { mode: "clusters", bloom: false } });
  let before = await state();
  const cell = await page.evaluate(
    () => window.__chronoscope.view.displayLayer.packet.bins[0].cell,
  );
  await api("select_query", { display_cell: cell });
  await page.evaluate(() => window.__chronoscope.refresh());
  let after = await state();
  const selected = after.clusters.filter((c) => c.selected);
  assert(selected.length > 0);
  for (const c of selected) assert.equal(c.color, before.colors[c.entity]);
  check("Cluster selection retains fill color and marks the outline", {
    selectedClusters: selected.length,
    selectedEvents: after.selected.length,
  });
  await api("select", { ids: [] });
  await page.evaluate(() => window.__chronoscope.refresh());
  await page.locator('[data-tab="views"]').click();
  // The entity facet shows only the top ten until expanded.
  const showAll = page.locator("#entity-show-all");
  if (await showAll.isVisible()) await showAll.click();
  const name = cell.key,
    custom = "#d0549a";
  await page
    .locator("[data-entity-color=" + JSON.stringify(name) + "]")
    .fill(custom);
  await page.waitForFunction(
    ({ name, custom }) =>
      window.__chronoscope.snapshot.scene.entity_colors?.[name] === custom &&
      !window.__chronoscope.busy,
    { name, custom },
  );
  after = await state();
  assert(
    after.clusters
      .filter((c) => c.entity === name)
      .every((c) => c.color === custom),
  );
  assert(after.tracks.includes(custom));
  check("Changing an entity color repaints cached clusters and tracks", {
    entity: name,
    color: custom,
  });
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    await page.waitForFunction(
      (t) =>
        document.documentElement.dataset.theme === t &&
        !window.__chronoscope.busy,
      theme,
    );
    after = await state();
    for (const c of after.clusters)
      assert.equal(c.color, after.colors[c.entity]);
    assert(
      after.clusters
        .filter((c) => c.entity === name)
        .every((c) => c.color === custom),
    );
    check(`Cluster palette matches events in ${theme} mode`, {
      clusters: after.clusters.length,
    });
  }
  await page.locator("#display-tracks").uncheck();
  await page.waitForFunction(
    () =>
      !window.__chronoscope.snapshot.scene.display.show_tracks &&
      !window.__chronoscope.busy,
  );
  await page.locator("#display-trails").uncheck();
  await page.waitForFunction(
    () =>
      !window.__chronoscope.snapshot.scene.display.show_trails &&
      !window.__chronoscope.busy,
  );
  after = await state();
  assert.equal(after.tracks.length, 0);
  assert.equal(after.diagnostics.stemSegments, 0);
  assert(after.clusters.length > 0);
  await page.locator("#display-tracks").check();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.scene.display.show_tracks &&
      !window.__chronoscope.busy,
  );
  after = await state();
  assert(after.tracks.length > 0);
  assert.equal(after.diagnostics.stemSegments, 0);
  await page.locator("#display-trails").check();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.scene.display.show_trails &&
      !window.__chronoscope.busy,
  );
  after = await state();
  assert(after.diagnostics.stemSegments > 0);
  check(
    "Tracks and vertical trails remain independent toggles under clustering",
    { tracks: after.tracks.length, stems: after.diagnostics.stemSegments },
  );
  await page.screenshot({ path: path.join(dir, "clusters-custom-dark.png") });
  const [lo, hi] = await page.evaluate(
    () => window.__chronoscope.snapshot.time_bounds,
  );
  await api("filter", {
    filter: { start: lo, end: Math.round((lo + hi) / 2) },
  });
  await page.evaluate(() => window.__chronoscope.refresh());
  const filtered = await page.evaluate(() => ({
    visible: window.__chronoscope.snapshot.visible,
    count: window.__chronoscope.view.displayLayer.packet.count,
    events: window.__chronoscope.view.renderPoints.length,
  }));
  assert.equal(filtered.visible, filtered.count);
  assert.equal(filtered.events, filtered.visible);
  assert(filtered.events > 0 && filtered.events < 3568);
  check(
    "Time filtering applies equally to clusters and retained track observations",
    filtered,
  );
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.passed = true;
} catch (error) {
  report.errors.push(String(error.stack || error));
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill("SIGTERM");
}
