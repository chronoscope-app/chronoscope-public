import { Resource } from "cesium";
import { call } from "./bridge";

const origin = "https://chronoscope-gis.invalid";
const maximumCache = 64 * 1024 * 1024;
const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();
let cachedBytes = 0;
let active = 0;
const waiting: (() => void)[] = [];
async function permit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
export function clearGisCache(id: string) {
  for (const [key, bytes] of cache)
    if (key.startsWith(id + "/")) {
      cachedBytes -= bytes.byteLength;
      cache.delete(key);
    }
}
/** Public Resource extension; no private Cesium hooks, local HTTP server or file:// permissions. */
export class GisResource extends Resource {
  constructor(
    readonly layerId: string,
    name: string,
    readonly alive: () => boolean,
    readonly wake: () => void = () => {},
  ) {
    super({
      url: `${origin}/${layerId}/${name.split("/").map(encodeURIComponent).join("/")}`,
    });
  }
  override clone(_result?: Resource): GisResource {
    const r = new GisResource(this.layerId, this.name, this.alive, this.wake);
    r.url = this.url;
    return r;
  }
  private get name() {
    const url = new URL(this.url);
    if (url.origin !== origin || !url.pathname.startsWith(`/${this.layerId}/`))
      throw Error("GIS resources must remain inside their local package");
    return url.pathname
      .slice(this.layerId.length + 2)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  }
  override getDerivedResource(options: any): Resource {
    const url = new URL(options.url || "", this.url);
    if (url.protocol === "data:" || url.protocol === "blob:")
      return new Resource(url.href);
    if (url.origin !== origin || !url.pathname.startsWith(`/${this.layerId}/`))
      throw Error(
        "External GIS links are disabled. Add the linked file explicitly.",
      );
    const resource = this.clone();
    resource.url = url.href;
    return resource;
  }
  private async bytes(): Promise<Uint8Array> {
    if (!this.alive()) throw Error("GIS layer unloaded");
    const key = this.layerId + "/" + this.name;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    if (pending.has(key)) return pending.get(key)!;
    const promise = permit(async () => {
      let result: Uint8Array | undefined;
      let offset = 0;
      do {
        if (!this.alive()) throw Error("GIS layer unloaded");
        const part = await call("gis_read", {
          id: this.layerId,
          resource: this.name,
          offset,
          limit: 1024 * 1024,
        });
        if (!result) result = new Uint8Array(part.total);
        if (part.offset !== offset || part.total !== result.length)
          throw Error("GIS resource changed during loading");
        const bytes = Uint8Array.from(atob(part.data), (c) => c.charCodeAt(0));
        if (!bytes.length && offset < result.length)
          throw Error("Incomplete GIS resource");
        result.set(bytes, offset);
        offset += bytes.length;
      } while (offset < result.length);
      if (result.byteLength <= 8 * 1024 * 1024 && this.alive()) {
        while (cache.size && cachedBytes + result.byteLength > maximumCache) {
          const first = cache.keys().next().value!;
          cachedBytes -= cache.get(first)!.byteLength;
          cache.delete(first);
        }
        cache.set(key, result);
        cachedBytes += result.byteLength;
      }
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  override fetchArrayBuffer(): any {
    return this.bytes()
      .then((b) => b.slice().buffer)
      .finally(() => setTimeout(this.wake, 0));
  }
  override fetchText(): any {
    return this.bytes()
      .then((b) => new TextDecoder("utf-8", { fatal: true }).decode(b))
      .finally(() => setTimeout(this.wake, 0));
  }
  override fetchJson(): any {
    return this.fetchText().then((s: string) => JSON.parse(s));
  }
  override fetchBlob(): any {
    return this.bytes().then(
      (b) => new Blob([b.slice().buffer], { type: mime(this.name) }),
    );
  }
  override fetchImage(): any {
    return this.fetchBlob().then(
      (blob: Blob) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(blob),
            image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
            setTimeout(this.wake, 0);
          };
          image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(Error("Invalid GIS image resource"));
          };
          image.src = url;
        }),
    );
  }
  override fetch(options?: any): any {
    switch (options?.responseType) {
      case "arraybuffer":
        return this.fetchArrayBuffer();
      case "blob":
        return this.fetchBlob();
      case "json":
        return this.fetchJson();
      case "document":
        return this.fetchText().then((s: string) =>
          new DOMParser().parseFromString(s, "application/xml"),
        );
      default:
        return this.fetchText();
    }
  }
  override fetchJsonp(): any {
    return Promise.reject(Error("GIS JSONP/network links are disabled"));
  }
}
function mime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        svg: "image/svg+xml",
        webp: "image/webp",
        gif: "image/gif",
      } as Record<string, string>
    )[ext || ""] || "application/octet-stream"
  );
}
