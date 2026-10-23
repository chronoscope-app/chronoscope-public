import { suggestTags, focusedUI } from "./focused-ai";
import { version as appVersion } from "../package.json";
import { EditorController } from "./editor-controller";
import { WorkspaceController } from "./workspace-controller";
import { openAnalytics } from "./analytics";
import { captureAppWindow } from "./app-capture";
import { NotificationCenter, type AppNotification } from "./notifications";
import { createAgentView } from "./agent-view";
import { GisTable } from "./gis-table";
import type { GisLayer } from "./gis";
import {
  defaultDisplay,
  type DisplayOptions,
  type DisplayPacket,
  type DisplayCell,
  type DisplayBin,
} from "./display-options";
import { mcpConnections } from "./mcp-connections";
import { SIChat } from "./si-chat";
import { SIWindowHost, workspaceHost } from "./si-windows";
import { RendererStatus } from "./renderer-status";
import { FilterIntent } from "./filter-intent";
import { ViewportRefresh } from "./viewport-refresh";
import { TimeRange } from "./time-range";
import { TimeRail } from "./time-rail";
import { installWorkspaceLayout } from "./workspace-layout";
import {
  PlaybackClock,
  PlaybackSpeed,
  PlaybackIncrement,
} from "./playback-speed";
import { LegendPanel } from "./legend-panel";
import { brandMark } from "./brand";
import { NavigationSphere, navigationTools } from "./navigation-sphere";
import { ChartsPanel } from "./charts-panel";
import { SidebarFields } from "./sidebar-fields";
import { PatternsPanel } from "./patterns-panel";
import { ViewsPanel } from "./views-panel";
import "./style.css";
import { guide, shortcuts } from "./help";
import { installTooltips } from "./tooltips";
import { call, chooseFile, native } from "./bridge";
import { SpaceTimeView } from "./view";
import { mapLayers, layerVisible, MapStack } from "./map-stack";
import {
  decode,
  escape as esc,
  time,
  entityColor,
  setEntityColors,
  type Snapshot,
  type Filter,
  type Preferences,
  type Terrain,
  type Raster,
  type MapLayer,
} from "./types";
import type { EngineContracts } from "./contracts";
import type { Bounds } from "./types";
const supportedRasterFormat = (format: string) =>
  ["image/png", "image/jpeg", "image/jpg", "image/jpgpng"].includes(
    format.toLowerCase(),
  );
type Scene = EngineContracts["scene_sync"]["args"]["scene"];
type ViewMode = Exclude<Scene["mode"], "" | undefined>;
type InspectorTab = Exclude<Scene["inspector_tab"], "" | undefined>;
const icons: Record<string, string> = {
  import: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
  folder: "M3 7h7l2-3h9v16H3z",
  save: "M4 3h13l4 4v14H3V3zM7 3v7h10V3M7 21v-7h10v7",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
  settings: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
  sun: "M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  select: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  "selection-add": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12h8m-4-4v8",
  "selection-remove": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12h8",
  move: "M12 3v18M3 12h18m-12-9 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3",
  maximize: "M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7",
  minimize: "M20 4l-7 7m0-6v6h6M4 20l7-7m-6 0h6v6",
  reset: "M3 10a9 9 0 1 1 1 8M3 4v6h6",
  table: "M3 4h18v16H3zM3 10h18M9 4v16",
  play: "m8 4 13 8-13 8z",
  pause: "M8 4v16M16 4v16",
  close: "m6 6 12 12M6 18 18 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  layers: "m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5",
  terrain: "m2 20 7-16 6 12 3-6 4 10zM6 11l3 2 3-3",
  terminal: "m4 6 6 6-6 6M13 18h7",
  camera: "M3 7h5l2-3h4l2 3h5v14H3z",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  entities:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-3.9a4 4 0 0 1 0 7.8",
  tag: "m20 13-7 7L3 10V3h7zm-12-6h.01",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-9-5v5l3 2",
  filter: "M3 4h18l-7 8v7l-4 2v-9z",
  chart: "M4 3v18h17M8 16v-4m5 4V7m5 9v-6",
  inspect: "M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  patterns: "m3 17 5-7 5 4 8-11M3 21h18",
  chat: "M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4",
  pin: "m9 3 6 0-1 6 4 4v2H6v-2l4-4zm3 12v7",
  "collapse-left": "m14 6-6 6 6 6",
  "collapse-right": "m10 6 6 6-6 6",
};
function icon(n: string) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n] || icons.layers}"/>${n === "sun" ? '<circle cx="12" cy="12" r="4"/>' : ""}</svg>`;
}
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
let snapshot: Snapshot,
  preferences: Preferences,
  tab: InspectorTab = "inspect",
  mode: ViewMode = "space-time",
  page = 0,
  tableOpen = false,
  busy = 0,
  serial = 0,
  focus = 0.45,
  terrainInfo: any = null,
  overrideBounds: Bounds | null = null,
  lastRaster: Raster | null = null;
let tableAnchor: string | null = null;
let tableActiveId: string | null = null;
let tableSelectionWork: Promise<void> = Promise.resolve();
const entitySelectionIntents = new Map<string, { selected: boolean }>();
let tableDisplayCell: DisplayCell | null = null;
let displayOptions: DisplayOptions = { ...defaultDisplay };
let customEntityColors: Record<string, string> = {};
let displayPreserveFrame = false;
let tableColumnOffset = 0;
let tableSource: string | null = null,
  tableRespectFilters = true,
  tableSort = "time",
  tableDescending = false,
  tableTotal = 0,
  tableSerial = 0;
let layerMenu: HTMLElement | null = null;
let findings: any[] = [];
let findingsRevision = -1;
let modalNode: HTMLElement | null = null;
let resolveGuard: ((proceed: boolean) => void) | null = null;
let playTimer: number | undefined;
let playbackPreserveFrame = false;
let timeScrubbing = false;
let timeScrubGeneration = 0;
$("#app").innerHTML = `
<header class="topbar"><div class="toolbar-main"><div class="brand"><div class="brand-mark">${brandMark}</div><div><div class="brand-name" title="Chronoscope">chrono<span>scope</span></div></div></div><button id="open" aria-label="Open workspace or data">${icon("folder")} <span class="toolbar-label">Open</span></button><button id="save" aria-label="Save workspace">${icon("save")} <span class="toolbar-label">Save</span></button><nav class="viewbar" aria-label="Views and data actions"><button class="active" data-view="space-time">Space-time</button><button data-view="map">2D Map</button><button data-view="globe">Globe</button><button id="aggregate-events" title="Preview and summarize visible records by time and proximity">Aggregate</button><button id="export">Export CSV</button><button id="toggle-table" aria-haspopup="menu" aria-controls="tables-menu" aria-expanded="false">${icon("table")} Tables</button></nav><button id="maps" aria-label="Map servers">${icon("map")} <span class="toolbar-label">Maps</span></button><button id="terrain" aria-label="Terrain">${icon("terrain")} <span class="toolbar-label">Terrain</span></button><button id="si" title="Open SI chat" aria-controls="si-chat" aria-expanded="false">AI</button><button id="help">Help</button><button class="icon" id="theme" title="Switch theme">${icon("sun")}</button><button class="icon" id="settings" title="Preferences and interfaces">${icon("settings")}</button></div><button type="button" class="renderer-status" id="backend" aria-label="Renderer starting; refresh map"></button><button type="button" class="icon notification-trigger" id="notifications" title="Notifications" aria-label="Notifications" aria-controls="notifications-panel" aria-expanded="false">${icon("bell")}<span class="notification-badge" aria-hidden="true" hidden></span></button></header>
<main class="workspace"><aside class="sidebar"><section class="sidebar-pinned" id="search-section" aria-label="Search and selection"><input id="search" placeholder="Search events…" aria-label="Search events"><button id="reset-filters">Reset filters</button><div class="selection-tools" id="selection-tools"><div class="selection-summary"><strong id="pinned-selection-count" role="status">0 selected</strong><button id="clear" aria-label="Clear selection">Clear</button></div><div class="selection-actions"><button class="secondary" id="select-all">Select visible</button><label class="check-row"><input type="checkbox" id="selected-only" aria-label="Selected events only"> Show only</label></div></div></section><div class="sidebar-scroll"><details open class="sidebar-facet" id="entity-section"><summary><span>Entities</span><select id="entity-field" aria-label="Entity list field" title="Group the list by another column; source track identities stay unchanged"><option value="entity">Entity</option></select></summary><div class="facet-sort" role="group" aria-label="Sort entities"><button id="entity-sort-name" data-facet-sort="name">Name <span aria-hidden="true"></span></button><button id="entity-sort-count" data-facet-sort="count">Quantity <span aria-hidden="true"></span></button></div><div class="facet-controls"><input id="entity-search" placeholder="Find an entity…" aria-label="Find entity"><button id="all-entities">Enable all</button></div><div id="entities"></div><div class="facet-footer"><small id="entity-list-count"></small><button id="entity-show-all">Show all</button></div></details><details open class="sidebar-facet" id="category-section"><summary><span>Categories</span><select id="category-field" aria-label="Category list field" title="Group the list by another column"><option value="category">Category</option></select></summary><div class="facet-sort" role="group" aria-label="Sort categories"><button id="category-sort-name" data-facet-sort="name">Name <span aria-hidden="true"></span></button><button id="category-sort-count" data-facet-sort="count">Quantity <span aria-hidden="true"></span></button></div><div id="categories"></div><div class="facet-footer"><small id="category-list-count"></small><button id="category-show-all">Show all</button></div></details><div class="divider"></div><details id="time-section"><summary>Exact time range</summary><label class="field">Start / UTC<input id="exact-start" placeholder="Unbounded"></label><label class="field">End / UTC<input id="exact-end" placeholder="Unbounded"></label><button id="exact-apply" class="secondary">Apply range</button></details><details id="rules-section"><summary>Attribute rules</summary><label class="field">Field<input id="rule-field" placeholder="value, confidence, category…"></label><select id="rule-op"><option>Contains</option><option>Equals</option><option>NotEquals</option><option>Greater</option><option>Less</option><option>IsEmpty</option></select><label class="field">Value<input id="rule-value"></label><button id="add-rule" class="secondary">Add AND rule</button><div id="rules"></div></details><details id="bounds-section"><summary>Geographic bounds</summary><label class="field">West, South, East, North<input id="bounds" placeholder="-80,43,-79,44"></label><button id="apply-bounds" class="secondary">Apply region</button></details><section id="layers-section"><div class="section-head"><span class="caps">Layers</span></div><div id="layer-list"></div><div class="source-foot">WGS84 · UTC</div></section></div></aside>
<section class="center"><div class="scene-container" id="scene"><div class="scene-top-right"><button class="icon" id="screenshot" title="Export canvas PNG">${icon("camera")}</button><button class="icon" id="fullscreen" title="Expand workspace" aria-label="Expand workspace" aria-pressed="false">${icon("maximize")}</button></div><div class="geography-readout" id="geography-readout"></div><div class="legend" id="legend"></div>${navigationTools()}</div><section class="table-panel" id="table-panel"><div class="table-header"><button class="icon" id="close-table" aria-label="Close attribute table" title="Close table">${icon("close")}</button><span class="caps" id="table-title">Attributes</span><small class="muted" id="table-count"></small><input id="gis-table-search" placeholder="Search this GIS layer…" aria-label="Search GIS attributes" hidden><span class="spacer"></span><label class="check-row" id="table-filter-option" hidden><input id="table-respect-filters" type="checkbox"> Respect workspace filters</label><button id="table-all" hidden>All sources</button><small id="table-fields" hidden></small><button id="previous-fields" hidden title="Show previous source columns">Previous fields</button><button id="next-fields" hidden title="Show next source columns">Next fields</button></div><div class="table-scroll"><table><thead id="table-head"></thead><tbody id="table-body"></tbody></table></div></section><section class="timeline"><div class="timeline-title"><span class="caps">Time window</span><span class="range-label mono" id="range-label"></span><span class="spacer"></span><button class="secondary" id="play">${icon("play")} Play</button><button id="full-range">Full range</button></div><div class="time-range-track" id="time-range-track"><div class="histogram" id="histogram"></div></div><div class="timeline-labels" id="timeline-labels"></div><div class="time-range-hint">Drag brackets to resize · Drag the window to move · Arrow keys to adjust</div></section></section>
<aside class="inspector"><div class="inspector-top"><div class="inspector-tabs"><button data-tab="views">Views</button><button data-tab="charts">Charts</button><button class="active" data-tab="inspect">Inspect</button><button data-tab="patterns">Patterns</button></div><div class="inspector-content" id="inspector-content"></div></div><section id="si-chat" class="si-chat" aria-label="Super Intelligence chat" hidden></section></aside></main><footer class="statusbar"><span class="status-dot"></span><span id="status">Initializing local Rust engine…</span><div class="map-attribution" id="map-attribution" aria-label="Map credits"></div><div id="cesium-credits" aria-label="Provider credits"></div><span class="spacer"></span><button id="cancel-map" hidden>Stop map loading</button><span id="busy"></span><span class="accent" id="selection-status"></span></footer>`;
const timeRail = new TimeRail($(".workspace"), {
  icon,
  apply: async (start, end) => {
    const parse = async (value: string) =>
      value.trim() ? (await call("time_parse", { value })).epoch : null;
    await filter({ start: await parse(start), end: await parse(end) });
  },
  interact: () => {
    if (playTimer !== undefined) $("#play").click();
  },
  error: (error) => toast(String(error), true),
});
const paneLayout = installWorkspaceLayout($(".workspace"), {
  icon,
  error: (error) => toast(String(error), true),
  sidebar: [
    ["search", "Search & selection", "search"],
    ["entity", "Entities", "entities"],
    ["category", "Categories", "tag"],
    ["time", "Exact time range", "clock"],
    ["rules", "Attribute rules", "filter"],
    ["bounds", "Geographic bounds", "map"],
    ["layers", "Layers", "layers"],
  ].map(([id, label, glyph]) => ({
    id,
    label,
    icon: glyph,
    target: $(`#${id}-section`),
  })),
  inspector: [
    ["views", "Views", "layers"],
    ["charts", "Charts", "chart"],
    ["inspect", "Inspect", "inspect"],
    ["patterns", "Patterns", "patterns"],
    ["si", "SI chat", "chat"],
  ].map(([id, label, glyph]) => ({
    id,
    label,
    icon: glyph,
    target: id === "si" ? $("#si-chat") : $(".inspector-top"),
    activate: () =>
      id === "si"
        ? siChat.open(false)
        : document
            .querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!
            .click(),
  })),
});
const notifications = new NotificationCenter(
  $("#notifications") as HTMLButtonElement,
  icon("close"),
);
const rendererStatus = new RendererStatus($("#backend"));
rendererStatus.update("Initializing renderer");
const view = new SpaceTimeView($("#scene"), (s) => rendererStatus.update(s));
$("#backend").addEventListener("click", () => {
  void view.recoverRenderer().catch((error) => toast(String(error), true));
});
const gisTable = new GisTable($("#table-head"), $("#table-body"), () =>
  tableRowUnit(),
);
gisTable.onChange = () => refresh(false);
gisTable.onError = (error) => toast(String(error), true);
gisTable.onSort = () => {
  resetTableScroll();
  void table().catch(gisTable.onError);
};
$("#gis-table-search").addEventListener("input", () => {
  gisTable.search = input("#gis-table-search");
  resetTableScroll();
  void table().catch(gisTable.onError);
});
view.onGisError = (id, message) => {
  toast(`GIS layer: ${message}`, true);
  layers();
};
view.onGisPick = (id, feature) => {
  void (async () => {
    const layer = view.gis.descriptors.find((l) => l.id === id);
    if (layer && !layer.feature_count) {
      await gisLayerMenu(id);
      return;
    }
    const matches = await call("gis_table", {
      id,
      feature_id: feature,
      limit: 1000,
    });
    if (matches.count > 1000)
      toast(
        "This native object has more than 1,000 samples. Import as Events for full record selection.",
      );
    const selected =
      matches.count <= 1000 ? matches.rows.map((row) => row.id) : [];
    await call("gis_set", {
      id,
      selected: selected.length ? selected : [feature],
    });
    await openGisAttributes(id);
    const properties =
      matches.rows[0]?.properties || view.gis.properties(id, feature);
    if (Object.keys(properties).length) {
      const host = $("#inspector-content");
      host.innerHTML = `<h3>GIS feature</h3><p class="description">${esc(feature)}</p><dl>${Object.entries(
        properties,
      )
        .slice(0, 64)
        .map(
          ([key, value]) =>
            `<dt>${esc(key)}</dt><dd>${esc(typeof value === "object" ? JSON.stringify(value) : value)}</dd>`,
        )
        .join("")}</dl>`;
    }
  })().catch(gisTable.onError);
};
const navigationHost = document.createElement("div");
$("#scene").append(navigationHost);
const navigation = new NavigationSphere(navigationHost, view, () => {
  return fitEvents().catch((error) => toast(String(error), true));
});
void view.ready.then(() => {
  navigation.update();
  view.controls.addEventListener("change", () => navigation.update());
});
const viewsPanel = new ViewsPanel($("#inspector-content"), {
  display: applyDisplay,
  preview: (options) => {
    displayOptions = options;
    view.setDisplayOptions(options);
  },
  saved: savedViews,
  error: (error) => toast(String(error), true),
});
const chartsPanel = new ChartsPanel($("#inspector-content"), {
  rolesChanged: () => refresh(false),
  changed: async () => {
    await call("scene_sync", { scene: captureScene() });
    await refresh(false);
  },
  selected: () => refresh(false),
  table: async (source) => {
    await openAttributes(source);
  },
  error: (error) => toast(String(error), true),
});
const patternsPanel = new PatternsPanel($("#inspector-content"), {
  prepare: async () => {
    if (playTimer !== undefined) $("#play").click();
    await filterIntent.flush();
  },
  selected: () => refresh(false),
  table: () => openAttributes(null),
  error: (error) => toast(String(error), true),
});
function sceneTimeBounds(s: Snapshot): [number, number] {
  if (mode !== "space-time") return s.time_bounds;
  const lo =
      s.filter.start ??
      Math.min(s.time_bounds[0], s.filter.end ?? s.time_bounds[0]),
    hi = s.filter.end ?? Math.max(s.time_bounds[1], lo);
  return [lo, hi];
}
function updateTimeFocus() {
  const [lo, hi] = snapshot?.time_bounds || [view.lo, view.hi];
  const epoch = lo + (hi - lo) * focus;
  view.setFocus(
    view.hi > view.lo ? (epoch - view.lo) / (view.hi - view.lo) : 0,
  );
}
const sidebarFields = new SidebarFields(
  async (kind, field) => {
    const current = filterIntent.desired(snapshot.filter);
    entitySelectionIntents.clear();
    facetExpanded[kind] = false;
    await filter({
      facet_fields: { ...current.facet_fields, [kind]: field },
      facet_hidden: { ...current.facet_hidden, [kind]: [] },
      [kind === "entity" ? "hidden_entities" : "hidden_categories"]: [],
    });
  },
  (error) => toast(String(error), true),
);
const entityLegend = new LegendPanel($("#legend"), "Legend");
const timeRange = new TimeRange(
  $("#time-range-track"),
  (start, end, final) => {
    const [lo, hi] = snapshot.time_bounds;
    $("#range-label").textContent =
      `${time(lo + (hi - lo) * start)} — ${time(lo + (hi - lo) * end)} UTC`;
    timeRail.update(lo, hi, lo + (hi - lo) * start, lo + (hi - lo) * end);
    focus = (start + end) / 2;
    updateTimeFocus();
    const cursor = $("#histogram").querySelector<HTMLElement>(".cursor");
    if (cursor) cursor.style.top = `${focus * 100}%`;
    const generation = timeScrubGeneration;
    const update = timeWindow(start, end, 0, true);
    void (
      final
        ? update.finally(() => {
            if (generation !== timeScrubGeneration) return;
            timeScrubbing = false;
            view.setPlayback(playTimer !== undefined);
            view.onSceneChange();
          })
        : update
    ).catch((e) => toast(String(e), true));
  },
  () => {
    timeScrubGeneration++;
    timeScrubbing = true;
    if (playTimer !== undefined) $("#play").click();
    view.setPlayback(true);
  },
  "vertical",
);
installTooltips();
let projectPath: string | null = null;
const editor = new EditorController();
const workspace = new WorkspaceController({
  settle: async () => {
    await editor.idle();
    await filterIntent.flush();
    await viewsPanel.idle();
  },
  status: () => call("workspace_status"),
  autosave: () => call("autosave_unsaved"),
  source: () => projectPath,
  identity: () => snapshot.workspace_id,
  chooseSavePath: () =>
    chooseFile({
      save: true,
      defaultPath: "study.chronoscope",
      filters: [
        { name: "Portable Chronoscope workspace", extensions: ["chronoscope"] },
      ],
    }),
  persist: (path, identity) =>
    task("Saving workspace and terrain…", () =>
      call("save", {
        path,
        scene: captureScene(),
        expected_workspace: identity,
      }),
    ),
  saved: (path) => {
    projectPath = path;
    toast("Workspace saved");
  },
  confirmUnsaved,
});
const input = (s: string) => ($(s) as HTMLInputElement).value;
const check = (s: string) => ($(s) as HTMLInputElement).checked;
function status(s: string) {
  $("#status").textContent = s;
}
function toast(s: string, error = false) {
  const e = document.createElement("div");
  e.className = "toast" + (error ? " error" : "");
  e.textContent = s;
  document.body.append(e);
  setTimeout(() => e.remove(), 6500);
  if (error) console.error(s);
}
function on(s: string, fn: (e: Event) => unknown) {
  $(s).addEventListener("click", (e) =>
    Promise.resolve(fn(e)).catch((error) => toast(String(error), true)),
  );
}
async function task<T>(label: string, fn: () => Promise<T>) {
  busy++;
  $("#busy").innerHTML = '<span class="spinner"></span>';
  status(label);
  try {
    return await fn();
  } finally {
    if (!--busy) $("#busy").innerHTML = "";
  }
}
function bounds(points: { lat: number; lon: number }[]): Bounds {
  if (!points.length) return [-122.47, 37.75, -122.36, 37.82];
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const dx = Math.max((e - w) * 0.12, 0.002),
    dy = Math.max((n - s) * 0.12, 0.002);
  return [
    Math.max(-180, w - dx),
    Math.max(-90, s - dy),
    Math.min(180, e + dx),
    Math.min(90, n + dy),
  ];
}
let nativeIconThemeWork: Promise<void> = Promise.resolve();
let lastNativeIconPreference: string | null | undefined;
function theme() {
  const t =
    preferences.theme === "system"
      ? matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : preferences.theme;
  document.documentElement.dataset.theme = t;
  view.setTheme(t);
  const preference = preferences.theme === "system" ? null : preferences.theme;
  if (native && preference !== lastNativeIconPreference) {
    lastNativeIconPreference = preference;
    nativeIconThemeWork = nativeIconThemeWork
      .then(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("desktop_icon_theme", { theme: preference });
      })
      .catch((error) => {
        if (lastNativeIconPreference === preference)
          lastNativeIconPreference = undefined;
        toast(String(error), true);
      });
  }
}
let renderBudget: 20000 | 100000 = 20000;
let renderLOD = false,
  geometryLOD = false,
  renderedCount = 0;
let viewportDataGeneration = 0;
let tableReveal: string | null = null;
const TABLE_ROW_HEIGHT = 32;
const TABLE_WINDOW = 100;
let tableScrollFrame = 0;
let tableScrollLoading = false;
// Stay below native browser scroll-height limits even for multi-million-row data.
const tableRowUnit = () =>
  Math.min(TABLE_ROW_HEIGHT, 32_000_000 / Math.max(1, tableTotal));
