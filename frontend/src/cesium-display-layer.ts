import {
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidalOccluder,
  Ellipsoid,
  GeometryInstance,
  LabelCollection,
  LabelStyle,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Rectangle,
  SingleTileImageryProvider,
  ColorGeometryInstanceAttribute,
  HorizontalOrigin,
  VerticalOrigin,
  type ImageryLayer,
  type Viewer,
} from "cesium";
import type {
  DisplayBin,
  DisplayCell,
  DisplayOptions,
  DisplayPacket,
} from "./display-options";
import { heatColor } from "./display-math";
import { entityColor } from "./types";
import type { GroundEffectRequest } from "./cesium-effects-math";

export interface CesiumDisplayContext {
  viewer: Viewer;
  host: HTMLElement;
  mode: string;
  bounds: number[];
  lo: number;
  hi: number;
  timeHeight: number;
  theme: string;
  selected: Set<string>;
  position(
    lat: number,
    lon: number,
    time?: number,
    groundOnly?: boolean,
  ): Cartesian3;
  groundHeight(lat: number, lon: number): number;
  project(position: Cartesian3): Cartesian2 | undefined;
  requestRender(): void;
  setSelection?(ids: string[]): void;
  mapZoom?(): number;
  terrainGeneration?: number;
  exaggeration?: number;
  globeTime?: boolean;
  globeTimeScale?: number;
}
interface Hit {
  bin: DisplayBin;
  x: number;
  y: number;
  r: number;
}

