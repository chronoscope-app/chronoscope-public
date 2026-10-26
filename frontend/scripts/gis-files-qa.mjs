import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust engine and Cesium loaders; local packaged assets, no public tile traffic.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const desktopCsp = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
).app.security.csp;
fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(root, ".qa/gis-files-"));
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS || path.join(dir, "screenshots");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
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
let browser, page;
const report = {
  passed: false,
  checks: [],
  errors: [],
  requests: [],
  screenshots: [],
};
function check(name, evidence) {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  // Give the existing Events timeline the same interval as the native reference layers.
  const sample = (name) => path.join(root, "tests/fixtures/gis", name);
  const preview = await api("import_preview", {
    path: sample("events.geojson"),
  });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "map",
    display: {
      mode: "points",
      bloom: false,
      show_points: true,
      show_tracks: true,
      trail_gap_minutes: 0,
    },
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(45000);
  await page.addInitScript(() => {
    window.__gisCsp = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__gisCsp.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      }),
    );
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Cesium|WebGL|shader/.test(message.text())
    )
      report.errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    if (
      /^https?:/.test(route.request().url()) &&
      !route
        .request()
        .url()
        .startsWith(url + "/")
    ) {
      report.requests.push(route.request().url());
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
    () =>
      window.__chronoscope?.snapshot?.count === 3 && !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene(c.snapshot.scene);
  });
  async function refresh() {
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh(true, false);
    });
    await page.waitForFunction(() => !window.__chronoscope.busy);
  }
  async function shot(name) {
    const file = path.join(out, name + ".png");
    await page.waitForTimeout(200);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  }
  async function load(file, format, position) {
    const before = (await api("gis_layers")).layers.length;
    page.once("dialog", (dialog) => dialog.accept(sample(file)));
    await page.click("#open");
    await page.waitForSelector("#gis-open-reference");
    if (position) {
      await page.fill("#gis-model-position", position.join(","));
      await page.fill("#gis-model-scale", "20000");
    }
    await page.click("#gis-open-reference");
    await page.waitForFunction(
      (n) =>
        window.__chronoscope.snapshot.gis_layers?.length === n &&
        !window.__chronoscope.busy &&
        !document.querySelector("#gis-open-reference"),
      before + 1,
    );
    const layer = (await api("gis_layers")).layers.at(-1);
    await page.waitForFunction(
      (id) =>
        window.__chronoscope.view.gis.loaded.has(id) ||
        window.__chronoscope.view.gis.errors.has(id),
      layer.id,
    );
    const state = await page.evaluate((id) => {
      const gis = window.__chronoscope.view.gis,
        entry = gis.loaded.get(id);
      return {
        loaded: !!entry,
        error: gis.errors.get(id),
        entities: entry?.object?.entities?.values.length,
        primitive: entry?.primitive,
      };
    }, layer.id);
    assert(state.loaded, JSON.stringify({ format, ...state }));
    assert(!state.error, JSON.stringify(state));
    assert.equal(layer.format, format);
    if (format === "tiles3d") {
      report.tileStart = await page.evaluate((id) => {
        const v = window.__chronoscope.view,
          t = v.gis.loaded.get(id).object;
        return {
          mode: v.mode,
          show: t.show,
          position: v.camera.positionWC,
          center: t.boundingSphere.center,
          radius: t.boundingSphere.radius,
          content: t.root._contentState,
          stats: {
            pending: t.statistics.numberOfPendingRequests,
            processing: t.statistics.numberOfTilesProcessing,
            selected: t.statistics.selected,
          },
        };
      }, layer.id);
      await page.waitForFunction(
        (id) =>
          window.__chronoscope.view.gis.loaded.get(id).object.root.content
            ?.trianglesLength > 0,
        layer.id,
      );
      check(
        "Native 3D Tiles content is fetched, decoded and ready in the live scene",
        {},
      );
    }

    check("Open renders native " + format, {
      ...state,
      features: layer.feature_count,
      resources: layer.resource_count,
    });
    return layer;
  }
  const layers = [];
  for (const [file, format, position] of [
    ["events.geojson", "geojson"],
    ["boundaries.topojson", "topojson"],
    ["timed-zones.kml", "kml"],
    ["timed-zones.kmz", "kmz"],
    ["moving.czml", "czml"],
    ["track.gpx", "gpx"],
    ["box/Box.gltf", "gltf", [-79, 25, 1000]],
    ["box/Box.glb", "glb", [-79, 25, 1000]],
    ["box/tileset.json", "tiles3d"],
  ]) {
    const layer = await load(file, format, position);
    layers.push(layer);
    await api("gis_set", { id: layer.id, enabled: false });
    await refresh();
  }
  // JSON content detection must also enter the native GIS workflow.
  const json = path.join(dir, "zones.json");
  fs.copyFileSync(sample("events.geojson"), json);
  page.once("dialog", (d) => d.accept(json));
  await page.click("#open");
  await page.waitForSelector("#gis-open-reference");
  await page.keyboard.press("Escape");
  check("JSON GIS is distinguished from workspace JSON in Open", {});
  const exactId = path.join(dir, "exact-id.geojson");
  fs.writeFileSync(
    exactId,
    '{"type":"FeatureCollection","features":[{"type":"Feature","id":9007199254740993,"properties":{"name":"Exact identifier"},"geometry":{"type":"Point","coordinates":[-79,25]}}]}',
  );
  const exactLayer = (await api("gis_load", { path: exactId })).layer;
  await refresh();
  assert(
    await page.evaluate(
      (id) =>
        !!window.__chronoscope.view.gis.loaded
          .get(id)
          .object.entities.getById("9007199254740993"),
      exactLayer.id,
    ),
  );
  await api("gis_remove", { id: exactLayer.id });
  await refresh();
  check(
    "Native rendering preserves source feature IDs beyond JavaScript safe integers",
    {},
  );
  const multipartFile = path.join(dir, "multipart-ids.geojson");
  fs.writeFileSync(
    multipartFile,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "foo",
          properties: {},
          geometry: {
            type: "MultiPoint",
            coordinates: [
              [-79, 25],
              [-78, 26],
            ],
          },
        },
        {
          type: "Feature",
          id: "foo_2",
          properties: {},
          geometry: { type: "Point", coordinates: [-77, 27] },
        },
      ],
    }),
  );
  const multipartLayer = (await api("gis_load", { path: multipartFile })).layer;
  await api("gis_set", { id: multipartLayer.id, selected: ["foo"] });
  await refresh();
  const multipartEvidence = await page.evaluate((id) => {
    const gis = window.__chronoscope.view.gis,
      entry = gis.loaded.get(id),
      parts = entry.features.get("foo");
    return {
      parts: parts.length,
      selection: gis.selection.entities.values.length,
      pick: gis.pick({ id: parts[1] }),
      separate: entry.features.get("foo_2").length,
    };
  }, multipartLayer.id);
  assert.equal(multipartEvidence.parts, 2);
  assert.equal(multipartEvidence.selection, 2);
  assert.equal(multipartEvidence.pick.id, "foo");
  assert.equal(multipartEvidence.separate, 1);
  await api("gis_remove", { id: multipartLayer.id });
  await refresh();
  check(
    "Multipart native objects retain exact source IDs and highlight every part without suffix collisions",
    multipartEvidence,
  );
  for (const extension of ["kml", "gpx"]) {
    const file = path.join(dir, "markup." + extension);
    const attack =
      '<img src="https://example.invalid/no-fetch" onerror="window.__gisMarkupExecuted=true">';
    fs.writeFileSync(
      file,
      extension === "kml"
        ? `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Safe rendering</name><description><![CDATA[${attack}]]></description><ExtendedData><Data name="field"><value><![CDATA[${attack}]]></value></Data></ExtendedData><Point><coordinates>-79,25</coordinates></Point></Placemark></Document></kml>`
        : `<gpx version="1.1" creator="QA" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="25" lon="-79"><name>Safe rendering</name><desc><![CDATA[${attack}]]></desc><src><![CDATA[${attack}]]></src></wpt></gpx>`,
    );
    const layer = (await api("gis_load", { path: file })).layer;
    await refresh();
    assert(
      await page.evaluate(
        (id) => window.__chronoscope.view.gis.loaded.has(id),
        layer.id,
      ),
    );
    assert.equal(
      await page.evaluate(() => !!window.__gisMarkupExecuted),
      false,
    );
    await api("gis_remove", { id: layer.id });
    await refresh();
  }
  check(
    "Source XML descriptions retain attributes without executing markup or contacting external URLs",
    {},
  );
  const geo = layers[0];
  await api("gis_set", { id: geo.id, enabled: true });
  await refresh();
  // Dblclick opens the same continuous attribute table; ctrl/shift selection is linked.
  await page.locator(`[data-gis-id="${geo.id}"] strong`).dblclick();
  await page.waitForSelector("[data-gis-row]");
  assert.equal(
    await page
      .locator("#table-tabs [role=tab][aria-selected=true]")
      .textContent(),
    "events.geojson",
  );
  await page.locator('[data-gis-row="zone-1"]').click();
  await page.waitForFunction(
    (id) =>
      window.__chronoscope.snapshot.gis_layers.find((l) => l.id === id).selected
        .length === 1,
    geo.id,
  );
  await page
    .locator('[data-gis-row="zone-2"]')
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await page.waitForFunction(
    (id) =>
      window.__chronoscope.snapshot.gis_layers.find((l) => l.id === id).selected
        .length === 2,
    geo.id,
  );
  const selected = (await api("gis_layers")).layers[0].selected;
  assert.deepEqual(selected.sort(), ["zone-1", "zone-2"]);
  check(
    "Reference table and native polygon highlights share exact feature IDs",
    { selected },
  );
  const selectionNative = await page.evaluate(
    () =>
      window.__chronoscope.view.gis.viewer.dataSources.getByName(
        "GIS selection",
      )[0].entities.values.length,
  );
  assert.equal(selectionNative, 2);
  await page.click("#close-table");
  assert(
    !(await page
      .locator("#table-panel")
      .evaluate((e) => e.classList.contains("open"))),
  );
  // All geographic scene modes retain native layers, including repeated transitions.
  for (const mode of ["globe", "space-time", "map", "globe", "space-time"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m,
      mode,
    );
    await refresh();
    assert(
      await page.evaluate(
        (id) => window.__chronoscope.view.gis.loaded.get(id).object.show,
        geo.id,
      ),
    );
  }
  check(
    "Reference layers persist through Globe, 2D and Columbus transitions",
    {},
  );
  // Native CZML position changes with the shared time focus.
  const czml = layers.find((l) => l.format === "czml");
  await api("gis_set", { id: czml.id, enabled: true });
  await refresh();
  const animation = await page.evaluate((id) => {
    const v = window.__chronoscope.view,
      entity = v.gis.loaded.get(id).object.entities.getById("flight");
    v.setFocus(0);
    const a = entity.position.getValue(v.viewer.clock.currentTime);
    v.setFocus(0.8);
    const b = entity.position.getValue(v.viewer.clock.currentTime);
    return { a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] };
  }, czml.id);
  assert(Math.hypot(...animation.a.map((n, i) => n - animation.b[i])) > 1000);
  check("Native CZML animation follows Chronoscope time focus", animation);
  // Save and reopen in the same running UI; no original asset reads are required.
  const portable = path.join(dir, "gis-portable.chronoscope");
  await api("save", {
    path: portable,
    scene: await page.evaluate(() => window.__chronoscope.captureScene()),
  });
  await api("gis_remove", { id: geo.id });
  await refresh();
  page.once("dialog", (d) => d.accept(portable));
  await page.click("#open");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.gis_layers?.length === 9 &&
      !window.__chronoscope.busy,
  );
  await refresh();
  assert.equal((await api("gis_layers")).layers.length, 9);
  check(
    "Portable GIS workspace reopens all formats and packaged model/tile assets",
    {},
  );
  // Hide reference layers to inspect polygon Events and their centroid track independently.
  for (const layer of (await api("gis_layers")).layers)
    await api("gis_set", { id: layer.id, enabled: false });
  await api("view_set", {
    mode: "space-time",
    fit: true,
    display: {
      mode: "points",
      show_points: true,
      show_centroids: true,
      show_tracks: true,
      trail_gap_minutes: 0,
    },
  });
  await refresh();
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene(c.snapshot.scene);
  });
  const polygons = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      points: v.points.length,
      centroids: v.points.filter((p) => p.centroid).length,
      polygons: v.geometryFeatures.length,
      tracks: v.trails.length,
    };
  });
  assert.equal(polygons.centroids, 2);
  assert.equal(polygons.polygons, 2);
  assert(polygons.tracks > 0);
  await shot("polygon-events-time-centroids");
  check(
    "Timed polygons retain full geometry plus centroid circles and entity tracks",
    polygons,
  );
  await page.click('[data-tab="views"]');
  await page.uncheck("#display-centroids");
  await page.waitForFunction(
    () => !window.__chronoscope.captureScene().display.show_centroids,
  );
  await refresh();
  assert.equal(
    await page.evaluate(
      () =>
        window.__chronoscope.view.renderPoints.filter((p) => p.centroid).length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.geometryFeatures.length,
    ),
    2,
  );
  check("Centroid markers/tracks can be hidden while polygons remain", {});
  await page.check("#display-centroids");
  await page.waitForFunction(
    () => window.__chronoscope.captureScene().display.show_centroids,
  );
  await refresh();
  const density = await page.evaluate(() => ({
    entities: [...document.querySelectorAll("#entities .entity")].map(
      (e) => e.getBoundingClientRect().height,
    ),
    categories: [...document.querySelectorAll("#categories .check-row")].map(
      (e) => ({
        height: e.getBoundingClientRect().height,
        margin: getComputedStyle(e).marginTop,
      }),
    ),
  }));
  // Entity selection buttons retain a 26px hit target; category rows are 24px.
  assert(density.entities.every((n) => n >= 24 && n <= 28));
  assert(
    density.categories.every((row) => row.height <= 25 && row.margin === "0px"),
  );
  check(
    "Entity/category rows remain compact without extra vertical margins",
    density,
  );
  for (const mode of ["map", "globe", "space-time"]) {
    await api("view_set", { mode });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh();
      await c.restoreScene(c.snapshot.scene);
    });
    const navigation = await page.evaluate(async (mode) => {
      const c = window.__chronoscope,
        v = c.view;
      const state = await c.liveViewRequest("view_navigate", {
        action: "look_at",
        center: [-79, 25, 0],
        distance_m: 500000,
        heading_degrees: 0,
        tilt_degrees: mode === "map" ? 0 : 35,
      });
      const p = v.project(v.groundPosition(25, -79));
      return {
        mode: state.mode,
        backend: state.backend,
        hardware: state.hardware_acceleration,
        error: Math.hypot(
          p.x - v.host.clientWidth / 2,
          p.y - v.host.clientHeight / 2,
        ),
      };
    }, mode);
    assert.equal(navigation.mode, mode);
    assert.equal(navigation.backend, "WebGL2");
    assert.equal(navigation.hardware, "unknown");
    assert(navigation.error < 1, JSON.stringify(navigation));
    check("Agent geographic camera target is centred in " + mode, navigation);
  }
  assert.deepEqual(
    report.requests,
    [],
    "No public network requests or invalid-origin fetches",
  );
  assert.deepEqual(report.errors, [], "No uncaught renderer errors");
  report.cspViolations = await page.evaluate(() => window.__gisCsp);
  assert.deepEqual(
    report.cspViolations,
    [],
    "No desktop security-policy violations",
  );
  report.passed = true;
} catch (error) {
  report.failure = error.stack || String(error);
  if (page)
    report.nativeState = await page
      .evaluate(() =>
        Array.from(window.__chronoscope.view.gis.loaded.values()).map(
          ({ descriptor, object }) => ({
            format: descriptor.format,
            show: object.show,
            ready: object.ready,
            tileContent: object.root?._contentState,
            triangles: object.root?.content?.trianglesLength,
            tilesLoaded: object.tilesLoaded,
          }),
        ),
      )
      .catch(() => []);
  if (page) {
    await page
      .screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
    report.failureText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
  }
  throw error;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (browser) await browser.close();
  server.kill("SIGTERM");
  console.log("Report:", path.join(out, "report.json"));
}
