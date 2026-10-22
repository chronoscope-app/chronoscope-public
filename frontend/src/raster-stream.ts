import type { Raster } from "./types";
import { latitudeAt } from "./geographic";
const R = 6378137;
const y = (latitude: number) =>
  R * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
/** One viewport canvas, independent of the number of provider tiles. Tile data
 * URLs are released after compositing; the disk cache retains reusable data. */
export class RasterStream {
  readonly canvas = document.createElement("canvas");
  readonly result: Raster;
  private context: CanvasRenderingContext2D;
  constructor(
    readonly bounds: number[],
    pixels: number,
    maxSize = 4096,
  ) {
    const aspect =
      ((((bounds[2] - bounds[0]) * Math.PI) / 180) * R) /
      (y(bounds[3]) - y(bounds[1]));
    const size = Math.min(
      maxSize,
      Math.max(512, 2 ** Math.ceil(Math.log2(Math.max(1, pixels)))),
    );
    this.canvas.width =
      aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
    this.canvas.height =
      aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
    this.context = this.canvas.getContext("2d")!;
    this.result = {
      tiles: [
        {
          request: {
            bounds: [...bounds],
            row: 0,
            col: 0,
            matrix: "viewport",
            geographic: false,
          },
          data_url: "",
          image: this.canvas,
          cache_hit: false,
        },
      ],
      requests: 0,
      cache_hits: 0,
      attribution: "",
    };
  }
  /** Reproject a bounded prior viewport canvas into this viewport in Mercator. */
  seed(previous: RasterStream) {
    const b = previous.bounds,
      target = this.bounds;
    const width = target[2] - target[0],
      height = y(target[3]) - y(target[1]);
    this.context.drawImage(
      previous.canvas,
      ((b[0] - target[0]) / width) * this.canvas.width,
      ((y(target[3]) - y(b[3])) / height) * this.canvas.height,
      ((b[2] - b[0]) / width) * this.canvas.width,
      ((y(b[3]) - y(b[1])) / height) * this.canvas.height,
    );
    this.result.attribution = previous.result.attribution;
  }
  async append(page: Raster, current: () => boolean) {
    const west = ((this.bounds[0] * Math.PI) / 180) * R,
      south = y(this.bounds[1]),
      north = y(this.bounds[3]);
    const width = (((this.bounds[2] - this.bounds[0]) * Math.PI) / 180) * R;
    for (const tile of page.tiles) {
      if (!current()) return;
      const image = new Image();
      image.src = tile.data_url;
      await image.decode();
      if (!current()) {
        image.src = "";
        return;
      }
      const b = tile.request.bounds,
        x = ((((b[0] * Math.PI) / 180) * R - west) / width) * this.canvas.width;
      const top = ((north - y(b[3])) / (north - south)) * this.canvas.height;
      const w =
        (((((b[2] - b[0]) * Math.PI) / 180) * R) / width) * this.canvas.width;
      const h = ((y(b[3]) - y(b[1])) / (north - south)) * this.canvas.height;
      // A transparent replacement must erase the older pixels of this layer.
      this.context.clearRect(x, top, w, h);
      if (tile.request.geographic) {
        // Row-reproject geographic pixels into the same Mercator viewport used
        // by terrain and flat maps. Never stretch latitude-linear rows.
        const first = Math.max(0, Math.floor(top)),
          last = Math.min(this.canvas.height, Math.ceil(top + h));
        for (let row = first; row < last; row++) {
          const lat = latitudeAt(
            this.bounds[3],
            this.bounds[1],
            (row + 0.5) / this.canvas.height,
            true,
          );
          const sourceY = Math.max(
            0,
            Math.min(
              image.height - 1,
              ((b[3] - lat) / (b[3] - b[1])) * image.height - 0.5,
            ),
          );
          this.context.drawImage(
            image,
            0,
            sourceY,
            image.width,
            1,
            x,
            row,
            w,
            1,
          );
        }
      } else this.context.drawImage(image, x, top, w, h);
      image.src = "";
      tile.data_url = "";
    }
    this.result.requests = page.requests;
    this.result.cache_hits = page.cache_hits;
    this.result.attribution = page.attribution;
    this.result.total_tiles = page.total_tiles;
    this.result.next_offset = page.next_offset;
  }
}
