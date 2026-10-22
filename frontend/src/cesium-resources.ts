/** Rust owns WMTS authentication, caching, layer opacity and composition.
 * Cesium receives local pixels, never a server URL, token or smartcard handle. */
import {
  BoundingSphere,
  Cartesian3,
  Credit,
  Ellipsoid,
  EllipsoidalOccluder,
  EllipsoidTerrainProvider,
  Event as CesiumEvent,
  GeographicTilingScheme,
  HeightmapTerrainData,
  ImageryLayer,
  OrientedBoundingBox,
  QuantizedMeshTerrainData,
  Rectangle,
  SingleTileImageryProvider,
  TerrainProvider,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type Viewer,
} from "cesium";
import type { Raster, Terrain } from "./types";
import {
  geoidUndulation,
  mercatorNorthing,
  sampleTerrain,
  terrainMaximumLevel,
  validateTerrain,
  type TerrainDatum,
} from "./cesium-resource-math";
import earthUrl from "./assets/earth-natural-earth.jpg";
import type { StreetsImageryProvider } from "./streets";
import geoidUrl from "./assets/egm96-15-cm.bin?url";
export type { TerrainDatum } from "./cesium-resource-math";
const DEG = Math.PI / 180;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const credit = (s: string) => new Credit(`<span>${esc(s)}</span>`);
const intersects = (a: Rectangle, b: Rectangle) =>
  !!Rectangle.intersection(a, b);
let geoidPromise: Promise<Int16Array> | undefined;
function loadGeoid() {
  return (geoidPromise ??= fetch(geoidUrl)
    .then(async (r) => {
      if (!r.ok) throw new Error("Packaged EGM96 geoid could not be loaded");
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength !== 1440 * 721 * 2)
        throw new Error("Invalid packaged EGM96 geoid");
      const view = new DataView(bytes),
        grid = new Int16Array(1440 * 721);
      for (let i = 0; i < grid.length; i++)
        grid[i] = view.getInt16(i * 2, true);
      return grid;
    })
    .catch((error) => {
      geoidPromise = undefined;
      throw error;
    }));
}

/** Bounded viewport imagery provider. Snapshots prevent streamed canvas edits
 * racing texture uploads. Its only requests are in-memory crops, never HTTP. */
