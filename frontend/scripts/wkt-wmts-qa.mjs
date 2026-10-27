import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Offline integration: actual Rust bridge + browser renderer + local WMTS fixture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/wkt-wmts/data");
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS ||
  path.join(root, ".qa/wkt-wmts/screenshots");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
fs.writeFileSync(path.join(dir, "token"), token, { mode: 0o600 });
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  cli,
  [
    "--data-dir",
    dir,
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    path.join(dir, "token"),
    "--frontend",
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser, mock;
const deadline = setTimeout(
  () => {
    console.error("WKT/WMTS QA exceeded 8-minute budget");
    server.kill();
    void browser?.close();
    process.exitCode = 1;
  },
  8 * 60 * 1000,
);
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  await api("preferences", {
    preferences: {
      basemap: "none",
      // Keep the imagery oracle on its original flat-ground fixture until
      // this suite explicitly loads its custom DTED below.
      terrain_builtin: false,
      map: { ...(await api("preferences")).map, enabled: false },
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1150 },
  });
  await page.addInitScript(() => {
    new MutationObserver(() =>
      document.querySelector("#unsaved-discard")?.click(),
    ).observe(document, { childList: true, subtree: true });
  });
  page.setDefaultTimeout(30000);
  const errors = [],
    publicRequests = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (
      ["http:", "https:"].includes(u.protocol) &&
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    ) {
      publicRequests.push(u.origin);
      return route.abort();
    }
    return route.continue();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("Browser error:", m.text());
  });
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/invoke") && r.status() >= 400)
      console.log("API rejection:", await r.text());
  });
  await page.goto(url + "/?renderer=cesium#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  page.once("dialog", (d) =>
    d.accept(path.join(root, "tests/fixtures/import/wkt-geometries.csv")),
  );
  await page.click("#open");
  await page.waitForSelector('[data-map="geometry_wkt"]');
  assert.equal(await page.inputValue('[data-map="geometry_wkt"]'), "2");
  await page.click("#review-import");
  await page.click("#commit-import");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 7 &&
      window.__chronoscope.view.geometryFeatures.length === 6 &&
      !window.__chronoscope.busy,
  );
  await page.click('[data-view="map"]');
  await page.evaluate(() => window.__chronoscope.view.fit());
  const meshes = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      features: v.geometryFeatures.length,
      fillMeshes: v.shapes.length,
      points: v.points.length,
      triangles: v.trianglePoints.length,
    };
  });
  assert.equal(meshes.features, 6);
  assert.ok(meshes.fillMeshes >= 3);
  assert.equal(meshes.points, 3); // source point plus two polygon-centroid anchors
  assert.equal(meshes.triangles, 0);
  const at = async (lat, lon) =>
    page.evaluate(
      ({ lat, lon }) => {
        const v = window.__chronoscope.view,
          p = v.project(
            v.pos({ id: "test", entity: 0, time: v.lo, lat, lon, value: 1 }),
          ),
          r = document.querySelector("#scene").getBoundingClientRect();
        return {
          x: r.x + p.x,
          y: r.y + p.y,
        };
      },
      { lat, lon },
    );
  const area = await at(43.247, -79.973);
  await page.mouse.click(area.x, area.y);
  await page.waitForSelector("#edit-wkt");
  assert.match(await page.inputValue("#edit-wkt"), /^POLYGON/);
  assert(Number.isFinite(Number(await page.inputValue("#edit-lat"))));
  assert.match(
    await page.locator("#inspector-content").innerText(),
    /derived polygon surface centroid/i,
  );
  // The requested centroid can lie inside a hole. Hide derived markers while
  // checking that the actual polygon fill remains unpickable there.
  await api("view_set", { display: { show_centroids: false } });
  await page.evaluate(() => window.__chronoscope.refresh(true, false));
  const hole = await at(43.255, -79.965);
  const holeHit = await page.evaluate(
    ({ x, y }) =>
      window.__chronoscope.view.pickId(
        x - document.querySelector("#scene").getBoundingClientRect().left,
        y - document.querySelector("#scene").getBoundingClientRect().top,
      )?.id,
    hole,
  );
  assert.notEqual(
    holeHit,
    "3",
    "The polygon hole must remain unfilled/unpickable as area",
  );
  await page.screenshot({ path: path.join(out, "wkt-map.png") });
  for (const mode of ["globe", "space-time", "map"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction(
      (mode) =>
        window.__chronoscope.view.mode === mode &&
        window.__chronoscope.view.geometryFeatures.length === 6,
      mode,
    );
  }
  const file = path.join(dir, "geometries.chronoscope");
  await api("save", { path: file });
  await api("open", { path: file });
  await page.evaluate(() => window.__chronoscope.refresh());
  assert.equal((await api("render_geometries")).count, 6);
  let requests = 0,
    active = 0,
    peak = 0;
  const keys = new Set();
  mock = createServer(async (req, res) => {
    if (req.url.startsWith("/caps")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:ServiceIdentification><ows:Title>Local WMTS fixture</ows:Title></ows:ServiceIdentification><Contents><Layer><ows:Title>Colored local tiles</ows:Title><ows:Identifier>fixture</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="http://127.0.0.1:${mock.address().port}/tiles/{TileRow}/{TileCol}"/></Layer><Layer><ows:Title>Alternate local imagery</ows:Title><ows:Identifier>alternate</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/jpgpng</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/jpgpng" resourceType="tile" template="http://127.0.0.1:${mock.address().port}/tiles/{TileRow}/{TileCol}?layer=alternate"/></Layer><TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>EPSG:3857</ows:SupportedCRS><TileMatrix><ows:Identifier>fine</ows:Identifier><ScaleDenominator>${559082264.0287178 / 8}</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>8</MatrixWidth><MatrixHeight>8</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`,
      );
      return;
    }
    const match = req.url.match(/tiles\/(\d+)\/(\d+)/);
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    requests++;
    keys.add(req.url);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    const image = new PNG({ width: 256, height: 256 });
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 40 + Number(match[1]) * 25;
      image.data[i + 1] = 50 + Number(match[2]) * 25;
      const alternate = req.url.includes("alternate");
      image.data[i + 2] = alternate ? 210 : 90;
      image.data[i + 3] = alternate && (i / 4) % 256 >= 128 ? 0 : 255;
    }
    const bytes = PNG.sync.write(image);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.length,
    });
    res.end(bytes);
    active--;
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const config = {
    url: `http://127.0.0.1:${mock.address().port}/caps`,
    layer: "fixture",
    matrix_set: "grid",
    style: "default",
    format: "image/png",
    time: "",
    enabled: true,
    level: 0,
  };
  await api("preferences", { preferences: { map: config } });
  console.log("WKT/polygon picking passed; loading64localtiles");
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene({ mode: "map", bounds: [-170, -80, 170, 80] });
    await c.loadRasters();
  });
  console.log("FirstWMTSloadreturned");
  await page.waitForFunction(
    () =>
      document.querySelector("#cancel-map").hidden &&
      window.__chronoscope.view.resources.status.tileCount === 1,
  );
  const report = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      rasterMeshes: v.resources.status.tileCount,
      nativeImageryLayers: v.viewer.imageryLayers.length,
      nativeImageryTilesRequested: v.resources.status.imageryRequestedTiles,
      status: document.querySelector("#status").textContent,
      toasts: [...document.querySelectorAll(".toast")].map(
        (e) => e.textContent,
      ),
      renderer: "Cesium native imagery",
      geometries: v.geometryFeatures.length,
    };
  });
  assert.equal(
    report.rasterMeshes,
    1,
    "All provider tiles must composite into one bounded viewport mesh: " +
      JSON.stringify(report),
  );
  // Camera aspect ratio can expose only part of the fixture's world extent.
  // Verify complete provider coverage independently of that viewport, rather
  // than assuming every world tile must be visible in a native 2D camera.
  const fullCoverage = await api("wmts_rasters", {
    config,
    bounds: [-170, -80, 170, 80],
    level: 0,
    limit: 4096,
    include_data: false,
  });
  assert.equal(fullCoverage.total_tiles, 64);
  assert.equal(fullCoverage.tiles.length, 64);
  assert.equal(keys.size, 64);
  assert.ok(peak > 1);
  const continuity = await page.evaluate(async () => {
    const c = window.__chronoscope,
      v = c.view,
      raster = v.resources.currentRaster,
      original = [...v.points];
    const point = {
      id: "18446744073709551615",
      entity: 0,
      lat: 0,
      lon: 0,
      time: v.lo,
      value: 1,
    };
    await v.setData(
      [...original, point],
      v.names,
      [...v.bounds],
      [v.lo, v.hi],
      v.geometryFeatures,
    );
    const preserved = v.resources.currentRaster === raster;
    await v.setData(
      original,
      v.names,
      [...v.bounds],
      [v.lo, v.hi],
      v.geometryFeatures,
    );
    return preserved;
  });
  assert(
    continuity,
    "Event refresh must retain the native imagery packet and textures",
  );
  console.log("WMTS64tilesandrefreshcontinuitypassed");
  const before = requests;
  const seeded = await page.evaluate(async () => {
    const c = window.__chronoscope,
      v = c.view,
      set = v.setRasters.bind(v),
      alphas = [];
    v.setRasters = async (data, ...args) => {
      const canvas = data.tiles[0]?.image;
      if (canvas)
        alphas.push(
          canvas
            .getContext("2d")
            .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3],
        );
      return set(data, ...args);
    };
    try {
      await Promise.all([c.loadRasters(), c.loadRasters()]);
    } finally {
      v.setRasters = set;
    }
    return alphas;
  });
  assert(
    seeded.length > 0 && seeded.every((a) => a === 255),
    "Reload must never publish a blank replacement: " + JSON.stringify(seeded),
  );
  assert.equal(requests, before, "Second view load must reuse disk cache");
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.click("#wmts-cache");
  assert.equal(await page.inputValue("#cache-interval"), "0");
  await page.check("#cache-offline");
  await page.click("#cache-save");
  await page.evaluate(() => window.__chronoscope.loadRasters());
  assert.equal(requests, before);
  await page.click('[data-view="globe"]');
  await page.waitForTimeout(500);
  assert.equal(requests, before);
  await page.screenshot({ path: path.join(out, "wmts-all-tiles-globe.png") });
  const applyMap = async () => {
    const layer = await page.inputValue("#wmts-layer"),
      service = await page.inputValue("#wmts-url");
    const started = page.waitForRequest((r) => {
      try {
        const b = r.postDataJSON();
        return (
          b?.command === "job_start" &&
          b.args?.command === "wmts_rasters" &&
          b.args.arguments?.config?.layer === layer &&
          b.args.arguments.config.url === service
        );
      } catch {
        return false;
      }
    });
    await page.click("#apply-map");
    await started.catch(async (error) => {
      throw new Error(
        String(error) +
          " " +
          JSON.stringify(
            await page.evaluate(() => ({
              toasts: [...document.querySelectorAll(".toast")].map(
                (e) => e.textContent,
              ),
              fields: [
                ...document.querySelectorAll(".modal input,.modal select"),
              ].map((e) => [e.id, e.value]),
            })),
          ),
      );
    });
    await page.waitForFunction(
      () => document.querySelector("#cancel-map").hidden,
    );
  };
  console.log("Diskcacheandofflinepassed");
  // Exercise named servers and layer selection through the actual menu.
  await api("wmts_access", { settings: { offline: false } });
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.waitForSelector('#wmts-layer option[value="alternate"]', {
    state: "attached",
  });
  await page.fill("#wmts-server-name", "Local primary");
  await page.selectOption("#wmts-layer", "alternate");
  assert.equal(
    await page.inputValue("#wmts-format"),
    "image/jpgpng",
    "ArcGIS mixed raster format stays selectable in the menu",
  );
  await applyMap();
  await page.waitForFunction(
    () =>
      window.__chronoscope.preferences.map.layer === "alternate" &&
      document.querySelector("#cancel-map").hidden,
  );
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.click("#add-wmts-server");
  await page.fill("#wmts-server-name", "Local second");
  await page.fill(
    "#wmts-url",
    `http://127.0.0.1:${mock.address().port}/caps-second`,
  );
  await page.click("#inspect-wmts");
  await page.waitForSelector('#wmts-layer option[value="fixture"]', {
    state: "attached",
  });
  await page.selectOption("#wmts-layer", "fixture");
  await page.selectOption("#wmts-level", "0");
  await page.check("#map-enabled");
  await applyMap();
  await page.waitForFunction(
    () =>
      window.__chronoscope.preferences.map.url.endsWith("/caps-second") &&
      document.querySelector("#cancel-map").hidden,
  );
  const savedServers = (await api("wmts_servers")).servers;
  assert.equal(
    savedServers.find((s) => s.name === "Local primary").config.layer,
    "alternate",
  );
  assert.equal(
    savedServers.find((s) => s.name === "Local second").config.layer,
    "fixture",
  );
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.waitForSelector('#wmts-layer option[value="fixture"]', {
    state: "attached",
  });
  assert.equal(await page.inputValue("#wmts-server-name"), "Local second");
  await page.selectOption(
    "#wmts-server",
    savedServers.find((s) => s.name === "Local primary").id,
  );
  await page.waitForSelector('#wmts-layer option[value="alternate"]', {
    state: "attached",
  });
  assert.equal(await page.inputValue("#wmts-layer"), "alternate");
  await applyMap();
  await page.waitForFunction(
    () =>
      window.__chronoscope.preferences.map.layer === "alternate" &&
      document.querySelector("#cancel-map").hidden,
  );
  await page.screenshot({
    path: path.join(out, "saved-servers-layer-switch.png"),
  });
  console.log("Namedserversandlayerswitchpassed");
  // Enable two sources simultaneously, exercise order/opacity and a zoom handoff.
  await page.click('[data-view="map"]');
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene({ mode: "map", bounds: [-170, -80, 170, 80] });
    c.view.fit();
  });
  // Fix the geographic frame for pixel-by-pixel compositing assertions. Camera
  // debounce behavior is exercised again by the automatic zoom handoff below.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const c = window.__chronoscope;
    c.__qaViewportChange = c.view.onViewportChange;
    c.view.onViewportChange = () => {};
  });
  const primary = savedServers.find((s) => s.name === "Local primary"),
    second = savedServers.find((s) => s.name === "Local second");
  const mapLayer = (id, server, layer) => ({
    id,
    name: id,
    server_name: server.name,
    config: { ...server.config, layer, enabled: true },
    opacity: 1,
    min_zoom: 0,
    max_zoom: 30,
  });
  const stack = [
    mapLayer("street-reference", second, "fixture"),
    mapLayer("aerial-reference", primary, "alternate"),
  ];
  const loadStack = async (layers) => {
    await api("preferences", { preferences: { map_layers: layers } });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh(false);
      await c.loadRasters([-170, -80, 170, 80]);
    });
  };
  const samples = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view,
        canvas = v.resources.currentRaster?.tiles[0]?.image;
      if (!canvas) return [];
      const ctx = canvas.getContext("2d"),
        result = [];
      for (let y = 8; y < canvas.height; y += 53)
        for (let x = 8; x < canvas.width; x += 59) {
          const p = Array.from(ctx.getImageData(x, y, 1, 1).data);
          result.push({ x, y, p });
        }
      return result;
    });
  await loadStack([
    { ...stack[0], config: { ...stack[0].config, enabled: false } },
    { ...stack[1], opacity: 0.5 },
  ]);
  // A queued camera debounce can supersede the explicit load. Await the actual
  // composed pixels, rather than treating a cancelled generation as completion.
  await page.waitForFunction(() => {
    if (!document.querySelector("#cancel-map").hidden) return false;
    const image =
      window.__chronoscope.view.resources.currentRaster?.tiles[0]?.image;
    if (!image) return false;
    const ctx = image.getContext("2d");
    for (let y = 8; y < image.height; y += 53)
      for (let x = 8; x < image.width; x += 59) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[3] >= 126 && p[3] <= 129) return true;
      }
    return false;
  });
  const overlayOnly = await samples();
  const transparent = overlayOnly.find((s) => s.p[3] === 0),
    blend = overlayOnly.find((s) => s.p[3] >= 126 && s.p[3] <= 129);
  assert.ok(
    transparent && blend,
    "Alternate WMTS must retain transparent coverage and 50% alpha",
  );
  await loadStack([stack[0], { ...stack[1], opacity: 0.5 }]);
  const combined = await samples();
  const compositeAt = (point) =>
    combined.find((s) => s.x === point.x && s.y === point.y).p;
  assert.equal(
    compositeAt(transparent)[2],
    90,
    "Transparent upper imagery must reveal lower server imagery",
  );
  assert.ok(
    Math.abs(compositeAt(blend)[2] - 150) <= 2,
    "50% opacity must blend both servers",
  );
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.resources.status.tileCount,
    ),
    1,
    "Stack must keep a single composed source packet for native Cesium tiles",
  );
  await page.evaluate(() => {
    const c = window.__chronoscope;
    c.view.onViewportChange = c.__qaViewportChange;
    delete c.__qaViewportChange;
  });
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.click("#map-stack-settings");
  const lower = page.locator('[data-map-stack="street-reference"]'),
    upper = page.locator('[data-map-stack="aerial-reference"]');
  await lower.locator("[data-map-max]").fill("4");
  await upper.locator("[data-map-min]").fill("4");
  await upper.locator("[data-map-opacity]").fill("100");
  await page.screenshot({
    path: path.join(out, "multi-server-layer-settings.png"),
  });
  await page.click("#save-map-stack");
  await page.waitForSelector("#save-map-stack", { state: "detached" });
  await page.waitForFunction(
    () => document.querySelector("#cancel-map").hidden,
  );
  const overviewZoom = await page.evaluate(() =>
    window.__chronoscope.currentMapZoom(),
  );
  assert.ok(overviewZoom < 4);
  assert.ok(
    (await samples()).every((s) => s.p[3] === 0 || s.p[2] === 90),
    "Only the street source should draw below the handoff",
  );
  await page.evaluate(() => {
    const c = window.__chronoscope;
    c.view.zoom(2 ** (5 - c.currentMapZoom()));
  });
  await page.waitForFunction(
    () =>
      window.__chronoscope.currentMapZoom() > 4 &&
      document
        .querySelector('[data-map-toggle="street-reference"]')
        .closest(".layer-card")
        .classList.contains("muted"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#cancel-map").hidden &&
      window.__chronoscope.view.resources.status.tileCount === 1,
  );
  // Retained imagery can satisfy the mesh-count check before the debounce starts.
  // Wait for the replacement source pixels, not just a drawable old surface.
  await page.waitForFunction(() => {
    const canvas =
      window.__chronoscope.view.resources.currentRaster?.tiles[0]?.image;
    if (!canvas || !document.querySelector("#cancel-map").hidden) return false;
    const ctx = canvas.getContext("2d");
    for (let y = 8; y < canvas.height; y += 53)
      for (let x = 8; x < canvas.width; x += 59) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[2] === 210 && p[3] === 255) return true;
      }
    return false;
  });
  assert.ok(
    (await samples()).some((s) => s.p[2] === 210 && s.p[3] === 255),
    "Aerial layer should appear automatically above the handoff",
  );
  const closeZoom = await page.evaluate(() =>
    window.__chronoscope.currentMapZoom(),
  );
  const stackPath = path.join(dir, "map-stack.chronoscope");
  await api("save", { path: stackPath });
  await api("open", { path: stackPath });
  await page.evaluate(() => window.__chronoscope.refresh());
  assert.equal((await api("preferences")).map_layers.length, 2);
  await page.screenshot({
    path: path.join(out, "multi-server-zoom-handoff.png"),
  });
  await page.click('[data-view="globe"]');
  const datelineZoom = await page.evaluate(() => {
    const c = window.__chronoscope,
      v = c.view;
    const at = (longitude) => {
      const Cartesian3 = v.camera.position.constructor;
      v.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, 0, 10000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      v.draw();
      return v.mapZoom();
    };
    const greenwich = at(0),
      dateline = at(179.99);
    return { greenwich, dateline };
  });
  assert.ok(
    Math.abs(datelineZoom.greenwich - datelineZoom.dateline) < 0.001,
    JSON.stringify(datelineZoom),
  );
  assert.ok(
    datelineZoom.dateline > 8,
    "Close globe must report a detailed zoom even at the dateline",
  );
  await page.click('[data-view="map"]');
  const stackEvidence = {
    datelineZoom,
    servers: 2,
    layers: 2,
    compositeSurfaces: 1,
    opacity: "50% blended with transparent holes",
    zoomBoundary: 4,
    overviewZoom,
    closeZoom,
    portable: true,
  };
  console.log("Multistackopacityandzoompassed");
  // Exercise the same multi-source composite on real bundled DTED, then hide it.
  const terrainLayers = (await api("preferences")).map_layers.map((l, i) => ({
    ...l,
    min_zoom: 0,
    max_zoom: 30,
    opacity: i ? 0.5 : 1,
  }));
  await api("preferences", {
    preferences: {
      map_layers: terrainLayers,
      terrain_exaggeration: 4,
      terrain_vertical_datum: "egm96",
    },
  });
  await api("terrain_load", {
    path: path.join(root, "tests/fixtures/terrain/synthetic-n43.dt0"),
  });
  await page.click('[data-view="space-time"]');
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    c.setTerrainInfo(await c.call("terrain_info"));
    c.setBounds([-79.99, 43.22, -79.91, 43.29]);
    await c.refresh(true, false);
    await c.rebuildTerrain();
    await c.loadRasters();
    const v = c.view;
    // The automatic camera/zoom handoff was tested above. Hold this exact
    // frame while checking native DTED mesh heights and raster draping.
    v.onViewportChange = () => {};
    v.fit();
    v.setBearing(35);
    v.setTilt(62);
    v.draw();
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#cancel-map").hidden &&
      window.__chronoscope.view.resources.status.terrainActive &&
      window.__chronoscope.view.resources.status.tileCount === 1,
  );
  await page
    .waitForFunction(
      () => {
        const v = window.__chronoscope.view,
          Cartographic = v.camera.positionCartographic.constructor,
          height = v.scene.globe.getHeight(
            Cartographic.fromDegrees(-79.95, 43.25),
          );
        return (
          v.scene.globe.tilesLoaded &&
          Number.isFinite(height) &&
          Math.abs(height - v.resources.sampleHeight(43.25, -79.95)) < 3
        );
      },
      null,
      { timeout: 60000 },
    )
    .catch(async (error) => {
      await page.screenshot({ path: path.join(out, "terrain-failure.png") });
      console.log(
        "Terrainnativefailure",
        await page.evaluate(() => {
          const v = window.__chronoscope.view;
          return {
            resources: v.resources.status,
            camera: v.camera.positionCartographic,
            mode: v.scene.mode,
            bounds: v.bounds,
            height: v.scene.globe.getHeight(
              v.camera.positionCartographic.constructor.fromDegrees(
                -79.95,
                43.25,
              ),
            ),
            expected: v.resources.sampleHeight(43.25, -79.95),
            tilesLoaded: v.scene.globe.tilesLoaded,
          };
        }),
      );
      throw error;
    });
  const terrainStack = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      image = v.resources.currentRaster.tiles[0].image,
      provider = v.viewer.terrainProvider;
    return {
      textureWidth: image.width,
      textureHeight: image.height,
      nativeProvider: provider.constructor.name,
      covered: v.resources.status.terrainCovered,
      sampleEllipsoidHeight: v.resources.sampleHeight(43.25, -79.95),
      renderedTerrainHeight: v.scene.globe.getHeight(
        v.camera.positionCartographic.constructor.fromDegrees(-79.95, 43.25),
      ),
      frameBounds: [...v.bounds],
      datum: v.resources.status.verticalDatum,
      sceneMode: v.scene.mode,
    };
  });
  assert.ok(terrainStack.textureWidth >= 256 && terrainStack.covered > 100);
  assert.equal(terrainStack.datum, "egm96");
  assert.ok(Number.isFinite(terrainStack.sampleEllipsoidHeight));
  assert.deepEqual(terrainStack.frameBounds, [-79.99, 43.22, -79.91, 43.29]);
  await page.screenshot({
    path: path.join(out, "multi-server-dted-drape.png"),
  });
  await page.evaluate(() => window.__chronoscope.mapLayerMenu());
  for (const toggle of await page.locator("[data-map-enabled]").all())
    await toggle.uncheck();
  await page.click("#save-map-stack");
  await page.waitForSelector("#save-map-stack", { state: "detached" });
  await page.waitForFunction(
    () => window.__chronoscope.view.resources.status.tileCount === 0,
  );
  assert.ok(
    await page.evaluate(
      () => window.__chronoscope.view.resources.status.terrainActive,
    ),
    "Hiding all imagery must retain the DTED surface",
  );
  // Agent preference changes use terrain reconciliation rather than a GUI save.
  await api("preferences", { preferences: { map_layers: terrainLayers } });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh(false);
    await c.loadRasters();
  });
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.resources.status.terrainActive &&
      window.__chronoscope.view.resources.status.tileCount === 1,
  );
  await api("preferences", { preferences: { map_layers: [] } });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh(false);
    await c.rebuildTerrain();
  });
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.resources.status.terrainActive &&
      window.__chronoscope.view.resources.status.tileCount === 0,
  );
  stackEvidence.terrain = terrainStack;
  assert.deepEqual(errors, []);
  assert.deepEqual(
    publicRequests,
    [],
    "Offline WMTS test must not contact public services",
  );
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        meshes,
        ...report,
        uniqueTiles: keys.size,
        networkTileRequests: requests,
        peakConcurrency: peak,
        publicRequests: publicRequests.length,
        datumCaveat:
          "N43 source says MSL; EGM96 explicitly selected as test assumption, not source-proven datum",
        offlineReuse: true,
        stack: stackEvidence,
        savedServerSwitching:
          "Two named local WMTS servers and two layers persist and switch after reload",
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "WKT detection, holes/picking, multipart rendering and reopen passed. All 64 requested WMTS tiles loaded concurrently, cache/offline reuse passed; 0 public requests.",
  );
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (mock) await new Promise((r) => mock.close(r));
  server.kill();
}