let tableScopeKey = "";
function resetTableScroll() {
  page = 0;
  $(".table-scroll").scrollTop = 0;
}
function tablePageArguments() {
  return {
    ...(tableReveal ? { reveal_id: tableReveal } : {}),
    ...(tableDisplayCell ? { display_cell: tableDisplayCell } : {}),
    source: tableSource,
    apply_filter: tableRespectFilters,
    sort_by: tableSort,
    descending: tableDescending,
    column_offset: tableColumnOffset,
    column_limit: 32,
    offset: page * 50,
    limit: TABLE_WINDOW,
  };
}
async function refresh(render = true, resources = true) {
  viewportDataGeneration++;
  const generation = ++serial;
  const scopeKey = JSON.stringify([
    snapshot?.filter,
    tableSource,
    tableRespectFilters,
    tableSort,
    tableDescending,
    tableDisplayCell,
  ]);
  if (scopeKey !== tableScopeKey) {
    tableScopeKey = scopeKey;
    if (!tableReveal) resetTableScroll();
  }
  const requestedTablePage = page;
  const requestedTableSerial = tableSerial;
  const includeRender =
    render ||
    !!snapshot?.filter.selected_only ||
    renderLOD ||
    geometryLOD ||
    view.displayLayer.active;
  const model = await call("view_snapshot_v1", {
    version: 1,
    generation: String(generation),
    include_render: includeRender,
    display_level: displayLevel(),
    include_inspector: tab === "inspect",
    include_statistics: false,
    // Render snapshots already include selection membership for every returned
    // point/shape. Send retained IDs only when reusing the current render data.
    selection_ids: includeRender
      ? []
      : [
          ...view.points.map((p) => p.id),
          ...view.geometryFeatures.map((f) => f.id),
        ].slice(0, 100000),
    ...(tableOpen
      ? {
          page: {
            command: "attribute_table" as const,
            args: tablePageArguments(),
          },
        }
      : {}),
  });
  // Validate the complete point payload before publishing any new UI state.
  const decoded = model.render ? decode(model.render) : null;
  const s = model.snapshot as Snapshot;
  if (generation !== serial) return;
  snapshot = s;
  await view.ready;
  await view.gis.sync((s.gis_layers || []) as GisLayer[]);
  if (generation !== serial) return;
  tableScopeKey = JSON.stringify([
    s.filter,
    tableSource,
    tableRespectFilters,
    tableSort,
    tableDescending,
    tableDisplayCell,
  ]);
  const colorChanged =
    JSON.stringify(customEntityColors) !==
    JSON.stringify(s.scene.entity_colors || {});
  customEntityColors = { ...s.scene.entity_colors };
  setEntityColors(customEntityColors);
  if (colorChanged) view.rebuild(true);
  displayOptions = viewsPanel.liveOptions || {
    ...defaultDisplay,
    ...s.scene.display,
  };
  view.setDisplayOptions(displayOptions);
  view.setGlobeTime(!!s.scene.globe_time);
  updateNavigationControls();
  renderBudget = s.scene.render_budget === 100000 ? 100000 : 20000;
  projectPath = s.lifecycle?.source ?? null;
  preferences = s.preferences;
  await view.setBasemap(preferences.basemap || "none");
  $("#save").title = s.lifecycle?.dirty
    ? "Save unsaved changes (Ctrl/Cmd+S)"
    : "Save workspace (Ctrl/Cmd+S)";
  $("#pinned-selection-count").textContent =
    `${s.selected_count.toLocaleString()} selected`;
  $("#selection-tools").classList.toggle("has-selection", s.selected_count > 0);
  ($("#clear") as HTMLButtonElement).disabled = s.selected_count === 0;
  $("#selection-status").textContent =
    `${s.visible.toLocaleString()} visible · ${s.selected_count} selected`;
  if (
    document.activeElement !== $("#search") &&
    !filterIntent.protects("search")
  )
    ($("#search") as HTMLInputElement).value = s.filter.search;
  ($("#selected-only") as HTMLInputElement).checked = s.filter.selected_only;
  const [lo, hi] = s.time_bounds;
  const desiredTime = filterIntent.desired(s.filter);
  if (playTimer === undefined)
    timeRange.set(
      desiredTime.start === null
        ? 0
        : (desiredTime.start - lo) / Math.max(1e-9, hi - lo),
      desiredTime.end === null
        ? 1
        : (desiredTime.end - lo) / Math.max(1e-9, hi - lo),
      [lo, hi],
    );
  ($("#exact-start") as HTMLInputElement).value =
    s.filter.start === null ? "" : time(s.filter.start);
  ($("#exact-end") as HTMLInputElement).value =
    s.filter.end === null ? "" : time(s.filter.end);
  entities();
  categories();
  void sidebarFields.render(s).catch((e) => toast(String(e), true));
  histogram();
  layers();
  await inspector(model.inspected, generation);
  if (generation !== serial) return;
  if (tableOpen)
    await table(
      requestedTablePage === page && requestedTableSerial === tableSerial
        ? model.page
        : undefined,
      generation,
      model.selected,
    );
  if (generation !== serial) return;
  if (model.render) {
    const packed = model.render;
    renderLOD = packed.lod || !!model.display?.aggregated;
    renderedCount = packed.rendered_count;
    if (generation !== serial) return;
    const points = decoded!;
    const geometries = model.geometries;
    if (generation !== serial) return;
    const names = [...packed.entities];
    for (const feature of geometries.features) {
      if (!names.includes(feature.entity)) names.push(feature.entity);
    }
    const coverage = [...points];
    if (model.display?.bounds) {
      const b = model.display.bounds;
      coverage.push(
        { lat: b[1], lon: b[0] } as any,
        { lat: b[3], lon: b[2] } as any,
      );
    }
    for (const feature of geometries.features) {
      const b = feature.shape.bounds;
      if (b)
        coverage.push(
          { lat: b[1], lon: b[0] } as any,
          { lat: b[3], lon: b[2] } as any,
        );
    }
    for (const layer of s.gis_layers || [])
      if (layer.enabled && layer.bounds) {
        const [w, south, e, n] = layer.bounds;
        coverage.push({ lat: south, lon: w } as any, { lat: n, lon: e } as any);
      }
    geometryLOD = geometries.limited;
    view.geometryLimited = geometries.limited;
    view.renderLOD = packed.lod;
    const dataChanged = await view.setData(
      points,
      names,
      overrideBounds ||
        (playbackPreserveFrame || timeScrubbing || displayPreserveFrame
          ? [...view.bounds]
          : bounds(coverage)),
      sceneTimeBounds(s),
      geometries.features,
      () => generation === serial,
      true,
    );
    if (generation !== serial) return;
    updateTimeFocus();
    const effectsAlreadyUpdating = view.displayLayer.updating;
    const effects = view.displayLayer.set(
      model.display || null,
      displayOptions,
    );
    // Ground imagery has its own coalesced transition. Do not hold the next
    // exact data/time update behind worker generation or an imagery crossfade.
    if (view.playback) {
      if (!effectsAlreadyUpdating)
        void effects.catch((e) => toast(String(e), true));
    } else await effects;
    view.rebuildTrails();
    if (generation !== serial) return;
    if (
      dataChanged &&
      resources &&
      !restoringScene &&
      !playbackPreserveFrame &&
      !timeScrubbing
    ) {
      if (terrainInfo) rebuildTerrain().catch((e) => toast(String(e), true));
      else if (mapsEnabled())
        loadRasters().catch((e) => toast(String(e), true));
    }
  }
  const selected = model.selected as string[];
  if (generation !== serial) return;
  view.setSelection(selected);
  updateNavigationControls();
  entityLegend.content.innerHTML =
    Object.keys(s.entities)
      .slice(0, 150)
      .map(
        (name, i) =>
          `<span class="legend-item"><i style="background:${entityColor(name)}"></i><span class="legend-label">${esc(name)}</span></span>`,
      )
      .join("") +
    '<span class="legend-item" title="Triangles have no observed coordinates. Their trail position is estimated between visible located events of the same entity and source."><span class="legend-label">● Observed location · △ Time only (estimated position)</span></span>';
  status(
    `${s.visible.toLocaleString()} matching events · ${view.displayLayer.active ? `${view.displayLayer.packet!.bins.length} display cells + selected evidence` : renderedCount.toLocaleString() + " markers"} · budget ${renderBudget.toLocaleString()}${view.geometryLimited ? " · geometry budget reached; refine filters" : ""}${renderLOD ? ` · ${renderedCount.toLocaleString()} representative markers · backend queries and Select visible remain exact` : view.trailsLimited ? " · stem/track geometry limited; refine filters" : ""}`,
  );
}
function facetField(kind: "entity" | "category") {
  return snapshot.filter.facet_fields?.[kind] || kind;
}
function facetHidden(kind: "entity" | "category") {
  return facetField(kind) === kind
    ? snapshot.filter[
        kind === "entity" ? "hidden_entities" : "hidden_categories"
      ]
    : snapshot.filter.facet_hidden?.[kind] || [];
}
const facetExpanded = { entity: false, category: false };
const facetSort = { entity: "count-desc", category: "count-desc" };
const facetCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
function facetRows(
  kind: "entity" | "category",
  counts: Record<string, number>,
  query = "",
) {
  const sort = facetSort[kind];
  for (const field of ["name", "count"]) {
    const button = $(`#${kind}-sort-${field}`);
    const active = sort.startsWith(field);
    const direction = sort.endsWith("asc") ? "ascending" : "descending";
    button.setAttribute("aria-pressed", String(active));
    button.querySelector("span")!.textContent = active
      ? direction === "ascending"
        ? "▲"
        : "▼"
      : "";
    const label = `Sort ${kind === "entity" ? "entities" : "categories"} by ${field === "name" ? "name" : "quantity"}${active ? `; currently ${direction}` : ""}. Click to ${active ? "reverse direction" : "sort"}.`;
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
  }
  const rows = Object.entries(counts).filter(([name]) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  const compareNames = (a: string, b: string) =>
    facetCollator.compare(
      kind === "category" ? a || "Uncategorized" : a,
      kind === "category" ? b || "Uncategorized" : b,
    );
  rows.sort(
    ([a, ac], [b, bc]) =>
      (sort.startsWith("count")
        ? sort === "count-desc"
          ? bc - ac
          : ac - bc
        : (sort === "name-desc" ? -1 : 1) * compareNames(a, b)) ||
      compareNames(a, b),
  );
  const visible = facetExpanded[kind] ? rows : rows.slice(0, 10);
  $(`#${kind}-list-count`).textContent =
    `${visible.length} of ${rows.length.toLocaleString()}${snapshot.facets?.[kind]?.limited ? " · list limited; use attribute rules" : ""}`;
  const button = $(`#${kind}-show-all`);
  button.hidden = rows.length <= 10;
  button.textContent = facetExpanded[kind] ? "Show top 10" : "Show all";
  button.setAttribute("aria-expanded", String(facetExpanded[kind]));
  return visible;
}
function entities() {
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.selectEntity
      : undefined;
  $("#entities").innerHTML = facetRows(
    "entity",
    snapshot.facets?.entity?.counts || snapshot.entities,
    input("#entity-search"),
  )
    .map(([name, count]) => {
      const selected =
        entitySelectionIntents.get(name)?.selected ??
        !!(snapshot.facets?.entity?.selected || snapshot.selected_entities)?.[
          name
        ];
      const action = `${selected ? "Deselect" : "Select"} all events for ${name}`;
      return `<div class="entity" data-selected="${selected}" title="${(snapshot.facets?.entity?.selected || snapshot.selected_entities)?.[name] || 0} of ${count} selected">${facetField("entity") === "entity" ? `<input class="entity-color" type="color" value="${entityColor(name)}" data-entity-color="${esc(name)}" aria-label="Color for ${esc(name)}" title="Change color for ${esc(name)}">` : ""}<input type="checkbox" data-entity="${esc(name)}" ${facetHidden("entity").includes(name) ? "" : "checked"} aria-label="Show ${esc(name)}"><span class="entity-name">${esc(name || "[Empty]")}</span><span class="entity-count">${count}</span><button type="button" data-select-entity="${esc(name)}" aria-label="${esc(action)}" aria-pressed="${selected}" title="${esc(action)}; keep other selections">${icon(selected ? "selection-remove" : "selection-add")}</button></div>`;
    })
    .join("");
  if (focused !== undefined)
    Array.from(document.querySelectorAll<HTMLElement>("[data-select-entity]"))
      .find((button) => button.dataset.selectEntity === focused)
      ?.focus({ preventScroll: true });
}
function categories() {
  $("#categories").innerHTML = facetRows(
    "category",
    snapshot.facets?.category?.counts || snapshot.categories,
  )
    .map(
      ([name, count]) =>
        `<label class="check-row"><input type="checkbox" data-category="${esc(name)}" ${facetHidden("category").includes(name) ? "" : "checked"}>${esc(name || (facetField("category") === "category" ? "Uncategorized" : "[Empty]"))}<span class="spacer"></span>${count}</label>`,
    )
    .join("");
  $("#rules").innerHTML = snapshot.filter.predicates
    .map(
      (p, i) =>
        `<div class="row"><small>${esc(p.field)} ${esc(p.op)} ${esc(p.value)}</small><button data-remove-rule="${i}">×</button></div>`,
    )
    .join("");
}
function histogram() {
  const max = Math.max(1, ...snapshot.histogram);
  const [lo, hi] = snapshot.time_bounds;
  const desiredTime = filterIntent.desired(snapshot.filter);
  const start =
      desiredTime.start === null
        ? 0
        : (desiredTime.start - lo) / Math.max(1e-9, hi - lo),
    end =
      desiredTime.end === null
        ? 1
        : (desiredTime.end - lo) / Math.max(1e-9, hi - lo);
  $("#histogram").innerHTML =
    snapshot.histogram
      .map(
        (n, i) =>
          `<div data-bin="${i}" class="bar ${snapshot.selected_histogram[i] ? "selected" : ""} ${i / 100 < start || i / 100 > end ? "dim" : ""}" style="width:${Math.max((n / max) * 100, 2)}%" title="${n} events"></div>`,
      )
      .join("") + `<div class="cursor" style="top:${focus * 100}%"></div>`;
  $("#range-label").textContent =
    `${time(desiredTime.start ?? lo)} — ${time(desiredTime.end ?? hi)} UTC`;
  timeRail.update(lo, hi, desiredTime.start, desiredTime.end);
}
function mapsEnabled() {
  return mapLayers(preferences).some((l) => l.config.enabled);
}
function currentMapZoom() {
  return view.mapZoom();
}

async function mapLayerMenu() {
  const stack = structuredClone(mapLayers(preferences));
  const render = () => {
    const zoom = currentMapZoom();
    modal(
      `${head("Map layers")}<p class="description">Bottom to top drawing order. Enable layers from any saved server. Zoom uses the standard 256-pixel Web Mercator scale; minimum is inclusive and maximum exclusive. Street imagery can cover 0–14, with aerial imagery at 14–30.</p><div class="notice">Current zoom: ${zoom.toFixed(2)} · approximately 1:${Math.round(591657527.6 / 2 ** zoom).toLocaleString()} at the equator, 96 dpi. Zoom controls visibility; the server matrix setting controls requested resolution.</div><div id="map-stack-list">${stack.map((l, i) => `<section class="map-stack-row" data-map-stack="${esc(l.id)}"><div class="row"><label class="check-row grow"><input data-map-enabled type="checkbox" ${l.config.enabled ? "checked" : ""}> ${esc(l.server_name)} · ${esc(l.config.layer)}</label><button data-map-up="${i}" title="Move layer up in drawing order" ${i === stack.length - 1 ? "disabled" : ""}>↑</button><button data-map-down="${i}" title="Move layer down in drawing order" ${i === 0 ? "disabled" : ""}>↓</button><button data-map-edit="${i}">Edit source</button><button data-map-remove="${i}" aria-label="Remove ${esc(l.name)}">×</button></div><label class="field">Layer name<input data-map-name value="${esc(l.name)}"></label><div class="modal-grid"><label class="field">Opacity / %<input data-map-opacity type="number" min="0" max="100" step="1" value="${l.opacity * 100}"></label><label class="field">Show from zoom<input data-map-min type="number" min="0" max="30" step="0.1" value="${l.min_zoom}"></label><label class="field">Hide at zoom<input data-map-max type="number" min="0" max="30" step="0.1" value="${l.max_zoom}"></label></div><small>${layerVisible(l, zoom) ? "Visible at current zoom" : "Hidden at current zoom"} · ${esc(l.config.time || "Default date")}</small></section>`).join("") || "<p>No map layers. Add layers using Map servers.</p>"}</div><footer><button id="stack-add">Map servers / add layer</button><span class="spacer"></span><button data-close>Cancel</button><button id="save-map-stack" class="primary">Apply layers</button></footer>`,
      true,
    );
    const capture = () => {
      $("#map-stack-list")
        .querySelectorAll<HTMLElement>("[data-map-stack]")
        .forEach((row, i) => {
          const value = (key: string) =>
            (row.querySelector(`[data-map-${key}]`) as HTMLInputElement).value;
          stack[i].config.enabled = (
            row.querySelector("[data-map-enabled]") as HTMLInputElement
          ).checked;
          stack[i].name = value("name");
          stack[i].opacity = Number(value("opacity")) / 100;
          stack[i].min_zoom = Number(value("min"));
          stack[i].max_zoom = Number(value("max"));
        });
    };
    const save = async () => {
      capture();
      await cancelMap();
      preferences = await call("preferences", {
        preferences: { map_layers: stack },
      });
      mapUnavailable = false;
      await refresh(false);
      await loadRasters();
    };
    $("#map-stack-list").addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("button");
      if (!b) return;
      capture();
      const perform = async () => {
        if (b.dataset.mapEdit !== undefined) {
          await save();
          const l = stack[Number(b.dataset.mapEdit)];
          await mapMenu(undefined, l);
          return;
        }
        const up = b.dataset.mapUp,
          down = b.dataset.mapDown,
          remove = b.dataset.mapRemove;
        if (up !== undefined) {
          const i = Number(up);
          [stack[i], stack[i + 1]] = [stack[i + 1], stack[i]];
        }
        if (down !== undefined) {
          const i = Number(down);
          [stack[i], stack[i - 1]] = [stack[i - 1], stack[i]];
        }
        if (remove !== undefined) stack.splice(Number(remove), 1);
        render();
      };
      void perform().catch((e) => toast(String(e), true));
    });
    on("#save-map-stack", async () => {
      await save();
      closeModal();
    });
    on("#stack-add", async () => {
      await save();
      await wmtsMenu();
    });
  };
  render();
}
function geographyReadout() {
  // Provider names and zoom metadata belong to Layers/Maps, not the canvas.
  $("#geography-readout").textContent = terrainInfo
    ? `DTED · ${preferences.terrain_vertical_datum === "egm96" ? "EGM96 → ellipsoid" : preferences.terrain_vertical_datum === "ellipsoid" ? "ellipsoid" : "datum unresolved"} · ${preferences.terrain_exaggeration}× vertical`
    : "";
  const credits = mapsEnabled()
    ? mapLayers(preferences)
        .filter((layer) => layerVisible(layer, currentMapZoom()))
        .flatMap(
          (layer) =>
            mapPresets.find(
              (p) =>
                p.config.url === layer.config.url &&
                p.config.layer === layer.config.layer,
            )?.credits || [],
        )
    : [];
  if (preferences.basemap === "streets")
    credits.push(
      { text: "OpenFreeMap", url: "https://openfreemap.org/" },
      { text: "© OpenMapTiles", url: "https://www.openmaptiles.org/" },
      {
        text: "© OpenStreetMap contributors",
        url: "https://www.openstreetmap.org/copyright",
      },
    );
  const unique = [
    ...new Map(
      credits.map((credit) => [credit.text + credit.url, credit]),
    ).values(),
  ];
  $("#map-attribution").innerHTML = unique
    .map(
      (credit) =>
        `<a href="${esc(credit.url)}" target="_blank" rel="noopener noreferrer">${esc(credit.text)}</a>`,
    )
    .join(" · ");
  view.mapCredits = unique.map((credit) => `${credit.text} (${credit.url})`);
}
function layers() {
  const zoom = currentMapZoom();
  geographyReadout();
  $("#layer-list").innerHTML =
    `<div class="layer-heading">Data · double-click for attributes</div>` +
    (snapshot.layers || [])
      .map(
        (l) =>
          `<div class="layer-card data-layer ${l.enabled ? "" : "muted"}" data-layer-source="${esc(l.source)}" tabindex="0" role="group" aria-label="${esc(l.source || "Unattributed data")}"><input type="checkbox" data-source-toggle="${esc(l.source)}" aria-label="Show ${esc(l.source || "data layer")}" ${l.enabled ? "checked" : ""}><div><strong>${esc(l.source || "Unattributed data")}</strong><small>${l.count.toLocaleString()} rows · ${l.visible.toLocaleString()} visible</small></div><button class="icon layer-options" data-layer-menu="${esc(l.source)}" aria-label="Layer options">⋯</button></div>`,
      )
      .join("") +
    ((snapshot.gis_layers || []) as GisLayer[])
      .map(
        (layer) =>
          `<div class="layer-card ${layer.enabled ? "" : "muted"}" data-gis-id="${esc(layer.id)}" tabindex="0" role="group" aria-label="${esc(layer.name)}"><input type="checkbox" data-gis-toggle="${esc(layer.id)}" ${layer.enabled ? "checked" : ""} aria-label="Show ${esc(layer.name)}"><div><strong>${esc(layer.name)}</strong><small>${esc((layer.source_format || layer.format).toUpperCase())} · ${layer.feature_count.toLocaleString()} features${view.gis?.errors.has(layer.id) ? " · load error" : ""}</small></div><button class="icon" data-gis-options="${esc(layer.id)}" aria-label="GIS layer options">⋯</button></div>`,
      )
      .join("") +
    `<div class="layer-heading">Geography</div><div class="layer-card" data-layer-kind="reference" tabindex="0" role="group">${icon("layers")}<div><strong>${mode === "globe" ? "WGS84 globe" : "Coordinate reference plane"}</strong><small>${mode === "globe" ? "Bundled Earth image · offline" : `WGS84 · ${preferences.coordinates.toUpperCase()}`}</small></div><button class="icon" data-geography-options="reference" aria-label="Coordinate reference settings">⋯</button></div>` +
    (preferences.basemap === "streets"
      ? `<div class="layer-card" data-layer-kind="reference" tabindex="0" role="group">${icon("layers")}<div><strong>Streets</strong><small>OpenFreeMap · Positron · automatic detail</small></div><button data-open-map title="Map settings">…</button></div>`
      : "") +
    mapLayers(preferences)
      .map(
        (l) =>
          `<div class="layer-card ${layerVisible(l, zoom) ? "" : "muted"}" data-layer-kind="raster" tabindex="0" role="group"><input type="checkbox" data-map-toggle="${esc(l.id)}" ${l.config.enabled ? "checked" : ""} aria-label="Enable ${esc(l.name)}"><div><strong>${esc(l.name)}</strong><small>${esc(l.server_name)} · zoom ${l.min_zoom}–${l.max_zoom}</small></div><button class="icon" data-map-stack-open aria-label="Map layer visibility and order">⋯</button></div>`,
      )
      .join("") +
    (terrainInfo
      ? `<div class="layer-card" data-layer-kind="terrain" tabindex="0" role="group">${icon("terrain")}<div><strong>DTED terrain</strong><small>${terrainInfo.tiles.length} tile(s) · ${preferences.terrain_vertical_datum === "egm96" ? "EGM96 MSL → ellipsoid" : preferences.terrain_vertical_datum === "ellipsoid" ? "ellipsoid" : "datum unresolved; not displayed"} · ${preferences.terrain_exaggeration}× vertical</small></div><button class="icon" data-geography-options="terrain" aria-label="Terrain settings">⋯</button></div>`
      : "");
  $("#fit-terrain").hidden = !terrainInfo;
}
function closeLayerMenu() {
  const menu = layerMenu;
  layerMenu = null;
  menu?.remove();
  $("#toggle-table").setAttribute("aria-expanded", "false");
}
function showTablesMenu() {
  if (layerMenu?.id === "tables-menu") {
    closeLayerMenu();
    return;
  }
  closeLayerMenu();
  const menu = document.createElement("div");
  menu.id = "tables-menu";
  menu.className = "layer-context-menu tables-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Layer attribute tables");
  menu.innerHTML =
    (snapshot.layers || [])
      .map(
        (layer) =>
          `<button role="menuitem" data-table-layer-source="${esc(layer.source)}"><strong>${esc(layer.source || "Unattributed data")}</strong><small>${layer.count.toLocaleString()} events${layer.enabled ? "" : " · hidden"}</small></button>`,
      )
      .join("") +
    ((snapshot.gis_layers || []) as GisLayer[])
      .filter((layer) => layer.feature_count > 0)
      .map(
        (layer) =>
          `<button role="menuitem" data-table-gis-id="${esc(layer.id)}"><strong>${esc(layer.name)}</strong><small>${layer.feature_count.toLocaleString()} features · ${esc((layer.source_format || layer.format).toUpperCase())}${layer.enabled ? "" : " · hidden"}</small></button>`,
      )
      .join("");
  if (!menu.childElementCount)
    menu.innerHTML =
      '<button role="menuitem" disabled>No layers with attribute tables</button>';
  layerMenu = menu;
  document.body.append(menu);
  const trigger = $("#toggle-table");
  const bounds = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, bounds.left))}px`;
  menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, bounds.bottom + 4))}px`;
  trigger.setAttribute("aria-expanded", "true");
  menu.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    if (!button) return;
    closeLayerMenu();
    const source = button.dataset.tableLayerSource;
    const id = button.dataset.tableGisId;
    void (id ? openGisAttributes(id) : openAttributes(source!)).catch((error) =>
      toast(String(error), true),
    );
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLayerMenu();
      trigger.focus();
    } else if (event.key === "Tab") {
      closeLayerMenu();
      trigger.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const items = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[index]?.focus();
    }
  });
  // WKWebView can emit focusout with no relatedTarget before a pointer's
  // click. Outside pointerdown, Escape and Tab dismiss without dropping clicks.
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

