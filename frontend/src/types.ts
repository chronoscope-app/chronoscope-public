import type { GisLayer } from "./gis";
import type { EngineContracts } from "./contracts";

/** Shared wire definitions come from the Rust registry, not a second UI schema. */
export type Preferences = Exclude<
  EngineContracts["preferences"]["result"],
  { dry_run: true }
>;
export type SceneState = EngineContracts["snapshot"]["result"]["scene"];
type WireFilter = EngineContracts["snapshot"]["result"]["filter"];
export type Filter = Required<
  Pick<
    WireFilter,
    | "start"
    | "end"
    | "hidden_entities"
    | "hidden_categories"
    | "hidden_sources"
    | "search"
    | "predicates"
    | "selected_only"
    | "bounds"
    | "located_only"
  >
> &
  Pick<WireFilter, "facet_fields" | "facet_hidden">;
export type MapLayer = NonNullable<Preferences["map_layers"]>[number];
// Forms may omit the optional matrix level until automatic zoom is resolved.
export type MapConfig = Omit<Preferences["map"], "level"> &
  Partial<Pick<Preferences["map"], "level">>;

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
  scene: SceneState;
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
  views: NonNullable<EngineContracts["snapshot"]["result"]["views"]>;
  groups: NonNullable<EngineContracts["snapshot"]["result"]["groups"]>;
  undo: number;
  redo: number;
  stats: Record<string, number>;
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
  altitude?: {
    meters: number;
    reference: "ellipsoid" | "egm96" | "reported" | "unspecified";
  };
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
    (p.stride !== 32 && p.stride !== 48) ||
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
  const expected = p.ids.length * p.stride,
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
    const o = i * p.stride,
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
    let altitude: Point["altitude"];
    if (p.stride === 48) {
      const meters = view.getFloat64(o + 32, true),
        reference = view.getUint8(o + 40);
      for (let j = 41; j < 48; j++) if (view.getUint8(o + j)) return invalid();
      if (reference === 0) {
        if (!Number.isNaN(meters)) return invalid();
      } else {
        if (
          ![1, 2, 3, 4].includes(reference) ||
          !Number.isFinite(meters) ||
          meters < -12000 ||
          meters > 100000000
        )
          return invalid();
        altitude = {
          meters,
          reference: (
            ["", "ellipsoid", "egm96", "reported", "unspecified"] as const
          )[reference] as NonNullable<Point["altitude"]>["reference"],
        };
      }
    }
    result.push({
      ...(altitude ? { altitude } : {}),
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

export const dateFormats: [Preferences["date_format"], string][] = [
  ["system", "System locale"],
  ["iso", "YYYY-MM-DD"],
  ["mdy", "MM/DD/YYYY"],
  ["mdy-short", "MM/DD/YY"],
  ["dmy", "DD/MM/YYYY"],
  ["dmy-short", "DD/MM/YY"],
  ["dmy-dots", "DD.MM.YYYY"],
  ["dmy-long", "DD Mon YYYY"],
  ["mdy-long", "Mon D, YYYY"],
];
export const timeFormats: [Preferences["time_format"], string][] = [
  ["system", "System locale"],
  ["12h", "12-hour · h:mm AM/PM"],
  ["12h-seconds", "12-hour · h:mm:ss AM/PM"],
  ["24h", "24-hour · HH:mm"],
  ["24h-seconds", "24-hour · HH:mm:ss"],
];
// Display preferences never affect canonical `time()`, parsers or stored epochs.
const systemDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const monthNameFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
});
const clockFormatters = new Map<string, Intl.DateTimeFormat>();
let displayFormats = { date_format: "system", time_format: "system" };
export function setDateTimeDisplay(
  p: Pick<Preferences, "date_format" | "time_format">,
) {
  const next = {
    date_format: p.date_format || "system",
    time_format: p.time_format || "system",
  };
  if (JSON.stringify(next) === JSON.stringify(displayFormats)) return false;
  displayFormats = next;
  return true;
}
export function displayDate(t: number) {
  const canonical = time(t);
  if (canonical === "Invalid time") return canonical;
  const [year, month, day] = canonical.split(" ")[0].split("-");
  const d = new Date(Math.floor(t) * 1000),
    f = displayFormats.date_format;
  if (f === "iso") return `${year}-${month}-${day}`;
  if (f === "mdy" || f === "mdy-short")
    return `${month}/${day}/${f.endsWith("short") ? year.slice(-2) : year}`;
  if (f === "dmy" || f === "dmy-short")
    return `${day}/${month}/${f.endsWith("short") ? year.slice(-2) : year}`;
  if (f === "dmy-dots") return `${day}.${month}.${year}`;
  if (f === "dmy-long" || f === "mdy-long") {
    const name = monthNameFormatter.format(d);
    return f === "dmy-long"
      ? `${day} ${name} ${year}`
      : `${name} ${Number(day)}, ${year}`;
  }
  return systemDateFormatter.format(d);
}
export function displayClock(t: number, precise = false) {
  const canonical = time(t);
  if (canonical === "Invalid time") return canonical;
  const f = displayFormats.time_format;
  const seconds = precise || f === "system" || f.endsWith("seconds");
  const fraction = seconds ? canonical.split(".")[1] : undefined;
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    ...(f.startsWith("12h")
      ? { hourCycle: "h12" as const }
      : f.startsWith("24h")
        ? { hourCycle: "h23" as const }
        : {}),
  };
  const key = f + ":" + seconds;
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
    clockFormatters.set(key, formatter);
  }
  return formatter
    .formatToParts(new Date(Math.floor(t) * 1000))
    .map(
      (p) => p.value + (p.type === "second" && fraction ? "." + fraction : ""),
    )
    .join("")
    .replace(/[\u202f\u00a0]/g, " ");
}
export function displayTime(t: number, precise = false) {
  return Number.isFinite(t) && time(t) !== "Invalid time"
    ? `${displayDate(t)} ${displayClock(t, precise)}`
    : "Invalid time";
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
  value?: number | null;
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
