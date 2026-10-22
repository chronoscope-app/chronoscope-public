import type { MapLayer, Preferences, Bounds, Raster } from "./types";
import { RasterStream } from "./raster-stream";
/** Explicit None migration: old workspaces still use their original single map. */
export function mapLayers(preferences: Preferences): MapLayer[] {
  return (
    preferences.map_layers ?? [
      {
        id: "legacy-map",
        name: preferences.map.layer || "Map",
        server_name: "WMTS",
        config: preferences.map,
        opacity: 1,
        min_zoom: 0,
        max_zoom: 30,
      },
    ]
  );
}
export function layerVisible(layer: MapLayer, zoom: number): boolean {
  return (
    layer.config.enabled &&
    layer.opacity > 0 &&
    zoom >= layer.min_zoom &&
    zoom < layer.max_zoom
  );
}
/** Compose ordered sources in one bounded viewport texture, before terrain/globe draping. */
export class MapStack {
  readonly streams = new Map<string, RasterStream>();
  readonly canvas: HTMLCanvasElement;
  readonly result: Raster;
  private context: CanvasRenderingContext2D;
  constructor(
    readonly layers: MapLayer[],
    bounds: Bounds,
    pixels: number,
    previous?: MapStack,
  ) {
    // Limit aggregate CPU canvases to ~32 megapixels; GPU still sees one mosaic.
    const maxSize = Math.min(
      4096,
      2 **
        Math.floor(
          Math.log2(Math.sqrt((32 * 1024 * 1024) / (layers.length + 1))),
        ),
    );
    for (const layer of layers)
      this.streams.set(layer.id, new RasterStream(bounds, pixels, maxSize));
    if (previous)
      for (const layer of layers) {
        const oldLayer = previous.layers.find((l) => l.id === layer.id);
        const oldStream = previous.streams.get(layer.id);
        if (
          oldStream &&
          oldLayer &&
          JSON.stringify(oldLayer.config) === JSON.stringify(layer.config)
        )
          this.streams.get(layer.id)!.seed(oldStream);
      }
    const first = this.streams.values().next().value!;
    this.canvas = document.createElement("canvas");
    this.canvas.width = first.canvas.width;
    this.canvas.height = first.canvas.height;
    this.context = this.canvas.getContext("2d")!;
    this.result = {
      ...first.result,
      tiles: [{ ...first.result.tiles[0], image: this.canvas }],
      attribution: "",
    };
  }
  compose() {
    const c = this.context;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const layer of this.layers) {
      c.globalAlpha = layer.opacity;
      c.drawImage(this.streams.get(layer.id)!.canvas, 0, 0);
    }
    c.globalAlpha = 1;
    const results = [...this.streams.values()].map((s) => s.result);
    this.result.attribution = [
      ...new Set(results.map((r) => r.attribution).filter(Boolean)),
    ].join(" · ");
    this.result.requests = Math.max(...results.map((r) => r.requests));
    this.result.cache_hits = Math.max(...results.map((r) => r.cache_hits));
  }
}