function showLayerMenu(layer: HTMLElement, x: number, y: number) {
  closeLayerMenu();
  const source = layer.dataset.layerSource;
  const gisId = layer.dataset.gisId;
  if (gisId) {
    void gisLayerMenu(gisId).catch(gisTable.onError);
    return;
  }
  layerMenu = document.createElement("div");
  layerMenu.className = "layer-context-menu";
  layerMenu.setAttribute("role", "menu");
  layerMenu.innerHTML =
    source !== undefined
      ? '<button role="menuitem" id="open-attributes">Open attribute table</button>'
      : '<button role="menuitem" disabled>Attribute table unavailable · geographic layer</button>';
  document.body.append(layerMenu);
  layerMenu.style.left = `${Math.max(8, Math.min(innerWidth - layerMenu.offsetWidth - 8, x))}px`;
  layerMenu.style.top = `${Math.max(8, Math.min(innerHeight - layerMenu.offsetHeight - 8, y))}px`;
  layerMenu
    .querySelector<HTMLButtonElement>("#open-attributes")
    ?.addEventListener("click", () => {
      closeLayerMenu();
      openAttributes(source!).catch((e) => toast(String(e), true));
    });
  layerMenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
async function openAttributes(source: string | null) {
  gisTable.close();
  tableAnchor = null;
  tableActiveId = null;
  tableDisplayCell = null;
  tableSource = source;
  tableColumnOffset = 0;
  tableRespectFilters = true;
  tableSort = "time";
  tableDescending = false;
  resetTableScroll();
  tableOpen = true;
  $("#table-panel").classList.add("open");
  $("#toggle-table").classList.add("active");
  await table();
  view.resize();
}
$("#layer-list").addEventListener("contextmenu", (e) => {
  const layer = (e.target as Element).closest<HTMLElement>(".layer-card");
  if (layer) {
    e.preventDefault();
    showLayerMenu(layer, e.clientX, e.clientY);
  }
});
$("#layer-list").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-layer-menu]");
  if (b) {
    const r = b.getBoundingClientRect();
    showLayerMenu(b.closest<HTMLElement>(".layer-card")!, r.left, r.bottom);
  }
});
$("#layer-list").addEventListener("keydown", (e) => {
  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
    const layer = (e.target as Element).closest<HTMLElement>(".layer-card");
    if (layer) {
      e.preventDefault();
      const r = layer.getBoundingClientRect();
      showLayerMenu(layer, r.left, r.bottom);
    }
  }
});
$("#layer-list").addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-map-stack-open]"))
    void mapLayerMenu().catch((e) => toast(String(e), true));
});
$("#layer-list").addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLElement>(
    "[data-geography-options]",
  );
  if (button?.dataset.geographyOptions === "terrain") terrainMenu();
  else if (button) void settings().catch((error) => toast(String(error), true));
});
$("#layer-list").addEventListener("dblclick", (e) => {
  if ((e.target as Element).closest("input,button")) return;
  const layer = (e.target as Element).closest<HTMLElement>(".layer-card");
  if (!layer) return;
  e.preventDefault();
  closeLayerMenu();
  if (layer.dataset.gisId) {
    const item = ((snapshot.gis_layers || []) as GisLayer[]).find(
      (l) => l.id === layer.dataset.gisId,
    );
    if (item?.feature_count)
      void openGisAttributes(item.id).catch(gisTable.onError);
    else void gisLayerMenu(layer.dataset.gisId).catch(gisTable.onError);
  } else if (layer.dataset.layerSource !== undefined)
    void openAttributes(layer.dataset.layerSource).catch((error) =>
      toast(String(error), true),
    );
  else layer.querySelector<HTMLButtonElement>("button")?.click();
});
$("#layer-list").addEventListener("click", (event) => {
  const id = (event.target as Element).closest<HTMLElement>(
    "[data-gis-options]",
  )?.dataset.gisOptions;
  if (id) void gisLayerMenu(id).catch(gisTable.onError);
});
$("#layer-list").addEventListener("change", (e) => {
  const c = e.target as HTMLInputElement;
  if (c.dataset.gisToggle) {
    void call("gis_set", { id: c.dataset.gisToggle, enabled: c.checked })
      .then(() => refresh(false))
      .catch(gisTable.onError);
    return;
  }
  if (c.dataset.mapToggle !== undefined) {
    const stack = structuredClone(mapLayers(preferences));
    const layer = stack.find((l) => l.id === c.dataset.mapToggle);
    if (!layer) return;
    layer.config.enabled = c.checked;
    void (async () => {
      await cancelMap();
      preferences = await call("preferences", {
        preferences: { map_layers: stack },
      });
      mapUnavailable = false;
      await refresh(false);
      await loadRasters();
    })().catch((e) => toast(String(e), true));
  }
  if (c.dataset.sourceToggle !== undefined) {
    const sources = new Set(snapshot.filter.hidden_sources || []);
    c.checked
      ? sources.delete(c.dataset.sourceToggle)
      : sources.add(c.dataset.sourceToggle);
    filter({ hidden_sources: [...sources] }).catch((error) =>
      toast(String(error), true),
    );
  }
});
document.addEventListener("contextmenu", (event) => {
  const target = event.target as Element;
  if (
    !target.closest(
      'input,textarea,[contenteditable="true"],pre,.agent-commands,.help-guide',
    )
  )
    event.preventDefault();
});
document.addEventListener("pointerdown", (e) => {
  if (
    layerMenu &&
    !layerMenu.contains(e.target as Node) &&
    !(
      layerMenu.id === "tables-menu" &&
      (e.target as Element).closest("#toggle-table")
    )
  )
    closeLayerMenu();
});
const filterIntent = new FilterIntent<Filter>(
  async () => {
    const current = await call("snapshot", {
      compact: true,
      include_statistics: false,
    });
    return { filter: current.filter as Filter, revision: current.revision };
  },
  (filter, revision) => call("filter", { filter, expected_revision: revision }),
  async () => {
    tableAnchor = null;
    tableActiveId = null;
    resetTableScroll();
    await refresh();
  },
);
function filter(
  delta: Partial<Filter>,
  delay = 0,
  progressive = false,
): Promise<void> {
  return filterIntent.enqueue(delta, delay, progressive);
}
async function select(ids: string[], add = false, reveal = false) {
  await call("select", { ids, mode: add ? "add" : "replace" });
  if (reveal && tableOpen) tableReveal = ids[0] ?? null;
  await refresh(false);
}
view.onPick = (ids, add) =>
  select(ids, add, true).catch((e) => toast(String(e), true));
