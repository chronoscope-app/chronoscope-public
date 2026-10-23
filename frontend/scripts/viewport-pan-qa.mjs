// Local Rust + real pointer drag + delayed event responses and WMTS imagery.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { PNG } from "pngjs";

const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/viewport-pan");
fs.mkdirSync(dir, { recursive: true });
const profile = fs.mkdtempSync(path.join(dir, "profile-"));
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(profile, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    profile,
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  passed: false,
  checks: [],
  errors: [],
  platform: process.platform,
};
let browser, page, tiles;
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name, JSON.stringify(evidence));
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error(log || "Server startup timeout")),
      20000,
    );
    server.once("error", reject);
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
    const body = await response.json();
    assert(response.ok, JSON.stringify(body));
    return body.result;
  };
  const rows = ["entity,timestamp,latitude,longitude"];
  for (let lat = 10; lat <= 50; lat += 1)
    for (let lon = -130; lon <= -50; lon += 1)
      rows.push(`grid,2026-10-22T12:00:00Z,${lat},${lon}`);
  const csv = path.join(profile, "grid.csv");
  fs.writeFileSync(csv, rows.join("\n"));
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });

  let tileRequests = 0;
  tiles = createServer(async (req, res) => {
    if (req.url.startsWith("/caps")) {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer><ows:Title>Pan test</ows:Title><ows:Identifier>fixture</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="http://127.0.0.1:${tiles.address().port}/tiles/{TileRow}/{TileCol}"/></Layer><TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>EPSG:3857</ows:SupportedCRS><TileMatrix><ows:Identifier>pan</ows:Identifier><ScaleDenominator>${559082264.0287178 / 32}</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>32</MatrixWidth><MatrixHeight>32</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`,
      );
      return;
    }
    const match = req.url.match(/^\/tiles\/(\d+)\/(\d+)/);
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    tileRequests++;
    await new Promise((resolve) => setTimeout(resolve, 450));
    const image = new PNG({ width: 256, height: 256 });
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 40 + Number(match[1]) * 5;
      image.data[i + 1] = 40 + Number(match[2]) * 5;
      image.data[i + 2] = 120;
      image.data[i + 3] = 255;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(PNG.sync.write(image));
  });
  await new Promise((resolve) => tiles.listen(0, "127.0.0.1", resolve));
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map_layers: null,
      terrain_path: null,
      map: {
        url: `http://127.0.0.1:${tiles.address().port}/caps`,
        layer: "fixture",
        matrix_set: "grid",
        style: "default",
        format: "image/png",
        time: "",
        enabled: true,
        level: 0,
      },
    },
  });
  await api("view_set", {
    mode: "map",
    display: {
      mode: "points",
      bloom: false,
      spatial_culling: true,
      show_points: true,
      show_tracks: false,
      show_trails: false,
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
  page = await browser.newPage({
    viewport: { width: 1100, height: 720 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Map layer|Cesium render failure/.test(message.text())
    )
      report.errors.push(message.text());
  });
  let held = false,
    requestsHeld = 0,
    resultsHeld = 0,
    active = 0,
    peak = 0;
  const queriedBounds = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().startsWith(url + "/")) return route.abort();
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (body?.command === "view_snapshot_v1" && body.args?.bounds) {
      active++;
      peak = Math.max(peak, active);
      if (held) {
        requestsHeld++;
        queriedBounds.push(body.args.bounds);
      }
      // A load takes longer than the scheduling interval. It must still publish.
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ response });
      if (held) resultsHeld++;
      active--;
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count > 3000 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    await window.__chronoscope.ready;
    await window.__chronoscope.viewModeIdle();
    // Keep software rendering fast enough to deliver continuous pointer input.
    window.__chronoscope.view.viewer.resolutionScale = 0.5;
    window.__chronoscope.view.viewer.resize();
    window.__chronoscope.view.lookAtGeographic([-80, 30, 0], 2500000, 0, 0);
    window.__chronoscope.view.viewer.render();
    await window.__chronoscope.loadRasters();
    window.__chronoscope.view.onViewportChange();
  });
  await page.waitForTimeout(2500);
  await page.waitForFunction(
    () =>
      window.__chronoscope.view.renderPoints.length > 0 &&
      window.__chronoscope.view.renderPoints.length < 1000 &&
      window.__chronoscope.view.resources.status.tileCount > 0 &&
      document.querySelector("#cancel-map").hidden,
  );
  const initial = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    window.__initialIds = new Set(v.renderPoints.map((p) => p.id));
    window.__initialRaster = v.resources.currentRaster;
    window.__initialRasterWest =
      v.resources.currentRaster.tiles[0].request.bounds[0];
    return { bounds: v.visibleBounds(), points: v.renderPoints.length };
  });
  // Retain the displayed image but make subsequent tile loads exercise the
  // delayed local server instead of tiles cached by the startup overview.
  await api("wmts_cache_clear");
  await page.evaluate(() => window.__chronoscope.refresh(false, false));
  const tileStart = tileRequests;
  console.log("Initial viewport", JSON.stringify(initial));
  const box = await page.locator(".cesium-widget canvas").boundingBox();
  const startX = box.x + box.width * 0.2,
    y = box.y + box.height * 0.5;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.evaluate(() => {
    // SwiftShader can stall presentation long enough to look like a pause in
    // the gesture. Feed Cesium's public change event continuously while the
    // real pointer drag moves the camera, keeping the regression independent
    // of the software GPU's frame rate.
    window.__dragCameraChanges = setInterval(() => {
      const v = window.__chronoscope.view;
      if (v.drag) v.camera.changed.raiseEvent(0.02);
    }, 40);
  });
  held = true;
  let added = 0,
    rasterUpdated = false,
    newImageryPixels = false;
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(startX + (box.width * 0.55 * i) / 60, y);
    await page.waitForTimeout(35);
    if (i % 10 === 0) {
      const state = await page.evaluate(() => {
        const v = window.__chronoscope.view;
        const tile = v.resources.currentRaster.tiles[0],
          bounds = tile.request.bounds,
          canvas = tile.image;
        let newPixels = false;
        if (bounds[0] < window.__initialRasterWest - 0.01) {
          const lon = (bounds[0] + window.__initialRasterWest) / 2;
          const x = Math.floor(
            ((lon - bounds[0]) / (bounds[2] - bounds[0])) * canvas.width,
          );
          const pixels = canvas
            .getContext("2d")
            .getImageData(x, 0, 1, canvas.height).data;
          for (let i = 3; i < pixels.length; i += 4)
            newPixels ||= pixels[i] > 0;
        }
        return {
          added: v.renderPoints.filter((p) => !window.__initialIds.has(p.id))
            .length,
          rasterUpdated: v.resources.currentRaster !== window.__initialRaster,
          held: !!v.drag,
          newPixels,
        };
      });
      assert(state.held, "pointer must remain held throughout the regression");
      added = Math.max(added, state.added);
      rasterUpdated ||= state.rasterUpdated;
      newImageryPixels ||= state.newPixels;
    }
  }
  // All assertions here precede mouseup: a release-only implementation fails.
  console.log(
    "Held drag",
    JSON.stringify({
      requestsHeld,
      resultsHeld,
      added,
      rasterUpdated,
      newTiles: tileRequests - tileStart,
      newImageryPixels,
      first: queriedBounds[0],
      last: queriedBounds.at(-1),
      state: await page.evaluate(() => ({
        points: window.__chronoscope.view.renderPoints.length,
        bounds: window.__chronoscope.view.visibleBounds(),
        status: document.querySelector("#status")?.textContent,
      })),
    }),
  );
  assert(
    requestsHeld >= 3,
    `only ${requestsHeld} viewport queries while dragging`,
  );
  assert(
    resultsHeld >= 3,
    `only ${resultsHeld} completed queries while dragging`,
  );
  assert(added > 0, "newly exposed events must render before release");
  assert(tileRequests > tileStart, "new WMTS tiles must load before release");
  assert(rasterUpdated, "replacement imagery must publish before release");
  assert(
    newImageryPixels,
    "new imagery pixels outside the original coverage must publish before release",
  );
  assert(peak <= 1, `overlapping viewport queries: ${peak}`);
  check(
    "events and imagery load and publish during a held continuous drag, including slow responses",
    {
      initial,
      requestsHeld,
      resultsHeld,
      added,
      newTiles: tileRequests - tileStart,
      newImageryPixels,
      peakViewportQueries: peak,
      firstQuery: queriedBounds[0],
      lastQuery: queriedBounds.at(-1),
    },
  );
  await page.screenshot({ path: path.join(dir, "held-pan.png") });
  await page.evaluate(() => clearInterval(window.__dragCameraChanges));
  held = false;
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const final = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      bounds: v.visibleBounds(),
      points: v.renderPoints.length,
      dragging: !!v.drag,
      errors: v.renderErrors,
    };
  });
  assert(!final.dragging);
  assert(final.points > 0);
  assert.equal(final.errors, 0);
  assert.notDeepEqual(initial.bounds, final.bounds);
  check("final viewport settles with data after release", final);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await page?.unrouteAll({ behavior: "ignoreErrors" });
  await browser?.close();
  server.kill("SIGTERM");
  tiles?.closeAllConnections();
  tiles?.close();
  fs.rmSync(tokenFile, { force: true });
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