/** Bounded Cesium primitives for exact backend cells, never per-source Entities. */
export class DisplayLayer {
  packet: DisplayPacket | null = null;
  active = false;
  options!: DisplayOptions;
  /** Ground bloom is an overlay; only a summary representation replaces events. */
  get replacesEvents() {
    return (
      this.active &&
      !this.options.bloom &&
      this.options.mode !== "heatmap" &&
      this.options.mode !== "points" &&
      (this.options.mode !== "auto" || !!this.packet?.aggregated)
    );
  }
  hits: Hit[] = [];
  /** Public diagnostics describe real Cesium resources, useful to MCP/UI tests. */
  diagnostics = {
    renderer: "cesium-webgl2",
    groundOnly: false,
    bloomIsolation: "event-layer-only",
    clusterPoints: 0,
    clusterLabels: 0,
    densityInstances: 0,
    atlasLayers: 0,
    rasterWidth: 0,
    rasterHeight: 0,
    heatPeak: 0,
    heatCeiling: 0,
    pending: false,
    error: "",
  };
  private points?: PointPrimitiveCollection;
  private labels?: LabelCollection;
  private densityPrimitive?: Primitive;
  private atlas?: ImageryLayer;
  private worker?: Worker;
  private generation = 0;
  private disposed = false;
  private cameraTimer?: ReturnType<typeof setTimeout>;
  private effectScale = 0;
  private finishWorker?: () => void;
  private renderKey = "";
  private requestedKey = "";
  private pendingRebuild?: Promise<void>;
  private playback = false;
  private exposure?: number;
  private transitionFrame = 0;
  private transitionTimer?: ReturnType<typeof setTimeout>;
  private finishTransition?: () => void;
  private nextAtlas?: ImageryLayer;
  setPlayback(active: boolean) {
    if (this.playback === active) return;
    this.playback = active;
    this.exposure = undefined;
  }
  constructor(private view: CesiumDisplayContext) {}
  private clear(keepAtlas = false) {
    if (!keepAtlas) {
      cancelAnimationFrame(this.transitionFrame);
      clearTimeout(this.transitionTimer);
      this.finishTransition?.();
      this.finishTransition = undefined;
      if (this.nextAtlas) {
        this.view.viewer.imageryLayers.remove(this.nextAtlas, true);
        this.nextAtlas = undefined;
      }
    }
    this.generation++;
    this.worker?.terminate();
    this.worker = undefined;
    this.finishWorker?.();
    this.finishWorker = undefined;
    clearTimeout(this.cameraTimer);
    const scene = this.view.viewer.scene;
    if (this.points) scene.primitives.remove(this.points);
    if (this.labels) scene.primitives.remove(this.labels);
    if (this.densityPrimitive) scene.primitives.remove(this.densityPrimitive);
    this.points = undefined;
    this.labels = undefined;
    this.densityPrimitive = undefined;
    if (this.atlas && !keepAtlas) {
      this.view.viewer.imageryLayers.remove(this.atlas, true);
      this.atlas = undefined;
    }
    this.hits = [];
    Object.assign(this.diagnostics, {
      clusterPoints: 0,
      clusterLabels: 0,
      densityInstances: 0,
      atlasLayers: this.atlas ? 1 : 0,
      rasterWidth: this.atlas ? this.diagnostics.rasterWidth : 0,
      rasterHeight: this.atlas ? this.diagnostics.rasterHeight : 0,
      heatPeak: 0,
      heatCeiling: 0,
      pending: false,
      error: "",
    });
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  get updating() {
    return !!this.pendingRebuild;
  }
  set(packet: DisplayPacket | null, options: DisplayOptions): Promise<void> {
    this.packet = packet;
    this.options = options;
    const v = this.view;
    // Cache metadata changes do not change pixels. Include every spatial/style
    // input so terrain, mode, time scaling and selected cells still invalidate.
    const { cache_hit: _cache, revision: _revision, ...visual } = packet || {};
    // Track geometry/style does not affect density, heat or bloom. Keep the
    // current atlas and worker when a user adjusts only a track control.
    const {
      show_tracks: _tracks,
      show_trails: _trails,
      track_opacity: _trackOpacity,
      trail_opacity: _trailOpacity,
      trail_pixels: _pixels,
      trail_gap_minutes: _gap,
      ...layerOptions
    } = options;
    const key = JSON.stringify([
      packet ? visual : null,
      layerOptions,
      v.mode,
      v.bounds,
      v.lo,
      v.hi,
      v.timeHeight,
      v.theme,
      // Custom colors are outside the packet; include their resolved values.
      packet?.bins.map((b) =>
        b.cell.partition === "entity" ? entityColor(b.cell.key, v.theme) : null,
      ),
      v.terrainGeneration,
      v.exaggeration,
      v.globeTime,
      v.globeTimeScale,
    ]);
    this.requestedKey = key;
    if (this.diagnostics.error) this.renderKey = "";
    if (this.pendingRebuild) return this.pendingRebuild;
    if (key === this.renderKey && !this.diagnostics.error)
      return Promise.resolve();
    // Let the current effect reach the screen, then render the newest request.
    // Restarting a worker on every input event starves live slider previews.
    const pending = Promise.resolve().then(async () => {
      try {
        while (!this.disposed && this.requestedKey !== this.renderKey) {
          const current = this.requestedKey;
          await this.rebuild();
          this.renderKey = current;
        }
      } catch (error) {
        this.renderKey = "";
        this.diagnostics.error = String(error);
        throw error;
      } finally {
        this.pendingRebuild = undefined;
      }
    });
    this.pendingRebuild = pending;
    return pending;
  }
  async rebuild() {
    const p = this.packet,
      o = this.options;
    this.clear(
      !!p &&
        (o.mode === "heatmap" || o.bloom) &&
        (!!p.bins.length || this.playback),
    );
    this.active =
      !!p &&
      (o.bloom || (o.mode !== "points" && (o.mode !== "auto" || p.aggregated)));
    this.diagnostics.groundOnly =
      o.bloom ||
      o.mode === "heatmap" ||
      (o.mode === "density" && this.view.mode !== "space-time");
    this.view.setSelection?.([...this.view.selected]);
    if (!this.active || !p) {
      this.view.requestRender();
      return;
    }
    if (!p.bins.length) {
      if (this.playback && this.atlas) await this.replaceAtlas(undefined);
      this.view.requestRender();
      return;
    }
    if (o.mode === "heatmap" || o.bloom) await this.groundEffects();
    else if (o.mode === "density") await this.density();
    else this.clusters();
    this.cameraChanged();
    this.view.requestRender();
  }

  private color(bin: DisplayBin, maximum: number, alpha = 0.92) {
    if (bin.selected_count)
      return Color.fromBytes(255, 220, 80, Math.round(alpha * 255));
    const c = heatColor(bin.count, maximum);
    return Color.fromBytes(c[0], c[1], c[2], Math.round(alpha * 255));
  }
  private clusters() {
    const p = this.packet!,
      scene = this.view.viewer.scene;
    this.points = scene.primitives.add(new PointPrimitiveCollection());
    this.labels = scene.primitives.add(new LabelCollection({ scene }));
    for (const bin of p.bins)
      this.points!.add({
        position: this.view.position(
          bin.latitude,
          bin.longitude,
          (bin.first_time + bin.last_time) / 2,
        ),
        pixelSize: 2 * Math.min(27, 10 + Math.log2(bin.count + 1) * 1.3),
        color:
          Color.fromCssColorString(
            entityColor(bin.cell.key, this.view.theme),
          ) || Color.CYAN,
        // Selection marks the edge without replacing the entity color.
        outlineColor: bin.selected_count
          ? Color.fromCssColorString(
              this.view.theme === "light" ? "#7c4b00" : "#ffd27a",
            )
          : this.view.theme === "light"
            ? Color.TRANSPARENT
            : Color.BLACK.withAlpha(0.8),
        outlineWidth: bin.selected_count || this.view.theme !== "light" ? 1 : 0,
        id: { kind: "cluster", bin },
      });
    const largest = p.bins
      .filter((b) => b.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);
    for (const bin of largest)
      this.labels!.add({
        position: this.view.position(
          bin.latitude,
          bin.longitude,
          (bin.first_time + bin.last_time) / 2,
        ),
        text: bin.count.toLocaleString(),
        font: "bold 12px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        id: { kind: "cluster", bin },
      });
    this.diagnostics.clusterPoints = p.bins.length;
    this.diagnostics.clusterLabels = largest.length;
  }
  cameraChanged() {
    if (!this.active || !this.packet || this.disposed) return;
    const width = this.view.host.clientWidth,
      height = this.view.host.clientHeight;
    const occluder = new EllipsoidalOccluder(
      Ellipsoid.WGS84,
      this.view.viewer.camera.positionWC,
    );
    const globe = this.view.mode === "globe";
    this.hits = [];
    const ground =
      this.options.bloom ||
      this.options.mode === "heatmap" ||
      (this.options.mode === "density" && this.view.mode !== "space-time");
    for (const bin of this.packet.bins) {
      const position = this.view.position(
        bin.latitude,
        bin.longitude,
        (bin.first_time + bin.last_time) / 2,
        ground,
      );
      if (globe && !occluder.isPointVisible(position)) continue;
      const pixel = this.view.project(position);
      if (
        !pixel ||
        pixel.x < -30 ||
        pixel.x > width + 30 ||
        pixel.y < -30 ||
        pixel.y > height + 30
      )
        continue;
      this.hits.push({
        bin,
        x: pixel.x,
        y: pixel.y,
        r: ground ? 8 : Math.min(27, 10 + Math.log2(bin.count + 1) * 1.3),
      });
    }
    // Labels are actual GPU glyphs. Suppress overlapping count strings while
    // retaining every count primitive and its exact cell membership.
    if (this.labels) {
      const occupied = new Set<string>();
      for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels.get(i),
          pixel = this.view.project(label.position);
        const key = pixel
          ? `${Math.round(pixel.x / 55)}:${Math.round(pixel.y / 30)}`
          : "";
        label.show = !!pixel && !occupied.has(key);
        if (label.show) occupied.add(key);
      }
    }
    if (this.options.mode === "heatmap" || this.options.bloom) {
      const scale = this.metresPerPixel();
      if (
        this.effectScale &&
        Math.abs(Math.log(scale / this.effectScale)) > Math.log(1.2)
      ) {
        clearTimeout(this.cameraTimer);
        this.cameraTimer = setTimeout(() => {
          if (!this.disposed && this.active) {
            this.renderKey = "";
            void this.set(this.packet, this.options);
          }
        }, 180);
      }
    }
  }
  pick(clientX: number, clientY: number) {
    const rect = this.view.host.getBoundingClientRect();
    let nearest: DisplayBin | undefined,
      distance = Infinity;
    for (const hit of this.hits) {
      const d = Math.hypot(
        clientX - rect.left - hit.x,
        clientY - rect.top - hit.y,
      );
      if (d <= hit.r && d < distance) {
        nearest = hit.bin;
        distance = d;
      }
    }
    return nearest;
  }
  inBox(x0: number, y0: number, x1: number, y1: number): DisplayCell[] {
    const r = this.view.host.getBoundingClientRect();
    return this.hits
      .filter(
        (h) =>
          h.x + r.left >= x0 &&
          h.x + r.left <= x1 &&
          h.y + r.top >= y0 &&
          h.y + r.top <= y1,
      )
      .map((h) => h.bin.cell);
  }
  private metresPerPixel() {
    const v = this.view,
      bounds = this.packet?.bounds || v.bounds;
    const latitude = (bounds[1] + bounds[3]) / 2,
      longitude = (bounds[0] + bounds[2]) / 2;
    // Project a short geodetic baseline through Cesium's actual scene mode.
    // camera.positionWC is projected rather than ECEF in Columbus/2D, so an
    // ECEF bounding sphere would produce a catastrophically oversized kernel.
    const delta = 0.001;
    const origin = v.project(v.position(latitude, longitude, undefined, true));
    const east = v.project(
      v.position(
        latitude,
        Math.min(179.999999, longitude + delta),
        undefined,
        true,
      ),
    );
    if (origin && east) {
      const pixels = Math.hypot(east.x - origin.x, east.y - origin.y);
      const metres =
        111320 *
        Math.max(0.01, Math.cos((latitude * Math.PI) / 180)) *
        Math.abs(Math.min(179.999999, longitude + delta) - longitude);
      if (pixels > 1e-6 && metres > 0) return Math.max(0.01, metres / pixels);
    }
    if (v.mapZoom)
      return Math.max(0.01, 40075016.68557849 / (256 * 2 ** v.mapZoom()));
    return 40075016.68557849 / Math.max(256, v.host.clientWidth);
  }
  private async addAtlas(
    canvas: HTMLCanvasElement,
    bounds: number[],
    generation: number,
  ) {
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return;
    const provider = await SingleTileImageryProvider.fromUrl(
      canvas.toDataURL("image/png"),
      {
        rectangle: Rectangle.fromDegrees(
          bounds[0],
          bounds[1],
          bounds[2],
          bounds[3],
        ),
      },
    );
    if (
      this.disposed ||
      generation !== this.generation ||
      this.view.viewer.isDestroyed()
    )
      return;
    const layer = this.view.viewer.imageryLayers.addImageryProvider(provider);
    (
      layer as ImageryLayer & { chronoscopeEffects: boolean }
    ).chronoscopeEffects = true;
    // A zero-alpha Cesium layer does not load tiles. Keep it almost transparent
    // while the previous atlas remains visible and the new texture is uploaded.
    layer.alpha = 0.001;
    layer.show = true;
    await this.replaceAtlas(layer);
    Object.assign(this.diagnostics, {
      atlasLayers: 1,
      rasterWidth: canvas.width,
      rasterHeight: canvas.height,
    });
    this.view.requestRender();
  }
  private replaceAtlas(layer?: ImageryLayer) {
    const old = this.atlas;
    this.nextAtlas = layer;
    return new Promise<void>((resolve) => {
      this.finishTransition = resolve;
      const started = performance.now();
      let frames = 0,
        readyAt: number | undefined;
      const schedule = () => {
        this.transitionFrame = requestAnimationFrame(frame);
        // WKWebView can suspend animation frames in a locked/background window.
        // Finish bounded native requests there without changing foreground FPS.
        this.transitionTimer = setTimeout(() => frame(performance.now()), 200);
      };
      const frame = (now: number) => {
        cancelAnimationFrame(this.transitionFrame);
        clearTimeout(this.transitionTimer);
        if (this.disposed) {
          resolve();
          return;
        }
        // Wait for real scene frames and tile readiness, bounded independently
        // of public WMTS sources that might remain loading or unreachable.
        if (
          readyAt === undefined &&
          ++frames >= 2 &&
          (!layer ||
            this.view.viewer.scene.globe.tilesLoaded ||
            now - started >= 1200)
        )
          readyAt = now;
        const fraction =
          readyAt === undefined
            ? 0
            : this.playback && old
              ? Math.min(1, (now - readyAt) / 350)
              : 1;
        const mix = fraction * fraction * (3 - 2 * fraction);
        if (layer) layer.alpha = Math.max(0.001, mix);
        if (old) old.alpha = 1 - mix;
        this.view.requestRender();
        if (fraction < 1) schedule();
        else {
          if (old) this.view.viewer.imageryLayers.remove(old, true);
          this.atlas = layer;
          this.nextAtlas = undefined;
          this.transitionFrame = 0;
          this.finishTransition = undefined;
          this.diagnostics.atlasLayers = layer ? 1 : 0;
          resolve();
        }
      };
      schedule();
    });
  }
  private async density() {
    const p = this.packet!,
      v = this.view;
    let maximum = this.options.heat_max || 1;
    if (!this.options.heat_max)
      for (const b of p.bins) maximum = Math.max(maximum, b.count);
    if (v.mode !== "space-time") {
      const bounds = [180, 90, -180, -90],
        canvas = document.createElement("canvas");
      for (const bin of p.bins) {
        bounds[0] = Math.min(bounds[0], bin.bounds[0]);
        bounds[1] = Math.min(bounds[1], bin.bounds[1]);
        bounds[2] = Math.max(bounds[2], bin.bounds[2]);
        bounds[3] = Math.max(bounds[3], bin.bounds[3]);
      }
      canvas.width = 1024;
      canvas.height = 512;
      const context = canvas.getContext("2d")!;
      for (const b of p.bins) {
        const box = b.bounds,
          c = this.color(b, maximum, 0.68);
        context.fillStyle = c.toCssColorString();
        context.fillRect(
          ((box[0] - bounds[0]) / (bounds[2] - bounds[0])) * canvas.width,
          ((bounds[3] - box[3]) / (bounds[3] - bounds[1])) * canvas.height,
          ((box[2] - box[0]) / (bounds[2] - bounds[0])) * canvas.width,
          ((box[3] - box[1]) / (bounds[3] - bounds[1])) * canvas.height,
        );
      }
      await this.addAtlas(canvas, bounds, this.generation);
    } else {
      const instances = p.bins.map((bin) => {
        const b = bin.bounds,
          time = (bin.first_time + bin.last_time) / 2;
        const positions = [
          [b[1], b[0]],
          [b[1], b[2]],
          [b[3], b[2]],
          [b[3], b[0]],
        ].map(([lat, lon]) => v.position(lat, lon, time));
        return new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(positions),
            perPositionHeight: true,
            vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              this.color(bin, maximum, 0.68),
            ),
          },
          id: { kind: "cluster", bin },
        });
      });
      this.densityPrimitive = v.viewer.scene.primitives.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({
            flat: true,
            translucent: true,
            closed: false,
          }),
          asynchronous: false,
          releaseGeometryInstances: true,
        }),
      );
      this.diagnostics.densityInstances = instances.length;
    }
  }
  private async groundEffects() {
    const p = this.packet,
      o = this.options;
    if (!p || !p.bins.length || this.disposed) return;
    this.worker?.terminate();
    this.finishWorker?.();
    const generation = ++this.generation;
    const metres = this.metresPerPixel();
    this.effectScale = metres;
    const data = this.playback
      ? this.view.bounds
      : p.bounds || this.view.bounds;
    const middle = (data[1] + data[3]) / 2;
    const reference =
      o.heat_reference_zoom == null
        ? 1
        : 2 **
          (Math.log2(40075016.68557849 / (256 * metres)) -
            o.heat_reference_zoom);
    const heatMetres = Math.max(1, o.heat_radius * reference * metres),
      bloomMetres = (8 + 80 * o.bloom_radius) * metres;
    const influence = Math.max(
      o.mode === "heatmap" ? heatMetres : 0,
      o.bloom ? bloomMetres : 0,
    );
    const latPad = Math.max(1e-7, (influence / 111320) * 2),
      lonPad = latPad / Math.max(0.01, Math.cos((middle * Math.PI) / 180));
    const bounds = [
      Math.max(-180, data[0] - lonPad),
      Math.max(-90, data[1] - latPad),
      Math.min(180, data[2] + lonPad),
      Math.min(90, data[3] + latPad),
    ];
    if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return;
    const width = 512,
      height = 512;
    const xMetres =
        (bounds[2] - bounds[0]) *
        111320 *
        Math.max(0.01, Math.cos((middle * Math.PI) / 180)),
      yMetres = (bounds[3] - bounds[1]) * 111320;
    const radius = (m: number, size: number, length: number) =>
      Math.max(1, Math.min(256, (m / length) * size));
    const request: GroundEffectRequest = {
      width,
      height,
      points: p.bins.map((bin) => ({
        x: (bin.longitude - bounds[0]) / (bounds[2] - bounds[0]),
        y: (bounds[3] - bin.latitude) / (bounds[3] - bounds[1]),
        count: bin.count,
        weight: o.heat_weight === "count" ? bin.count : bin.weight,
      })),
      heat: o.mode === "heatmap",
      heatRadius: radius(heatMetres, width, xMetres),
      heatRadiusY: radius(heatMetres, height, yMetres),
      heatMaximum: o.heat_max,
      bloom: o.bloom,
      bloomRadius: radius(bloomMetres, width, xMetres),
      bloomRadiusY: radius(bloomMetres, height, yMetres),
      bloomStrength: Math.max(0, Math.min(10, o.bloom_strength)),
      bloomThreshold: o.bloom_threshold,
      bloomExposure: this.playback ? this.exposure : undefined,
    };
    Object.assign(this.diagnostics, { pending: true, error: "" });
    await new Promise<void>((resolve) => {
      this.finishWorker = resolve;
      const worker = new Worker(
        new URL("./cesium-effects-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker = worker;
      const finish = () => {
        worker.terminate();
        if (this.worker === worker) {
          this.worker = undefined;
          this.finishWorker = undefined;
        }
        resolve();
      };
      worker.onmessage = async (event: MessageEvent) => {
        if (generation !== this.generation || this.disposed) {
          finish();
          return;
        }
        if (event.data.error) {
          this.diagnostics.error = event.data.error;
          this.diagnostics.pending = false;
          finish();
          return;
        }
        try {
          if (this.playback && this.exposure === undefined)
            this.exposure = event.data.exposure;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas
            .getContext("2d")!
            .putImageData(
              new ImageData(
                new Uint8ClampedArray(event.data.image),
                width,
                height,
              ),
              0,
              0,
            );
          await this.addAtlas(canvas, bounds, generation);
          Object.assign(this.diagnostics, {
            heatPeak: event.data.peak,
            heatCeiling: event.data.ceiling,
            pending: false,
          });
        } catch (error) {
          this.diagnostics.error = String(error);
          this.diagnostics.pending = false;
        }
        finish();
      };
      worker.onerror = (error) => {
        this.diagnostics.error = error.message;
        this.diagnostics.pending = false;
        finish();
      };
      worker.postMessage({ ...request, id: generation });
    });
  }
}