function locationLabel(e: any) {
  if (e.location_kind === "polygon-centroid")
    return `Centroid · ${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`;
  const c = e.coordinate_formats;
  if (!c)
    return e.geometry_wkt
      ? `WKT ${
          String(e.geometry_wkt)
            .replace(/^SRID=4326;/i, "")
            .split(/[ (]/)[0]
        }`
      : e.lat != null
        ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`
        : "No location";
  if (preferences.coordinates === "mgrs") return c.mgrs;
  if (preferences.coordinates === "utm") {
    const u = c.utm;
    return `${u.zone === 0 ? "UPS " : u.zone}${u.hemisphere} ${u.easting.toFixed(1)} ${u.northing.toFixed(1)}`;
  }
  return `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
}
async function table(
  preloaded?: any,
  parentGeneration = serial,
  selectedIds?: string[],
) {
  const generation = ++tableSerial;
  $("#gis-table-search").hidden = !gisTable.layerId;
  if (gisTable.layerId) {
    const layer = ((snapshot.gis_layers || []) as GisLayer[]).find(
      (l) => l.id === gisTable.layerId,
    );
    if (!layer) {
      gisTable.close();
      return table();
    }
    for (const id of [
      "#table-fields",
      "#previous-fields",
      "#next-fields",
      "#table-filter-option",
    ])
      $(id).hidden = true;
    $("#table-all").hidden = false;
    $("#table-title").textContent = `GIS · ${layer.name}`;
    const r = await gisTable.render(layer, page * 50);
    if (!r || generation !== tableSerial) return;
    tableTotal = r.count;
    $("#table-count").textContent =
      `${r.count.toLocaleString()} reference features · ${layer.selected.length} selected`;
    $(".table-scroll table").setAttribute("aria-rowcount", String(r.count + 1));
    return;
  }
  const requestedWindow = page;
  const r = preloaded || (await call("attribute_table", tablePageArguments()));
  if (generation !== tableSerial || parentGeneration !== serial) return;
  if (!tableReveal && requestedWindow !== page) return;
  const exactSelected = new Set(
    selectedIds ||
      (
        await call("selection_contains", {
          ids: r.events.map((e: any) => e.id),
        })
      ).selected,
  );
  if (generation !== tableSerial || parentGeneration !== serial) return;
  const reveal = tableReveal;
  if (reveal && r.reveal_found !== undefined) {
    tableReveal = null;
    if (r.reveal_found === false)
      toast(
        "Selected event is outside this table’s source or filter scope. Adjust the table source or workspace filters to reveal it.",
      );
  }
  page = Math.floor(r.offset / 50);
  tableTotal = r.count;
  if (page > 0 && page * 50 >= tableTotal) {
    page = Math.max(0, Math.ceil(tableTotal / 50) - 1);
    return table();
  }
  $("#table-title").textContent =
    `Attributes · ${tableSource || "all sources"}`;
  $("#table-title").setAttribute("title", tableSource || "All sources");
  for (const id of ["#table-fields", "#previous-fields", "#next-fields"])
    $(id).hidden = false;
  $("#table-fields").textContent =
    `${tableColumnOffset + 1}–${Math.min(tableColumnOffset + 32, r.total_columns)} of ${r.total_columns} fields`;
  ($("#previous-fields") as HTMLButtonElement).disabled =
    tableColumnOffset === 0;
  ($("#next-fields") as HTMLButtonElement).disabled =
    tableColumnOffset + 32 >= r.total_columns;
  $("#table-filter-option").hidden = false;
  $("#table-all").hidden = tableSource === null;
  ($("#table-respect-filters") as HTMLInputElement).checked =
    tableRespectFilters;
  $("#table-count").textContent =
    `${tableTotal.toLocaleString()} events${r.columns_limited ? " · first 512 source fields" : ""}`;
  const columns = r.columns as string[];
  const titles: Record<string, string> = {
    time: "Time / UTC",
    end: "End / UTC",
    lat: "Latitude",
    lon: "Longitude",
    mgrs_precision: "MGRS digits per half",
  };
  const headers = columns.map((c) => [
    c,
    c.startsWith("attribute:")
      ? `Original · ${c.slice(10)}`
      : titles[c] || c.replaceAll("_", " "),
  ]);
  $("#table-head").innerHTML =
    `<tr>${headers.map(([c, title]) => `<th aria-sort="${tableSort === c ? (tableDescending ? "descending" : "ascending") : "none"}"><button data-table-sort="${esc(c)}" aria-label="Sort by ${esc(c)}">${esc(title)}${tableSort === c ? (tableDescending ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr>`;
  const value = (e: any, c: string) => {
    if (c.startsWith("attribute:")) return e[c] ?? e.attrs?.[c.slice(10)] ?? "";
    if (c === "time" || c === "end") return e[c] == null ? "" : time(e[c]);
    if (Array.isArray(e[c])) return e[c].join("; ");
    return e[c] ?? "";
  };
  const hadTableFocus = !!document.activeElement?.closest(
    "#table-body [data-event]",
  );
  const spacer = (rows: number) =>
    rows > 0
      ? `<tr class="table-spacer" aria-hidden="true"><td colspan="${columns.length}" style="height:${rows * tableRowUnit()}px"></td></tr>`
      : "";
  $("#table-body").innerHTML =
    spacer(r.offset) +
    (r.events
      .map(
        (e: any, index: number) =>
          `<tr tabindex="${e.id === tableActiveId || (!tableActiveId && index === 0) ? 0 : -1}" aria-rowindex="${page * 50 + index + 2}" data-event="${esc(e.id)}" aria-selected="${exactSelected.has(e.id)}" class="${exactSelected.has(e.id) ? "selected" : ""}">${columns.map((c) => `<td>${esc(value(e, c))}</td>`).join("")}</tr>`,
      )
      .join("") ||
      `<tr><td colspan="${columns.length}">No events in this scope.</td></tr>`) +
    spacer(Math.max(0, tableTotal - r.offset - r.events.length));
  $(".table-scroll table").setAttribute(
    "aria-rowcount",
    String(tableTotal + 1),
  );
  if (hadTableFocus && tableActiveId) {
    const active = Array.from(
      $("#table-body").querySelectorAll<HTMLElement>("[data-event]"),
    ).find((row) => row.dataset.event === tableActiveId);
    active?.focus({ preventScroll: true });
  }
  if (reveal) {
    const row = Array.from(
      $("#table-body").querySelectorAll<HTMLElement>("[data-event]"),
    ).find((row) => row.dataset.event === reveal);
    if (row)
      $(".table-scroll").scrollTop =
        row.offsetTop - $("#table-head").clientHeight;
  }
}
$("#table-head").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-table-sort]");
  if (!b) return;
  const c = b.dataset.tableSort!;
  tableDescending = tableSort === c ? !tableDescending : false;
  tableSort = c;
  tableAnchor = null;
  tableActiveId = null;
  resetTableScroll();
  table().catch((e) => toast(String(e), true));
});
$("#table-respect-filters").addEventListener("change", () => {
  tableRespectFilters = check("#table-respect-filters");
  tableAnchor = null;
  tableActiveId = null;
  resetTableScroll();
  table().catch((e) => toast(String(e), true));
});
on("#previous-fields", async () => {
  tableColumnOffset = Math.max(0, tableColumnOffset - 32);
  await table();
});
on("#next-fields", async () => {
  tableColumnOffset += 32;
  await table();
});
on("#table-all", () => openAttributes(null));
function history() {
  return `<div class="row"><button id="undo" class="secondary" ${snapshot.undo ? "" : "disabled"}>Undo</button><button id="redo" ${snapshot.redo ? "" : "disabled"}>Redo</button></div>`;
}
async function inspector(preloaded?: any, parentGeneration = serial) {
  const el = $("#inspector-content");
  if (tab === "charts") {
    void chartsPanel
      .render(snapshot)
      .catch((error) => toast(String(error), true));
    return;
  }
  chartsPanel.hide();
  if (tab === "patterns") {
    patterns();
    return;
  }
  if (tab === "views") {
    viewsPanel.render({
      options: displayOptions,
    });
    return;
  }
  if (snapshot.selected_count !== 1) {
    editor.deactivate();
    el.innerHTML = `<div class="empty-inspector"><h3>${snapshot.selected_count ? `${snapshot.selected_count} events selected` : "No event selected"}</h3><p>Select an event in the scene or table to inspect its details. Every view shares the same selection.</p><div class="tip"><kbd>Click</kbd><span>Inspect an event and its source values.</span></div><div class="tip"><kbd>Shift</kbd><span>Add events to the current selection.</span></div><div class="tip"><kbd>Box</kbd><span>Draw a region to select events in the scene.</span></div></div><div class="divider"></div><div class="caps">Selected events</div><label class="field">Entity name<input id="reassign-name" placeholder="Merge or split into an entity"></label><button id="reassign" class="secondary" ${snapshot.selected_count ? "" : "disabled"}>Reassign selection</button><label class="field" style="margin-top:15px">Tag<input id="tag-value" placeholder="Add an analyst tag"></label><button id="tag" class="secondary" ${snapshot.selected_count ? "" : "disabled"}>Add tag</button><button id="suggest-tags" class="secondary" ${snapshot.selected_count ? "" : "disabled"}>Suggest tags…</button><button id="delete" ${snapshot.selected_count ? "" : "disabled"}>Remove selected</button><div class="divider"></div>${history()}`;
    return;
  }
  const r =
    preloaded || (await call("events", { id: snapshot.selected[0], limit: 1 }));
  if (parentGeneration !== serial) return;
  const e = r.events[0];
  if (!e) return;
  const focused = document.activeElement as
    HTMLInputElement | HTMLTextAreaElement | null;
  const previousTarget = editor.target;
  const caret =
    focused?.id.startsWith("edit-") &&
    previousTarget?.workspace === snapshot.workspace_id &&
    previousTarget.id === e.id
      ? {
          id: focused.id,
          start: focused.selectionStart,
          end: focused.selectionEnd,
        }
      : null;
  const fields = editor.open(
    {
      workspace: snapshot.workspace_id,
      id: e.id,
      revision: snapshot.revision,
      originalWkt: e.geometry_wkt || "",
    },
    {
      entity: e.entity,
      time: time(e.time),
      label: e.label,
      category: e.category,
      related: e.related_to,
      lat: e.lat == null ? "" : String(e.lat),
      lon: e.lon == null ? "" : String(e.lon),
      wkt: e.geometry_wkt || "",
      note: e.note,
      tags: e.tags.join(", "),
    },
  );
  el.innerHTML = `<div class="caps">Event ${esc(e.id)}</div><h3 style="font-size:22px;font-weight:400;margin:8px 0">${esc(e.entity)}</h3><p class="mono muted" style="font-size:9px;margin-bottom:20px">${esc(e.source)} · row ${e.source_row}</p><div class="notice mono">${esc(locationLabel(e))}${e.location_kind === "polygon-centroid" ? "<br><small>Derived polygon surface centroid · not a measured point. Full boundary retained; a centroid can lie outside a concave polygon.</small>" : ""}${e.lat == null && !e.geometry_wkt ? "<br><small>△ A triangle may show an estimated position between located events on this trail. The actual location remains unknown. Unbracketed events are available in the table and timeline.</small>" : ""}${e.mgrs_precision == null ? "" : `<br><small>${10 ** (5 - e.mgrs_precision)} m MGRS grid · marker at square centre</small>`}</div>${[
    ["entity", "Entity", fields.entity],
    ["time", "Timestamp / UTC", fields.time],
    ["label", "Label", fields.label],
    ["category", "Category", fields.category],
    ["related", "Related entity", fields.related],
    ["lat", "Latitude", fields.lat],
    ["lon", "Longitude", fields.lon],
  ]
    .map(
      ([key, title, value]) =>
        `<label class="field">${title}<input id="edit-${key}" value="${esc(value)}"></label>`,
    )
    .join(
      "",
    )}<label class="field">WKT geometry / WGS84 X Y<textarea id="edit-wkt" rows="3">${esc(fields.wkt)}</textarea></label><label class="field">Analyst note<textarea id="edit-note" rows="3">${esc(fields.note)}</textarea></label><label class="field">Tags<input id="edit-tags" value="${esc(fields.tags)}"></label><button id="suggest-tags" class="secondary">Suggest tags…</button><button id="apply-edit" class="primary">Apply changes</button><details><summary>Original source attributes</summary>${Object.entries(
    e.attrs,
  )
    .map(
      ([k, v]) =>
        `<div style="margin:9px 0"><small class="muted">${esc(k)}</small><p class="mono" style="margin-top:4px;overflow-wrap:anywhere">${esc(v)}</p></div>`,
    )
    .join("")}</details><div class="divider"></div>${history()}`;
  if (caret) {
    const field = document.getElementById(caret.id) as
      HTMLInputElement | HTMLTextAreaElement | null;
    field?.focus({ preventScroll: true });
    if (caret.start !== null && caret.end !== null)
      field?.setSelectionRange(caret.start, caret.end);
  }
}
function savedViews() {
  const content = `<h3>Views and selection groups</h3><p class="description muted" style="font-size:11px;margin:12px 0 20px">Save the current filters, selection and camera as a view, or save selected events as a group.</p><label class="field">Name<input id="view-name" placeholder="Morning activity…"></label><div class="row"><button id="save-view" class="secondary">Save view</button><button id="save-group">Save group</button></div><div class="caps">Saved views</div>${snapshot.views.map((v, i) => `<button class="finding" data-view-index="${i}">${esc(v.name)}</button>`).join("") || '<small class="muted">No views saved yet.</small>'}<div class="caps">Selection groups</div>${snapshot.groups.map((g, i) => `<button class="finding" data-group-index="${i}">${esc(g.name)} · ${g.ids_count ?? g.ids.length}</button>`).join("")}`;

  const panel = modal(head("Saved views and groups") + content);
  panel.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("button");
    if (!button) return;
    void (async () => {
      if (button.id === "save-view" || button.id === "save-group") {
        const name = input("#view-name");
        await call(button.id === "save-view" ? "save_view" : "save_group", {
          name,
          ...(button.id === "save-view" ? { scene: captureScene() } : {}),
        });
        await refresh(false);
        savedViews();
      } else if (
        button.dataset.viewIndex !== undefined ||
        button.dataset.groupIndex !== undefined
      ) {
        const restored = await call(
          button.dataset.viewIndex !== undefined
            ? "restore_view"
            : "restore_group",
          {
            index: Number(
              button.dataset.viewIndex ?? button.dataset.groupIndex,
            ),
          },
        );
        closeModal();
        if (button.dataset.viewIndex !== undefined)
          await restoreScene(restored.scene);
        else await refresh();
      }
    })().catch((error) => toast(String(error), true));
  });
}
function patterns() {
  patternsPanel.render(
    snapshot,
    `<p class="muted">Choose domain thresholds for a targeted spatial or track analysis.</p><label class="field">Pattern<select id="pattern">${["Proximity", "Stationary", "Gaps", "Speed", "Clusters"].map((p) => `<option>${p}</option>`).join("")}</select></label><label class="check-row"><input type="checkbox" id="analysis-selection"> Selected visible events only</label><div class="modal-grid">${[
      ["radius", "Radius / metres", 150],
      ["tolerance", "Time tolerance / s", 300],
      ["duration", "Min duration / s", 900],
      ["gap", "Gap / seconds", 1800],
      ["speed", "Speed / km/h", 80],
      ["cluster", "Cluster size", 3],
    ]
      .map(
        ([id, label, n]) =>
          `<label class="field">${label}<input id="${id}" type="number" step="${id === "cluster" ? "1" : "any"}" value="${n}"></label>`,
      )
      .join(
        "",
      )}</div><button id="run-analysis" class="primary">Run analysis</button><div class="notice">Findings describe observed samples, not confirmed meetings or routes. Clusters use transitive connectivity. Stationary periods require bounded event gaps.</div>`,
    `<div class="caps">${findings.length} findings ${findings.length && findingsRevision !== snapshot.revision ? "· rerun after changes" : ""}</div>${findings.map((f, i) => `<article class="finding" data-finding="${i}"><strong>${esc(f.summary)}</strong><p>${esc(f.metric)}</p></article>`).join("")}`,
  );
}
function closeModal() {
  const pending = resolveGuard;
  resolveGuard = null;
  pending?.(false);
  modalNode?.remove();
  modalNode = null;
}
function modal(html: string, small = false) {
  closeModal();
  modalNode = document.createElement("div");
  modalNode.className = "modal-backdrop";
  modalNode.innerHTML = `<section class="modal ${small ? "small" : ""}">${html}</section>`;
  document.body.append(modalNode);
  modalNode
    .querySelectorAll("[data-close]")
    .forEach((e) => e.addEventListener("click", closeModal));
  return modalNode;
}
function head(title: string) {
  return `<div class="modal-head"><h2>${title}</h2><button data-close class="icon">${icon("close")}</button></div>`;
}
async function openGisAttributes(id: string) {
  gisTable.open(id);
  tableAnchor = null;
  tableActiveId = null;
  tableDisplayCell = null;
  resetTableScroll();
  tableOpen = true;
  $("#gis-table-search").setAttribute("value", "");
  ($("#gis-table-search") as HTMLInputElement).value = "";
  $("#table-panel").classList.add("open");
  $("#toggle-table").classList.add("active");
  await refresh(false);
  view.resize();
}
async function fitGisLayer(id: string) {
  await view.ready;
  const layer = view.gis.descriptors.find((l) => l.id === id);
  if (layer?.bounds && mode === "space-time") {
    const [w, s, e, n] = layer.bounds;
    const pad = Math.max(0.02, e - w, n - s) * 0.15;
    overrideBounds = [
      Math.max(-180, w - pad),
      Math.max(-90, s - pad),
      Math.min(180, e + pad),
      Math.min(90, n + pad),
    ];
    await refresh(true, false);
  }
  await view.gis.fit(id);
  if (layer?.time_bounds) {
    focus = Math.max(
      0,
      Math.min(
        1,
        (view.gis.currentTime() - snapshot.time_bounds[0]) /
          Math.max(1e-9, snapshot.time_bounds[1] - snapshot.time_bounds[0]),
      ),
    );
    updateTimeFocus();
  }
  view.onSceneChange();
}
async function openGisFile(path: string, format: string) {
  const model = ["gltf", "glb"].includes(format),
    asset = model || format === "tiles3d",
    binaryVector = ["shapefile", "geopackage"].includes(format);
  const center = [
    (view.bounds[0] + view.bounds[2]) / 2,
    (view.bounds[1] + view.bounds[3]) / 2,
    0,
  ];
  modal(
    `${head("Open GIS file")}<p class="description">${esc(path.split(/[\\/]/).pop())} · ${esc(format.toUpperCase())}</p><p class="description">${binaryVector ? "Add a reference layer to display WGS84 XY shapes and attributes. " : "Add a reference layer to retain native shapes, styling and animation. "}${format === "geopackage" ? "Vector tables are combined, with their names retained in the source_layer attribute. " : ""}${asset ? "3D assets use their physical dimensions and placement." : "Import as Events to map timestamps and use Chronoscope filters, tracks and analysis. Timeless features can remain reference layers."}</p>${model ? `<label class="field">Model location · longitude, latitude, ellipsoidal height (metres)<input id="gis-model-position" value="${center.join(", ")}"></label><label class="field">Model scale<input id="gis-model-scale" type="number" min="0.000001" max="1000000" value="1" step="any"></label>` : ""}<p class="description">Local companion assets are included in the workspace. External links and KML NetworkLinks are disabled.</p><footer><button data-close>Cancel</button><span class="spacer"></span>${asset ? "" : '<button id="gis-open-events">Import as Events…</button>'}<button class="primary" id="gis-open-reference">Add reference layer</button></footer>`,
  );
  if (!asset)
    on("#gis-open-events", async () => {
      closeModal();
      await importPreview(path, "auto");
    });
  on("#gis-open-reference", async () => {
    const args: {
      path: string;
      position?: [number, number, number];
      scale?: number;
    } = { path };
    if (model) {
      args.position = input("#gis-model-position").split(",").map(Number) as [
        number,
        number,
        number,
      ];
      args.scale = Number(input("#gis-model-scale"));
      if (args.position.length !== 3 || !args.position.every(Number.isFinite))
        throw Error("Enter longitude, latitude and ellipsoidal height");
    }
    const { layer } = await task("Reading GIS source and local assets…", () =>
      call("gis_load", args),
    );
    closeModal();
    await refresh(true, false);
    await fitGisLayer(layer.id);
    if (layer.warnings.length) toast(layer.warnings.join(" "));
  });
}
async function gisLayerMenu(id: string) {
  const { layers: items } = await call("gis_layers");
  const layer = items.find((l) => l.id === id);
  if (!layer) return;
  const model = ["gltf", "glb"].includes(layer.format);
  modal(
    `${head("GIS layer")}<label class="field">Name<input id="gis-layer-name" value="${esc(layer.name)}"></label><p class="description">${esc((layer.source_format || layer.format).toUpperCase())} · ${layer.feature_count.toLocaleString()} features · ${layer.resource_count.toLocaleString()} packaged files · ${(layer.bytes / 1048576).toFixed(1)} MiB</p><label class="check-row"><input id="gis-layer-enabled" type="checkbox" ${layer.enabled ? "checked" : ""}> Show layer</label>${model ? `<label class="field">Location · longitude, latitude, ellipsoidal height (metres)<input id="gis-layer-position" value="${layer.position!.join(", ")}"></label><label class="field">Scale<input id="gis-layer-scale" type="number" step="any" min="0.000001" max="1000000" value="${layer.scale}"></label>` : ""}${layer.warnings.map((w) => `<p class="description">${esc(w)}</p>`).join("")}${view.gis.errors.has(id) ? `<p class="error">${esc(view.gis.errors.get(id))}</p>` : ""}<div class="row"><button id="gis-layer-fit">Fit layer</button>${layer.feature_count ? '<button id="gis-layer-table">Attribute table</button><button id="gis-layer-events">Import as Events…</button>' : ""}</div><footer><button class="danger" id="gis-layer-remove">Remove layer</button><span class="spacer"></span><button data-close>Cancel</button><button class="primary" id="gis-layer-apply">Apply</button></footer>`,
  );
  on("#gis-layer-fit", async () => {
    closeModal();
    await fitGisLayer(id);
  });
  if (layer.feature_count) {
    on("#gis-layer-table", async () => {
      closeModal();
      await openGisAttributes(id);
    });
    on("#gis-layer-events", async () => {
      closeModal();
      if (await guardUnsaved("import GIS features as Events"))
        await importPreview("", "auto", id);
    });
  }
  on("#gis-layer-remove", async () => {
    await call("gis_remove", { id });
    if (gisTable.layerId === id) gisTable.close();
    closeModal();
    await refresh(false);
  });
  on("#gis-layer-apply", async () => {
    const args: any = {
      id,
      name: input("#gis-layer-name"),
      enabled: check("#gis-layer-enabled"),
    };
    if (model) {
      args.position = input("#gis-layer-position").split(",").map(Number);
      args.scale = Number(input("#gis-layer-scale"));
    }
    await call("gis_set", args);
    view.gis.retry(id);
    closeModal();
    await refresh(false);
  });
}

async function importPreview(
  path: string,
  delimiter: NonNullable<
    EngineContracts["import_preview"]["args"]["delimiter"]
  >,
  gisLayer?: string,
) {
  const preview = await task("Reading headers and source values…", () =>
    gisLayer
      ? call("gis_import_preview", { id: gisLayer })
      : call("import_preview", { path, delimiter }),
  );
  let sheet = 0,
    mapping = preview.sheets[0].mapping;
  function draw() {
    const s = preview.sheets[sheet];
    const fields = [
      ["time", "Timestamp/date *"],
      ["clock", "Separate time"],
      ["coordinate_column", "Combined DD/UTM coordinate"],
      ["entity", "Entity"],
      ["lat", "Latitude (DD)"],
      ["lon", "Longitude (DD)"],
      ["easting", "UTM easting"],
      ["northing", "UTM northing"],
      ["zone", "UTM zone"],
      ["hemisphere", "UTM hemisphere N/S"],
      ["mgrs", "MGRS reference"],
      ["geometry_wkt", "WKT geometry (X longitude, Y latitude)"],
      ["category", "Category"],
      ["label", "Label"],
      ["value", "Numeric value"],
      ["related_to", "Related entity"],
      ["end", "End timestamp"],
    ];
    const el = modal(
      `${head("Import data")}<p class="description">${esc(preview.source)} · ${s.count.toLocaleString()} rows · original columns are retained.</p><div class="modal-grid"><label class="field">Worksheet<select id="import-sheet">${preview.sheets.map((s: any, i: number) => `<option value="${i}" ${i === sheet ? "selected" : ""}>${esc(s.sheet)}</option>`).join("")}</select></label><label class="field">CSV delimiter<select id="import-delimiter"><option value="auto" ${delimiter === "auto" ? "selected" : ""}>Auto detect</option><option value="|" ${delimiter === "|" ? "selected" : ""}>Pipe</option><option value="," ${delimiter === "," ? "selected" : ""}>Comma</option><option value=";" ${delimiter === ";" ? "selected" : ""}>Semicolon</option><option value="\t" ${delimiter === "\t" ? "selected" : ""}>Tab</option></select></label><label class="field">Input coordinates<select id="import-crs">${["dd", "utm", "mgrs"].map((c) => `<option ${c === mapping.coordinate_system ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field">Default entity<input id="default-entity" value="${esc(mapping.default_entity)}"></label>${fields.map(([key, title]) => `<label class="field">${title}<select data-map="${key}"><option value="">Not mapped</option>${s.headers.map((h: string, i: number) => `<option value="${i}" ${mapping[key] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`).join("")}<label class="field">Default UTM zone<input id="default-zone" type="number" min="1" max="60" value="${mapping.default_zone || ""}"></label><label class="field">Default hemisphere<select id="default-hemisphere"><option value="">Choose…</option><option ${mapping.default_hemisphere === "N" ? "selected" : ""}>N</option><option ${mapping.default_hemisphere === "S" ? "selected" : ""}>S</option></select></label><label class="field">Date order<select id="date-order">${[
        ["auto", "Auto / reject ambiguous"],
        ["dmy", "Day first"],
        ["mdy", "Month first"],
      ]
        .map(
          ([v, t]) =>
            `<option value="${v}" ${mapping.date_order === v ? "selected" : ""}>${t}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="field">Numeric time encoding<select id="time-encoding">${["auto", "unix_seconds", "unix_milliseconds", "unix_microseconds", "unix_nanoseconds", "excel_serial", "excel1904"].map((v) => `<option value="${v}" ${mapping.time_encoding === v ? "selected" : ""}>${v.replaceAll("_", " ")}</option>`).join("")}</select></label><label class="field">Default date for time-only values<input id="default-date" value="${esc(mapping.default_date)}" placeholder="YYYY-MM-DD"></label><label class="check-row"><input id="decimal-comma" type="checkbox" ${mapping.decimal_comma ? "checked" : ""}> Decimal comma numbers</label><label class="field">Custom timestamp format<input id="date-format" value="${esc(mapping.custom_format)}" placeholder="%d/%m/%Y %H:%M:%S"></label><label class="field">Naive UTC offset / minutes<input id="time-offset" type="number" value="${mapping.offset_minutes}"></label></div><div class="notice">${[...(s.notes || []), ...(s.warnings || [])].map((t: string) => `<p>${esc(t)}</p>`).join("")}</div><div class="preview-scroll"><table><thead><tr>${s.headers.map((h: string) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.preview.map((r: string[]) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="notice">Input coordinates must already use WGS84; reproject other datums before importing. A UTM zone and hemisphere are separate fields. Times retain seconds and fractions; original source strings are preserved. Short MGRS grids use their centre and retain their precision.</div><details><summary>Aggregate during import (optional)</summary><label class="check-row"><input type="checkbox" id="import-aggregate"> Keep time/proximity summaries instead of all records</label><div class="modal-grid"><label class="field">Time window / minutes<input id="import-aggregate-window" type="number" min="1" max="5259600" value="15"></label><label class="field">Radius / metres<input id="import-aggregate-radius" type="number" min="1" max="20040000" value="100"></label></div><p class="description">Lossy: summaries retain counts, an anchor location, time span and mean value. Keep your original file for individual records. Uses fixed UTC windows and separate groups per entity, category and source. Unknown locations stay separate.</p></details><button id="preview-mapping">Preview conversions with these settings</button><div id="normalized-preview" class="notice"></div><footer><label class="check-row"><input id="append-import" type="checkbox"> Append to workspace</label><span class="spacer"></span><button data-close>Cancel</button><button id="commit-import" class="primary">Validate and import</button></footer>`,
    );
    $("#import-sheet").addEventListener("change", () => {
      sheet = Number(input("#import-sheet"));
      mapping = preview.sheets[sheet].mapping;
      draw();
    });
    $("#import-delimiter").addEventListener("change", () =>
      importPreview(
        path,
        input("#import-delimiter") as NonNullable<
          EngineContracts["import_preview"]["args"]["delimiter"]
        >,
      ).catch((e) => toast(String(e), true)),
    );
    function readMapping() {
      el.querySelectorAll<HTMLSelectElement>("[data-map]").forEach(
        (e) =>
          (mapping[e.dataset.map!] = e.value === "" ? null : Number(e.value)),
      );
      Object.assign(mapping, {
        coordinate_system: input("#import-crs"),
        default_entity: input("#default-entity"),
        default_zone: Number(input("#default-zone")),
        default_hemisphere: input("#default-hemisphere"),
        custom_format: input("#date-format"),
        offset_minutes: Number(input("#time-offset")),
        date_order: input("#date-order"),
        time_encoding: input("#time-encoding"),
        default_date: input("#default-date"),
        decimal_comma: check("#decimal-comma"),
      });
    }
    function showNormalized(r: any) {
      $("#normalized-preview").innerHTML =
        `<b>Converted sample / UTC</b>${(r?.events || []).map((e: any) => `<p>${time(e.time)} · ${esc(e.entity)} · ${e.lat == null ? "Unlocated" : `${e.lat.toFixed(6)}, ${e.lon.toFixed(6)}`}${e.mgrs_precision == null ? "" : ` · ${10 ** (5 - e.mgrs_precision)} m MGRS grid`}</p>`).join("")}${(r?.rejected || []).map(([n, t]: any) => `<p class="error">Row ${n}: ${esc(t)}</p>`).join("")}`;
    }
    showNormalized(s.normalized);
    on("#preview-mapping", async () => {
      readMapping();
      showNormalized(
        await call("import_validate", {
          sheet,
          mapping,
          import_id: preview.import_id,
        }),
      );
    });
    on("#commit-import", async () => {
      readMapping();
      const args = {
        sheet,
        mapping,
        import_id: preview.import_id,
        append: check("#append-import"),
        accept_rejected: false,
        ...(check("#import-aggregate")
          ? {
              aggregation: {
                window_minutes: Number(input("#import-aggregate-window")),
                radius_m: Number(input("#import-aggregate-radius")),
              },
            }
          : {}),
      };
      const result = await task("Validating events…", () =>
        call("import_commit", args),
      );
      if (!result.needs_review && result.aggregation)
        toast(
          `${result.accepted.toLocaleString()} accepted records → ${(result.retained ?? result.accepted).toLocaleString()} retained summaries/records`,
        );
      if (result.needs_review) {
        modal(
          `${head("Review rejected rows")}<p class="description">${result.accepted} valid events · ${result.rejected} rejected rows. Continuing excludes these rejected rows.</p><div class="preview-scroll">${(result.reasons || []).map(([r, s]: [number, string]) => `<p class="error" style="padding:9px">Row ${r}: ${esc(s)}</p>`).join("")}</div><footer><button data-close>Cancel</button><span class="spacer"></span><button id="accept-import" class="primary">Import valid rows</button></footer>`,
        );
        on("#accept-import", async () => {
          await call("import_commit", { ...args, accept_rejected: true });
          closeModal();
          if (!args.append) {
            projectPath = null;
            tableSource = null;
            tableSort = "time";
            tableDescending = false;
            page = 0;
          }
          overrideBounds = null;
          await refresh();
          view.fit();
        });
        return;
      }
      closeModal();
      if (!args.append) {
        projectPath = null;
        tableSource = null;
        tableSort = "time";
        tableDescending = false;
        page = 0;
      }
      overrideBounds = null;
      findings = [];
      await refresh();
      view.fit();
      toast(`Imported ${result.accepted} events`);
    });
  }
  draw();
}
type MapPreset = Exclude<
  EngineContracts["wmts_servers"]["result"],
  { dry_run: true }
>["presets"][number];
let mapPresets: MapPreset[] = [];
let capabilities: any = null;
let capabilitiesURL = "";
let mapUnavailable = false;
async function mapMenu(
  draft?: Parameters<typeof wmtsMenu>[0],
  editing?: MapLayer,
) {
  if (draft || editing) return wmtsMenu(draft, editing);
  const custom = mapLayers(preferences).filter((l) => l.config.enabled).length;
  modal(
    `${head("Map")}<label class="check-row"><input id="streets-enabled" type="checkbox" ${preferences.basemap === "streets" ? "checked" : ""}> Streets</label><p class="description">Detailed worldwide streets · OpenFreeMap Positron. Detail follows your zoom automatically. No account or API key needed.</p>${custom ? `<p class="notice">${custom} custom map layer(s) are enabled and may cover Streets.</p><button id="streets-only">Use Streets only</button>` : ""}${view.resources.status.basemapError ? `<p class="error">${esc(view.resources.status.basemapError)}</p><button id="retry-streets">Retry Streets</button>` : ""}<details class="map-advanced"><summary>Advanced map settings</summary><div class="row" style="margin-top:12px"><button id="custom-map-server">Add custom map server…</button><button id="custom-map-layers">Custom layers…</button><button id="basemap-cache">Cache and loading…</button><button id="basemap-credits">Map credits</button></div><p class="description">Custom WMTS layers, authentication, opacity and zoom rules remain available here.</p></details><footer><button data-close>Cancel</button><span class="spacer"></span><button id="apply-basemap" class="primary">Apply</button></footer>`,
  );
  on("#custom-map-server", () => wmtsMenu());
  on("#custom-map-layers", mapLayerMenu);
  on("#basemap-cache", mapCacheMenu);
  on("#basemap-credits", () => view.showCredits());
  if (view.resources.status.basemapError)
    on("#retry-streets", async () => {
      await view.setBasemap("none");
      await view.setBasemap("streets");
      closeModal();
    });
  on("#apply-basemap", async () => {
    preferences = await call("preferences", {
      preferences: { basemap: check("#streets-enabled") ? "streets" : "none" },
    });
    closeModal();
    await refresh(false);
  });
  if (custom)
    on("#streets-only", async () => {
      const stack = mapLayers(preferences).map((layer) => ({
        ...layer,
        config: { ...layer.config, enabled: false },
      }));
      preferences = await call("preferences", {
        preferences: {
          basemap: "streets",
          map: { ...preferences.map, enabled: false },
          map_layers: stack,
        },
      });
      closeModal();
      await refresh(false);
      await loadRasters();
    });
}
async function wmtsMenu(
  draft?: {
    servers: any[];
    selected: string;
    config: Preferences["map"];
  },
  editing?: MapLayer,
) {
  const catalog = await call("wmts_servers");
  mapPresets = catalog.presets;
  const library = draft || catalog;
  type Server = { id: string; name: string; config: Preferences["map"] };
  const servers: Server[] = library.servers.map((s: Server) => ({
    ...s,
    config: { ...s.config },
  }));
  const initialConfig = draft?.config || editing?.config || preferences.map;
  let selected =
    draft?.selected ||
    servers.find(
      (s) =>
        s.config.url === initialConfig.url &&
        s.config.layer === initialConfig.layer &&
        s.config.matrix_set === initialConfig.matrix_set,
    )?.id ||
    servers.find((s) => s.config.url === initialConfig.url)?.id ||
    "";
  if (!selected) {
    selected = `workspace-${crypto.randomUUID()}`;
    servers.push({
      id: selected,
      name: initialConfig.url ? "Current workspace map" : "New map server",
      config: { ...initialConfig },
    });
  }
  let c = { ...(draft?.config || editing?.config || preferences.map) };
  if (!c.url) c.enabled = true;
  let caps: any = capabilitiesURL === c.url ? capabilities : null;
  let requestGeneration = 0;
  modal(
    `${head("Map servers")}<p class="description">Save multiple WMTS connections and add imagery layers from any server. The server library stays on this computer; the layer stack and visibility rules are saved with your workspace.</p><div class="row"><label class="field grow">Map source<select id="wmts-server"></select></label><button id="add-wmts-server">Add server</button><button id="remove-wmts-server">Remove</button></div><div id="wmts-source-info" class="notice" hidden></div><label class="field">Server name<input id="wmts-server-name"></label><label class="field">Capabilities or service URL<input id="wmts-url" placeholder="https://…/WMTSCapabilities.xml"></label><div class="row"><button id="inspect-wmts" class="primary">Read capabilities</button><button id="wmts-auth">Authentication…</button><button id="wmts-cache">Cache and loading…</button><span class="spacer"></span><label class="check-row"><input id="map-enabled" type="checkbox"> Show map</label></div><div id="wmts-layer-status" role="status" class="description"></div><div id="wmts-fields" style="margin-top:12px"></div><div class="notice">EPSG:3857 and EPSG:4326/CRS84. Imagery loads directly with a local disk cache. Each server remembers its layer, matrix, style, date and resolution. Multiple sources can be enabled together. Use Map layers to set opacity, order and zoom visibility.</div><footer><button data-close>Close</button><button id="save-wmts-server">Save server</button><button id="map-stack-settings">Map layers…</button><button id="map-credits">Map credits</button><button id="add-map-layer">Add selected layer to map</button><span class="spacer"></span><button id="apply-map" class="primary">Apply to view</button></footer>`,
    false,
  );
  const menuOwner = $("#wmts-server");
  const alive = () => document.querySelector("#wmts-server") === menuOwner;
  const server = () => servers.find((s) => s.id === selected)!;
  const capture = () => {
    c.url = input("#wmts-url").trim();
    c.enabled = check("#map-enabled");
    if ($("#wmts-layer")) c.layer = input("#wmts-layer");
    if ($("#wmts-matrix")) c.matrix_set = input("#wmts-matrix");
    if ($("#wmts-style")) c.style = input("#wmts-style");
    if ($("#wmts-format")) c.format = input("#wmts-format");
    if ($("#wmts-time")) c.time = input("#wmts-time");
    if ($("#wmts-level"))
      c.level =
        input("#wmts-level") === "" ? null : Number(input("#wmts-level"));
    server().name = input("#wmts-server-name").trim();
    server().config = { ...c };
  };
  const options = () => {
    if (!alive()) return;
    $("#wmts-server").innerHTML =
      '<optgroup label="Saved servers">' +
      servers
        .map(
          (s) =>
            `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`,
        )
        .join("") +
      "</optgroup>";
    ($("#remove-wmts-server") as HTMLButtonElement).disabled =
      servers.length === 0;
  };
  const fields = () => {
    if (!alive()) return;
    const preset = mapPresets.find(
      (p) => p.config.url === c.url && p.config.layer === c.layer,
    );
    const info = $("#wmts-source-info");
    info.hidden = !preset;
    info.innerHTML = preset
      ? `<strong>${esc(preset.name)}</strong><p>${esc(preset.description)} ${esc(preset.coverage)}</p><p>${esc(preset.license)}</p>${preset.credits.map((credit) => `<a href="${esc(credit.url)}" target="_blank" rel="noopener noreferrer">${esc(credit.text)}</a>`).join(" · ")}`
      : "";
    const layers =
      caps?.layers.filter((l: any) => l.formats.some(supportedRasterFormat)) ||
      [];
    const layer = layers.find((l: any) => l.id === c.layer) || layers[0];
    if (!layer) {
      $("#wmts-fields").innerHTML =
        `<label class="field">Layer<input id="wmts-current-layer" readonly value="${esc(c.layer || "No layer selected")}"></label>`;
      $("#wmts-layer-status").textContent = caps
        ? "This service has no supported PNG/JPEG layers."
        : "Read capabilities to browse all imagery layers. Your current layer is shown below.";
      return;
    }
    c.layer = layer.id;
    if (!layer.matrix_sets.includes(c.matrix_set)) {
      c.matrix_set = layer.matrix_sets[0] || "";
      c.level = null;
    }
    if (!layer.formats.includes(c.format))
      c.format = layer.formats.find(supportedRasterFormat) || "";
    if (!c.style) c.style = layer.style;
    const time = layer.dimensions.find(
      (d: any) => d.name.toLowerCase() === "time",
    );
    $("#wmts-layer-status").textContent =
      `${layers.length.toLocaleString()} imagery layers available`;
    $("#wmts-fields").innerHTML =
      `<div class="modal-grid"><label class="field wide">Layer<select id="wmts-layer">${layers.map((l: any) => `<option value="${esc(l.id)}" ${l.id === c.layer ? "selected" : ""}>${esc(l.title || l.id)} · ${esc(l.id)}</option>`).join("")}</select></label><label class="field">Matrix set<select id="wmts-matrix">${layer.matrix_sets.map((id: string) => `<option ${id === c.matrix_set ? "selected" : ""}>${esc(id)}</option>`).join("")}</select></label><label class="field">Resolution<select id="wmts-level"><option value="">Automatic / screen resolution</option>${(caps.matrix_sets.find((m: any) => m.id === c.matrix_set)?.matrices || []).map((m: any, i: number) => `<option value="${i}" ${c.level === i ? "selected" : ""}>${esc(m.id)} · scale 1:${Math.round(m.scale).toLocaleString()}</option>`).join("")}</select></label><label class="field">Time dimension<input id="wmts-time" value="${esc(c.time)}" placeholder="${esc(time?.default || "Provider default")}"><small class="muted">${esc(time?.values?.slice(0, 3).join(", ") || "This layer has no advertised time dimension")}</small></label><label class="field">Style<input id="wmts-style" value="${esc(c.style)}"></label><label class="field">Format<select id="wmts-format">${layer.formats
        .filter(supportedRasterFormat)
        .map(
          (f: string) =>
            `<option ${f === c.format ? "selected" : ""}>${esc(f)}</option>`,
        )
        .join("")}</select></label></div>`;
    $("#wmts-layer").addEventListener("change", () => {
      capture();
      c.matrix_set = "";
      c.level = null;
      c.style = "";
      c.time = "";
      fields();
    });
    $("#wmts-matrix").addEventListener("change", () => {
      capture();
      c.level = null;
      fields();
    });
  };
  const read = async () => {
    capture();
    const url = c.url,
      generation = ++requestGeneration;
    $("#wmts-layer-status").textContent = "Loading imagery layers…";
    try {
      const result = await call("wmts_capabilities", { url });
      if (
        !alive() ||
        generation !== requestGeneration ||
        input("#wmts-url").trim() !== url
      )
        return;
      caps = result;
      capabilities = result;
      capabilitiesURL = url;
      fields();
    } catch (error) {
      if (alive() && generation === requestGeneration)
        $("#wmts-layer-status").textContent =
          `Layers unavailable: ${error}. Check the URL or authentication, then read capabilities again.`;
    }
  };
  const show = () => {
    if (!alive()) return;
    requestGeneration++;
    $("#wmts-server-name").setAttribute("value", server().name);
    ($("#wmts-server-name") as HTMLInputElement).value = server().name;
    ($("#wmts-url") as HTMLInputElement).value = c.url;
    ($("#map-enabled") as HTMLInputElement).checked = c.enabled;
    caps = capabilitiesURL === c.url ? capabilities : null;
    options();
    fields();
    if (!caps && c.enabled && c.url) void read();
  };
  const persist = async () => {
    capture();
    await call("wmts_servers", { settings: { servers } });
    options();
    toast("Map server saved on this computer");
  };
  $("#wmts-server").addEventListener("change", () => {
    capture();
    const choice = input("#wmts-server");
    if (choice.startsWith("builtin:")) {
      const preset = mapPresets.find((p) => p.id === choice.slice(8))!;
      const existing = servers.find(
        (s) => JSON.stringify(s.config) === JSON.stringify(preset.config),
      );
      if (!existing && servers.length >= 32) {
        toast(
          "At most 32 saved map servers. Remove an entry before adding another.",
          true,
        );
        options();
        return;
      }
      selected =
        existing?.id ||
        (servers.some((s) => s.id === preset.id)
          ? `server-${crypto.randomUUID()}`
          : preset.id);
      if (!existing) {
        servers.push({
          id: selected,
          name: preset.name,
          config: { ...preset.config },
        });
      }
    } else selected = choice;
    c = { ...server().config };
    show();
  });
  $("#wmts-url").addEventListener("input", () => {
    requestGeneration++;
    caps = null;
    fields();
  });
  on("#inspect-wmts", read);
  on("#add-wmts-server", () => {
    capture();
    if (servers.length >= 32) throw new Error("At most 32 saved map servers");
    selected = `server-${crypto.randomUUID()}`;
    c = {
      url: "",
      layer: "",
      matrix_set: "",
      style: "",
      format: "image/png",
      time: "",
      enabled: false,
      level: null,
    };
    servers.push({ id: selected, name: "New WMTS server", config: { ...c } });
    show();
    $("#wmts-url").focus();
  });
  on("#remove-wmts-server", async () => {
    requestGeneration++;
    const i = servers.findIndex((s) => s.id === selected);
    servers.splice(i, 1);
    await call("wmts_servers", { settings: { servers } });
    if (!servers.length) {
      closeModal();
      await mapMenu();
      return;
    }
    selected = servers[0].id;
    c = { ...server().config };
    show();
  });
  on("#save-wmts-server", persist);
  on("#wmts-auth", () => {
    capture();
    return authenticationMenu(c.url, () =>
      mapMenu({ servers, selected, config: c }, editing),
    );
  });
  on("#wmts-cache", mapCacheMenu);
  on("#map-stack-settings", mapLayerMenu);
  on("#map-credits", () => {
    closeModal();
    view.showCredits();
  });
  on("#add-map-layer", async () => {
    capture();
    if (!c.layer || !c.matrix_set)
      throw new Error(
        "Read capabilities and choose a layer and matrix set first",
      );
    await persist();
    const stack = structuredClone(mapLayers(preferences));
    stack.push({
      id: `layer-${crypto.randomUUID()}`,
      name: `${server().name} · ${c.layer}`,
      server_name: server().name,
      config: { ...c, enabled: true },
      opacity: 1,
      min_zoom: 0,
      max_zoom: 30,
    });
    await cancelMap();
    preferences = await call("preferences", {
      preferences: { map_layers: stack },
    });
    mapUnavailable = false;
    await refresh(false);
    await loadRasters();
    await mapLayerMenu();
  });
  on("#apply-map", async () => {
    capture();
    if (c.enabled && (!c.layer || !c.matrix_set))
      throw new Error(
        "Read capabilities and choose a layer and matrix set first",
      );
    await persist();
    await cancelMap();
    let stack = preferences.map_layers
      ? structuredClone(preferences.map_layers)
      : null;
    if (editing || stack) {
      stack ??= structuredClone(mapLayers(preferences));
      const targetId = editing?.id || stack[0]?.id || "legacy-map";
      const index = stack.findIndex((l) => l.id === targetId);
      const layer = {
        ...(index >= 0
          ? stack[index]
          : {
              id: "legacy-map",
              name: c.layer,
              opacity: 1,
              min_zoom: 0,
              max_zoom: 30,
            }),
        server_name: server().name,
        config: { ...c },
      };
      if (index >= 0) stack[index] = layer;
      else stack.unshift(layer);
    }
    preferences = { ...preferences, map: { ...c }, map_layers: stack };
    await call("preferences", { preferences });
    closeModal();
    await refresh(false);
    mapUnavailable = false;
    await loadRasters();
  });
  show();
}
async function authenticationMenu(
  url: string,
  returnToMenu?: () => Promise<void>,
) {
  const auth = await task("Checking native authentication…", () =>
    call<any>("wmts_auth_status"),
  );
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error("Enter a valid HTTPS map server URL first.");
  }
  const profile = auth.profiles.find((p: any) => p.origin === origin);
  const kind = auth.platform_kind;
  const labels: Record<string, string> = {
    "macos-keychain": "Keychain certificate subject name",
    "windows-store": "CurrentUser\\MY\\ + 40-digit certificate thumbprint",
    pkcs11: "PKCS#11 certificate URI (type=cert)",
  };
  modal(
    `${head("Map authentication")}<p class="description">${esc(auth.notice)}</p><div class="notice">${auth.automatic ? "Default: automatic TLS client-certificate detection. The OS/card provider handles PIN prompts. Public servers do not prompt." : "Automatic smartcard detection is unavailable on this platform. Public maps work normally; protected maps need compatible PKCS#11 middleware and an explicit certificate URI."}</div><label class="field">HTTPS server origin<input id="auth-origin" value="${esc(origin)}" placeholder="https://maps.example.org"></label><label class="field">Authentication<select id="auth-mode"><option value="automatic" ${!profile ? "selected" : ""}>${auth.automatic ? "Automatic (default)" : "No override (default)"}</option><option value="identity" ${profile && profile.kind !== "disabled" ? "selected" : ""}>Specific client identity</option><option value="disabled" ${profile?.kind === "disabled" ? "selected" : ""}>No client certificate</option></select></label><label class="field" id="auth-identity-field">${esc(labels[kind])}<input id="auth-identity" value="${esc(profile?.identity || "")}" autocomplete="off" spellcheck="false" placeholder="${kind === "pkcs11" ? "pkcs11:token=My%20Card;id=%01;type=cert" : ""}"></label><p class="description">Overrides stay on this computer and apply only to the exact HTTPS host and port. PINs and private keys are never stored in Chronoscope or shared workspaces. Servers on other origins require their own authentication. Cached imagery can remain visible without the card.</p>${!auth.transport_available ? `<div class="notice error">${esc(auth.unavailable_reason)}</div>` : ""}<footer><button id="auth-back">Back</button><button id="auth-reset">Forget session choices</button><span class="spacer"></span><button id="auth-save" class="primary">Save</button></footer>`,
  );
  const update = () => {
    $("#auth-identity-field").hidden = input("#auth-mode") !== "identity";
  };
  $("#auth-mode").addEventListener("change", update);
  update();
  const back = async () => {
    await (returnToMenu ? returnToMenu() : mapMenu());
  };
  on("#auth-back", back);
  on("#auth-reset", async () => {
    await cancelMap();
    await call("wmts_auth_reset");
    toast(
      "Authentication sessions closed; cached imagery remains on this device.",
    );
  });
  on("#auth-save", async () => {
    const origin = input("#auth-origin");
    await cancelMap();
    if (input("#auth-mode") === "automatic")
      await call("wmts_auth_remove", { origin });
    else
      await call("wmts_auth_set", {
        profile: {
          origin,
          kind: input("#auth-mode") === "disabled" ? "disabled" : kind,
          identity:
            input("#auth-mode") === "disabled" ? "" : input("#auth-identity"),
        },
      });
    capabilities = null;
    mapUnavailable = false;
    toast("Local map authentication updated");
    await back();
  });
}
let mapLoadGeneration = 0;
const activeMapJobs = new Set<string>();
const viewportDataRefresh = new ViewportRefresh(
  async () => {
    if (restoringScene) return;
    const bounds = view.visibleDataBounds() || view.visibleBounds();
    if (bounds) await refreshViewportData(bounds);
  },
  (e) => toast(String(e), true),
);
const viewportResourceRefresh = new ViewportRefresh(
  refreshViewportResources,
  (e) => toast(String(e), true),
);
function cancelViewportRefresh() {
  viewportDataRefresh.cancel();
  viewportResourceRefresh.cancel();
}
let terrainLoadGeneration = 0;
const cancelMap = async () => {
  mapLoadGeneration++;
  $("#cancel-map").hidden = true;
  await Promise.all(
    [...activeMapJobs].map((job_id) =>
      call("job_cancel", { job_id }).catch(() => {}),
    ),
  );
};
on("#cancel-map", async () => {
  await cancelMap();
  $("#cancel-map").hidden = true;
  status("Map loading stopped; downloaded tiles remain cached");
});
async function mapCacheMenu() {
  const info = await call("wmts_access"),
    s = info.settings;
  modal(
    `${head("Map cache and loading")}<p class="description">Tiles and capabilities are cached directly in a private folder on this computer. No proxy, service or listening port is involved. Cache files are independent of saved workspaces. Previously viewed imagery can be reused without contacting the provider; offline mode requires all requested tiles and capabilities to be cached.</p><div class="notice mono">${esc(info.directory)}<br>${(info.bytes / 1048576).toFixed(1)} MiB cached</div><div class="modal-grid"><label class="field">Concurrent downloads<input id="cache-concurrency" type="number" min="1" max="32" value="${s.concurrency}"></label><label class="field">Minimum request interval / ms (0 = no imposed delay)<input id="cache-interval" type="number" min="0" max="60000" value="${s.request_interval_ms}"></label><label class="field">Disk cache limit / MiB (0 = unlimited)<input id="cache-limit" type="number" min="0" value="${s.cache_limit_mb}"></label><label class="field">Tile freshness / days<input id="cache-days" type="number" min="1" max="3650" value="${s.tile_ttl_days}"></label></div><label class="check-row"><input id="cache-offline" type="checkbox" ${s.offline ? "checked" : ""}> Use cached maps only / no network access</label><p class="description">Provider terms and HTTP rate limits still apply. The optional request interval is useful for restrained testing; normal loading defaults to no delay. Cache is oldest-file evicted when over its size limit. Offline mode also permits older cached imagery.</p><button id="cache-clear">Clear cached imagery and capabilities</button><footer><button data-close>Cancel</button><span class="spacer"></span><button id="cache-save" class="primary">Save settings</button></footer>`,
    true,
  );
  on("#cache-save", async () => {
    await call("wmts_access", {
      settings: {
        concurrency: Number(input("#cache-concurrency")),
        request_interval_ms: Number(input("#cache-interval")),
        cache_limit_mb: Number(input("#cache-limit")),
        tile_ttl_days: Number(input("#cache-days")),
        offline: check("#cache-offline"),
      },
    });
    mapUnavailable = false;
    closeModal();
    toast("Local map loading/cache settings saved");
  });
  on("#cache-clear", async () => {
    await cancelMap();
    await call("wmts_cache_clear");
    capabilities = null;
    toast(
      "Map disk cache cleared; displayed imagery stays until the next load",
    );
    closeModal();
  });
}
let keyedMapPreferences: Preferences | null = null;
let cachedMapKey = "";
let loadedMapVisibility = "";
let lastMapStack: MapStack | undefined;
function mapStackKey() {
  if (keyedMapPreferences !== preferences) {
    keyedMapPreferences = preferences;
    cachedMapKey = JSON.stringify(mapLayers(preferences));
  }
  return cachedMapKey;
}
async function loadRasters(
  regionOverride?: Bounds,
  superseded?: () => boolean,
) {
  if (restoringScene) return;
  const rawRegion = regionOverride || view.visibleBounds() || [...view.bounds];
  // Rust raster composition uses a Mercator grid, including geographic WMTS
  // sources. Clip only imagery requests; polar event coordinates remain exact.
  const rasterLimit = 85.0511287798066;
  const region: Bounds = [
    rawRegion[0],
    Math.max(-rasterLimit, rawRegion[1]),
    rawRegion[2],
    Math.min(rasterLimit, rawRegion[3]),
  ];
  if (region[0] >= region[2] || region[1] >= region[3]) return;
  const generation = ++mapLoadGeneration,
    requestMode = mode,
    configKey = mapStackKey();
  const current = () =>
    generation === mapLoadGeneration &&
    mode === requestMode &&
    configKey === mapStackKey();
  await Promise.all(
    [...activeMapJobs].map((job_id) =>
      call("job_cancel", { job_id }).catch(() => {}),
    ),
  );
  if (!current()) return;
  const zoom = currentMapZoom();
  const visible = mapLayers(preferences).filter((l) => layerVisible(l, zoom));
  loadedMapVisibility = visible.map((l) => l.id).join("|");
  layers();
  if (!visible.length) {
    lastMapStack = undefined;
    lastRaster = null;
    view.clearRasters();
    $("#cancel-map").hidden = true;
    return;
  }
  $("#cancel-map").hidden = false;
  const pixels =
    Math.max($("#scene").clientWidth, $("#scene").clientHeight) *
    Math.min(devicePixelRatio, 2);
  const stack = new MapStack(visible, region, pixels, lastMapStack);
  // Seed only unchanged visible layers, retaining valid imagery until replacements arrive.
  lastMapStack = stack;
  stack.compose();
  lastRaster = stack.result;
  await view.setRasters(stack.result, current);
  let cursor = 0,
    loaded = 0,
    failures = 0;
  const loadLayer = async (layer: MapLayer) => {
    let offset: number | null = 0;
    try {
      while (offset !== null && current()) {
        const job = await call("job_start", {
          command: "wmts_rasters",
          arguments: {
            config: layer.config,
            bounds: region,
            offset,
            limit: 8,
            target_pixels: pixels,
          },
        });
        activeMapJobs.add(job.job_id);
        let next: Raster;
        try {
          for (;;) {
            if (!current()) await call("job_cancel", { job_id: job.job_id });
            const state = await call("job_result", { job_id: job.job_id });
            if (state.status === "completed") {
              next = state.result;
              break;
            }
            if (["failed", "cancelled"].includes(state.status))
              throw new Error(state.error?.message || "Map loading cancelled");
            await new Promise((r) => setTimeout(r, 40));
          }
        } finally {
          activeMapJobs.delete(job.job_id);
          await call("job_release", { job_id: job.job_id }).catch(() => {});
        }
        if (!current()) return;
        await stack.streams.get(layer.id)!.append(next!, current);
        if (!current()) return;
        loaded += next!.tiles.length;
        stack.compose();
        lastRaster = stack.result;
        await view.setRasters(lastRaster, current);
        if (!current()) return;
        geographyReadout();
        status(
          `${loaded.toLocaleString()} map tiles · ${visible.length} active layers · progressive imagery`,
        );
        offset = next!.next_offset ?? null;
        // Publish this page before following newer camera bounds. Finishing an
        // entire old viewport can otherwise delay a pan by hundreds of tiles.
        if (superseded?.()) return;
      }
      if (current()) notifications.replace(`map:${layer.id}`, []);
    } catch (error) {
      if (current()) {
        failures++;
        console.error(`Map layer ${layer.name}:`, error);
        notifications.replace(`map:${layer.id}`, [
          {
            id: `map:${layer.id}`,
            source: `map:${layer.id}`,
            title: `${layer.name} could not finish loading`,
            severity: "warning",
            message: `${error}. Previously loaded imagery remains available.`,
            actions: [
              { label: "Retry", run: () => loadRasters() },
              { label: "Map settings", run: () => mapLayerMenu() },
            ],
          },
        ]);
      }
    }
  };
  const worker = async () => {
    while (
      cursor < visible.length &&
      current() &&
      (!superseded?.() || loaded === 0)
    )
      await loadLayer(visible[cursor++]);
  };
  try {
    await Promise.all([worker(), worker()]);
  } finally {
    if (current()) {
      $("#cancel-map").hidden = true;
      status(
        superseded?.()
          ? `${loaded.toLocaleString()} map tiles · following viewport`
          : `${loaded.toLocaleString()} map tiles · ${visible.length - failures} layers loaded${failures ? ` · ${failures} failed` : ""}`,
      );
    }
  }
}

async function rebuildTerrain(
  cameraBounds?: Bounds,
  superseded?: () => boolean,
) {
  if (!terrainInfo) return;
  const generation = ++terrainLoadGeneration;
  const region = cameraBounds || view.bounds;
  if (
    !preferences.terrain_vertical_datum ||
    preferences.terrain_vertical_datum === "unresolved-msl"
  ) {
    await view.setTerrain(null);
    await loadRasters(region, superseded);
    return;
  }
  const coverage = terrainInfo.bounds as number[];
  // Keep the sampled DEM boundary beyond the viewport. Otherwise a local
  // elevation packet can make a false cliff where it meets the ellipsoid.
  // Doubling the grid dimensions preserves the previous sample spacing.
  const padLon = (region[2] - region[0]) / 2;
  const padLat = (region[3] - region[1]) / 2;
  const bounds: Bounds = [
    Math.max(region[0] - padLon, coverage[0]),
    Math.max(region[1] - padLat, coverage[1], -85.0511287798066),
    Math.min(region[2] + padLon, coverage[2]),
    Math.min(region[3] + padLat, coverage[3], 85.0511287798066),
  ];
  if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    await view.setTerrain(null);
    await loadRasters(region, superseded);
    return;
  }
  let t;
  try {
    t = await call("terrain_mesh", { bounds, resolution: 257 });
  } catch (error) {
    if (generation !== terrainLoadGeneration) return;
    throw error;
  }
  if (generation !== terrainLoadGeneration) return;
  view.exaggeration = preferences.terrain_exaggeration;
  await view.setTerrainDatum(
    preferences.terrain_vertical_datum || "unresolved-msl",
  );
  Object.freeze(t.bounds);
  Object.freeze(t.elevations);
  Object.freeze(t);
  await view.setTerrain(t, () => generation === terrainLoadGeneration);
  if (generation !== terrainLoadGeneration) return;
  await loadRasters(region, superseded);
}
function displayLevel() {
  return Math.max(
    0,
    Math.min(
      24,
      Math.floor(
        view.mapZoom() +
          Math.log2(
            256 /
              (displayOptions.bloom
                ? 2
                : displayOptions.mode === "heatmap"
                  ? Math.max(8, displayOptions.heat_radius / 4)
                  : displayOptions.cluster_pixels),
          ),
      ),
    ),
  );
}
let viewportPending: Bounds | null = null,
  viewportRunning = false;
async function refreshViewportData(bounds: Bounds) {
  viewportPending = bounds;
  if (viewportRunning) {
    viewportDataGeneration++;
    return;
  }
  viewportRunning = true;
  try {
    while (viewportPending) {
      const next = viewportPending;
      viewportPending = null;
      await runViewportData(next);
    }
  } finally {
    viewportRunning = false;
  }
}
async function runViewportData(bounds: Bounds) {
  if (displayOptions.mode === "heatmap" && displayOptions.spatial_culling) {
    const z = view.mapZoom(),
      scale =
        displayOptions.heat_reference_zoom == null
          ? 1
          : 2 ** (z - displayOptions.heat_reference_zoom);
    const pad = (displayOptions.heat_radius * scale * 360) / (256 * 2 ** z);
    const span =
      bounds[2] >= bounds[0]
        ? bounds[2] - bounds[0]
        : 360 - bounds[0] + bounds[2];
    let west = bounds[0] - pad,
      east = bounds[2] + pad;
    if (span + 2 * pad >= 360) {
      west = -180;
      east = 180;
    } else {
      west = ((((west + 180) % 360) + 360) % 360) - 180;
      east = ((((east + 180) % 360) + 360) % 360) - 180;
    }
    bounds = [
      west,
      Math.max(-90, bounds[1] - pad),
      east,
      Math.min(90, bounds[3] + pad),
    ];
  }
  if (
    !renderLOD &&
    !geometryLOD &&
    !displayOptions.spatial_culling &&
    !view.displayLayer.active
  )
    return;
  const generation = ++viewportDataGeneration,
    revision = snapshot.revision;
  const current = () =>
    generation === viewportDataGeneration && revision === snapshot.revision;
  try {
    const model = await call("view_snapshot_v1", {
      version: 1,
      generation: String(generation),
      include_render: true,
      display_level: displayLevel(),
      max_points: renderBudget,
      ...(displayOptions.spatial_culling ? { bounds } : {}),
      selection_ids: [],
    });
    if (!current() || model.snapshot.revision !== revision) return;
    const packet = model.render,
      geometries = model.geometries,
      names = [...packet.entities];
    for (const f of geometries.features)
      if (!names.includes(f.entity)) names.push(f.entity);
    view.geometryLimited = geometries.limited;
    await view.setData(
      decode(packet),
      names,
      [...view.bounds],
      sceneTimeBounds(snapshot),
      geometries.features,
      current,
      true,
    );
    if (!current()) return;
    updateTimeFocus();
    await view.displayLayer.set(model.display || null, displayOptions);
    if (!current()) return;
    view.setSelection(model.selected);
    view.rebuildTrails();
    renderLOD = packet.lod || !!model.display?.aggregated;
    renderedCount = packet.rendered_count;
    status(
      view.displayLayer.active
        ? `${model.display.count.toLocaleString()} located records · ${model.display.bins.length.toLocaleString()} display cells · exact source records retained`
        : `${snapshot.visible.toLocaleString()} visible events · ${renderedCount.toLocaleString()} viewport markers`,
    );
  } catch (e) {
    if (current() && !String(e).includes("CONFLICT:")) toast(String(e), true);
  }
}
function scheduleViewportResources() {
  if (restoringScene) return;
  // Slow imagery must not hold up event/cluster updates during navigation.
  viewportDataRefresh.request();
  viewportResourceRefresh.request();
}
async function refreshViewportResources(superseded: () => boolean) {
  if (restoringScene) return;
  if (preferences) {
    const zoom = currentMapZoom();
    const visibility = mapLayers(preferences)
      .filter((l) => layerVisible(l, zoom))
      .map((l) => l.id)
      .join("|");
    if (visibility !== loadedMapVisibility) {
      loadedMapVisibility = visibility;
      const visible = mapLayers(preferences).filter((l) =>
        layerVisible(l, zoom),
      );
      if (visible.length && lastMapStack) {
        const replacement = new MapStack(
          visible,
          lastMapStack.streams.values().next().value!.bounds as Bounds,
          Math.max($("#scene").clientWidth, $("#scene").clientHeight),
          lastMapStack,
        );
        replacement.compose();
        lastMapStack = replacement;
        lastRaster = replacement.result;
        void view.setRasters(lastRaster);
      } else {
        lastMapStack = undefined;
        lastRaster = null;
        view.clearRasters();
      }
      void cancelMap();
      layers();
    }
  }
  const bounds = view.visibleBounds();
  if (!bounds) return;
  if (terrainInfo) await rebuildTerrain(bounds, superseded);
  else await loadRasters(bounds, superseded);
}
async function loadTerrain(folder = false) {
  const path = await chooseFile({
    directory: folder,
    filters: [{ name: "DTED terrain", extensions: ["dt0", "dt1", "dt2"] }],
  });
  if (!path) return;
  terrainInfo = await task("Indexing DTED tiles…", () =>
    call("terrain_load", { path }),
  );
  preferences = await call("preferences");
  overrideBounds = terrainInfo.bounds;
  await refresh();
  if (preferences.terrain_vertical_datum === "unresolved-msl") {
    terrainMenu();
    toast("Choose the terrain vertical datum before displaying elevations");
    return;
  }
  await rebuildTerrain();
  view.fit();
  toast(`Loaded ${terrainInfo.tiles.length} DTED tile(s)`);
}
function terrainMenu() {
  modal(
    `${head("Terrain")}<p class="description">Index a DTED file or folder. Elevations are decoded lazily, validated by checksum, and used to drape WMTS imagery.</p><div class="row"><button id="dted-file" class="primary">${icon("terrain")} Load DTED file</button><button id="dted-folder" class="secondary">${icon("folder")} Load folder</button></div><div class="notice">Standard WGS84 DT0/DT1/DT2. Voids remain holes. Choose the source vertical datum explicitly. EGM96 uses the bundled NGA geoid grid to convert mean-sea-level heights to ellipsoid heights for display. Unknown MSL remains undisplayed; source elevations are never modified.</div><label class="field">Source vertical datum<select id="terrain-datum"><option value="unresolved-msl" ${preferences.terrain_vertical_datum === "unresolved-msl" ? "selected" : ""}>Unresolved mean sea level (do not display)</option><option value="egm96" ${preferences.terrain_vertical_datum === "egm96" ? "selected" : ""}>EGM96 mean sea level</option><option value="ellipsoid" ${preferences.terrain_vertical_datum === "ellipsoid" ? "selected" : ""}>WGS84 ellipsoid heights</option></select></label><label class="field">Vertical exaggeration / ×<input id="exaggeration" type="range" min=".1" max="20" step=".1" value="${preferences.terrain_exaggeration}"></label><footer><button data-close>Close</button><span class="spacer"></span><button id="remove-terrain">Unload terrain</button><button id="apply-terrain" class="primary">Apply exaggeration</button></footer>`,
    true,
  );
  on("#remove-terrain", async () => {
    await call("terrain_unload");
    terrainInfo = null;
    overrideBounds = null;
    await view.setTerrain(null);
    closeModal();
    await refresh();
    layers();
  });
  on("#dted-file", async () => {
    closeModal();
    await loadTerrain();
  });
  on("#dted-folder", async () => {
    closeModal();
    await loadTerrain(true);
  });
  on("#apply-terrain", async () => {
    preferences = {
      ...preferences,
      terrain_exaggeration: Number(input("#exaggeration")),
      terrain_vertical_datum: input(
        "#terrain-datum",
      ) as Preferences["terrain_vertical_datum"],
    };
    await call("preferences", { preferences });
    closeModal();
    await rebuildTerrain();
  });
}
const analyticsButton = document.createElement("button");
analyticsButton.id = "analytics-results";
analyticsButton.textContent = "Results";
analyticsButton.title =
  "Browse persistent analysis results, charts and linked Event rows";
$("#si").before(analyticsButton);
analyticsButton.onclick = () =>
  void openAnalytics(
    async () => {
      await refresh();
    },
    (error) => toast(String(error), true),
  ).catch((error) => toast(String(error), true));
const siHooks = {
  configure: siConnection,
  before: async () => {
    await filterIntent.flush();
    await call("scene_sync", {
      scene: captureScene(),
      expected_revision: snapshot.revision,
    });
  },
  after: async () => {
    await refresh();
    await restoreScene(snapshot.scene);
  },
  capture: async () => {
    await filterIntent.flush();
    const source = await view.screenshot();
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const picture = new Image();
      picture.onload = () => resolve(picture);
      picture.onerror = () => reject(Error("Map capture could not be decoded"));
      picture.src = source;
    });
    const scale = Math.min(1, 1600 / image.width, 1200 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  },
  error: (error: unknown) => toast(String(error), true),
};
const siChat = new SIChat($("#si-chat"), {
  ...siHooks,
  close: async () => {
    siChat.hide();
    paneLayout.inspector.close(true);
  },
  detach: async () => {
    await siWindows.open();
  },
});
async function openSIChat() {
  await paneLayout.inspector.reveal("si", true);
  await siChat.open();
}
const siWindows = new SIWindowHost(
  async () => {
    await openSIChat();
  },
  () => siChat.hide(),
);
void workspaceHost({
  before: siHooks.before,
  after: siHooks.after,
  capture: siHooks.capture,
  settings: async () => {
    if (native) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().unminimize();
      await getCurrentWindow().setFocus();
    }
    await siConnection();
  },
}).catch(siHooks.error);

