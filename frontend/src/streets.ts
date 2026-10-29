/** Rasterize the public vector basemap into native Cesium imagery tiles.
 * One non-interactive MapLibre context is reused; Cesium owns the camera,
 * globe, terrain, tile LOD and GPU imagery cache in every view. */
import {
  Credit,
  Event as CesiumEvent,
  WebMercatorTilingScheme,
  Math as CesiumMath,
  type ImageryProvider,
  type Request,
} from "cesium";
import {
  Map as VectorMap,
  addProtocol,
  setWorkerUrl,
  setWorkerCount,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { call } from "./bridge";

setWorkerUrl(workerUrl);
setWorkerCount(1);
const PREFIX = "chronoscope-basemap://resource/";
const STYLE = "https://tiles.openfreemap.org/styles/positron";
let active = 0;
const waiters: (() => void)[] = [];
addProtocol("chronoscope-basemap", async (params, controller) => {
  if (!params.url.startsWith(PREFIX)) throw Error("Unknown basemap resource");
  if (active >= 4) await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
  try {
    controller.signal.throwIfAborted();
    const response = await call("basemap_resource", {
      url: decodeURIComponent(params.url.slice(PREFIX.length)),
    });
    controller.signal.throwIfAborted();
    const bytes = Uint8Array.from(atob(response.data), (s) => s.charCodeAt(0));
    return {
      data:
        params.type === "json"
          ? JSON.parse(new TextDecoder().decode(bytes))
          : params.type === "string"
            ? new TextDecoder().decode(bytes)
            : bytes.buffer,
    };
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
});

export function tileCenter(
  x: number,
  y: number,
  level: number,
): [number, number] {
  const n = 2 ** level;
  return [
    ((x + 0.5) / n) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI,
  ];
}

type Work = {
  x: number;
  y: number;
  level: number;
  request?: Request & { cancelled?: boolean };
  resolve: (image: HTMLCanvasElement) => void;
  reject: (error: Error) => void;
};
export class StreetsImageryProvider implements ImageryProvider {
  readonly tilingScheme = new WebMercatorTilingScheme();
  readonly rectangle = this.tilingScheme.rectangle;
  readonly tileWidth = 512;
  readonly tileHeight = 512;
  readonly minimumLevel = 0;
  readonly maximumLevel = 20;
  readonly hasAlphaChannel = false;
  readonly tileDiscardPolicy: ImageryProvider["tileDiscardPolicy"] = undefined!;
  readonly proxy: ImageryProvider["proxy"] = undefined!;
  readonly errorEvent = new CesiumEvent();
  readonly credit = new Credit(
    '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    false,
  );
  private queue: Work[] = [];
  private busy = false;
  private closed = false;
  private map?: VectorMap;
  private container?: HTMLDivElement;
  private cancelRender?: () => void;
  private fatalError?: Error;
  private cache = new Map<string, HTMLCanvasElement>();
  private cacheLimit = 24;
  private resetRenderer = false;
  renderedTiles = 0;
  alignmentErrorPixels = 0;
  maximumRequestedLevel = 0;
  lastError = "";
  constructor(private requestRender: () => void) {}
  setCacheLimit(limit: number) {
    if (limit === this.cacheLimit) return;
    this.cacheLimit = Math.max(2, Math.min(24, Math.floor(limit)));
    while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
    // The rasterizer is hidden; existing Cesium imagery stays installed. Release
    // its vector cache at a safe job boundary, then recreate lazily if needed.
    this.resetRenderer = true;
    if (!this.busy) this.releaseRenderer();
  }
  private releaseRenderer() {
    this.map?.remove(); this.map = undefined;
    this.container?.remove(); this.container = undefined;
    this.resetRenderer = false;
  }
  get pending() {
    return this.queue.length + Number(this.busy);
  }
  getTileCredits() {
    return [this.credit];
  }
  pickFeatures() {
    return undefined;
  }
  requestImage(x: number, y: number, level: number, request?: Request) {
    if (this.closed || this.queue.length >= 32) return undefined;
    const key = `${level}/${x}/${y}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const result = new Promise<HTMLCanvasElement>((resolve, reject) => {
      this.queue.push({ x, y, level, request, resolve, reject });
    });
    void this.drain();
    return result;
  }
  private async render(work: Work) {
    if (this.fatalError) throw this.fatalError;
    const center = tileCenter(work.x, work.y, work.level);
    // Let labels cross the output edge before cropping. At the Mercator polar
    // boundary a margin would force MapLibre to move the camera, so keep those
    // edge tiles unbuffered and validate their bounds in the same way.
    const margin =
      work.level > 1 && work.y > 0 && work.y < 2 ** work.level - 1 ? 128 : 0;
    const size = 512 + margin * 2;
    if (!this.map) {
      this.container = document.createElement("div");
      this.container.setAttribute("aria-hidden", "true");
      this.container.style.cssText = `position:fixed;left:-2000px;top:0;width:${size}px;height:${size}px;pointer-events:none;contain:strict;`;
      document.body.append(this.container);
      this.map = new VectorMap({
        container: this.container,
        style: STYLE,
        center,
        zoom: work.level,
        minZoom: 0,
        maxZoom: 22,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        refreshExpiredTiles: false,
        pixelRatio: 1,
        maxTileCacheSize: this.cacheLimit * 2,
        canvasContextAttributes: {
          preserveDrawingBuffer: true,
          antialias: false,
        },
        transformRequest: (url) => ({ url: PREFIX + encodeURIComponent(url) }),
      });
      this.map.on("error", (event) => {
        this.fatalError =
          event.error instanceof Error
            ? event.error
            : Error(String(event.error));
        this.lastError = this.fatalError.message;
        this.requestRender();
      });
    }
    const map = this.map;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        map.off("idle", idle);
        map.off("error", failed);
        this.cancelRender = undefined;
        if (error) reject(error);
        else resolve();
      };
      const idle = () => finish();
      const failed = (event: { error: unknown }) =>
        finish(
          event.error instanceof Error
            ? event.error
            : Error(String(event.error)),
        );
      const timer = setTimeout(
        () => finish(Error("Street map tile timed out")),
        30000,
      );
      this.cancelRender = () => finish(Error("Street map closed"));
      map.once("idle", idle);
      map.once("error", failed);
      if (this.container!.clientWidth !== size) {
        this.container!.style.width =
          this.container!.style.height = `${size}px`;
        map.resize();
      }
      map.jumpTo({ center, zoom: work.level, bearing: 0, pitch: 0 });
      map.triggerRepaint();
    });
    if (this.fatalError) throw this.fatalError;
    if (this.closed || work.request?.cancelled)
      throw Error("Street map request cancelled");
    const rectangle = this.tilingScheme.tileXYToRectangle(
      work.x,
      work.y,
      work.level,
    );
    const northwest = map.project([
      CesiumMath.toDegrees(rectangle.west),
      CesiumMath.toDegrees(rectangle.north),
    ]);
    const southeast = map.project([
      CesiumMath.toDegrees(rectangle.east),
      CesiumMath.toDegrees(rectangle.south),
    ]);
    const alignmentError = Math.max(
      Math.abs(northwest.x - margin),
      Math.abs(northwest.y - margin),
      Math.abs(southeast.x - 512 - margin),
      Math.abs(southeast.y - 512 - margin),
    );
    this.alignmentErrorPixels = Math.max(
      this.alignmentErrorPixels,
      alignmentError,
    );
    if (!Number.isFinite(alignmentError) || alignmentError > 0.1) {
      this.fatalError = Error(
        "Street map projection does not match its Cesium tile bounds",
      );
      throw this.fatalError;
    }
    this.maximumRequestedLevel = Math.max(
      this.maximumRequestedLevel,
      work.level,
    );
    const tile = document.createElement("canvas");
    tile.width = tile.height = 512;
    tile
      .getContext("2d")!
      .drawImage(map.getCanvas(), margin, margin, 512, 512, 0, 0, 512, 512);
    return tile;
  }
  private async drain() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.closed) {
        if (this.resetRenderer) this.releaseRenderer();
        const work = this.queue.shift()!;
        try {
          if (work.request?.cancelled)
            throw Error("Street map request cancelled");
          const image = await this.render(work);
          this.cache.set(`${work.level}/${work.x}/${work.y}`, image);
          while (this.cache.size > this.cacheLimit)
            this.cache.delete(this.cache.keys().next().value!);
          this.renderedTiles++;
          this.lastError = "";
          work.resolve(image);
        } catch (error) {
          if (!work.request?.cancelled && !this.closed)
            this.lastError = String(error);
          work.reject(error instanceof Error ? error : Error(String(error)));
        }
        this.requestRender();
      }
    } finally {
      this.busy = false;
      if (this.resetRenderer) this.releaseRenderer();
      this.requestRender();
    }
  }
  dispose() {
    this.closed = true;
    this.cancelRender?.();
    for (const work of this.queue.splice(0))
      work.reject(Error("Street map closed"));
    this.releaseRenderer();
    this.cache.clear();
  }
}
