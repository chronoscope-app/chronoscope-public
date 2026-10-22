import {
  GeoJsonDataSource,
  KmlDataSource,
  CzmlDataSource,
  GpxDataSource,
  Cesium3DTileset,
  Model,
  Transforms,
  Cartesian3,
  JulianDate,
  Color,
  CustomDataSource,
  ConstantProperty,
  Resource,
  HeadingPitchRange,
  BoundingSphere,
  Rectangle,
  type DataSource,
  type Entity,
  type Viewer,
} from "cesium";
import type { EngineContracts } from "./contracts";
import { GisResource, clearGisCache } from "./gis-resource";
export type GisLayer = Exclude<
  EngineContracts["gis_load"]["result"],
  { dry_run: true }
>["layer"];
export type GisFeature = Exclude<
  EngineContracts["gis_table"]["result"],
  { dry_run: true }
>["rows"][number];
type NativeLayer = {
  descriptor: GisLayer;
  object: DataSource | Cesium3DTileset | Model;
  primitive: boolean;
  features: Map<string, Entity[]>;
};
const isSource = (object: NativeLayer["object"]): object is DataSource =>
  "entities" in object;
function xml(text: string, kml: boolean) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw Error("Invalid GIS XML");
  // Native descriptions are unused (our attribute inspector escapes text).
  // Remove rich text before the loaders' HTML processing so source strings
  // cannot create DOM requests or active markup, even in detached elements.
  for (const name of kml
    ? ["description", "BalloonStyle", "ExtendedData"]
    : ["desc", "cmt", "link", "src", "type", "number"])
    for (const node of Array.from(document.getElementsByTagNameNS("*", name)))
      node.remove();
  if (!kml)
    for (const node of Array.from(document.getElementsByTagNameNS("*", "time")))
      if (
        !/^\d{4}-\d{2}-\d{2}T/.test(node.textContent || "") ||
        !Number.isFinite(Date.parse(node.textContent || ""))
      )
        node.remove();
  if (!kml) {
    let point = 0,
      track = 0,
      route = 0;
    for (const node of Array.from(document.getElementsByTagNameNS("*", "*"))) {
      const kind = node.localName;
      if (["wpt", "rtept", "trkpt"].includes(kind)) {
        point++;
        if (kind === "wpt" && !node.getAttribute("id"))
          node.setAttribute("id", String(point));
      } else if (kind === "trk" || kind === "rte") {
        const count = kind === "trk" ? ++track : ++route;
        if (!node.getAttribute("id"))
          node.setAttribute("id", `_chronoscope_${kind}_${count}`);
      }
    }
  }
  if (kml) {
    const seen = new Set<string>();
    for (const [index, node] of Array.from(
      document.getElementsByTagNameNS("*", "Placemark"),
    ).entries()) {
      let id = node.getAttribute("id") || String(index + 1);
      if (seen.has(id)) id += `/row/${index + 1}`;
      seen.add(id);
      node.setAttribute("id", id);
    }
    // No autonomous polling or outbound links from an imported local document.
    for (const node of Array.from(
      document.getElementsByTagNameNS("*", "NetworkLink"),
    ))
      node.remove();
    for (const node of [
      ...Array.from(document.getElementsByTagNameNS("*", "href")),
      ...Array.from(document.getElementsByTagNameNS("*", "styleUrl")),
    ]) {
      const value = node.textContent?.trim() || "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("data:"))
        node.textContent = "";
    }
  }
  return document;
}
/** Native loader lifecycle, bounded tile cache, resource isolation and explicit model placement. */
export class GisLayers {
  descriptors: GisLayer[] = [];
  readonly loaded = new Map<string, NativeLayer>();
  readonly errors = new Map<string, string>();
  private nativeIds = new Map<string, Map<string, string>>();
  private loading = new Map<string, Promise<void>>();
  private selection = new CustomDataSource("GIS selection");
  private disposed = false;
  onError: (id: string, message: string) => void = () => {};
  constructor(readonly viewer: Viewer) {
    void viewer.dataSources.add(this.selection);
  }
  private signature(layer: GisLayer) {
    return JSON.stringify([layer.sha256, layer.position, layer.scale]);
  }
  private current(id: string, signature: string) {
    return (
      !this.disposed &&
      this.descriptors.some(
        (l) => l.id === id && l.enabled && this.signature(l) === signature,
      )
    );
  }
  async sync(layers: GisLayer[]) {
    if (this.disposed) return;
    this.descriptors = layers.map((l) => structuredClone(l));
    const wanted = new Map(layers.map((l) => [l.id, l]));
    for (const [id, entry] of this.loaded) {
      const layer = wanted.get(id);
      if (!layer || this.signature(layer) !== this.signature(entry.descriptor))
        this.remove(id);
      else {
        entry.descriptor = layer;
        entry.object.show = layer.enabled;
      }
    }
    for (const layer of layers) {
      if (
        !layer.enabled ||
        this.loaded.has(layer.id) ||
        this.errors.has(layer.id)
      )
        continue;
      const loadKey = layer.id + ":" + this.signature(layer);
      let load = this.loading.get(loadKey);
      if (!load) {
        load = this.load(layer)
          .catch((error) => {
            if (this.current(layer.id, this.signature(layer))) {
              const message = String(error?.message || error);
              this.errors.set(layer.id, message);
              this.onError(layer.id, message);
            }
          })
          .finally(() => this.loading.delete(loadKey));
        this.loading.set(loadKey, load);
      }
      await load;
    }
    this.selection.entities.removeAll();
    for (const layer of layers)
      if (layer.enabled && layer.selected?.length)
        this.highlight(layer.id, layer.selected, false);
    this.viewer.scene.requestRender();
  }
  private async load(layer: GisLayer) {
    const signature = this.signature(layer);
    const resource = new GisResource(
      layer.id,
      layer.entrypoint,
      () => this.current(layer.id, signature),
      () => {
        if (!this.disposed && !this.viewer.isDestroyed())
          this.viewer.scene.requestRender();
      },
    );
    let object: NativeLayer["object"];
    if (layer.format === "geojson" || layer.format === "topojson") {
      const json = await resource.fetchJson();
      // URLs embedded in simplestyle properties are not permitted to bypass the local adapter.
      const scrub = (value: any) => {
        if (!value || typeof value !== "object") return;
        if (value.properties && typeof value.properties === "object")
          delete value.properties["marker-url"];
        if (Array.isArray(value.features)) value.features.forEach(scrub);
      };
      scrub(json);
      // Supply deterministic reference IDs when the source omits them, matching
      // the Rust attribute reader; never use random runtime IDs for these rows.
      const seen = new Set<string>();
      const assign = (feature: any, fallback: string, index: number) => {
        let id = feature.id == null ? fallback : String(feature.id);
        if (!id) id = fallback;
        if (seen.has(id)) id += `/row/${index + 1}`;
        seen.add(id);
        feature.id = id;
        feature.properties = {
          ...feature.properties,
          _chronoscope_source_feature_id: id,
        };
      };
      if (layer.format === "topojson") {
        let index = 0;
        for (const [name, object] of Object.entries(json.objects) as [
          string,
          any,
        ][])
          for (const [i, geometry] of (object.type === "GeometryCollection"
            ? object.geometries
            : [object]
          ).entries())
            assign(geometry, `${name}/${i + 1}`, index++);
      } else if (json.type === "FeatureCollection")
        json.features.forEach((f: any, i: number) =>
          assign(f, String(i + 1), i),
        );
      else if (json.type === "Feature") assign(json, "1", 0);
      const source =
        layer.format === "geojson" &&
        json.type !== "Feature" &&
        json.type !== "FeatureCollection"
          ? {
              type: "Feature",
              id: "1",
              properties: { _chronoscope_source_feature_id: "1" },
              geometry: json,
            }
          : json;
      object = await GeoJsonDataSource.load(source, {
        sourceUri: layer.entrypoint,
        stroke: Color.CYAN,
        fill: Color.CYAN.withAlpha(0.25),
        strokeWidth: 2,
        markerSize: 24,
        clampToGround: false,
      });
    } else if (layer.format === "czml") {
      const json = await resource.fetchJson();
      // Stock CZML supports Resource as sourceUri at runtime; declarations narrow it to string.
      object = await CzmlDataSource.load(json, { sourceUri: resource as any });
    } else if (layer.format === "gpx") {
      const document = xml(await resource.fetchText(), false),
        index = new Map<string, string>();
      let ordinal = 0;
      for (const node of Array.from(
        document.getElementsByTagNameNS("*", "*"),
      )) {
        if (!["wpt", "trkpt", "rtept"].includes(node.localName)) continue;
        ordinal++;
        let parent: Element | null = node;
        while (parent && !["wpt", "trk", "rte"].includes(parent.localName))
          parent = parent.parentElement;
        if (parent)
          index.set(
            String(ordinal),
            parent.getAttribute("id") || String(ordinal),
          );
      }
      this.nativeIds.set(layer.id, index);
      object = await GpxDataSource.load(document, { clampToGround: false });
    } else if (layer.format === "kml" || layer.format === "kmz") {
      object = await KmlDataSource.load(xml(await resource.fetchText(), true), {
        camera: this.viewer.camera,
        canvas: this.viewer.canvas,
        sourceUri: resource as any,
        clampToGround: false,
      });
    } else if (layer.format === "tiles3d") {
      object = await Cesium3DTileset.fromUrl(resource, {
        maximumScreenSpaceError: 16,
        projectTo2D: true,
        cacheBytes: 256 * 1024 * 1024,
        maximumCacheOverflowBytes: 128 * 1024 * 1024,
      });
      object.loadProgress.addEventListener(() =>
        this.viewer.scene.requestRender(),
      );
      object.tileFailed.addEventListener((failure) => {
        const message = String(failure.message);
        this.errors.set(layer.id, message);
        this.onError(layer.id, message);
      });
    } else {
      if (!layer.position) throw Error("Choose a WGS84 model location first");
      object = await Model.fromGltfAsync({
        url: resource,
        modelMatrix: Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(...layer.position),
        ),
        scale: layer.scale,
        projectTo2D: true,
        incrementallyLoadTextures: false,
        id: { kind: "gis", layer: layer.id, id: "model" },
      });
    }
    if (!this.current(layer.id, signature)) {
      if ("destroy" in object) object.destroy();
      return;
    }
    const primitive = !isSource(object),
      features = new Map<string, Entity[]>();
    if (isSource(object)) {
      object.show = layer.enabled;
      for (const entity of object.entities.values) {
        const jsonSource =
          layer.format === "geojson" || layer.format === "topojson";
        const id = jsonSource
          ? entity.properties?.getValue(this.viewer.clock.currentTime)
              ?._chronoscope_source_feature_id || entity.id
          : entity.id;
        (entity as any).__chronoscopeGis = { kind: "gis", layer: layer.id, id };
        if (!features.has(id)) features.set(id, []);
        features.get(id)!.push(entity);
        if (jsonSource)
          entity.properties?.removeProperty("_chronoscope_source_feature_id");
      }
      object.errorEvent.addEventListener((_source: unknown, error: unknown) =>
        this.onError(layer.id, String(error)),
      );
      await this.viewer.dataSources.add(object);
    } else {
      object.show = layer.enabled;
      this.viewer.scene.primitives.add(object);
    }
    this.loaded.set(layer.id, {
      descriptor: layer,
      object,
      primitive,
      features,
    });
    this.errors.delete(layer.id);
    this.viewer.scene.requestRender();
  }
  setTime(seconds: number) {
    if (!Number.isFinite(seconds) || this.viewer.isDestroyed()) return;
    this.viewer.clock.shouldAnimate = false;
    this.viewer.clock.currentTime = JulianDate.fromDate(
      new Date(seconds * 1000),
    );
  }
  currentTime() {
    return JulianDate.toDate(this.viewer.clock.currentTime).getTime() / 1000;
  }
  async fit(id: string) {
    const entry = this.loaded.get(id);
    if (!entry) return;
    if (entry.descriptor.time_bounds) {
      const start = isSource(entry.object)
        ? entry.object.clock?.startTime
        : null;
      this.setTime(
        start
          ? JulianDate.toDate(start).getTime() / 1000
          : entry.descriptor.time_bounds[0],
      );
    }
    if (isSource(entry.object)) {
      if (entry.descriptor.bounds) {
        const [w, s, e, n] = entry.descriptor.bounds;
        const width = Math.max(0.01, e - w),
          height = Math.max(0.01, n - s);
        this.viewer.camera.flyTo({
          destination: Rectangle.fromDegrees(
            Math.max(-180, w - width * 0.15),
            Math.max(-90, s - height * 0.15),
            Math.min(180, e + width * 0.15),
            Math.min(90, n + height * 0.15),
          ),
          duration: 0,
        });
      } else await this.viewer.zoomTo(entry.object);
    } else {
      const model = entry.object instanceof Model ? entry.object : null;
      if (model && !model.ready)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            remove();
            reject(Error("Model is still loading; try Fit again"));
          }, 15000);
          const remove = model!.readyEvent.addEventListener(() => {
            clearTimeout(timer);
            remove();
            resolve();
          });
          this.viewer.scene.requestRender();
        });
      const sphere = entry.object.boundingSphere;
      this.viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0,
        offset: new HeadingPitchRange(
          0,
          -Math.PI / 3,
          Math.max(20, sphere.radius * 3),
        ),
      });
    }
    this.viewer.scene.requestRender();
  }
  pick(hit: any): { kind: "gis"; layer: string; id: string } | undefined {
    const entity =
      hit?.id?.__chronoscopeGis ||
      (hit?.id?.kind === "gis" ? hit.id : undefined);
    if (entity) return entity;
    for (const [id, entry] of this.loaded)
      if (
        entry.primitive &&
        (hit?.primitive === entry.object || hit?.tileset === entry.object)
      )
        return {
          kind: "gis",
          layer: id,
          id: String(hit?.featureId ?? "model"),
        };
    return undefined;
  }
  properties(layerId: string, id: string): Record<string, unknown> {
    const source = this.loaded.get(layerId)?.object;
    if (!source || !isSource(source)) return {};
    const entity = source.entities.getById(id);
    return (
      entity?.properties?.getValue(this.viewer.clock.currentTime) || {
        name: entity?.name || id,
      }
    );
  }
  highlight(layerId: string, ids: string[], clear = true) {
    if (clear) this.selection.entities.removeAll();
    const entry = this.loaded.get(layerId);
    if (!entry || !isSource(entry.object)) return;
    const seen = new Set<string>();
    for (const id of ids.slice(0, 1000)) {
      let nativeId = this.nativeIds.get(layerId)?.get(id) || id;
      while (!entry.features.has(nativeId) && nativeId.includes("/"))
        nativeId = nativeId.slice(0, nativeId.lastIndexOf("/"));
      for (const entity of entry.features.get(nativeId) || []) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        const selected = this.selection.entities.add({
          id: "selection:" + layerId + ":" + entity.id,
        });
        selected.availability = entity.availability;
        selected.position = entity.position;
        if (entity.position)
          selected.point = {
            pixelSize: 15,
            color: Color.TRANSPARENT,
            outlineColor: Color.YELLOW,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          } as any;
        if (entity.polygon) {
          selected.polygon = entity.polygon.clone();
          selected.polygon.material = Color.YELLOW.withAlpha(0.25) as any;
          selected.polygon.outline = new ConstantProperty(true);
          selected.polygon.outlineColor = new ConstantProperty(Color.YELLOW);
        }
        if (entity.polyline) {
          selected.polyline = entity.polyline.clone();
          selected.polyline.material = Color.YELLOW as any;
          selected.polyline.width = new ConstantProperty(4);
        }
      }
    }
    this.viewer.scene.requestRender();
  }
  remove(id: string) {
    const entry = this.loaded.get(id);
    if (entry) {
      if (entry.primitive) this.viewer.scene.primitives.remove(entry.object);
      else this.viewer.dataSources.remove(entry.object as DataSource, true);
    }
    this.loaded.delete(id);
    this.nativeIds.delete(id);
    this.errors.delete(id);
    clearGisCache(id);
    this.selection.entities.removeAll();
  }
  retry(id: string) {
    this.errors.delete(id);
  }
  dispose() {
    this.disposed = true;
    for (const id of [...this.loaded.keys()]) this.remove(id);
    if (!this.viewer.isDestroyed())
      this.viewer.dataSources.remove(this.selection, true);
  }
}