async function siConnection() {
  const connection = await call("si_status");
  modal(
    `${head("SI settings")}<div class="si-settings-content"><section aria-labelledby="si-service-heading"><h3 id="si-service-heading">SI service</h3><p class="description">Connect an OpenAI-compatible model with tool support to power SI chat. Requested workspace data and tool results are sent to this service. The Tools section below connects other apps and manages which tools SI may use.</p>
    <label class="field">Service URL<input id="si-url" value="${esc(connection.url || "https://api.openai.com/v1")}" placeholder="https://api.openai.com/v1"></label>
    <label class="field">Model<input id="si-model" value="${esc(connection.model)}" placeholder="Model with tool support"></label>
    <label class="field">API key<input id="si-key" type="password" autocomplete="off" placeholder="Session only; optional if the service allows it"></label>
    <p class="description">The key and chat stay in memory until disconnect or app exit. URL/model settings stay on this computer. File access is optional and managed separately in chat permissions.</p>
    <details id="si-certificate-settings"><summary>Client certificate · ${connection.client_certificate ? (connection.client_certificate.kind === "disabled" ? "disabled" : "specific identity") : connection.automatic_client_certificate ? "automatic" : "no override"}</summary><p class="description">${connection.automatic_client_certificate ? "If this HTTPS service requests a user certificate, the OS selects an eligible identity and your card provider handles PIN prompts." : "Linux protected services need compatible PKCS#11 middleware and an explicit certificate identity. Automatic card selection is unavailable."}</p><label class="field">Certificate authentication<select id="si-certificate-mode"><option value="automatic" ${!connection.client_certificate ? "selected" : ""}>${connection.automatic_client_certificate ? "Automatic (default)" : "No override (default)"}</option><option value="identity" ${connection.client_certificate && connection.client_certificate.kind !== "disabled" ? "selected" : ""}>Specific identity</option><option value="disabled" ${connection.client_certificate?.kind === "disabled" ? "selected" : ""}>No client certificate</option></select></label><label class="field" id="si-certificate-identity-field">${esc(connection.client_certificate_kind === "pkcs11" ? "PKCS#11 certificate URI (type=cert)" : connection.client_certificate_kind === "windows-store" ? "CurrentUser\\MY\\ + certificate thumbprint" : "Keychain certificate subject name")}<input id="si-certificate-identity" value="${esc(connection.client_certificate?.identity || "")}" autocomplete="off" spellcheck="false"></label><p class="description">Certificate choices apply only to this HTTPS server and stay on this computer. PINs and private keys stay with the OS/card provider. Reconnect to forget this SI session’s certificate choices.</p></details>
    <div class="row si-service-actions"><button id="si-disconnect" ${connection.connected ? "" : "disabled"}>Disconnect</button><span class="spacer"></span><button id="si-connect" class="primary" ${connection.running ? "disabled" : ""}>Connect</button></div></section><section aria-labelledby="si-tools-heading"><h3 id="si-tools-heading">Tools</h3><div id="si-tools-settings"></div></section></div><footer><span class="spacer"></span><button data-close>Done</button></footer>`,
  );
  const updateCertificate = () => {
    $("#si-certificate-identity-field").hidden =
      input("#si-certificate-mode") !== "identity";
  };
  $("#si-certificate-mode").addEventListener("change", updateCertificate);
  $("#si-url").addEventListener("input", () => {
    try {
      if (
        connection.client_certificate &&
        new URL(input("#si-url")).origin !==
          connection.client_certificate.origin
      ) {
        ($("#si-certificate-mode") as HTMLSelectElement).value = "automatic";
        ($("#si-certificate-identity") as HTMLInputElement).value = "";
        updateCertificate();
      }
    } catch {
      /* Allow a partially typed address. */
    }
  });
  updateCertificate();
  const owner = modalNode;
  const dialog = owner!.querySelector<HTMLElement>(".modal")!;
  dialog.classList.add("si-settings-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "SI settings");
  void mcpConnections(
    dialog.querySelector<HTMLElement>("#si-tools-settings")!,
    (error) => toast(String(error), true),
  ).catch((error) => toast(String(error), true));
  on("#si-connect", async () => {
    const key = $("#si-key") as HTMLInputElement;
    const args: EngineContracts["si_configure"]["args"] = {
      provider: "openai-compatible",
      url: input("#si-url"),
      model: input("#si-model"),
      api_key: key.value,
      client_certificate:
        input("#si-certificate-mode") === "automatic" ||
        (input("#si-certificate-mode") === "disabled" &&
          input("#si-url").startsWith("http:"))
          ? null
          : {
              origin: new URL(input("#si-url")).origin,
              kind:
                input("#si-certificate-mode") === "disabled"
                  ? "disabled"
                  : connection.client_certificate_kind!,
              identity:
                input("#si-certificate-mode") === "disabled"
                  ? ""
                  : input("#si-certificate-identity"),
            },
    };
    key.value = "";
    await call("si_configure", args);
    if (modalNode === owner) closeModal();
    if (!(await siWindows.focus())) await openSIChat();
  });
  on("#si-disconnect", async () => {
    await call("si_disconnect");
    if (modalNode === owner) closeModal();
    if (!(await siWindows.focus())) await openSIChat();
  });
}
on("#si", async () => {
  if (await siWindows.focus()) return;
  if (paneLayout.inspector.collapsed) {
    await openSIChat();
    return;
  }
  if ($("#si-chat").hidden) await siChat.open();
  else siChat.hide();
});
async function aggregateEvents() {
  const revision = snapshot.revision;
  modal(
    `${head("Aggregate visible records")}<p class="description">Preview groups before replacing the workspace with summaries. Summaries reduce stored and displayed records; they do not preserve individual member rows. Save a copy first. Undo restores the preceding workspace during this session.</p><div class="modal-grid"><label class="field">Time window / minutes<input id="aggregate-window" type="number" min="1" value="15"></label><label class="field">Radius / metres<input id="aggregate-radius" type="number" min="1" value="100"></label></div><p class="description">Fixed UTC windows, grouped separately by entity, category and source. Every member lies within the radius of its first anchor; this is not transitive clustering. Missing locations stay separate. The displayed location and original attributes come from the anchor, value becomes the mean, and time/end cover the group.</p><button id="aggregate-preview" class="secondary">Preview exact counts</button><div id="aggregate-result" class="notice"></div><label class="check-row"><input id="aggregate-review" type="checkbox"> Replace the entire workspace with summaries of the visible records; exclude hidden records</label><footer><button data-close>Cancel</button><span class="spacer"></span><button id="aggregate-apply" class="primary" disabled>Create summaries</button></footer>`,
    true,
  );
  let previewKey = "";
  const args = () => ({
    aggregation: {
      window_minutes: Number(input("#aggregate-window")),
      radius_m: Number(input("#aggregate-radius")),
    },
  });
  const ready = () => {
    ($("#aggregate-apply") as HTMLButtonElement).disabled =
      !check("#aggregate-review") || previewKey !== JSON.stringify(args());
  };
  $("#aggregate-review").addEventListener("change", ready);
  for (const id of ["#aggregate-window", "#aggregate-radius"])
    $(id).addEventListener("input", ready);
  on("#aggregate-preview", async () => {
    const options = args();
    const r = await task("Computing exact aggregation…", () =>
      call("space_time_aggregate", { ...options, limit: 10 }),
    );
    previewKey = JSON.stringify(options);
    $("#aggregate-result").textContent =
      `${r.input_count.toLocaleString()} input records → ${r.group_count.toLocaleString()} summaries/records. ${r.groups.map((g: any) => `${g.representative.entity}: ${g.count}`).join(" · ")}`;
    ready();
  });
  on("#aggregate-apply", async () => {
    if (previewKey !== JSON.stringify(args()) || !check("#aggregate-review"))
      return;
    const r = await task("Creating summaries…", () =>
      call("aggregate_apply", { ...args(), expected_revision: revision }),
    );
    closeModal();
    await refresh();
    toast(
      `${r.input_count.toLocaleString()} records → ${r.retained.toLocaleString()} retained. Undo is available.`,
    );
  });
}
on("#aggregate-events", aggregateEvents);
async function settings() {
  const lifecycle = await call("workspace_status");
  const agent = native
    ? await (await import("@tauri-apps/api/core")).invoke<any>("agent_status")
    : { enabled: false };
  modal(
    `${head("Preferences")}<p class="description">Preferences are stored in your user data directory.</p><div class="modal-grid"><label class="field">Appearance<select id="pref-theme">${["dark", "light", "system"].map((t) => `<option ${t === preferences.theme ? "selected" : ""}>${t}</option>`).join("")}</select></label><label class="field">Display coordinates<select id="pref-coordinates">${["dd", "utm", "mgrs"].map((t) => `<option ${t === preferences.coordinates ? "selected" : ""}>${t}</option>`).join("")}</select></label></div><label class="check-row"><input id="pref-autosave" type="checkbox" ${lifecycle.auto_save_unsaved ? "checked" : ""}> Automatically save unsaved work</label><p class="description">Saves a copy every 30 seconds and before switching workspaces or quitting. Previous-session work is saved here automatically, without recovery prompts.</p><div class="notice mono">${esc(lifecycle.document_directory)}</div><label class="field">Marker budget<select id="pref-render-budget"><option value="20000" ${renderBudget === 20000 ? "selected" : ""}>20,000 representatives in Points mode</option><option value="100000" ${renderBudget === 100000 ? "selected" : ""}>100,000 representatives (uses more memory)</option></select></label><p class="description">This workspace setting changes the maximum in Points mode. Automatic display uses count clusters above 2,000 located records. Heat map and bloom are off by default. Exact queries and selection retain all matching records.</p><div class="divider"></div><div class="row">${icon("terminal")}<h3>CLI and MCP access</h3></div><div class="notice mono agent-commands">${esc(agent.cli ? `"${agent.cli}" agent enable\n"${agent.cli}" --attach call snapshot\n"${agent.cli}" mcp --attach` : "chronoscope agent enable\nchronoscope --attach call snapshot\nchronoscope mcp --attach")}</div><p class="description">Enable once here or run <code>agent enable</code> from a terminal. No folder is required: agents can operate the live workspace and exchange files in a private app folder. Access stays enabled across launches. Optionally choose a different folder for importing/exporting files. The app executable shown above also runs the CLI; a separate CLI download or administrator install is unnecessary.</p><div class="notice">SI agent access: ${agent.enabled ? `enabled · ${esc(agent.root)}<br>Connection: ${esc(agent.descriptor)}` : "disabled"}</div>${native ? `<button id="agent-toggle" class="secondary">${agent.enabled ? "Disable SI agent access" : "Enable SI agent access"}</button><button id="agent-folder">Choose file-access folder…</button><button id="agent-default-folder">Use default folder</button><button id="agent-config">MCP setup</button>` : ""}<footer><button data-close>Cancel</button><span class="spacer"></span><button id="save-preferences" class="primary">Save preferences</button></footer>`,
    true,
  );
  if (native)
    on("#agent-toggle", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (agent.enabled) {
        await invoke("agent_access", { enabled: false, root: null });
      } else {
        await invoke("agent_access", { enabled: true, root: null });
      }
      closeModal();
      await settings();
    });
  if (native) {
    on("#agent-folder", async () => {
      const root = await chooseFile({ directory: true });
      if (!root) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("agent_access", { enabled: true, root });
      closeModal();
      await settings();
    });
    on("#agent-default-folder", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("agent_access", { enabled: true, root: null });
      closeModal();
      await settings();
    });
    on("#agent-config", () => {
      modal(
        `${head("Connect an SI client")}<p class="description">Use this configuration in a client that supports local stdio MCP, such as Codex. Enable agent access first and keep Chronoscope open. This configuration contains no credential.</p><label class="field">MCP configuration<textarea id="agent-client-config" readonly rows="10">${esc(JSON.stringify(agent.config, null, 2))}</textarea></label><p class="description">For Codex CLI, run the command below. It uses the app executable directly, including when the path contains spaces.</p><textarea id="agent-codex-command" readonly rows="3">${esc(agent.codex_command)}</textarea><div class="row"><button id="agent-copy-config">Copy MCP configuration</button><button id="agent-copy-codex">Copy Codex command</button></div><footer><button id="agent-setup-back">Back</button><button data-close>Close</button></footer>`,
        true,
      );
      const copySetup = async (id: string) => {
        const field = $(id) as HTMLTextAreaElement;
        field.focus();
        field.select();
        try {
          if (navigator.clipboard?.writeText)
            await navigator.clipboard.writeText(field.value);
          else if (!document.execCommand("copy"))
            throw new Error("Copy unavailable");
          toast("Copied to clipboard");
        } catch {
          toast("Text selected; press Cmd/Ctrl+C to copy");
        }
      };
      on("#agent-copy-config", () => copySetup("#agent-client-config"));
      on("#agent-copy-codex", () => copySetup("#agent-codex-command"));
      $("#agent-client-config").addEventListener("focus", (e) =>
        (e.target as HTMLTextAreaElement).select(),
      );
      on("#agent-setup-back", async () => {
        closeModal();
        await settings();
      });
    });
  }
  on("#save-preferences", async () => {
    preferences = {
      ...preferences,
      theme: input("#pref-theme") as Preferences["theme"],
      coordinates: input("#pref-coordinates") as Preferences["coordinates"],
      auto_save_unsaved: check("#pref-autosave"),
    };
    await call("preferences", { preferences });
    renderBudget =
      Number(input("#pref-render-budget")) === 100000 ? 100000 : 20000;
    await call("view_set", { render_budget: renderBudget });
    closeModal();
    theme();
    await refresh();
    if (lastRaster) await view.setRasters(lastRaster);
  });
}
function timeWindow(
  start: number,
  end: number,
  delay = 0,
  progressive = false,
): Promise<void> {
  const [lo, hi] = snapshot.time_bounds;
  return filter(
    {
      start: start === 0 ? null : lo + (hi - lo) * start,
      end: end === 1 ? null : lo + (hi - lo) * end,
    },
    delay,
    progressive,
  );
}
$("#search").addEventListener("input", () => {
  filter({ search: input("#search") }, 220).catch((e) =>
    toast(String(e), true),
  );
});
$("#entity-search").addEventListener("input", entities);
for (const kind of ["entity", "category"] as const) {
  for (const field of ["name", "count"]) {
    $(`#${kind}-sort-${field}`).addEventListener("click", () => {
      const current = facetSort[kind];
      facetSort[kind] = current.startsWith(field)
        ? `${field}-${current.endsWith("asc") ? "desc" : "asc"}`
        : `${field}-${field === "name" ? "asc" : "desc"}`;
      (kind === "entity" ? entities : categories)();
    });
  }
  $(`#${kind}-show-all`).addEventListener("click", () => {
    facetExpanded[kind] = !facetExpanded[kind];
    (kind === "entity" ? entities : categories)();
  });
}
for (const [id, key, attribute] of [
  ["#entities", "hidden_entities", "entity"],
  ["#categories", "hidden_categories", "category"],
] as const)
  $(id).addEventListener("change", async (event) => {
    const e = event.target as HTMLInputElement;
    const name = e.dataset[attribute];
    if (name === undefined) return;
    const current = filterIntent.desired(snapshot.filter);
    const field = current.facet_fields?.[attribute] || attribute;
    const hidden = new Set(
      field === attribute
        ? current[key]
        : current.facet_hidden?.[attribute] || [],
    );
    e.checked ? hidden.delete(name) : hidden.add(name);
    await filter(
      field === attribute
        ? { [key]: [...hidden] }
        : {
            facet_hidden: { ...current.facet_hidden, [attribute]: [...hidden] },
          },
    );
  });
