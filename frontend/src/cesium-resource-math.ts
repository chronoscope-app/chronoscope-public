import type { Terrain } from "./types";

export type TerrainDatum = "egm96" | "ellipsoid" | "unresolved-msl";
export const GEOID_WIDTH = 1440;
export const GEOID_HEIGHT = 721;
const DEG = Math.PI / 180;
export const mercatorNorthing = (lat: number) =>
  Math.log(
    Math.tan(
      Math.PI / 4 + (Math.max(-89.999999, Math.min(89.999999, lat)) * DEG) / 2,
    ),
  );

/** NGA EGM96 15-minute undulations N, bilinear and periodic in longitude.
 * Storage rows run south to north. h(ellipsoid) = H(orthometric) + N. */
export function geoidUndulation(grid: Int16Array, lat: number, lon: number) {
  if (
    grid.length !== GEOID_WIDTH * GEOID_HEIGHT ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90
  )
    throw new Error("Invalid EGM96 grid or geographic position");
  const x = ((((lon + 180) % 360) + 360) % 360) * 4,
    y = (lat + 90) * 4,
    x0 = Math.floor(x) % GEOID_WIDTH,
    x1 = (x0 + 1) % GEOID_WIDTH,
    y0 = Math.min(GEOID_HEIGHT - 1, Math.floor(y)),
    y1 = Math.min(y0 + 1, GEOID_HEIGHT - 1),
    fx = x - Math.floor(x),
    fy = y - y0;
  return (
    ((grid[y0 * GEOID_WIDTH + x0] * (1 - fx) +
      grid[y0 * GEOID_WIDTH + x1] * fx) *
      (1 - fy) +
      (grid[y1 * GEOID_WIDTH + x0] * (1 - fx) +
        grid[y1 * GEOID_WIDTH + x1] * fx) *
        fy) /
    100
  );
}

export function validateTerrain(t: Terrain) {
  if (
    !Array.isArray(t.bounds) ||
    t.bounds.length !== 4 ||
    !t.bounds.every(Number.isFinite) ||
    t.bounds[0] >= t.bounds[2] ||
    t.bounds[1] >= t.bounds[3] ||
    t.bounds[0] < -180 ||
    t.bounds[2] > 180 ||
    t.bounds[1] <= -90 ||
    t.bounds[3] >= 90 ||
    !Number.isInteger(t.width) ||
    !Number.isInteger(t.height) ||
    t.width < 2 ||
    t.height < 2 ||
    t.width > 2049 ||
    t.height > 2049 ||
    t.elevations.length !== t.width * t.height ||
    t.elevations.some(
      (n) => n !== null && (!Number.isFinite(n) || Math.abs(n) > 100000),
    )
  )
    throw new Error("Invalid terrain grid; previous terrain retained");
}

/** Rust terrain_mesh rows are uniform in Web Mercator, NOT latitude.
 * Bilinear interpolation rejects every positive-weight void; it never invents
 * heights by renormalising the remaining corners. Exact valid posts survive. */
export function sampleTerrain(
  t: Terrain,
  lat: number,
  lon: number,
): number | null {
  const b = t.bounds;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lon < b[0] - 1e-10 ||
    lon > b[2] + 1e-10 ||
    lat < b[1] - 1e-10 ||
    lat > b[3] + 1e-10
  )
    return null;
  const x = Math.max(
      0,
      Math.min(t.width - 1, ((lon - b[0]) / (b[2] - b[0])) * (t.width - 1)),
    ),
    y = Math.max(
      0,
      Math.min(
        t.height - 1,
        ((mercatorNorthing(b[3]) - mercatorNorthing(lat)) /
          (mercatorNorthing(b[3]) - mercatorNorthing(b[1]))) *
          (t.height - 1),
      ),
    ),
    x0 = Math.min(Math.floor(x), t.width - 2),
    y0 = Math.min(Math.floor(y), t.height - 2),
    fx = x - x0,
    fy = y - y0;
  let value = 0;
  for (const [i, w] of [
    [y0 * t.width + x0, (1 - fx) * (1 - fy)],
    [y0 * t.width + x0 + 1, fx * (1 - fy)],
    [(y0 + 1) * t.width + x0, (1 - fx) * fy],
    [(y0 + 1) * t.width + x0 + 1, fx * fy],
  ]) {
    if (w < 1e-12) continue;
    const v = t.elevations[i];
    if (v === null) return null;
    value += v * w;
  }
  return value;
}

/** Geometry refinement floor from the source grid resolution, not an arbitrary
 * camera zoom. This caps subdivision beyond the available DTED sample detail. */
export function terrainMaximumLevel(t: Terrain, tileSamples = 32) {
  const lonPost = (t.bounds[2] - t.bounds[0]) / (t.width - 1),
    latPost = (t.bounds[3] - t.bounds[1]) / (t.height - 1);
  return Math.min(
    22,
    Math.max(
      0,
      Math.ceil(
        Math.log2(
          Math.max(
            180 / (tileSamples * lonPost),
            180 / (tileSamples * latPost),
          ),
        ),
      ),
    ),
  );
}