export class RasterPacketImageryProvider implements ImageryProvider {
  readonly tilingScheme = new WebMercatorTilingScheme();
  readonly tileWidth = 256;
  readonly tileHeight = 256;
  readonly minimumLevel = 0;
  readonly maximumLevel: number;
  readonly rectangle: Rectangle;
  readonly errorEvent = new CesiumEvent();
  readonly hasAlphaChannel = true;
  readonly tileDiscardPolicy: ImageryProvider["tileDiscardPolicy"] = undefined!;
  readonly proxy: ImageryProvider["proxy"] = undefined!;
  readonly credit: Credit;
  requestedTiles = 0;
  constructor(
    private tiles: {
      image: HTMLCanvasElement;
      bounds: number[];
      geographic: boolean;
    }[],
    attribution: string,
  ) {
    const b = [
      Math.min(...tiles.map((t) => t.bounds[0])),
      Math.min(...tiles.map((t) => t.bounds[1])),
      Math.max(...tiles.map((t) => t.bounds[2])),
      Math.max(...tiles.map((t) => t.bounds[3])),
    ];
    const requested = Rectangle.fromDegrees(b[0], b[1], b[2], b[3]);
    const clipped = Rectangle.intersection(
      requested,
      this.tilingScheme.rectangle,
    );
    if (!clipped)
      throw new Error(
        "Raster coverage lies outside the Web Mercator display extent",
      );
    this.rectangle = clipped;
    const pixelsPerWorld = Math.max(
      ...tiles.map((t) => (t.image.width * 360) / (t.bounds[2] - t.bounds[0])),
    );
    this.maximumLevel = Math.min(
      24,
      Math.max(0, Math.ceil(Math.log2(pixelsPerWorld / 256))),
    );
    this.credit = credit(attribution || "Locally cached map imagery");
  }
  getTileCredits() {
    return [this.credit];
  }
  pickFeatures() {
    return undefined;
  }
  requestImage(x: number, y: number, level: number) {
    this.requestedTiles++;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!,
      r = this.tilingScheme.tileXYToRectangle(x, y, level),
      west = r.west / DEG,
      east = r.east / DEG,
      north = mercatorNorthing(r.north / DEG),
      south = mercatorNorthing(r.south / DEG);
    for (const tile of this.tiles) {
      const b = tile.bounds,
        w = Math.max(b[0], west),
        e = Math.min(b[2], east),
        n = Math.min(b[3], r.north / DEG),
        s = Math.max(b[1], r.south / DEG);
      if (w >= e || s >= n) continue;
      const dx = ((w - west) / (east - west)) * 256,
        dw = ((e - w) / (east - west)) * 256,
        sx = ((w - b[0]) / (b[2] - b[0])) * tile.image.width,
        sw = ((e - w) / (b[2] - b[0])) * tile.image.width,
        top = ((north - mercatorNorthing(n)) / (north - south)) * 256,
        bottom = ((north - mercatorNorthing(s)) / (north - south)) * 256;
      if (!tile.geographic) {
        const tn = mercatorNorthing(b[3]),
          ts = mercatorNorthing(b[1]),
          sy = ((tn - mercatorNorthing(n)) / (tn - ts)) * tile.image.height,
          sh =
            ((mercatorNorthing(n) - mercatorNorthing(s)) / (tn - ts)) *
            tile.image.height;
        ctx.drawImage(tile.image, sx, sy, sw, sh, dx, top, dw, bottom - top);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, top, dw, bottom - top);
        ctx.clip();
        for (
          let row = Math.max(0, Math.floor(top));
          row < Math.min(256, Math.ceil(bottom));
          row++
        ) {
          const latitude =
              Math.atan(
                Math.sinh(north - ((row + 0.5) / 256) * (north - south)),
              ) / DEG,
            sy = Math.max(
              0,
              Math.min(
                tile.image.height - 1,
                ((b[3] - latitude) / (b[3] - b[1])) * tile.image.height - 0.5,
              ),
            );
          ctx.drawImage(tile.image, sx, sy, sw, 1, dx, row, dw, 1);
        }
        ctx.restore();
      }
    }
    return Promise.resolve(canvas);
  }
  dispose() {
    this.tiles = [];
  }
}

/** Native quantized mesh. Void cells have no triangles. Subdivision follows
 * coverage and source sample spacing instead of manufacturing extra detail. */