$("#entities").addEventListener("change", (event) => {
  const color = event.target as HTMLInputElement;
  const name = color.dataset.entityColor;
  if (name === undefined) return;
  customEntityColors = { ...customEntityColors, [name]: color.value };
  setEntityColors(customEntityColors);
  void (async () => {
    await call("scene_sync", { scene: captureScene() });
    view.rebuild(true);
    await refresh(true, false);
  })().catch((error) => toast(String(error), true));
});
$("#entities").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-select-entity]");
  if (b) {
    const name = b.dataset.selectEntity!;
    const field = facetField("entity");
    // Preserve each click's intent while serializing with table selection.
    // In-flight intent keeps rapid clicks reversible before refresh completes.
    const intent = {
      selected: !(
        entitySelectionIntents.get(name)?.selected ??
        !!(snapshot.facets?.entity?.selected || snapshot.selected_entities)?.[
          name
        ]
      ),
    };
    entitySelectionIntents.set(name, intent);
    // Keep the live button in place so another click or keyboard activation
    // can arrive before the queued operation finishes.
    const action = `${intent.selected ? "Deselect" : "Select"} all events for ${name}`;
    b.innerHTML = icon(intent.selected ? "selection-remove" : "selection-add");
    b.setAttribute("aria-label", action);
    b.setAttribute("aria-pressed", String(intent.selected));
    b.title = `${action}; keep other selections`;
    b.closest<HTMLElement>(".entity")!.dataset.selected = String(
      intent.selected,
    );
    tableSelectionWork = tableSelectionWork
      .then(async () => {
        const predicates = [{ field, op: "Equals" as const, value: name }];
        await call("select_query", {
          filter: { predicates },
          mode: intent.selected ? "add" : "subtract",
        });
        await refresh(false);
      })
      .catch((error) => toast(String(error), true))
      .finally(() => {
        if (entitySelectionIntents.get(name) === intent) {
          entitySelectionIntents.delete(name);
          entities();
        }
      });
  }
});
$("#table-body").addEventListener("click", (e) => {
  const row = (e.target as Element).closest<HTMLElement>("[data-event]");
  if (!row) return;
  e.preventDefault();
  const id = row.dataset.event!,
    additive = e.ctrlKey || e.metaKey;
  tableActiveId = id;
  row.focus({ preventScroll: true });
  const anchor = tableAnchor;
  if (!e.shiftKey || !anchor) tableAnchor = id;
  const scope = {
    source: tableSource,
    apply_filter: tableRespectFilters,
    ...(tableDisplayCell ? { display_cell: tableDisplayCell } : {}),
  };
  const range =
    e.shiftKey && anchor
      ? {
          ...scope,
          table_range: {
            anchor,
            target: id,
            sort_by: tableSort,
            descending: tableDescending,
          },
          mode: additive ? ("add" as const) : ("replace" as const),
        }
      : null;
  tableSelectionWork = tableSelectionWork
    .then(async () => {
      if (range) await call("select_query", range);
      else
        await call("select", {
          ids: [id],
          mode: additive ? "toggle" : "replace",
        });
      await refresh(false, false);
    })
    .catch((error) => toast(String(error), true));
});
$("#table-body").addEventListener("keydown", (event) => {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(
      event.key,
    )
  )
    return;
  const row = (event.target as Element).closest<HTMLElement>("[data-event]");
  if (!row) return;
  event.preventDefault();
  event.stopPropagation();
  const key = event.key,
    extend = event.shiftKey,
    jump = event.ctrlKey || event.metaKey;
  tableActiveId ??= row.dataset.event!;
  tableSelectionWork = tableSelectionWork
    .then(async () => {
      const currentId = tableActiveId;
      if (!currentId) return;
      const scope = {
        source: tableSource,
        apply_filter: tableRespectFilters,
        ...(tableDisplayCell ? { display_cell: tableDisplayCell } : {}),
        sort_by: tableSort,
        descending: tableDescending,
        limit: 1,
        fields: ["id"],
      };
      const current = await call("query", { ...scope, reveal_id: currentId });
      if (!current.reveal_found || !current.count) return;
      let rank = current.offset;
      if (key === "Home" || (jump && key === "ArrowUp")) rank = 0;
      else if (key === "End" || (jump && key === "ArrowDown"))
        rank = current.count - 1;
      else
        rank +=
          key === "ArrowDown"
            ? 1
            : key === "ArrowUp"
              ? -1
              : (key === "PageDown" ? 1 : -1) *
                Math.max(
                  1,
                  Math.floor(
                    ($(".table-scroll").clientHeight -
                      $("#table-head").clientHeight) /
                      TABLE_ROW_HEIGHT,
                  ),
                );
      rank = Math.max(0, Math.min(current.count - 1, rank));
      const next = await call("query", { ...scope, offset: rank });
      const id = next.events[0]?.id as string | undefined;
      if (!id) return;
      const anchor = tableAnchor || currentId;
      if (extend)
        await call("select_query", {
          source: scope.source,
          apply_filter: scope.apply_filter,
          ...(tableDisplayCell ? { display_cell: tableDisplayCell } : {}),
          table_range: {
            anchor,
            target: id,
            sort_by: scope.sort_by,
            descending: scope.descending,
          },
          mode: "replace",
        });
      else await call("select", { ids: [id], mode: "replace" });
      tableAnchor = extend ? anchor : id;
      tableActiveId = id;
      tableReveal = id;
      await refresh(false, false);
      const active = Array.from(
        $("#table-body").querySelectorAll<HTMLElement>("[data-event]"),
      ).find((row) => row.dataset.event === id);
      active?.focus({ preventScroll: true });
      active?.scrollIntoView({ block: "nearest" });
    })
    .catch((error) => toast(String(error), true));
});
$("#inspector-content").addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (input.id?.startsWith("edit-"))
    editor.change(input.id.slice(5), input.value);
});
$("#inspector-content").addEventListener("click", async (event) => {
  const b = (event.target as Element).closest<HTMLElement>(
    "button,[data-finding]",
  );
  if (!b) return;
  try {
    if (b.dataset.finding !== undefined) {
      await select(findings[Number(b.dataset.finding)].ids);
      return;
    }
    if (
      b.dataset.viewIndex !== undefined ||
      b.dataset.groupIndex !== undefined
    ) {
      const restored = await call(
        b.dataset.viewIndex !== undefined ? "restore_view" : "restore_group",
        { index: Number(b.dataset.viewIndex ?? b.dataset.groupIndex) },
      );
      if (b.dataset.viewIndex !== undefined) await restoreScene(restored.scene);
      else await refresh();
      return;
    }
    switch (b.id) {
      case "apply-edit": {
        await editor.submit(
          async ({ values }) =>
            (await call("time_parse", { value: values.time })).epoch,
          async ({ target, values }, epoch) =>
            call("edit", {
              id: target.id,
              expected_workspace: target.workspace,
              expected_revision: target.revision,
              changes: {
                ...(values.wkt !== target.originalWkt
                  ? { geometry_wkt: values.wkt.trim() || null }
                  : {}),
                entity: values.entity,
                time: epoch,
                lat: values.lat === "" ? null : Number(values.lat),
                lon: values.lon === "" ? null : Number(values.lon),
                category: values.category,
                label: values.label,
                related_to: values.related,
                note: values.note,
                tags: values.tags
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }),
        );
        await refresh();
        toast("Event updated; original source fields preserved");
        break;
      }
      case "undo":
      case "redo":
        await call(b.id);
        await refresh();
        break;
      case "suggest-tags":
        await suggestTags(snapshot, () => refresh());
        break;
      case "reassign":
      case "tag":
        await call(b.id, {
          value: input(b.id === "tag" ? "#tag-value" : "#reassign-name"),
        });
        await refresh();
        break;
      case "delete":
        reviewDelete();
        break;
      case "save-view":
      case "save-group":
        await call(b.id === "save-view" ? "save_view" : "save_group", {
          name: input("#view-name"),
          scene: captureScene(),
        });
        await refresh(false);
        break;
      case "run-analysis": {
        const r = await task("Analyzing observed samples…", () =>
          call("analyze", {
            pattern: input(
              "#pattern",
            ) as EngineContracts["analyze"]["args"]["pattern"],
            parameters: {
              radius_m: Number(input("#radius")),
              tolerance_s: Number(input("#tolerance")),
              duration_s: Number(input("#duration")),
              gap_s: Number(input("#gap")),
              speed_kmh: Number(input("#speed")),
              min_cluster: Number(input("#cluster")),
            },
            selected_only: check("#analysis-selection"),
          }),
        );
        findings = r.findings;
        findingsRevision = r.revision;
        patterns();
        toast(
          `${r.count} findings${r.limited ? " · partial results at computation limit" : ""}`,
        );
        break;
      }
    }
  } catch (e) {
    toast(String(e), true);
  }
});
document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab! as InspectorTab;
    paneLayout.inspector.reveal(tab);
    document
      .querySelectorAll("[data-tab]")
      .forEach((e) => e.classList.toggle("active", e === b));
    refresh(false).catch((e) => toast(String(e), true));
  }),
);
function updateNavigationControls() {
  const navigationLabel = mode === "map" ? "Pan" : "Orbit";
  $("#navigate").setAttribute("aria-label", navigationLabel);
  $("#navigate").dataset.tooltip =
    mode === "map"
      ? "Drag to pan the flat map; scroll to zoom. Time filtering remains in the timeline."
      : "Drag to move; middle-drag rotates/tilts; right-drag or wheel zooms. Shift-click adds selection.";
  const timeHeight = mode === "space-time";
  $("#time-height").hidden = !timeHeight;
  $("#time-height-label").hidden = !timeHeight;
  $("#globe-time").hidden = mode !== "globe";
  $("#globe-time-height").hidden = mode !== "globe";
  ($("#globe-time-height") as HTMLInputElement).disabled = !view.globeTime;
  $("#globe-time-height-label").hidden = mode !== "globe";
  $("#navigation-time-group").hidden = mode === "map";
  const timeLabel = mode === "globe" ? "Time elevation" : "Time height";
  $("#time-elevation-title").textContent = timeLabel;
  $("#time-elevation").setAttribute("aria-label", timeLabel);
  $("#time-elevation").classList.toggle("active", timeHeight || view.globeTime);
  navigation.update();
  ($("#globe-time-height") as HTMLInputElement).value = String(
    Math.round((100 * Math.log(view.globeTimeScale * 20)) / Math.log(400)),
  );
  const height = view.timeHeightMeters;
  $("#time-elevation-value").textContent =
    mode !== "globe"
      ? `${view.timeHeight.toFixed(1)}×`
      : !view.globeTime
        ? "Off"
        : height >= 1000
          ? `${(height / 1000).toFixed(height < 10000 ? 1 : 0)} km`
          : `${Math.round(height)} m`;
  $("#globe-time").classList.toggle("active", view.globeTime);
  $("#globe-time").setAttribute("aria-pressed", String(view.globeTime));
}
on("#globe-time", async () => {
  const button = $("#globe-time") as HTMLButtonElement;
  const enabled = !view.globeTime;
  button.disabled = true;
  displayPreserveFrame = true;
  try {
    await call("scene_sync", {
      scene: { ...captureScene(), globe_time: enabled },
    });
    view.setGlobeTime(enabled);
    updateNavigationControls();
    // Time elevation changes event geometry, not the user’s camera.
    await refresh(true, false);
    await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
  } finally {
    displayPreserveFrame = false;
    button.disabled = false;
  }
});
let viewModeGeneration = 0;
let viewModeWork: Promise<void> = Promise.resolve();
document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const generation = ++viewModeGeneration;
    cancelViewportRefresh();
    void cancelMap();
    mode = b.dataset.view! as ViewMode;
    document
      .querySelectorAll("[data-view]")
      .forEach((e) => e.classList.toggle("active", e === b));
    view.setMode(mode);
    updateNavigationControls();
    layers();
    if (!restoringScene && snapshot)
      viewModeWork = (async () => {
        await call("scene_sync", { scene: captureScene() });
        if (generation !== viewModeGeneration) return;
        await refresh(true, false);
        if (generation !== viewModeGeneration) return;
        await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
        if (generation !== viewModeGeneration) return;
        cancelViewportRefresh();
        if (terrainInfo) await rebuildTerrain();
        else await loadRasters();
      })().catch((e) => toast(String(e), true));
    if (lastRaster) view.setRasters(lastRaster).catch(() => {});
  }),
);
on("#maps", () => mapMenu());
on("#terrain", terrainMenu);
on("#settings", settings);

