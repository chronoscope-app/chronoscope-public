import { chromium, spawn, localServerUrl } from "./qa-runtime.mjs";
// Real Open dialog, Rust readers, Cesium reference layers and Events conversion.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
const desktopCsp = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
).app.security.csp;
fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
const directory =
  process.env.CHRONOSCOPE_QA_OUT ||
  fs.mkdtempSync(path.join(root, ".qa/vector-gis-"));
fs.mkdirSync(directory, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(directory, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const binary =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  binary,
  [
    "--data-dir",
    directory,
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  passed: false,
  checks: [],
  errors: [],
  externalRequests: [],
  screenshots: [],
};
let browser;
function check(name) {
  report.checks.push(name);
  console.log("PASS", name);
}
try {
  const url = await localServerUrl(server);
  async function api(command, args = {}) {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await response.json();
    assert(response.ok, JSON.stringify(body));
    return body.result;
  }
  const preferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...preferences,
      basemap: "none",
      map: { ...preferences.map, enabled: false },
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__vectorCspErrors ||= [];
      window.__vectorCspErrors.push(
        `${event.effectiveDirective}: ${event.blockedURI}`,
      );
    });
  });
  await page.route("**/*", async (route) => {
    if (
      /^https?:/.test(route.request().url()) &&
      !route
        .request()
        .url()
        .startsWith(url + "/")
    ) {
      report.externalRequests.push(route.request().url());
      await route.abort();
    } else if (
      route.request().isNavigationRequest() &&
      route.request().resourceType() === "document"
    ) {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": desktopCsp,
        },
      });
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  const beforeScreenshot = path.join(directory, "before-vector-import.png");
  await page.screenshot({ path: beforeScreenshot });
  report.screenshots.push(beforeScreenshot);
  const sample = (name) => path.join(root, "tests/fixtures/gis/vector", name);
  async function refresh() {
    await page.evaluate(async () => window.__chronoscope.refresh(true, false));
    await page.waitForFunction(() => !window.__chronoscope.busy);
  }
  async function open(name, format, count) {
    const before = (await api("gis_layers")).layers.length;
    page.once("dialog", (dialog) => dialog.accept(sample(name)));
    await page.click("#open");
    await page.waitForSelector("#gis-open-reference");
    assert((await page.locator(".modal").textContent()).includes(format));
    await page.click("#gis-open-reference");
    await page.waitForFunction(
      (n) =>
        window.__chronoscope.snapshot.gis_layers?.length === n &&
        !window.__chronoscope.busy,
      before + 1,
    );
    const layer = (await api("gis_layers")).layers.at(-1);
    assert.equal(layer.feature_count, count);
    assert.equal(layer.source_format, format.toLowerCase());
    assert(
      (
        await page.locator(`[data-gis-id="${layer.id}"]`).textContent()
      ).includes(format),
    );
    await page.waitForFunction(
      (id) =>
        window.__chronoscope.view.gis.loaded.has(id) ||
        window.__chronoscope.view.gis.errors.has(id),
      layer.id,
    );
    const state = await page.evaluate(
      (id) => ({
        loaded: window.__chronoscope.view.gis.loaded.has(id),
        error: window.__chronoscope.view.gis.errors.get(id),
      }),
      layer.id,
    );
    assert(state.loaded && !state.error, JSON.stringify(state));
    check(
      `Open ${format}: native reference geometry and ${count} source features`,
    );
    return layer;
  }
  const shp = await open("events.shp", "SHAPEFILE", 2);
  await open("zones.shp", "SHAPEFILE", 2);
  const gpkg = await open("features.gpkg", "GEOPACKAGE", 5);
  const table = await api("gis_table", { id: gpkg.id });
  assert(table.rows.some((row) => row.id === "points/9007199254740993"));
  assert(table.rows.some((row) => row.properties.source_layer === "zones"));
  check("GeoPackage table provenance and exact 64-bit source IDs");
  for (const mode of ["map", "globe", "space-time", "map"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction(
      (value) => window.__chronoscope.view.mode === value,
      mode,
    );
    await refresh();
    assert(
      await page.evaluate(
        (id) => window.__chronoscope.view.gis.loaded.get(id)?.object.show,
        shp.id,
      ),
    );
  }
  check("New reference layers persist across all three views");
  const screenshot = path.join(directory, "vector-reference-layers.png");
  await page.screenshot({ path: screenshot });
  report.screenshots.push(screenshot);
  const preview = await api("gis_import_preview", { id: gpkg.id });
  const imported = await api("import_commit", {
    import_id: preview.import_id,
    mapping: preview.sheets[0].mapping,
    append: false,
  });
  assert.equal(imported.accepted, 5);
  await refresh();
  assert.equal(
    await page.evaluate(() => window.__chronoscope.snapshot.count),
    5,
  );
  check(
    "Packaged GeoPackage converts into timestamped Events in the running UI",
  );
  const saved = path.join(directory, "vectors.chronoscope");
  await api("save", {
    path: saved,
    scene: await page.evaluate(() => window.__chronoscope.captureScene()),
  });
  await api("gis_remove", { id: shp.id });
  await api("open", { path: saved });
  await refresh();
  assert.equal((await api("gis_layers")).layers.length, 3);
  assert.equal((await api("gis_table", { id: gpkg.id })).count, 5);
  check(
    "Portable vector workspace reopens with original layer IDs and attributes",
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    await page.evaluate(() => window.__vectorCspErrors || []),
    [],
  );
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("Report:", path.join(directory, "report.json"));
  await browser?.close();
  server.kill();
}
