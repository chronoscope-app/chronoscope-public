import {
  Event,
  GeographicTilingScheme,
  Rectangle,
  type ImageryProvider,
} from "cesium";

/** Direct canvas imagery: avoid PNG encoding, data-URL copies and image decode
 * for every animated heatmap. Cesium still drapes it over its terrain mesh. */
export class CanvasAtlasProvider implements ImageryProvider {
  readonly rectangle: Rectangle;
  readonly tilingScheme: GeographicTilingScheme;
  readonly minimumLevel = 0;
  readonly maximumLevel = 0;
  readonly hasAlphaChannel = true;
  readonly errorEvent = new Event();
  readonly tileDiscardPolicy: ImageryProvider["tileDiscardPolicy"] = undefined!;
  readonly proxy: ImageryProvider["proxy"] = undefined!;
  readonly credit: ImageryProvider["credit"] = undefined!;
  constructor(
    private canvas: HTMLCanvasElement,
    bounds: number[],
  ) {
    this.rectangle = Rectangle.fromDegrees(
      bounds[0],
      bounds[1],
      bounds[2],
      bounds[3],
    );
    this.tilingScheme = new GeographicTilingScheme({
      rectangle: this.rectangle,
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1,
    });
  }
  get tileWidth() {
    return this.canvas.width;
  }
  get tileHeight() {
    return this.canvas.height;
  }
  requestImage(_x: number, _y: number, _level: number) {
    return Promise.resolve(this.canvas);
  }
  getTileCredits() {
    return [];
  }
  pickFeatures() {
    return undefined;
  }
}