on("#theme", async () => {
  preferences = {
    ...preferences,
    theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  };
  await call("preferences", { preferences });
  theme();
  await refresh(false);
  if (lastRaster) await view.setRasters(lastRaster);
});
view.onClusters = (cells, add, ids = []) => {
  void (async () => {
    const args = {
      display_cells: cells,
      mode: add ? ("add" as const) : ("replace" as const),
    };
    if (ids.length)
      await call("batch", {
        expected_revision: snapshot.revision,
        operations: [
          { command: "select_query", args },
          { command: "select", args: { ids, mode: "add" } },
        ],
      });
    else
      await call("select_query", {
        ...args,
        expected_revision: snapshot.revision,
      });
    await refresh();
  })().catch((e) => toast(String(e), true));
};
view.onCluster = (bin) => {
  if (bin.count === 1) {
    void select([bin.sample_id], false);
    return;
  }
  modal(
    `${head("Display cell")}<p><strong>${bin.count.toLocaleString()} events</strong> · ${bin.selected_count.toLocaleString()} selected</p><p class="description">${time(bin.first_time)}–${time(bin.last_time)} UTC. This is a reversible display summary. Its position is not a measured event location.</p><footer><button id="cell-table">Open member attributes</button><button id="cell-select">Select all members</button><button id="cell-zoom" class="primary">Zoom to members</button></footer>`,
  );
  on("#cell-select", async () => {
    await call("select_query", {
      display_cell: bin.cell,
      expected_revision: snapshot.revision,
    });
    closeModal();
    await refresh();
  });
  on("#cell-table", async () => {
    closeModal();
    await openAttributes(null);
    tableDisplayCell = bin.cell;
    tableRespectFilters = true;
    page = 0;
    await table();
    $("#table-title").textContent = "Display cell members";
  });
  on("#cell-zoom", async () => {
    closeModal();
    const b = bin.event_bounds,
      x = Math.max(0.00001, (b[2] - b[0]) * 0.1),
      y = Math.max(0.00001, (b[3] - b[1]) * 0.1);
    overrideBounds = [
      Math.max(-180, b[0] - x),
      Math.max(-90, b[1] - y),
      Math.min(180, b[2] + x),
      Math.min(90, b[3] + y),
    ];
    await refresh();
    view.fit();
    await refreshViewportData(view.visibleDataBounds() || overrideBounds);
  });
};
async function applyDisplay(next: DisplayOptions) {
  await call("scene_sync", { scene: { ...captureScene(), display: next } });
  displayOptions = viewsPanel.liveOptions || next;
  view.setDisplayOptions(displayOptions);
  displayPreserveFrame = true;
  try {
    await refresh(true, false);
    await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
  } finally {
    displayPreserveFrame = false;
  }
}
function displaySettings() {
  document.querySelector<HTMLButtonElement>('[data-tab="views"]')!.click();
}
function captureScene(): Scene {
  return {
    mode,
    ...view.captureCamera(),
    render_budget: renderBudget,
    display: displayOptions,
    entity_colors: customEntityColors,
    table_source: tableSource,
    gis_table: gisTable.layerId,
    table_attributes: true,
    table_respect_filters: tableRespectFilters,
    table_sort: tableSort,
    table_descending: tableDescending,
    table_column_offset: tableColumnOffset,
    time_height: view.timeHeight,
    globe_time: view.globeTime,
    globe_time_scale: view.globeTimeScale,
    focus,
    bounds: overrideBounds,
    table_open: tableOpen,
    inspector_tab: tab,
    ...chartsPanel.capture(),
    expanded: document.body.classList.contains("fullscreen"),
  };
}
let restoringScene = false;
async function restoreScene(scene: any = {}) {
  restoringScene = true;
  try {
    cancelViewportRefresh();
    await cancelMap();
    terrainLoadGeneration++;
    terrainInfo = await call("terrain_info");
    if (!terrainInfo) await view.setTerrain(null);
    overrideBounds = scene.bounds || null;
    chartsPanel.restore(scene);
    customEntityColors = { ...scene.entity_colors };
    setEntityColors(customEntityColors);
    displayOptions = { ...defaultDisplay, ...scene.display };
    view.setDisplayOptions(displayOptions);
    tableDisplayCell = null;
    mode = scene.mode || "space-time";
    renderBudget = scene.render_budget === 100000 ? 100000 : 20000;
    view.timeHeight = scene.time_height || 2.8;
    view.setGlobeTimeScale(scene.globe_time_scale ?? 1);
    view.setGlobeTime(!!scene.globe_time);
    focus = scene.focus ?? 0.45;
    $("#time-height").setAttribute("value", String(view.timeHeight));
    ($("#time-height") as HTMLInputElement).value = String(view.timeHeight);
    document.querySelector<HTMLElement>(`[data-view="${mode}"]`)?.click();
    tableOpen = !!scene.table_open;
    // Older workspaces may request a compact table; every event table now
    // restores the complete attribute columns using the same source/scope.
    tableSource = scene.table_source ?? null;
    gisTable.close();
    if (scene.gis_table) gisTable.open(scene.gis_table);
    tableRespectFilters = true;
    tableSort = scene.table_sort || "time";
    tableDescending = !!scene.table_descending;
    tableColumnOffset = scene.table_column_offset || 0;
    tab = scene.inspector_tab || "inspect";
    $("#table-panel").classList.toggle("open", tableOpen);
    $("#toggle-table").classList.toggle("active", tableOpen);
    document
      .querySelectorAll<HTMLElement>("[data-tab]")
      .forEach((e) => e.classList.toggle("active", e.dataset.tab === tab));
    setWorkspaceExpanded(!!scene.expanded);
    findings = [];
    patternsPanel.reset();
    editor.deactivate();
    page = 0;
    await refresh(true, false);
    if (!mapsEnabled()) {
      lastMapStack = undefined;
      lastRaster = null;
      view.clearRasters();
    }
    theme();
    if (!view.restoreCamera(scene)) view.fit();
    updateTimeFocus();
    view.resize();
  } finally {
    restoringScene = false;
  }
  // Request resources only after the saved mode and camera have been restored.
  if (terrainInfo) await rebuildTerrain();
  else if (mapsEnabled())
    void loadRasters().catch((e) => toast(String(e), true));
  else if (lastRaster) await view.setRasters(lastRaster);
  void refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
}
function guardUnsaved(action: string): Promise<boolean> {
  return workspace.guard(action);
}
async function confirmUnsaved(action: string): Promise<boolean> {
  modal(
    `${head("Unsaved changes")}<p class="description">Save this workspace before you ${esc(action)}?</p><footer><button id="unsaved-cancel">Cancel</button><button id="unsaved-discard">Continue without saving</button><button id="unsaved-save" class="primary">Save</button></footer>`,
    true,
  );
  return new Promise<boolean>((resolve) => {
    resolveGuard = resolve;
    const finish = (proceed: boolean) => {
      resolveGuard = null;
      closeModal();
      resolve(proceed);
    };
    $("#unsaved-cancel").onclick = () => finish(false);
    $("#unsaved-discard").onclick = () => finish(true);
    $("#unsaved-save").onclick = () => {
      saveWorkspace()
        .then((saved) => {
          if (saved) finish(true);
        })
        .catch((e) => toast(String(e), true));
    };
  });
}
const archivedRecoveryNotices = new Map<string, AppNotification>();
async function recoveryNotifications() {
  const notices: AppNotification[] = [...archivedRecoveryNotices.values()];
  const state = await call("workspace_status");
  const pending = await call("recovery_list");
  if (state.auto_save_unsaved) {
    const saved = await call("recovery_archive");
    for (const path of saved.archived) {
      const checkpoint = pending.checkpoints.find((c) => path.includes(c.id));
      const notice: AppNotification = {
        id: `recovered:${path}`,
        source: "recovery",
        title: checkpoint?.name
          ? `Unsaved work saved: ${checkpoint.name}`
          : "Unsaved work saved",
        message: `A previous session was saved as ${path.split(/[\\/]/).pop()}. It is available in ${saved.directory}.`,
        actions: [
          {
            label: "Open saved copy",
            run: async () => {
              notifications.close();
              if (!(await guardUnsaved("open recovered work"))) return;
              if (playTimer !== undefined) $("#play").click();
              await task("Opening recovered work…", async () => {
                const result = await call("open", { path });
                projectPath = path;
                lastRaster = null;
                mapUnavailable = false;
                await restoreScene(result.scene);
              });
            },
          },
        ],
      };
      archivedRecoveryNotices.set(notice.id, notice);
      notices.push(notice);
    }
    if (saved.errors.length)
      notices.push({
        id: "recovery-errors",
        source: "recovery",
        severity: "warning",
        title: "Some recovery copies need attention",
        message: saved.errors.join("; "),
        actions: [{ label: "Retry", run: recoveryNotifications }],
      });
  }
  const result = state.auto_save_unsaved
    ? await call("recovery_list")
    : pending;
  for (const c of result.checkpoints)
    notices.push({
      id: `checkpoint:${c.id}`,
      source: "recovery",
      severity: "warning",
      title: `Unsaved work: ${c.name || "Untitled workspace"}`,
      message: `${c.updated} · revision ${c.revision}. This previous session can be recovered; original workspace files are unchanged.`,
      actions: [
        {
          label: "Recover",
          run: async () => {
            notifications.close();
            if (!(await guardUnsaved("recover another workspace"))) return;
            if (playTimer !== undefined) $("#play").click();
            await task("Recovering workspace…", async () => {
              const recovered = await call("recovery_restore", { id: c.id });
              projectPath = (await call("workspace_status")).source;
              await restoreScene(recovered.scene);
              await call("recovery_checkpoint");
              await call("recovery_discard", {
                id: recovered.source_checkpoint,
              });
            });
            await recoveryNotifications();
          },
        },
        {
          label: "Delete checkpoint",
          run: async () => {
            if (!window.confirm("Permanently delete this recovery checkpoint?"))
              return;
            await call("recovery_discard", { id: c.id });
            await recoveryNotifications();
          },
        },
      ],
    });
  notifications.replace("recovery", notices);
}
function reportRecoveryError(error: unknown) {
  notifications.replace("recovery-status", [
    {
      id: "recovery-check-failed",
      source: "recovery-status",
      severity: "warning",
      title: "Recovery check needs attention",
      message: String(error),
      actions: [
        {
          label: "Retry",
          run: async () => {
            await recoveryNotifications();
            notifications.replace("recovery-status", []);
          },
        },
      ],
    },
  ]);
}
async function openFile() {
  const path = await chooseFile({
    title: "Open workspace or data",
    filters: [
      {
        name: "Chronoscope workspaces and data",
        extensions: [
          "chronoscope",
          "json",
          "csv",
          "tsv",
          "xlsx",
          "xls",
          "xlsb",
          "shp",
          "gpkg",
          "geojson",
          "topojson",
          "kml",
          "kmz",
          "czml",
          "gpx",
          "gltf",
          "glb",
        ],
      },
      { name: "Chronoscope workspaces", extensions: ["chronoscope", "json"] },
      {
        name: "CSV and Excel",
        extensions: ["csv", "tsv", "xlsx", "xls", "xlsb"],
      },
      {
        name: "GIS data and 3D assets",
        extensions: [
          "shp",
          "gpkg",
          "geojson",
          "topojson",
          "json",
          "kml",
          "kmz",
          "czml",
          "gpx",
          "gltf",
          "glb",
        ],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!path) return;
  const probe =
    /\.(json|geojson|topojson|kml|kmz|czml|gpx|gltf|glb|shp|gpkg)$/i.test(path)
      ? await task("Identifying file…", () => call("file_probe", { path }))
      : null;
  const isWorkspace =
    /\.chronoscope$/i.test(path) || probe?.kind === "workspace";
  await filterIntent.flush();
  if (
    !(await guardUnsaved(
      isWorkspace ? "open another workspace" : "import data",
    ))
  )
    return;
  if (playTimer !== undefined) $("#play").click();
  if (probe?.kind === "gis") {
    await openGisFile(path, probe.format!);
    return;
  }
  if (!isWorkspace) {
    await importPreview(path, "auto");
    return;
  }
  await task("Opening workspace…", async () => {
    const result = await call("open", { path });
    projectPath = path;
    lastRaster = null;
    mapUnavailable = false;
    await restoreScene(result.scene);
    if (result.missing_resources?.length)
      toast(result.missing_resources.join("; "), true);
  });
}
function saveWorkspace(saveAs = false): Promise<boolean> {
  return workspace.save(saveAs);
}

on("#open", openFile);
on("#save", () => saveWorkspace());
on("#export", async () => {
  const path = await chooseFile({
    save: true,
    defaultPath: "events.csv",
  });
  if (path) {
    const r = await call("export", { path });
    toast(`Exported ${r.exported} events`);
  }
});
on("#close-table", () => {
  gisTable.close();
  tableAnchor = null;
  tableActiveId = null;
  tableDisplayCell = null;
  tableOpen = false;
  $("#table-panel").classList.remove("open");
  $("#toggle-table").classList.remove("active");
  view.resize();
  view.onSceneChange?.();
});
on("#toggle-table", showTablesMenu);
$(".table-scroll").addEventListener("scroll", () => {
  if (!tableOpen || tableScrollFrame) return;
  tableScrollFrame = requestAnimationFrame(() => {
    tableScrollFrame = 0;
    const rank = Math.floor($(".table-scroll").scrollTop / tableRowUnit());
    const next = Math.floor(Math.max(0, rank - 20) / 50);
    if (next === page || tableReveal) return;
    page = next;
    if (tableScrollLoading) return;
    tableScrollLoading = true;
    void (async () => {
      try {
        for (;;) {
          const requested = page;
          await table();
          if (requested === page) break;
        }
      } finally {
        tableScrollLoading = false;
      }
    })().catch((error) => toast(String(error), true));
  });
});
on("#navigate", () => {
  view.boxMode = false;
  $("#navigate").classList.add("active");
  $("#navigate").setAttribute("aria-pressed", "true");
  $("#box-select").classList.remove("active");
  $("#box-select").setAttribute("aria-pressed", "false");
});
on("#box-select", () => {
  view.boxMode = true;
  $("#box-select").classList.add("active");
  $("#box-select").setAttribute("aria-pressed", "true");
  $("#navigate").classList.remove("active");
  $("#navigate").setAttribute("aria-pressed", "false");
});
function setWorkspaceExpanded(expanded: boolean) {
  document.body.classList.toggle("fullscreen", expanded);
  const button = $("#fullscreen");
  const label = expanded ? "Restore workspace" : "Expand workspace";
  button.innerHTML = icon(expanded ? "minimize" : "maximize");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(expanded));
}
on("#fullscreen", () => {
  setWorkspaceExpanded(!document.body.classList.contains("fullscreen"));
  view.resize();
});
async function fitEvents() {
  overrideBounds = null;
  await refresh();
  if (terrainInfo) await rebuildTerrain();
  view.fit();
}
on("#fit-terrain", async () => {
  overrideBounds = terrainInfo.bounds;
  await refresh();
  await rebuildTerrain();
  view.fit();
});
$("#globe-time-height").addEventListener("input", () => {
  view.setGlobeTimeScale(
    Math.pow(400, Number(input("#globe-time-height")) / 100) / 20,
  );
  updateNavigationControls();
  view.onSceneChange();
});
$("#time-height").addEventListener("input", () => {
  view.timeHeight = Number(input("#time-height"));
  updateNavigationControls();
  view.rebuild();
  view.onSceneChange();
  if (lastRaster) view.setRasters(lastRaster).catch(() => {});
});
on("#screenshot", async () => {
  await filterIntent.flush();
  const a = document.createElement("a");
  a.href = await view.screenshot();
  a.download = "chronoscope-space-time.png";
  a.click();
});
on("#select-all", async () => {
  await call("select_visible");
  await refresh(false);
});
on("#clear", () => select([]));
$("#selected-only").addEventListener("change", () =>
  filter({ selected_only: check("#selected-only") }).catch(() => {}),
);
on("#all-entities", () =>
  filter({
    hidden_entities: [],
    facet_hidden: {
      ...filterIntent.desired(snapshot.filter).facet_hidden,
      entity: [],
    },
  }),
);
on("#reset-filters", () =>
  filter({
    start: null,
    end: null,
    hidden_entities: [],
    hidden_categories: [],
    hidden_sources: [],
    facet_hidden: {},
    search: "",
    predicates: [],
    selected_only: false,
    bounds: null,
    located_only: false,
  }),
);
on("#exact-apply", async () => {
  const parse = async (s: string) =>
    !s.trim() ? null : (await call("time_parse", { value: s })).epoch;
  await filter({
    start: await parse(input("#exact-start")),
    end: await parse(input("#exact-end")),
  });
});
on("#add-rule", () =>
  filter({
    predicates: [
      ...filterIntent.desired(snapshot.filter).predicates,
      {
        field: input("#rule-field"),
        op: input("#rule-op"),
        value: input("#rule-value"),
      },
    ],
  }),
);
$("#rules").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-remove-rule]");
  if (b)
    filter({
      predicates: filterIntent
        .desired(snapshot.filter)
        .predicates.filter((_, i) => i !== Number(b.dataset.removeRule)),
    }).catch(() => {});
});
on("#apply-bounds", async () => {
  const b = input("#bounds").split(",").map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite))
    throw new Error("Use west,south,east,north");
  await filter({
    bounds: { west: b[0], south: b[1], east: b[2], north: b[3] },
  });
});
on("#full-range", () => timeWindow(0, 1));
$("#histogram").addEventListener("pointerdown", async (e) => {
  const r = $("#histogram").getBoundingClientRect();
  focus = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
  updateTimeFocus();
  histogram();
  const bin = Math.min(99, Math.floor(focus * 100));
  await call("select_visible", { bin, mode: e.shiftKey ? "add" : "replace" });
  await refresh(false);
});
let playbackUpdating = false;
let playbackWindow: [number, number] | null = null;
let playbackClock: PlaybackClock | undefined;
const playbackSpeed = new PlaybackSpeed($("#play"), (speed) => {
  playbackClock?.setSpeed(speed);
});
const playbackIncrement = new PlaybackIncrement(
  $("#playback-speed").parentElement!,
  (increment) => {
    playbackClock?.setIncrement(increment);
  },
);
timeRail.mountPlayback();
on("#play", () => {
  if (playTimer !== undefined) {
    cancelAnimationFrame(playTimer);
    playTimer = undefined;
    playbackClock = undefined;
    view.setPlayback(false);
    if (playbackWindow)
      void timeWindow(...playbackWindow)
        .catch((error) => toast(String(error), true))
        .finally(() => {
          playbackPreserveFrame = playTimer !== undefined;
        });
    else playbackPreserveFrame = false;
    $("#play").innerHTML = icon("play") + " Play";
    return;
  }
  const [lo, hi] = snapshot.time_bounds;
  const span = Math.max(1e-9, hi - lo);
  const startAt = Math.max(
    0,
    Math.min(1, ((snapshot.filter.start ?? lo) - lo) / span),
  );
  const endAt = Math.max(
    startAt,
    snapshot.filter.end === null
      ? 1
      : Math.min(1, (snapshot.filter.end - lo) / span),
  );
  const width = endAt - startAt;
  const travel = 1 - width;
  const initialFocus = focus;
  playbackClock = new PlaybackClock(
    playbackSpeed.value,
    performance.now(),
    playbackIncrement.value,
  );
  playbackPreserveFrame = true;
  view.setPlayback(true);
  let lastUpdate = -Infinity;
  $("#play").innerHTML = icon("pause") + " Pause";
  const frame = (now: number) => {
    if (playTimer === undefined) return;
    const phase = playbackClock!.seconds(now) / span;
    const start = travel > 1e-9 ? (startAt + phase) % travel : 0;
    playbackWindow = [start, start + width];
    focus = travel > 1e-9 ? start + width / 2 : (initialFocus + phase) % 1;
    updateTimeFocus();
    const cursor = $("#histogram").querySelector<HTMLElement>(".cursor");
    if (cursor) cursor.style.top = `${focus * 100}%`;
    timeRange.set(start, start + width, [lo, hi]);
    timeRail.update(lo, hi, lo + span * start, lo + span * (start + width));
    // A full-range cursor sweep does not change the evidence. Avoid decoding
    // and republishing the same large packet just because another tick elapsed.
    const current = filterIntent.desired(snapshot.filter);
    const nextStart = start === 0 ? null : lo + (hi - lo) * start;
    const nextEnd =
      start + width === 1 ? null : lo + (hi - lo) * (start + width);
    // One data refresh at a time. Never accumulate work behind the render clock.
    if (
      !playbackUpdating &&
      !busy &&
      now - lastUpdate >= 50 &&
      (current.start !== nextStart || current.end !== nextEnd)
    ) {
      lastUpdate = now;
      playbackUpdating = true;
      void timeWindow(start, start + width)
        .catch((error) => {
          if (playTimer !== undefined) $("#play").click();
          toast(String(error), true);
        })
        .finally(() => {
          playbackUpdating = false;
        });
    }
    playTimer = requestAnimationFrame(frame);
  };
  playTimer = requestAnimationFrame(frame);
});
function reviewDelete() {
  if (!snapshot.selected_count) return;
  modal(
    `${head("Remove selected events?")}<p class="description">Delete ${snapshot.selected_count} selected events and their group/view references. Undo remains available during this session.</p><footer><button data-close>Cancel</button><span class="spacer"></span><button id="confirm-delete" class="primary">Delete events</button></footer>`,
    true,
  );
  on("#confirm-delete", async () => {
    await call("delete");
    closeModal();
    await refresh();
    toast("Removed selection. Undo is available.");
  });
}
function helpMenu() {
  const menu = modal(
    `${head("Help")}<div class="help-actions"><button id="user-guide" class="primary">Full user guide</button><button id="demo-datasets">Demo datasets</button><button id="keyboard-guide">Keyboard shortcuts</button><button id="about-app">About Chronoscope</button></div>`,
    true,
  );
  menu.querySelector(".modal")!.classList.add("help-menu");
  on("#user-guide", () => showHelp());
  on("#demo-datasets", demoDatasets);
  on("#keyboard-guide", () => showHelp(true));
  on("#about-app", () =>
    modal(
      `${head(`Chronoscope ${appVersion}`)}<p class="description">Rust engine · CesiumJS WebGL2 renderer · Tauri desktop.</p><p class="description">Chronoscope is MIT licensed. CesiumJS and other dependency licenses, notices and public-data credits are bundled with the app.</p>`,
      true,
    ),
  );
}
async function demoDatasets() {
  const { demos } = await call("demo_catalog");
  modal(
    `${head("Demo datasets")}<p class="description">Real observations, bundled for offline use. Each opens as a new workspace with saved views. Save to keep your own copy.</p><div class="help-actions">${demos
      .map(
        (demo) =>
          `<section><button data-demo-id="${esc(demo.id)}">${esc(demo.name)}</button><p class="description">${esc(demo.description)}</p><p class="description">${esc(demo.license)} · ${esc(demo.source_url)}</p></section>`,
      )
      .join("")}</div>`,
  );
  demos.forEach((demo) => {
    on(`[data-demo-id="${demo.id}"]`, async () => {
      closeModal();
      await filterIntent.flush();
      if (!(await guardUnsaved("open a demo dataset"))) return;
      if (playTimer !== undefined) $("#play").click();
      await task("Opening demo dataset…", async () => {
        const result = await call("demo_open", {
          id: demo.id as EngineContracts["demo_open"]["args"]["id"],
        });
        projectPath = null;
        lastRaster = null;
        mapUnavailable = false;
        await restoreScene(result.scene);
      });
    });
  });
}
function showHelp(keysOnly = false) {
  modal(
    `${head(keysOnly ? "Keyboard shortcuts" : "Chronoscope user guide")}<p class="description">Local, offline documentation · version ${appVersion}. Ctrl shortcuts use Cmd on macOS. Text fields keep standard editing shortcuts.</p>${keysOnly ? "" : '<input id="help-search" aria-label="Search help topics" placeholder="Search help…">'}<div class="help-guide">${keysOnly ? "" : guide.map(([title, body], i) => `<details class="help-topic" ${i === 0 ? "open" : ""}><summary>${title}</summary>${body}</details>`).join("")}<section><h3>Keyboard shortcuts</h3><table>${shortcuts.map(([key, text]) => `<tr><td class="mono">${key}</td><td>${text}</td></tr>`).join("")}</table></section></div>`,
  );
  if (!keysOnly)
    $("#help-search").addEventListener("input", () => {
      const q = input("#help-search").toLowerCase();
      document
        .querySelectorAll<HTMLDetailsElement>(".help-topic")
        .forEach((e) => {
          e.hidden = !e.textContent!.toLowerCase().includes(q);
          if (q && !e.hidden) e.open = true;
        });
    });
}
on("#help", helpMenu);
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  const editable =
    e.target instanceof Element &&
    !!e.target.closest('input,textarea,select,[contenteditable="true"]');
  const cmd = e.ctrlKey || e.metaKey;
  const run = (fn: () => unknown) => {
    e.preventDefault();
    Promise.resolve()
      .then(fn)
      .catch((error) => toast(String(error), true));
  };
  if (key === "f1") {
    run(() => showHelp());
    return;
  }
  if (key === "escape") {
    e.preventDefault();
    if (modalNode) closeModal();
    else if (notifications.isOpen) notifications.close();
    else if (layerMenu) closeLayerMenu();
    else if (view.cancelNavigation()) {
      if (view.boxMode) $("#navigate").click();
    } else if (view.boxMode) $("#navigate").click();
    else if (!editable) run(() => select([]));
    return;
  }
  if (modalNode || busy || notifications.isOpen || layerMenu) return;
  if (cmd) {
    if (key === "o" || key === "i") run(openFile);
    else if (key === "s") run(() => saveWorkspace(e.shiftKey));
    else if (key === "e") run(() => $("#export").click());
    else if (key === "f")
      run(() => {
        paneLayout.sidebar.reveal("search", true);
        $("#search").focus();
        ($("#search") as HTMLInputElement).select();
      });
    else if (!editable && key === "a") run(() => $("#select-all").click());
    else if (!editable && (key === "z" || key === "y"))
      run(async () => {
        await call(key === "y" || e.shiftKey ? "redo" : "undo");
        await refresh();
      });
    return;
  }
  if (editable) return;
  // Space activates a focused button; only use it as a playback shortcut
  // when focus is outside a control with its own activation behavior.
  if (
    key === " " &&
    e.target instanceof Element &&
    e.target.closest('button,summary,[role="button"]')
  )
    return;
  if (view.navigationKey(e)) return;
  if (
    key === "o" &&
    !e.altKey &&
    e.target instanceof Node &&
    view.host.contains(e.target)
  ) {
    run(() =>
      document
        .querySelector<HTMLElement>(
          `[data-view="${mode === "globe" ? "map" : "globe"}"]`,
        )
        ?.click(),
    );
    return;
  }
  const viewKey =
    e.altKey && /^Digit[1-3]$/.test(e.code) ? e.code.slice(-1) : key;
  if (e.altKey && ["1", "2", "3"].includes(viewKey))
    run(() =>
      document
        .querySelector<HTMLElement>(
          `[data-view="${["space-time", "map", "globe"][Number(viewKey) - 1]}"]`,
        )
        ?.click(),
    );
  else if (!e.altKey && key === " ") run(() => $("#play").click());
  else if (key === "?") run(() => showHelp(true));
  else if (key === "delete" && snapshot.selected_count) run(reviewDelete);
});
const liveViewRequest = createAgentView({
  view,
  snapshot: () => snapshot,
  mode: () => mode,
  captureScene,
  fitGisLayer,
});

