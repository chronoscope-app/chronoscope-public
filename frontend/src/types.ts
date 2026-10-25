import type { GisLayer } from "./gis";
export interface Snapshot {
  workspace_id: string;
  field_roles?: import("./field-roles").FieldRoles;
  gis_layers?: GisLayer[];
  lifecycle?: {
    dirty: boolean;
    source: string | null;
    checkpoint_revision: number | null;
    recovery_error: string | null;
  };
  layers: {
    source: string;
    count: number;
    visible: number;
    enabled: boolean;
  }[];
  scene: any;
  time_resolution: string;
  revision: number;
  name: string;
  count: number;
  visible: number;
  selected: string[];
  selected_count: number;
  selected_entities: Record<string, number>;
  facets?: Record<
    string,
    {
      field: string;
      counts: Record<string, number>;
      selected: Record<string, number>;
      limited: boolean;
    }
  >;
  selection_limited: boolean;
  entities: Record<string, number>;
  categories: Record<string, number>;
  time_bounds: [number, number];
  histogram: number[];
  selected_histogram: number[];
  filter: Filter;
  preferences: Preferences;
  views: any[];
  groups: any[];
  undo: number;
  redo: number;
  stats: Record<string, number>;
}
export interface Filter {
  start: number | null;
  end: number | null;
  hidden_entities: string[];
  hidden_categories: string[];
  hidden_sources: string[];
  facet_fields?: Record<string, string>;
  facet_hidden?: Record<string, string[]>;
  search: string;
  predicates: any[];
  selected_only: boolean;
  bounds: any;
  located_only: boolean;
}
export interface Preferences {
  basemap: "streets" | "none";
  auto_save_unsaved: boolean;
  theme: "dark" | "light" | "system";
  coordinates: "dd" | "utm" | "mgrs";
  map: MapConfig;
  map_layers?: MapLayer[] | null;
  terrain_path: string | null;
  terrain_builtin: boolean;
  terrain_exaggeration: number;
  terrain_vertical_datum: "unresolved-msl" | "egm96" | "ellipsoid";
}
export interface MapLayer {
  id: string;
  name: string;
  server_name: string;
  config: MapConfig;
  opacity: number;
  min_zoom: number;
  max_zoom: number;
}
export interface MapConfig {
  level?: number | null;
  url: string;
  layer: string;
  matrix_set: string;
  style: string;
  format: string;
  time: string;
  enabled: boolean;
}
export interface Packed {
  inferred_ids?: string[];
  centroid_ids?: string[];
  unlocated_count?: number;
  inferred_markers?: any[];
  lod: boolean;
  rendered_count: number;
  located_count: number;
  revision: number;
  stride: number;
  data: string;
  ids: string[];
  entities: string[];
}
export interface Point {
  inferred?: boolean;
  centroid?: boolean;
  id: string;
  entity: number;
  lon: number;
  lat: number;
  time: number;
  value: number;
}
export interface Terrain {
  geographic?: boolean;
  attribution?: string | null;
  bounds: number[];
  width: number;
  height: number;
  elevations: (number | null)[];
  minimum: number;
  maximum: number;
  covered: number;
  tiles: number;
}
export interface Raster {
  total_tiles?: number;
  next_offset?: number | null;
  tiles: {
    request: {
      bounds: number[];
      row: number;
      col: number;
      matrix: string;
      geographic?: boolean;
    };
    data_url: string;
    image?: HTMLCanvasElement;
    cache_hit: boolean;
  }[];
  requests: number;
  cache_hits: number;
  attribution: string;
}
export function decode(p: Packed): Point[] {
  const invalid = () => {
    throw new Error("Invalid render packet; previous scene retained");
  };
  if (
    !p ||
    p.stride !== 32 ||
    !Array.isArray(p.ids) ||
    p.ids.length > 100000 ||
    p.rendered_count !== p.ids.length ||
    !Array.isArray(p.entities) ||
    p.entities.length > 100000 ||
    p.entities.some((name) => typeof name !== "string") ||
    typeof p.data !== "string"
  )
    return invalid();
  const ids = new Set<string>();
  for (const id of p.ids) {
    if (
      typeof id !== "string" ||
      !/^(0|[1-9][0-9]{0,19})$/.test(id) ||
      (id.length === 20 && id > "18446744073709551615") ||
      ids.has(id)
    )
      return invalid();
    ids.add(id);
  }
  const expected = p.ids.length * 32,
    padding = p.data.endsWith("==") ? 2 : p.data.endsWith("=") ? 1 : 0;
  if (
    p.data.length !== 4 * Math.ceil(expected / 3) ||
    p.data.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(p.data) ||
    p.data.slice(0, p.data.length - padding).includes("=")
  )
    return invalid();
  let raw: string;
  try {
    raw = atob(p.data);
  } catch {
    return invalid();
  }
  if (raw.length !== expected) return invalid();
  const bytes = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) bytes[i] = raw.charCodeAt(i);
  const view = new DataView(bytes.buffer),
    inferred = new Set(p.inferred_ids || []),
    centroids = new Set(p.centroid_ids || []);
  for (const id of centroids) if (!ids.has(id)) return invalid();
  for (const id of inferred) if (!ids.has(id)) return invalid();
  const result: Point[] = [];
  for (let i = 0; i < p.ids.length; i++) {
    const o = i * 32,
      lon = view.getFloat64(o, true),
      lat = view.getFloat64(o + 8, true),
      epoch = view.getFloat64(o + 16, true),
      entity = view.getUint32(o + 24, true),
      value = view.getFloat32(o + 28, true);
    if (
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(epoch) ||
      Math.abs(epoch) > 8.64e12 ||
      entity >= p.entities.length ||
      !Number.isFinite(value)
    )
      return invalid();
    result.push({
      id: p.ids[i],
      inferred: inferred.has(p.ids[i]),
      centroid: centroids.has(p.ids[i]),
      lon,
      lat,
      time: epoch,
      entity,
      value,
    });
  }
  return result;
}
export function time(t: number) {
  if (!Number.isFinite(t)) return "Invalid time";
  // Date stores only milliseconds. Render canonical decimal fractions separately
  // so reading/editing an Event never drops its microseconds.
  const decimal = Math.abs(t).toString();
  let fraction =
    (decimal.includes("e")
      ? Math.abs(t).toFixed(9).split(".")[1]
      : decimal.split(".")[1]) || "";
  fraction = fraction.slice(0, 9);
  let seconds = Math.trunc(t);
  if (t < 0 && Number(fraction) > 0) {
    seconds -= 1;
    fraction = (1_000_000_000 - Number(fraction.padEnd(9, "0")))
      .toString()
      .padStart(9, "0");
  }
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return "Invalid time";
  fraction = fraction.replace(/0+$/, "");
  return (
    date.toISOString().replace("T", " ").slice(0, 19) +
    (fraction ? "." + fraction : "")
  );
}

export function escape(s: unknown) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export const colors = [
  "#9cc0ff",
  "#c9aff8",
  "#ffa49b",
  "#8ed9e8",
  "#ffd27a",
  "#f2a7dc",
  "#a8cbe8",
  "#c5c3ff",
];

const lightColors = [
  "#1d4fb8",
  "#7044a9",
  "#b53640",
  "#006c81",
  "#875000",
  "#a33280",
  "#386783",
  "#5354a6",
];
let entityColors: Record<string, string> = {};
export function setEntityColors(colors: Record<string, string>) {
  entityColors = { ...colors };
}
export function entityColor(
  name: string,
  theme = typeof document === "undefined"
    ? "dark"
    : document.documentElement.dataset.theme,
): string {
  if (Object.hasOwn(entityColors, name)) return entityColors[name];
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 16777619);
  }
  return (theme === "light" ? lightColors : colors)[
    (hash >>> 16) % colors.length
  ];
}

export interface GeometryFeature {
  id: string;
  entity: string;
  time: number;
  shape: {
    kind: string;
    points: [number, number][];
    lines: [number, number][][];
    polygons: [number, number][][][];
    bounds: number[] | null;
    vertex_count: number;
    dimensions: string;
  };
}

export type Bounds = [number, number, number, number];
