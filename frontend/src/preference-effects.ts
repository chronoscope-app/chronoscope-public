import type { Preferences } from "./types";

// JSON objects have no meaningful key order; array/layer order is meaningful.
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  return value;
}
function resourceKey(p: Preferences) {
  return JSON.stringify(
    ordered([
      p.basemap,
      p.map,
      p.map_layers,
      p.terrain_path,
      p.terrain_builtin,
      p.terrain_exaggeration,
      p.terrain_vertical_datum,
    ]),
  );
}
/** Appearance/format/workspace settings never authorize resource replacement. */
export function preferenceEffects(previous: Preferences, next: Preferences) {
  return {
    resourcesChanged: resourceKey(previous) !== resourceKey(next),
    pathChanged:
      next.terrain_path !== previous.terrain_path ||
      next.terrain_builtin !== previous.terrain_builtin,
  };
}