export class LocalDtedTerrainProvider implements TerrainProvider {
  readonly tilingScheme = new GeographicTilingScheme();
  readonly errorEvent: TerrainProvider["errorEvent"] = new CesiumEvent();
  readonly credit: Credit;
  readonly hasVertexNormals = false;
  readonly hasWaterMask = false;
  readonly availability = undefined;
  readonly maximumLevel: number;
  readonly rectangle: Rectangle;
  private levelZeroError: number;
  private cache = new Map<
    string,
    HeightmapTerrainData | QuantizedMeshTerrainData
  >();
  constructor(
    readonly terrain: Terrain,
    private geoid: Int16Array | undefined,
    readonly verticalDatum: TerrainDatum,
    readonly exaggeration: number,
  ) {
    this.maximumLevel = terrainMaximumLevel(terrain);
    this.rectangle = Rectangle.fromDegrees(
      ...(terrain.bounds as [number, number, number, number]),
    );
    this.credit = credit(
      `Local DTED · ${verticalDatum === "egm96" ? "EGM96 MSL → WGS84 ellipsoid (NGA 15′ geoid)" : "WGS84 ellipsoid heights"}`,
    );
    this.levelZeroError =
      TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
        Ellipsoid.WGS84,
        33,
        2,
      );
  }
  sampleHeight(lat: number, lon: number) {
    const h = sampleTerrain(this.terrain, lat, lon);
    if (h === null) return null;
    // Geoid undulation is a datum conversion, not relief: do not exaggerate N.
    return (
      h * this.exaggeration +
      (this.geoid ? geoidUndulation(this.geoid, lat, lon) : 0)
    );
  }
  getLevelMaximumGeometricError(level: number) {
    return this.levelZeroError / 2 ** level;
  }
  getTileDataAvailable(x: number, y: number, level: number) {
    return (
      level === 0 ||
      (level <= this.maximumLevel &&
        intersects(
          this.tilingScheme.tileXYToRectangle(x, y, level),
          this.rectangle,
        ))
    );
  }
  loadTileDataAvailability() {
    return undefined;
  }
  requestTileGeometry(x: number, y: number, level: number) {
    const key = `${level}/${x}/${y}`,
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const r = this.tilingScheme.tileXYToRectangle(x, y, level),
      n = 33,
      count = n * n,
      heights = new Float64Array(count),
      valid = new Uint8Array(count),
      points: Cartesian3[] = [],
      vertices = new Uint16Array(count * 3),
      indices: number[] = [],
      west: number[] = [],
      east: number[] = [],
      north: number[] = [],
      south: number[] = [];
    let min = Infinity,
      max = -Infinity,
      holes = false,
      changed = false;
    for (let row = 0; row < n; row++)
      for (let col = 0; col < n; col++) {
        const i = row * n + col,
          lon = (r.west + ((r.east - r.west) * col) / (n - 1)) / DEG,
          lat = (r.north - ((r.north - r.south) * row) / (n - 1)) / DEG,
          inside =
            lon >= this.terrain.bounds[0] &&
            lon <= this.terrain.bounds[2] &&
            lat >= this.terrain.bounds[1] &&
            lat <= this.terrain.bounds[3],
          h = inside ? this.sampleHeight(lat, lon) : 0;
        heights[i] = h ?? 0;
        valid[i] = h === null ? 0 : 1;
        holes ||= h === null;
        changed ||= h !== null && Math.abs(h) > 1e-8;
        min = Math.min(min, heights[i]);
        max = Math.max(max, heights[i]);
        vertices[i] = Math.round((col / (n - 1)) * 32767);
        vertices[i + count] = Math.round((1 - row / (n - 1)) * 32767);
        points.push(Cartesian3.fromDegrees(lon, lat, heights[i]));
        if (col === 0 && valid[i]) west.push(i);
        if (col === n - 1 && valid[i]) east.push(i);
        if (row === 0 && valid[i]) north.push(i);
        if (row === n - 1 && valid[i]) south.push(i);
        if (row > 0 && col > 0) {
          const a = i - n - 1,
            b = i - n,
            c = i - 1,
            d = i;
          if (valid[a] && valid[b] && valid[c] && valid[d])
            indices.push(a, c, b, b, c, d);
        }
      }
    let childTileMask = 0;
    if (level < this.maximumLevel)
      for (const [dx, dy, bit] of [
        [0, 0, 4],
        [1, 0, 8],
        [0, 1, 1],
        [1, 1, 2],
      ])
        if (
          intersects(
            this.tilingScheme.tileXYToRectangle(
              2 * x + dx,
              2 * y + dy,
              level + 1,
            ),
            this.rectangle,
          )
        )
          childTileMask |= bit;
    let result: HeightmapTerrainData | QuantizedMeshTerrainData;
    if (!changed && !holes)
      result = new HeightmapTerrainData({
        buffer: new Float32Array(count),
        width: n,
        height: n,
        childTileMask,
      });
    else {
      for (let i = 0; i < count; i++)
        vertices[2 * count + i] =
          max > min
            ? Math.round(((heights[i] - min) / (max - min)) * 32767)
            : 0;
      const sphere = BoundingSphere.fromPoints(points),
        occluder = new EllipsoidalOccluder(Ellipsoid.WGS84),
        horizon =
          occluder.computeHorizonCullingPointPossiblyUnderEllipsoid(
            sphere.center,
            points,
            min,
          ) ?? new Cartesian3(),
        skirt = Math.min(
          1000,
          Math.max(1, this.getLevelMaximumGeometricError(level) * 2),
        );
      result = new QuantizedMeshTerrainData({
        quantizedVertices: vertices,
        indices: Uint16Array.from(indices),
        minimumHeight: min,
        maximumHeight: max,
        boundingSphere: sphere,
        orientedBoundingBox: OrientedBoundingBox.fromRectangle(
          r,
          min,
          max,
          Ellipsoid.WGS84,
        ),
        horizonOcclusionPoint: horizon,
        westIndices: west,
        eastIndices: east,
        northIndices: north,
        southIndices: south,
        westSkirtHeight: skirt,
        eastSkirtHeight: skirt,
        northSkirtHeight: skirt,
        southSkirtHeight: skirt,
        childTileMask,
        credits: [this.credit],
      });
    }
    this.cache.set(key, result);
    while (this.cache.size > 64)
      this.cache.delete(this.cache.keys().next().value!);
    return Promise.resolve(result);
  }
  dispose() {
    this.cache.clear();
  }
}

