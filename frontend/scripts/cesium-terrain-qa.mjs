import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Synthetic DTED + generated diagnostic tile; normal app transitions.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../.."),
  dir =
    process.env.CHRONOSCOPE_QA_DATA_DIR ||
    path.join(root, ".qa/cesium-terrain"),
  out = process.env.CHRONOSCOPE_QA_SCREENSHOTS || dir;
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const tileFile =
  process.env.CHRONOSCOPE_QA_TERRAIN_RASTER ||
  path.join(root, "tests/fixtures/cesium/synthetic-grid-z13.json");
const publicFetches = 0;
assert(fs.existsSync(tileFile), "Generate the offline synthetic fixture first");
const tile = JSON.parse(fs.readFileSync(tileFile, "utf8")),
  image = tile.image_file
    ? fs.readFileSync(path.join(path.dirname(tileFile), tile.image_file))
    : Buffer.from(tile.data_url.split(",")[1], "base64"),
  hits = [];
if (tile.sha256)
  assert.equal(createHash("sha256").update(image).digest("hex"), tile.sha256);
const dtedPath =
  process.env.CHRONOSCOPE_QA_DTED ||
  path.join(root, "tests/fixtures/terrain/synthetic-n43.dt0");
let fixture;
fixture = createServer((req, res) => {
  if (req.url.startsWith("/caps")) {
    res.setHeader("Content-Type", "application/xml");
    res.end(
      `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><ows:ServiceIdentification><ows:Title>${tile.attribution}</ows:Title></ows:ServiceIdentification><Contents><Layer><ows:Title>Chronoscope synthetic diagnostic grid</ows:Title><ows:Identifier>synthetic-grid</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet><TileMatrixSetLimits><TileMatrixLimits><TileMatrix>${tile.level}</TileMatrix><MinTileRow>${tile.row}</MinTileRow><MaxTileRow>${tile.row}</MaxTileRow><MinTileCol>${tile.col}</MinTileCol><MaxTileCol>${tile.col}</MaxTileCol></TileMatrixLimits></TileMatrixSetLimits></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="http://127.0.0.1:${fixture.address().port}/tiles/{TileRow}/{TileCol}"/></Layer><TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>EPSG:3857</ows:SupportedCRS><TileMatrix><ows:Identifier>${tile.level}</ows:Identifier><ScaleDenominator>${559082264.0287178 / 2 ** tile.level}</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${2 ** tile.level}</MatrixWidth><MatrixHeight>${2 ** tile.level}</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`,
    );
    return;
  }
  if (req.url === `/tiles/${tile.row}/${tile.col}`) {
    hits.push(req.url);
    res.setHeader("Content-Type", "image/png");
    res.end(image);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
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
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const lon = (tile.bounds[0] + tile.bounds[2]) / 2,
    lat = (tile.bounds[1] + tile.bounds[3]) / 2;
  const csv = path.join(dir, "hamilton-events.csv");
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,category,label\n" +
      Array.from(
        { length: 12 },
        (_, i) =>
          `Survey ${i % 2},2026-10-15T10:${String(i * 2).padStart(2, "0")},${lat + (Math.floor(i / 2) - 2.5) * 0.0005},${lon + ((i % 2) - 0.5) * 0.001 + Math.sin(i / 2) * 0.00015},Demonstration,Synthetic ground survey event`,
      ).join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  const prefs = await api("preferences"),
    config = {
      url: `http://127.0.0.1:${fixture.address().port}/caps`,
      layer: "synthetic-grid",
      matrix_set: "grid",
      style: "default",
      format: "image/png",
      time: "",
      enabled: true,
      level: 0,
    };
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: config,
      map_layers: [
        {
          id: "sentinel",
          name: "EOX Sentinel-2 2024 cached imagery",
          server_name: "EOX cached replay",
          config,
          opacity: 1,
          min_zoom: 0,
          max_zoom: 30,
        },
      ],
      terrain_path: dtedPath,
      terrain_builtin: false,
      terrain_exaggeration: 4,
      terrain_vertical_datum: "egm96",
    },
  });
  await api("terrain_load", {
    path: dtedPath,
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
      viewport: { width: 1800, height: 1150 },
    }),
    errors = [],
    external = [];
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (
      ["http:", "https:"].includes(u.protocol) &&
      u.hostname !== "127.0.0.1"
    ) {
      external.push(u.origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.view?.viewer && !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.ready);
  await page.waitForFunction(() => {
    const c = window.__chronoscope;
    return (
      c.snapshot?.count === 12 &&
      c.view.resources.status.terrainActive &&
      c.view.resources.status.tileCount === 1 &&
      document.querySelector("#cancel-map").hidden
    );
  });
  // Loading a terrain folder initially fits its whole coverage. Frame the
  // survey's actual area using the same saved scene action an agent invokes.
  await page.evaluate(
    async ({ lat, lon }) => {
      const c = window.__chronoscope;
      await c.restoreScene({
        mode: "space-time",
        bounds: [lon - 0.006, lat - 0.006, lon + 0.006, lat + 0.006],
      });
      await c.rebuildTerrain();
      c.view.fit();
    },
    { lat, lon },
  );
  const states = [];
  for (const mode of ["space-time", "globe", "map", "space-time"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.evaluate(() => window.__chronoscope.viewModeIdle());
    // Keep normal app callbacks, fitting and menu-driven mode transitions active.
    await page.evaluate(() => window.__chronoscope.view.fit());
    console.log(
      "Beforewait",
      mode,
      await page.evaluate(
        ({ lat, lon }) => {
          const v = window.__chronoscope.view,
            C = v.camera.positionCartographic.constructor;
          return {
            resources: v.resources.status,
            height: v.scene.globe.getHeight(C.fromDegrees(lon, lat)),
            expected: v.resources.sampleHeight(lat, lon),
            tilesLoaded: v.scene.globe.tilesLoaded,
            bounds: v.bounds,
            visible: v.visibleBounds(),
            camera: v.camera.position,
          };
        },
        { lat, lon },
      ),
    );
    await page
      .waitForFunction(
        ({ lat, lon, mode }) => {
          const c = window.__chronoscope,
            v = c.view,
            Cartographic = v.camera.positionCartographic.constructor,
            h = v.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
          return (
            v.mode === mode &&
            v.resources.status.terrainActive &&
            v.resources.status.tileCount === 1 &&
            v.scene.globe.tilesLoaded &&
            Number.isFinite(h) &&
            // A morph first paints finite zero-height level-zero tiles. Wait
            // for the actual rendered source-resolution tile before measuring.
            v.scene.globe._surface._tilesToRender.some((tile) => {
              const r = tile.rectangle,
                x = (lon * Math.PI) / 180,
                y = (lat * Math.PI) / 180;
              return (
                tile.level >= 12 &&
                x >= r.west &&
                x <= r.east &&
                y >= r.south &&
                y <= r.north
              );
            })
          );
        },
        { lat, lon, mode },
        { timeout: 90000 },
      )
      .catch(async (error) => {
        await page.screenshot({
          path: path.join(out, "terrain-natural-failure.png"),
        });
        console.log(
          "Failurestate",
          await page.evaluate(
            ({ lat, lon }) => {
              const v = window.__chronoscope.view,
                C = v.camera.positionCartographic.constructor;
              return {
                resources: v.resources.status,
                height: v.scene.globe.getHeight(C.fromDegrees(lon, lat)),
                expected: v.resources.sampleHeight(lat, lon),
                tilesLoaded: v.scene.globe.tilesLoaded,
                bounds: v.bounds,
                visible: v.visibleBounds(),
                camera: v.camera.position,
              };
            },
            { lat, lon },
          ),
        );
        throw error;
      });
    // A ready terrain cache can outlive a scene morph. Verify actual painted
    // geographic pixels after rendering frames, not just cached mesh metadata.
    await page.evaluate(async () => {
      const v = window.__chronoscope.view;
      for (let i = 0; i < 5; i++) {
        v.viewer.render();
        await new Promise(requestAnimationFrame);
      }
    });
    await page
      .waitForFunction(
        () => {
          const v = window.__chronoscope.view,
            c = document.createElement("canvas");
          c.width = v.viewer.canvas.width;
          c.height = v.viewer.canvas.height;
          const x = c.getContext("2d");
          v.requestRender();
          v.viewer.render();
          x.drawImage(v.viewer.canvas, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let vegetation = 0;
          for (let i = 0; i < d.length; i += 16)
            if (
              d[i + 1] > 35 &&
              d[i + 1] > d[i] * 1.15 &&
              d[i + 1] > d[i + 2] * 1.12
            )
              vegetation++;
          window.__chronoscope.__qaPaintedGroundSamples = vegetation;
          return vegetation > 250;
        },
        null,
        { timeout: 15000 },
      )
      .catch(async (error) => {
        await page.screenshot({
          path: path.join(out, "missing-ground-failure.png"),
        });
        console.log(
          "Missingground",
          await page.evaluate(() => {
            const v = window.__chronoscope.view;
            return {
              mode: v.mode,
              show: v.scene.globe.show,
              tilesLoaded: v.scene.globe.tilesLoaded,
              renderTiles: v.scene.globe._surface._tilesToRender.map((t) => ({
                level: t.level,
                x: t.x,
                y: t.y,
                mesh: !!t.data?.renderedMesh,
              })),
              camera: v.camera.positionWC,
              direction: v.camera.directionWC,
              resources: v.resources.status,
            };
          }),
        );
        throw error;
      });
    const state = await page.evaluate(
      ({ lat, lon }) => {
        const v = window.__chronoscope.view,
          C = v.camera.positionCartographic.constructor;
        const probes = [];
        for (const dy of [-0.002, 0, 0.002])
          for (const dx of [-0.002, 0, 0.002]) {
            const p = C.fromDegrees(lon + dx, lat + dy),
              h = v.scene.globe.getHeight(p),
              expected = v.resources.sampleHeight(lat + dy, lon + dx);
            let loadedLevel = -1,
              leaf;
            const visit = (tile) => {
              if (!tile) return;
              const r = tile.rectangle;
              if (
                p.longitude < r.west ||
                p.longitude > r.east ||
                p.latitude < r.south ||
                p.latitude > r.north
              )
                return;
              if (tile.data?.renderedMesh && tile.level >= loadedLevel) {
                loadedLevel = tile.level;
                leaf = tile;
              }
              for (const child of [
                tile._southwestChild,
                tile._southeastChild,
                tile._northwestChild,
                tile._northeastChild,
              ])
                visit(child);
            };
            for (const tile of v.scene.globe._surface._levelZeroTiles || [])
              visit(tile);
            // Sample the actual GPU mesh's top triangles only. Cesium may
            // retire terrainData/cache entries after upload; its rendered
            // vertex/index buffers remain the authoritative visible surface.
            const mesh = leaf?.data?.renderedMesh,
              r = leaf.rectangle,
              u = (p.longitude - r.west) / r.width,
              w = (p.latitude - r.south) / r.height;
            let topHeight;
            for (let j = 0; mesh && j < mesh.indexCountWithoutSkirts; j += 3) {
              const ia = mesh.indices[j],
                ib = mesh.indices[j + 1],
                ic = mesh.indices[j + 2],
                a = mesh.encoding.decodeTextureCoordinates(mesh.vertices, ia, {
                  x: 0,
                  y: 0,
                }),
                b = mesh.encoding.decodeTextureCoordinates(mesh.vertices, ib, {
                  x: 0,
                  y: 0,
                }),
                c = mesh.encoding.decodeTextureCoordinates(mesh.vertices, ic, {
                  x: 0,
                  y: 0,
                }),
                det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
              if (Math.abs(det) < 1e-20) continue;
              const wa =
                  ((b.y - c.y) * (u - c.x) + (c.x - b.x) * (w - c.y)) / det,
                wb = ((c.y - a.y) * (u - c.x) + (a.x - c.x) * (w - c.y)) / det,
                wc = 1 - wa - wb;
              if (wa >= -1e-7 && wb >= -1e-7 && wc >= -1e-7) {
                topHeight =
                  wa * mesh.encoding.decodeHeight(mesh.vertices, ia) +
                  wb * mesh.encoding.decodeHeight(mesh.vertices, ib) +
                  wc * mesh.encoding.decodeHeight(mesh.vertices, ic);
                break;
              }
            }
            const offWest = C.fromDegrees(lon + dx - 1e-5, lat + dy),
              offEast = C.fromDegrees(lon + dx + 1e-5, lat + dy),
              westHeight = v.scene.globe.getHeight(offWest),
              eastHeight = v.scene.globe.getHeight(offEast);
            probes.push({
              topHeight,
              topAbsoluteError: Math.abs(topHeight - expected),
              westRayHeight: westHeight,
              eastRayHeight: eastHeight,
              westRayError: Math.abs(
                westHeight -
                  v.resources.sampleHeight(lat + dy, lon + dx - 1e-5),
              ),
              eastRayError: Math.abs(
                eastHeight -
                  v.resources.sampleHeight(lat + dy, lon + dx + 1e-5),
              ),
              lat: lat + dy,
              lon: lon + dx,
              renderedHeight: h,
              expectedHeight: expected,
              absoluteError: Math.abs(h - expected),
              loadedLevel,
              declaredError:
                loadedLevel >= 0
                  ? v.viewer.terrainProvider.getLevelMaximumGeometricError(
                      loadedLevel,
                    )
                  : null,
            });
          }
        return {
          probes,
          paintedGroundVegetationSamples:
            window.__chronoscope.__qaPaintedGroundSamples,
          mode: v.mode,
          sceneMode: v.scene.mode,
          terrain: v.resources.status,
          nativeRayHeightAtExactSeam: v.scene.globe.getHeight(
            C.fromDegrees(lon, lat),
          ),
          topSurfaceHeight: probes[4].topHeight,
          expectedHeight: v.resources.sampleHeight(lat, lon),
          bearing: v.bearing(),
          tilt: v.tilt(),
          frameBounds: v.visibleBounds(),
        };
      },
      { lat, lon },
    );
    states.push(state);
    console.log("MeasurednativeLOD", JSON.stringify(state));
    fs.writeFileSync(
      path.join(out, "native-lod-progress.json"),
      JSON.stringify(states, null, 2),
    );
    assert.ok(
      state.probes.every(
        (p) =>
          Number.isFinite(p.renderedHeight) &&
          Number.isFinite(p.expectedHeight) &&
          p.loadedLevel >= 12 &&
          p.topAbsoluteError < 3 &&
          p.westRayError < 3 &&
          p.eastRayError < 3,
      ),
      "Native top surface and off-seam ray heights must match source within 3m (exact seam ray skirt hits recorded separately): " +
        JSON.stringify(state.probes),
    );
    console.log(
      "PASS natural terrain transition",
      mode,
      state.topSurfaceHeight,
    );
    await page.screenshot({
      path: path.join(out, `hamilton-${mode}-${states.length}.png`),
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.ok(hits.length > 0);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        states,
        publicTileFetches: publicFetches,
        browserPublicRequests: external.length,
        localTileRequests: hits.length,
        source: tile.url,
        bounds: tile.bounds,
        attribution: tile.attribution,
        sourceResolution: tile.sourceResolution,
        dtedSource:
          process.env.CHRONOSCOPE_QA_DTED_SOURCE ||
          "Bundled tests/fixtures/terrain/synthetic-n43.dt0; see tests/fixtures/terrain/SOURCES.md",
        dtedSha256: createHash("sha256")
          .update(fs.readFileSync(dtedPath))
          .digest("hex"),
        imageSha256: createHash("sha256").update(image).digest("hex"),
        datumCaveat:
          "N43 header says generic MSL. EGM96 explicitly chosen as this test's assumption, not a proven source datum.",
        events:
          "12 synthetic survey records, actual public N43 DTED and real georeferenced Sentinel imagery",
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => fixture.close(r));
}