async function initialize() {
  await view.ready;
  [preferences, mapPresets] = await Promise.all([
    call("preferences"),
    call("wmts_servers").then((c) => c.presets),
  ]);
  theme();
  terrainInfo = await call("terrain_info");
  if (terrainInfo) overrideBounds = terrainInfo.bounds;
  await refresh(true, false);
  layers();
  if (snapshot.scene) await restoreScene(snapshot.scene);
  else {
    view.fit();
    if (terrainInfo) await rebuildTerrain();
    else if (mapsEnabled())
      void loadRasters().catch((e) => toast(String(e), true));
  }
  if (native) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("app-menu", (e) => {
      if (e.payload === "help-guide") showHelp();
      else if (e.payload === "help-shortcuts") showHelp(true);
    });
    await listen("workspace-close-request", async () => {
      try {
        await workspace.close(async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("desktop_close");
        });
      } catch (error) {
        toast(String(error), true);
      }
    });
    let syncTimer: ReturnType<typeof setTimeout>;
    view.onSceneChange = () => {
      if (restoringScene) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        if (restoringScene) return;
        try {
          const scene = captureScene();
          const result = await call("scene_sync", {
            scene,
            expected_revision: snapshot.revision,
          });
          if (result.revision >= snapshot.revision) {
            snapshot.revision = result.revision;
            snapshot.scene = scene;
          }
        } catch (error) {
          if (!String(error).includes("CONFLICT:")) toast(String(error), true);
        }
      }, 600);
    };
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let guiSync: Promise<void> = Promise.resolve();
    let pendingEngineRevision = 0;
    let restorePending = false,
      themePending = false,
      terrainPending = false,
      fitTerrainPending = false;
    const flushChanges = () => {
      clearTimeout(eventTimer);
      eventTimer = undefined;
      const requestedRevision = pendingEngineRevision;
      pendingEngineRevision = 0;
      const restore = restorePending,
        retTheme = themePending,
        retTerrain = terrainPending,
        fitTerrain = fitTerrainPending;
      restorePending = false;
      themePending = false;
      terrainPending = false;
      fitTerrainPending = false;
      guiSync = guiSync
        .catch(() => {})
        .then(async () => {
          // Local filter intent already publishes its own coherent snapshot.
          // Wait for that publication before processing its echoed desktop event.
          await filterIntent.idle().catch(() => {});
          if (
            !restore &&
            !retTheme &&
            !retTerrain &&
            requestedRevision <= snapshot.revision
          )
            return;
          if (retTerrain) {
            const next = await call("preferences");
            const pathChanged = next.terrain_path !== preferences.terrain_path;
            terrainInfo = await call("terrain_info");
            if (pathChanged || fitTerrain)
              overrideBounds = terrainInfo?.bounds || null;
            if (!terrainInfo) await view.setTerrain(null);
          }
          await refresh();
          if (restore) await restoreScene(snapshot.scene);
          if (retTheme) {
            theme();
            mapUnavailable = false;
            if (terrainInfo) await rebuildTerrain();
            else await loadRasters();
          }
          if (fitTerrain) view.fit();
        });
      guiSync.catch((error) => toast(String(error), true));
      return guiSync;
    };
    let desktopRequests: Promise<unknown> = Promise.resolve();
    await listen<any>("engine-event", (e) => {
      const event = e.payload;
      if (event.command === "scene_sync") return;
      if (
        ["capture", "view_status", "view_navigate", "assist_ui"].includes(
          event.kind,
        )
      ) {
        if (eventTimer) flushChanges();
        desktopRequests = desktopRequests
          .catch(() => {})
          .then(async () => {
            try {
              await filterIntent.flush();
              await guiSync;
              if (Date.now() > event.expires_at_ms)
                throw Error(
                  "UNAVAILABLE: desktop request expired before execution",
                );
              if (event.kind === "assist_ui") {
                await refresh(false, false);
                const result = await focusedUI(event.arguments, snapshot, () =>
                  refresh(),
                );
                await call("view_response", {
                  request_id: event.request_id,
                  result,
                });
                return;
              }
              if (event.kind === "capture") {
                const target = event.arguments?.target || "app";
                const label = event.arguments?.window || "main";
                if (target === "app" && label === "main" && tab === "charts")
                  await Promise.race([
                    chartsPanel.idle().catch(() => {}),
                    new Promise((resolve) => setTimeout(resolve, 2000)),
                  ]);
                if (target === "app") {
                  // A failed graphics context must not prevent capturing its UI.
                  try {
                    view.requestRender();
                  } catch {}
                }
                const data_url =
                  target === "map"
                    ? await view.screenshot()
                    : await captureAppWindow(label);
                await call("view_response", {
                  request_id: event.request_id,
                  data_url,
                });
              } else {
                const result = await liveViewRequest(
                  event.kind,
                  event.arguments,
                );
                if (event.kind === "view_navigate") clearTimeout(syncTimer);
                await call("view_response", {
                  request_id: event.request_id,
                  result,
                });
              }
            } catch (error) {
              await call("view_response", {
                request_id: event.request_id,
                error: String(error),
              });
            }
          })
          .catch(() => {});
        return;
      }
      const mapChange = [
        "preferences",
        "wmts_auth_set",
        "wmts_auth_remove",
        "wmts_auth_reset",
        "wmts_access",
      ].includes(event.command);
      const catalogChange = [
        "preferences",
        "terrain_load",
        "terrain_unload",
        "open",
        "undo",
        "redo",
      ].includes(event.command);
      const clearCache = event.command === "wmts_cache_clear";
      if (mapChange || catalogChange || clearCache) {
        void cancelMap();
        terrainLoadGeneration++;
        if (mapChange || clearCache) capabilities = null;
      }
      if (
        event.revision <= snapshot.revision &&
        !mapChange &&
        !catalogChange &&
        !clearCache
      )
        return;
      if (
        [
          "view_set",
          "restore_view",
          "open",
          "demo_open",
          "undo",
          "redo",
        ].includes(event.command)
      )
        clearTimeout(syncTimer);
      pendingEngineRevision = Math.max(
        pendingEngineRevision,
        event.revision || 0,
      );
      restorePending ||= [
        "view_set",
        "restore_view",
        "open",
        "demo_open",
        "undo",
        "redo",
      ].includes(event.command);
      themePending ||=
        mapChange || ["terrain_load", "terrain_unload"].includes(event.command);
      terrainPending ||= [
        "preferences",
        "terrain_load",
        "terrain_unload",
      ].includes(event.command);
      fitTerrainPending ||= event.command === "terrain_load";
      clearTimeout(eventTimer);
      eventTimer = setTimeout(flushChanges, 180);
    });
  }
  view.onViewportChange = scheduleViewportResources;
  void recoveryNotifications().catch(reportRecoveryError);
  setInterval(async () => {
    if (busy || !preferences.auto_save_unsaved) return;
    try {
      await workspace.autosave();
    } catch (error) {
      console.error("Automatic document save:", error);
    }
  }, 30000);
}
const ready = initialize();
ready.catch((e) => {
  toast(String(e), true);
  status("Initialization failed; see error details");
});
(window as any).__chronoscope = {
  view,
  openAttributes,
  captureScene,
  liveViewRequest,
  restoreScene,
  displaySettings,
  saveWorkspace,
  openFile,
  openWorkspace: openFile, // Retain the existing automation bridge alias.
  showHelp,
  call,
  refresh,
  ready,
  editorIdle: () => editor.idle(),
  viewModeIdle: () => viewModeWork,
  filterIdle: () => filterIntent.flush(),
  displayIdle: () => viewsPanel.idle(),
  chartsIdle: () => chartsPanel.idle(),
  patternsIdle: () => patternsPanel.idle(),
  select,
  selectionIdle: () => tableSelectionWork,
  loadTerrain,
  rebuildTerrain,
  loadRasters,
  mapLayerMenu,
  currentMapZoom,
  setTerrainInfo: (v: any) => (terrainInfo = v),
  setBounds: (v: Bounds) => (overrideBounds = v),
  get busy() {
    return busy;
  },
  get snapshot() {
    return snapshot;
  },
  get preferences() {
    return preferences;
  },
};