export class CesiumResources {
  private disposed = false;
  private generation = 0;
  private terrainGeneration = 0;
  private verticalDatum: TerrainDatum = "unresolved-msl";
  private terrain: Terrain | null = null;
  private terrainProvider: LocalDtedTerrainProvider | undefined;
  private currentRaster: Raster | undefined;
  private rasterLayers: {
    layer: ImageryLayer;
    provider: RasterPacketImageryProvider;
  }[] = [];
  private baseLayer: ImageryLayer | undefined;
  private streetsLayer?: ImageryLayer;
  private streetsProvider?: StreetsImageryProvider;
  private basemapGeneration = 0;
  private basemap = "none";
  private previousScreenSpaceError?: number;
  private removeRenderListener: (() => void) | undefined;
  private mode = "space-time";
  constructor(
    readonly viewer: Viewer,
    private requestRender = () => viewer.scene.requestRender(),
  ) {
    // Local default: no ion/Bing/network terrain implied by construction.
    void SingleTileImageryProvider.fromUrl(earthUrl, {
      rectangle: Rectangle.MAX_VALUE,
      credit: "Natural Earth · public domain",
    })
      .then((provider) => {
        if (this.disposed || viewer.isDestroyed()) return;
        this.baseLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
        this.requestRender();
      })
      .catch((error) => {
        if (!this.disposed)
          console.error("Local Natural Earth map could not be loaded", error);
      });
    this.removeRenderListener = viewer.scene.postRender.addEventListener(() =>
      this.retireRasters(),
    );
  }
  get status() {
    return {
      basemap: this.basemap,
      basemapPending: this.streetsProvider?.pending ?? 0,
      basemapError: this.streetsProvider?.lastError ?? "",
      basemapRenderedTiles: this.streetsProvider?.renderedTiles ?? 0,
      basemapAlignmentErrorPixels:
        this.streetsProvider?.alignmentErrorPixels ?? 0,
      basemapMaximumLevel: this.streetsProvider?.maximumRequestedLevel ?? 0,
      imageryLayers:
        this.rasterLayers.length +
        (this.baseLayer ? 1 : 0) +
        (this.streetsLayer ? 1 : 0),
      tileCount: this.currentRaster?.tiles.length ?? 0,
      imageryRequestedTiles:
        this.rasterLayers.at(-1)?.provider.requestedTiles ?? 0,
      terrainActive: !!this.terrainProvider,
      terrainCovered: this.terrain?.covered ?? 0,
      verticalDatum: this.verticalDatum,
      geoidModel:
        this.verticalDatum === "egm96" ? "NGA EGM96 15-minute; H+N" : null,
      mode: this.mode,
    };
  }
  setVerticalDatum(datum: TerrainDatum) {
    if (!["egm96", "ellipsoid", "unresolved-msl"].includes(datum))
      throw new Error("Unknown terrain vertical datum");
    if (datum !== this.verticalDatum) {
      this.verticalDatum = datum;
      this.terrainGeneration++;
    }
  }
  async setBasemap(mode: "streets" | "none") {
    if (
      this.disposed ||
      (mode === this.basemap && (mode === "none" || this.streetsLayer))
    )
      return;
    const generation = ++this.basemapGeneration;
    this.basemap = mode;
    if (mode === "streets") {
      this.previousScreenSpaceError ??=
        this.viewer.scene.globe.maximumScreenSpaceError;
      this.viewer.scene.globe.maximumScreenSpaceError = Math.min(
        this.previousScreenSpaceError,
        1,
      );
    } else if (this.previousScreenSpaceError !== undefined) {
      this.viewer.scene.globe.maximumScreenSpaceError =
        this.previousScreenSpaceError;
      this.previousScreenSpaceError = undefined;
    }
    this.streetsProvider?.dispose();
    if (
      this.streetsLayer &&
      this.viewer.imageryLayers.contains(this.streetsLayer)
    )
      this.viewer.imageryLayers.remove(this.streetsLayer, true);
    this.streetsProvider = undefined;
    this.streetsLayer = undefined;
    if (mode === "streets") {
      const { StreetsImageryProvider } = await import("./streets");
      if (this.disposed || generation !== this.basemapGeneration) return;
      this.streetsProvider = new StreetsImageryProvider(this.requestRender);
      this.streetsLayer = this.viewer.imageryLayers.addImageryProvider(
        this.streetsProvider,
        this.baseLayer ? 1 : 0,
      );
      this.streetsLayer.show = true;
    }
    this.requestRender();
  }
  async setTerrain(
    terrain: Terrain | null,
    exaggeration = 1,
    accept: () => boolean = () => true,
  ) {
    const generation = ++this.terrainGeneration;
    if (
      !Number.isFinite(exaggeration) ||
      exaggeration < 0 ||
      exaggeration > 100
    )
      throw new Error("Invalid terrain exaggeration");
    if (terrain) validateTerrain(terrain);
    if (terrain && this.verticalDatum === "unresolved-msl")
      throw new Error(
        "Choose the DTED vertical datum before displaying terrain. MSL is not automatically WGS84 ellipsoid height; select EGM96 only when the data source confirms it.",
      );
    const geoid =
      terrain && this.verticalDatum === "egm96" ? await loadGeoid() : undefined;
    if (this.disposed || generation !== this.terrainGeneration || !accept())
      return;
    if (
      terrain === this.terrain &&
      this.terrainProvider?.exaggeration === exaggeration &&
      this.terrainProvider.verticalDatum === this.verticalDatum
    )
      return;
    // A repeated clear must not replace the ellipsoid provider and invalidate
    // the globe's terrain/imagery quadtree during an unrelated view refresh.
    if (!terrain && !this.terrainProvider && this.terrain === null) return;
    const previous = this.terrainProvider;
    this.terrain = terrain;
    this.terrainProvider = terrain
      ? new LocalDtedTerrainProvider(
          terrain,
          geoid,
          this.verticalDatum,
          exaggeration,
        )
      : undefined;
    this.viewer.terrainProvider =
      this.terrainProvider ?? new EllipsoidTerrainProvider();
    previous?.dispose();
    this.requestRender();
  }
  sampleHeight(lat: number, lon: number): number | null {
    return this.terrainProvider?.sampleHeight(lat, lon) ?? null;
  }
  groundHeight(lat: number, lon: number) {
    return this.sampleHeight(lat, lon) ?? 0;
  }
  setMode(mode: string) {
    this.mode = mode;
    if (this.streetsLayer) this.streetsLayer.show = true;
    this.requestRender();
  }
  async setRasters(
    data: Raster,
    accept: () => boolean = () => true,
  ): Promise<boolean> {
    const generation = ++this.generation;
    if (this.disposed || !accept()) return false;
    if (!data.tiles.length) {
      this.clearRasters();
      return true;
    }
    const tiles: {
      image: HTMLCanvasElement;
      bounds: number[];
      geographic: boolean;
    }[] = [];
    for (const t of data.tiles) {
      const b = t.request.bounds;
      if (
        b.length !== 4 ||
        !b.every(Number.isFinite) ||
        b[0] >= b[2] ||
        b[1] >= b[3] ||
        b[0] < -180 ||
        b[2] > 180 ||
        b[1] < -90 ||
        b[3] > 90
      )
        throw new Error("Invalid raster bounds; previous imagery retained");
      const image = t.image ?? new Image();
      if (!t.image) {
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(t.data_url))
          throw new Error(
            "Expected an authorised inline raster image; previous imagery retained",
          );
        (image as HTMLImageElement).src = t.data_url;
        await (image as HTMLImageElement).decode();
      }
      if (this.disposed || generation !== this.generation || !accept())
        return false;
      if (
        !image.width ||
        !image.height ||
        image.width > 16384 ||
        image.height > 16384
      )
        throw new Error("Invalid raster size; previous imagery retained");
      const snapshot = document.createElement("canvas");
      snapshot.width = image.width;
      snapshot.height = image.height;
      snapshot.getContext("2d")!.drawImage(image, 0, 0);
      tiles.push({
        image: snapshot,
        bounds: [...b],
        geographic: !!t.request.geographic,
      });
    }
    if (this.disposed || generation !== this.generation || !accept())
      return false;
    const provider = new RasterPacketImageryProvider(tiles, data.attribution);
    let insertAt = this.viewer.imageryLayers.length;
    for (let i = 0; i < this.viewer.imageryLayers.length; i++)
      if (
        (
          this.viewer.imageryLayers.get(i) as ImageryLayer & {
            chronoscopeEffects?: boolean;
          }
        ).chronoscopeEffects
      ) {
        insertAt = i;
        break;
      }
    const layer = this.viewer.imageryLayers.addImageryProvider(
      provider,
      insertAt,
    );
    this.currentRaster = data;
    this.rasterLayers.push({ layer, provider });
    // Keep previously rendered pixels below the replacement until textures load.
    while (this.rasterLayers.length > 3)
      this.removeRaster(this.rasterLayers.splice(1, 1)[0]);
    this.requestRender();
    return true;
  }
  private retireRasters() {
    const latest = this.rasterLayers.at(-1);
    if (
      !latest ||
      this.rasterLayers.length < 2 ||
      !latest.provider.requestedTiles ||
      !this.viewer.scene.globe.tilesLoaded
    )
      return;
    while (this.rasterLayers.length > 1)
      this.removeRaster(this.rasterLayers.shift()!);
  }
  private removeRaster(entry: {
    layer: ImageryLayer;
    provider: RasterPacketImageryProvider;
  }) {
    if (this.viewer.imageryLayers.contains(entry.layer))
      this.viewer.imageryLayers.remove(entry.layer, true);
    entry.provider.dispose();
  }
  clearRasters() {
    this.generation++;
    this.currentRaster = undefined;
    for (const entry of this.rasterLayers) this.removeRaster(entry);
    this.rasterLayers = [];
    this.requestRender();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.basemapGeneration++;
    this.streetsProvider?.dispose();
    if (
      this.streetsLayer &&
      this.viewer.imageryLayers.contains(this.streetsLayer)
    )
      this.viewer.imageryLayers.remove(this.streetsLayer, true);
    this.terrainGeneration++;
    this.removeRenderListener?.();
    this.removeRenderListener = undefined;
    this.clearRasters();
    this.terrainProvider?.dispose();
    if (this.baseLayer && this.viewer.imageryLayers.contains(this.baseLayer))
      this.viewer.imageryLayers.remove(this.baseLayer, true);
  }
}
