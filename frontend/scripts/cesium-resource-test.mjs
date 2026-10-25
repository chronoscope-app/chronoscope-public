/** Numerical resource tests, using independently recorded PROJ vgridshift
 * answers instead of a copy of our interpolation formula. No network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
const compile = (name, replace = (s) => s) => {
  const source = replace(
    ts.transpileModule(
      fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    ).outputText,
  );
  return (
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
};
const mathUrl = compile("cesium-resource-math.ts"),
  { geoidUndulation, sampleTerrain, terrainMaximumLevel, validateTerrain } =
    await import(mathUrl),
  geoidBytes = fs.readFileSync(
    new URL("../src/assets/egm96-15-cm.bin", import.meta.url),
  );
assert.equal(
  crypto.createHash("sha256").update(geoidBytes).digest("hex"),
  "246249f1b6d0dd4da5d79572775a2d21dcf56fe0836aab512ffcf5a01737d194",
);
const grid = new Int16Array(1440 * 721);
for (let i = 0; i < grid.length; i++) grid[i] = geoidBytes.readInt16LE(i * 2);
// pyproj/PROJ, original unquantized egm96_15.gtx, +proj=vgridshift +multiplier=1.
for (const [lat, lon, expected] of [
  [33.749, -84.388, -30.83035774084472],
  [40.015, -105.27, -15.283918938445963],
  [0, 0, 17.161579132080078],
  [0, 180, 21.153329849243164],
  [0, -180, 21.153329849243164],
  [27.9, 85, -47.96861343383813],
  [89.99, -45, 13.621275825500474],
  [-89.99, 37, -29.538739624023435],
])
  assert.ok(
    Math.abs(geoidUndulation(grid, lat, lon) - expected) <= 0.0051,
    `${lat},${lon}`,
  );
assert.equal(geoidUndulation(grid, 10, -180), geoidUndulation(grid, 10, 180));
assert.equal(geoidUndulation(grid, 10, 540), geoidUndulation(grid, 10, 180));
assert.throws(() => geoidUndulation(grid, 91, 0));
assert.throws(() => geoidUndulation(new Int16Array(1), 0, 0));
const t = {
  bounds: [-1, 30, 1, 60],
  width: 3,
  height: 3,
  elevations: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  minimum: 100,
  maximum: 900,
  covered: 9,
  tiles: 1,
};
validateTerrain(t);
assert.equal(sampleTerrain(t, 60, -1), 100);
assert.equal(sampleTerrain(t, 30, 1), 900);
const midLat =
  (Math.atan(
    Math.sinh(
      (Math.log(Math.tan(Math.PI / 4 + (60 * Math.PI) / 360)) +
        Math.log(Math.tan(Math.PI / 4 + (30 * Math.PI) / 360))) /
        2,
    ),
  ) *
    180) /
  Math.PI;
assert.ok(Math.abs(sampleTerrain(t, midLat, 0) - 500) < 1e-9);
assert.notEqual(sampleTerrain(t, 45, 0), 500); // Avoid latitude-linear mesh mistake.
assert.equal(sampleTerrain(t, 70, 0), null);
const hole = { ...t, elevations: [...t.elevations] };
hole.elevations[4] = null;
assert.equal(sampleTerrain(hole, midLat, 0), null);
assert.equal(sampleTerrain(hole, 60, -1), 100);
assert.equal(sampleTerrain(hole, 50, 0), null);
assert.throws(() => validateTerrain({ ...t, width: 1 }));
assert.throws(() => validateTerrain({ ...t, elevations: [Infinity] }));
assert.ok(
  terrainMaximumLevel({
    ...t,
    width: 257,
    height: 257,
    elevations: new Array(257 * 257).fill(0),
  }) > terrainMaximumLevel(t),
);

const cesiumUrl = new URL(
  "../node_modules/cesium/Source/Cesium.js",
  import.meta.url,
).href;
const resourceUrl = compile("cesium-resources.ts", (s) =>
  s
    .replace('from "cesium"', `from ${JSON.stringify(cesiumUrl)}`)
    .replace('from "./cesium-resource-math"', `from ${JSON.stringify(mathUrl)}`)
    .replace(/import earthUrl from .*?;/, 'const earthUrl="local-blue-marble";')
    .replace(/import geoidUrl from .*?;/, 'const geoidUrl="local-geoid";'),
);
const {
    LocalDtedTerrainProvider,
    CesiumResources,
    RasterPacketImageryProvider,
  } = await import(resourceUrl),
  { QuantizedMeshTerrainData, HeightmapTerrainData, Cartographic, Rectangle } =
    await import(cesiumUrl);
// Rounded Rust/Mercator viewport limits can be a few nanometres outside
// Cesium's exact scheme; native tile lookup must still find both corners.
const imagery = new RasterPacketImageryProvider(
  [
    {
      image: { width: 256, height: 256 },
      bounds: [-180, -85.05112878, 180, 85.05112878],
      geographic: false,
    },
  ],
  "Test source",
);
assert.ok(
  imagery.tilingScheme.positionToTileXY(
    Rectangle.northwest(imagery.rectangle),
    0,
  ),
);
assert.ok(
  imagery.tilingScheme.positionToTileXY(
    Rectangle.southeast(imagery.rectangle),
    0,
  ),
);
const provider = new LocalDtedTerrainProvider(t, grid, "egm96", 2);
// Global real terrain reaches root samples. A quantized hemisphere has no
// finite horizon-culling point; coarse heightmaps must retain the actual DEM.
const worldTerrain = {
  ...t,
  bounds: [-180, -89.999999, 180, 89.999999],
  geographic: true,
  width: 257,
  height: 257,
  elevations: Array(257 * 257).fill(2800),
};
const worldProvider = new LocalDtedTerrainProvider(
  worldTerrain,
  undefined,
  "ellipsoid",
  1,
);
const worldRoot = await worldProvider.requestTileGeometry(1, 0, 0);
assert(worldRoot instanceof HeightmapTerrainData);
assert.equal(
  worldRoot.interpolateHeight(
    worldProvider.tilingScheme.tileXYToRectangle(1, 0, 0),
    1,
    0,
  ),
  2800,
);
assert(worldRoot.isChildAvailable(1, 0, 2, 0));
assert.equal(
  worldRoot.interpolateHeight(
    worldProvider.tilingScheme.tileXYToRectangle(1, 0, 0),
    1,
    -Math.PI / 2,
  ),
  2800,
);
// A polar viewport has coarse longitude columns. Keep the exact source-column
// peak without generating 33 redundant columns in every narrow polar tile.
const polarColumns = {
  ...worldTerrain,
  bounds: [-179.7, 80, 179.7, 89.999999],
  width: 257,
  height: 257,
  elevations: Array.from(
    { length: 257 * 257 },
    (_, i) => 100 + ((i % 257) % 2) * 1000,
  ),
};
const polarProvider = new LocalDtedTerrainProvider(
  polarColumns,
  undefined,
  "ellipsoid",
  1,
);
const peak = Cartographic.fromDegrees(-179.7 + (129 * 359.4) / 256, 85);
const polarXY = polarProvider.tilingScheme.positionToTileXY(
  peak,
  polarProvider.maximumLevel,
);
const polarData = await polarProvider.requestTileGeometry(
  polarXY.x,
  polarXY.y,
  polarProvider.maximumLevel,
);
assert(polarData instanceof QuantizedMeshTerrainData);
assert(polarData._quantizedVertices.length / 3 <= 5 * 129);
assert(
  Math.abs(
    polarData.interpolateHeight(
      polarProvider.tilingScheme.tileXYToRectangle(
        polarXY.x,
        polarXY.y,
        polarProvider.maximumLevel,
      ),
      peak.longitude,
      peak.latitude,
    ) - 1100,
  ) < 0.1,
);
assert.ok(
  Math.abs(
    provider.sampleHeight(60, -1) - (200 + geoidUndulation(grid, 60, -1)),
  ) < 1e-9,
);
assert.equal(provider.sampleHeight(80, 0), null);
const e = new LocalDtedTerrainProvider(t, undefined, "ellipsoid", 1);
assert.equal(e.sampleHeight(60, -1), 100);
const rectangle = Rectangle.fromDegrees(...t.bounds),
  position = Cartographic.fromDegrees(0, midLat),
  xy = provider.tilingScheme.positionToTileXY(position, provider.maximumLevel),
  data = await provider.requestTileGeometry(xy.x, xy.y, provider.maximumLevel);
assert.ok(data instanceof QuantizedMeshTerrainData);
assert.equal(data.isChildAvailable(xy.x, xy.y, xy.x * 2, xy.y * 2), false);
assert.equal(
  await provider.requestTileGeometry(xy.x, xy.y, provider.maximumLevel),
  data,
);
const tileRect = provider.tilingScheme.tileXYToRectangle(
    xy.x,
    xy.y,
    provider.maximumLevel,
  ),
  sampled = data.interpolateHeight(
    tileRect,
    position.longitude,
    position.latitude,
  );
assert.ok(
  Math.abs(sampled - provider.sampleHeight(midLat, 0)) < 1,
  `${sampled} vs ${provider.sampleHeight(midLat, 0)}`,
);
assert.equal(e.getTileDataAvailable(0, 0, 24), false);
const outside = await e.requestTileGeometry(0, 0, 0);
assert.ok(
  outside instanceof HeightmapTerrainData ||
    outside instanceof QuantizedMeshTerrainData,
);
// A source void must remain an actual gap in Cesium's native terrain mesh,
// rather than becoming a fabricated zero-metre post or a bridged polygon.
const voidGrid = {
  bounds: [-45, 0, 0, 45],
  width: 33,
  height: 33,
  elevations: new Array(33 * 33).fill(100),
  minimum: 100,
  maximum: 100,
  covered: 1088,
  tiles: 1,
};
voidGrid.elevations[16 * 33 + 16] = null;
const voidProvider = new LocalDtedTerrainProvider(
    voidGrid,
    undefined,
    "ellipsoid",
    1,
  ),
  voidLat =
    (Math.atan(
      Math.sinh(Math.log(Math.tan(Math.PI / 4 + (45 * Math.PI) / 360)) / 2),
    ) *
      180) /
    Math.PI,
  voidPosition = Cartographic.fromDegrees(-22.5, voidLat),
  voidTile = voidProvider.tilingScheme.positionToTileXY(voidPosition, 2),
  voidData = await voidProvider.requestTileGeometry(voidTile.x, voidTile.y, 2),
  voidRect = voidProvider.tilingScheme.tileXYToRectangle(
    voidTile.x,
    voidTile.y,
    2,
  );
assert.ok(voidData instanceof QuantizedMeshTerrainData);
assert.equal(
  voidData.interpolateHeight(
    voidRect,
    voidPosition.longitude,
    voidPosition.latitude,
  ),
  undefined,
);
assert.ok(
  Math.abs(
    voidData.interpolateHeight(
      voidRect,
      (-40 * Math.PI) / 180,
      (5 * Math.PI) / 180,
    ) - 100,
  ) < 0.01,
);
// Caller must resolve generic MSL before any terrain is installed. Use the
// prototype directly to exercise preflight without constructing DOM/CesiumGL.
await assert.rejects(
  CesiumResources.prototype.setTerrain.call(
    { terrainGeneration: 0, verticalDatum: "unresolved-msl" },
    t,
    1,
  ),
  /Choose the DTED vertical datum/,
);
// Clearing absent terrain is a true no-op: do not reset Cesium's quadtree
// and drop already loaded map textures on ordinary dataset/view refreshes.
await CesiumResources.prototype.setTerrain.call(
  {
    terrainGeneration: 0,
    terrain: null,
    terrainProvider: undefined,
    disposed: false,
    verticalDatum: "unresolved-msl",
  },
  null,
  1,
);
// Navigation updates its CPU sampling grid, while one native tile source owns
// Cesium's quadtree and cached GPU-ready tiles across the entire catalog.
{
  const world = {
    ...t,
    geographic: true,
    bounds: [-180, -85, 180, 85],
    elevations: Array(9).fill(100),
  };
  let tileLoads = 0;
  const source = {
    bounds: world.bounds,
    maximumLevel: 7,
    async load(bounds) {
      tileLoads++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { ...world, bounds, elevations: Array(9).fill(100) };
    },
  };
  let assignments = 0,
    installed;
  const resources = Object.assign(Object.create(CesiumResources.prototype), {
    disposed: false,
    terrainGeneration: 0,
    terrainProviderChanges: 0,
    verticalDatum: "ellipsoid",
    terrain: null,
    viewer: {
      set terrainProvider(value) {
        assignments++;
        installed = value;
      },
    },
    requestRender() {},
  });
  await resources.setTerrain(world, 1, () => true, source);
  const original = installed;
  const [firstTile, sameTile] = await Promise.all([
    original.requestTileGeometry(6, 3, 3),
    original.requestTileGeometry(6, 3, 3),
  ]);
  assert.equal(tileLoads, 1, "Concurrent terrain requests coalesce");
  assert.equal(firstTile, sameTile);
  const rectangle = original.tilingScheme.tileXYToRectangle(6, 3, 3);
  assert(
    Math.abs(
      firstTile.interpolateHeight(
        rectangle,
        (rectangle.west + rectangle.east) / 2,
        (rectangle.south + rectangle.north) / 2,
      ) - 100,
    ) < 0.01,
  );
  const viewportGrid = {
    ...world,
    bounds: [-1, 40, 1, 50],
    elevations: Array(9).fill(200),
  };
  await resources.setTerrain(viewportGrid, 1, () => true, source);
  assert.equal(
    assignments,
    1,
    "Viewport terrain sampling must not discard the imagery/terrain quadtree",
  );
  assert.equal(installed, original);
  assert.equal(
    original.sampleHeight(45, 0),
    200,
    "CPU Event/axis heights use the new viewport grid",
  );
  assert.equal(
    await original.requestTileGeometry(6, 3, 3),
    firstTile,
    "Navigation retains rendered tile geometry",
  );
  await original.requestTileGeometry(7, 3, 3);
  assert.equal(
    tileLoads,
    2,
    "A newly visible tile reads actual source terrain",
  );
  assert.equal(
    original.maximumLevel,
    7,
    "Refinement follows catalog sample spacing, not viewport packet dimensions",
  );
  await resources.setTerrain(viewportGrid, 2, () => true, source);
  assert.equal(
    assignments,
    2,
    "An explicit exaggeration change does replace terrain",
  );
  assert.notEqual(installed, original);
  await resources.setTerrain(viewportGrid, 2, () => true, { ...source });
  assert.equal(
    assignments,
    3,
    "A different terrain catalog replaces the provider",
  );
  await resources.setTerrain(null);
  assert.equal(assignments, 4, "Unload replaces terrain exactly once");
  await resources.setTerrain(null);
  assert.equal(assignments, 4);
  // Fast navigation cannot create an unbounded queue of native mesh IPC calls.
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const bounded = new LocalDtedTerrainProvider(
    world,
    undefined,
    "ellipsoid",
    1,
    {
      ...source,
      async load(bounds) {
        await blocked;
        return { ...world, bounds };
      },
    },
  );
  const queued = Array.from({ length: 6 }, (_, i) =>
    bounded.requestTileGeometry(i, 3, 3),
  );
  assert.equal(bounded.pendingCount, 6);
  assert.equal(
    bounded.requestTileGeometry(7, 3, 3),
    undefined,
    "Cesium retries excess terrain requests later",
  );
  release();
  await Promise.all(queued);
  assert.equal(bounded.pendingCount, 0);
  bounded.dispose();
}

// Geographic world meshes retain uniform latitude registration near the poles.
const polarTerrain = {
  bounds: [-1, 80, 1, 89.999999],
  width: 2,
  height: 3,
  geographic: true,
  elevations: [100, 100, 50, 50, 0, 0],
};
assert.equal(sampleTerrain(polarTerrain, (80 + 89.999999) / 2, 0), 50);
console.log(
  "Cesium resources: 8 independent PROJ geoid references, dateline/poles, Mercator DTED sampling/voids, native mesh interpolation/availability/cache, explicit datum enforcement passed.",
);
