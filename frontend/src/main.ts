import type { SnapshotModel, SnapshotRequestIntent, SnapshotData, SnapshotApplication } from "./view-snapshot";
import { SceneTransitions, type RestoreCommit } from "./scene-transitions";
import { MeasurementLegend } from "./measurement-style";
import { preferenceEffects } from "./preference-effects";
import { WorkspaceFiles } from "./workspace-files";
import { Welcome } from "./welcome";
import {
  attributeTableMarkup,
  createAttributeTables,
} from "./attribute-tables";
import { TableWindowHost } from "./table-windows";
import { createMapSettings } from "./map-settings";
import { suggestTags, focusedUI } from "./focused-ai";
import { version as appVersion } from "../package.json";
import { EditorController } from "./editor-controller";
import { WorkspaceController } from "./workspace-controller";
import { openAnalytics } from "./analytics";
import { openGuidedAnalysis } from "./guided-analysis";
import { ImportDialog } from "./import-dialog";
import { captureAppWindow, recordAppWindow } from "./app-capture";
import { NotificationCenter, type AppNotification } from "./notifications";
import { createAgentView } from "./agent-view";
import { createAgentLab } from "./agent-lab";
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
import { DialogController } from "./dialog-controller";
import { createPreferencesController } from "./preferences-controller";
import { globeElevationScale, globeElevationSlider } from "./time-elevation";
import { PlaybackWindow } from "./playback-window";
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
import type { TerrainTileSource } from "./cesium-resources";
import { mapLayers, layerVisible, MapStack } from "./map-stack";
import {
  decode,
  escape as esc,
  time,
  displayTime,
  setDateTimeDisplay,
  entityColor,
  setEntityColors,
  type Snapshot,
  type SceneState,
  type Filter,
  type Preferences,
  type Terrain,
  type Raster,
  type MapLayer,
} from "./types";
import type { EngineContracts } from "./contracts";
import type { Bounds } from "./types";
document.title = `Chronoscope ${appVersion}`;
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
  busy = 0,
  serial = 0,
  focus = 0.45,
  terrainInfo: any = null,
  overrideBounds: Bounds | null = null,
  lastRaster: Raster | null = null;
const entitySelectionIntents = new Map<string, { selected: boolean }>();
let displayOptions: DisplayOptions = { ...defaultDisplay };
let customEntityColors: Record<string, string> = {};
let displayPreserveFrame = false;
let layerMenu: HTMLElement | null = null;
let findings: any[] = [];
let findingsRevision = -1;
let resolveGuard: ((proceed: boolean) => void) | null = null;
const dialogs = new DialogController(() => {
  const pending = resolveGuard;
  resolveGuard = null;
  pending?.(false);
});
let playTimer: number | undefined;
let playbackHistory: {
  workspace: string;
  width: number;
  last: [number | null, number | null];
  bounds: [number, number];
} | undefined;
let playbackPreserveFrame = false;
let timeScrubbing = false;
let timeScrubGeneration = 0;
$("#app").innerHTML = `
<header class="topbar"><div class="toolbar-main"><div class="brand"><div class="brand-mark">${brandMark}</div><div><div class="brand-name" title="Chronoscope">chrono<span>scope</span></div></div></div><button id="open" aria-label="Open workspace or data">${icon("folder")} <span class="toolbar-label">Open</span></button><button id="save" aria-label="Save workspace">${icon("save")} <span class="toolbar-label">Save</span></button><nav class="viewbar" aria-label="Views and data actions"><button class="active" data-view="space-time">Time</button><button data-view="map">Map</button><button data-view="globe">Globe</button><button id="aggregate-events" title="Preview and summarize visible records by time and proximity">Aggregate</button><button id="export">Export CSV</button><button id="toggle-table" aria-haspopup="menu" aria-controls="tables-menu" aria-expanded="false">${icon("table")} Tables</button></nav><button id="maps" aria-label="Map servers">${icon("map")} <span class="toolbar-label">Maps</span></button><button id="terrain" aria-label="Terrain">${icon("terrain")} <span class="toolbar-label">Terrain</span></button><button id="si" title="Open SI chat" aria-controls="si-chat" aria-expanded="false">AI</button><button id="help">Help</button><button class="icon" id="theme" title="Switch theme">${icon("sun")}</button><button class="icon" id="settings" title="Preferences and interfaces">${icon("settings")}</button><button type="button" class="icon renderer-status" id="backend" aria-label="Reset map" title="Reset map"></button></div><button type="button" class="icon notification-trigger" id="notifications" title="Notifications" aria-label="Notifications" aria-controls="notifications-panel" aria-expanded="false">${icon("bell")}<span class="notification-badge" aria-hidden="true" hidden></span></button></header>
<main class="workspace"><aside class="sidebar"><section class="sidebar-pinned" id="search-section" aria-label="Search and selection"><input id="search" placeholder="Search events…" aria-label="Search events"><button id="reset-filters">Reset filters</button><div class="selection-tools" id="selection-tools"><div class="selection-summary"><strong id="pinned-selection-count" role="status">0 selected</strong><button id="clear" aria-label="Clear selection">Clear</button></div><div class="selection-actions"><button class="secondary" id="select-all">Select visible</button><label class="check-row"><input type="checkbox" id="selected-only" aria-label="Selected events only"> Show only</label></div></div></section><div class="sidebar-scroll"><details open class="sidebar-facet" id="entity-section"><summary><span>Entities</span><select id="entity-field" aria-label="Entity list field" title="Group the list by another column; source track identities stay unchanged"><option value="entity">Entity</option></select></summary><div class="facet-sort" role="group" aria-label="Sort entities"><button id="entity-sort-name" data-facet-sort="name">Name <span aria-hidden="true"></span></button><button id="entity-sort-count" data-facet-sort="count">Quantity <span aria-hidden="true"></span></button></div><div class="facet-controls"><input id="entity-search" placeholder="Find an entity…" aria-label="Find entity"><button id="all-entities">Enable all</button></div><div id="entities"></div><div class="facet-footer"><small id="entity-list-count"></small><button id="entity-show-all">Show all</button></div></details><details open class="sidebar-facet" id="category-section"><summary><span>Categories</span><select id="category-field" aria-label="Category list field" title="Group the list by another column"><option value="category">Category</option></select></summary><div class="facet-sort" role="group" aria-label="Sort categories"><button id="category-sort-name" data-facet-sort="name">Name <span aria-hidden="true"></span></button><button id="category-sort-count" data-facet-sort="count">Quantity <span aria-hidden="true"></span></button></div><div id="categories"></div><div class="facet-footer"><small id="category-list-count"></small><button id="category-show-all">Show all</button></div></details><div class="divider"></div><details id="time-section"><summary>Exact time range</summary><label class="field">Start / UTC<input id="exact-start" placeholder="Unbounded"></label><label class="field">End / UTC<input id="exact-end" placeholder="Unbounded"></label><button id="exact-apply" class="secondary">Apply range</button></details><details id="rules-section"><summary>Attribute rules</summary><label class="field">Field<input id="rule-field" placeholder="value, confidence, category…"></label><select id="rule-op"><option>Contains</option><option>Equals</option><option>NotEquals</option><option>Greater</option><option>Less</option><option>IsEmpty</option></select><label class="field">Value<input id="rule-value"></label><button id="add-rule" class="secondary">Add AND rule</button><div id="rules"></div></details><details id="bounds-section"><summary>Geographic bounds</summary><label class="field">West, South, East, North<input id="bounds" placeholder="-80,43,-79,44"></label><button id="apply-bounds" class="secondary">Apply region</button></details><section id="layers-section"><div class="section-head"><span class="caps">Layers</span></div><div id="layer-list"></div><div class="source-foot">WGS84 · UTC</div></section></div></aside>
<section class="center"><div class="scene-container" id="scene"><div class="legend" id="legend"></div>${navigationTools()}</div><section class="table-panel" id="table-panel">${attributeTableMarkup}</section><section class="timeline"><div class="timeline-title"><span class="caps">Time window</span><span class="range-label mono" id="range-label"></span><span class="spacer"></span><button class="secondary" id="play">${icon("play")} Play</button><button id="full-range">Full range</button></div><div class="time-range-track" id="time-range-track"><div class="histogram" id="histogram"></div></div><div class="timeline-labels" id="timeline-labels"></div><div class="time-range-hint">Drag brackets to resize · Drag the window to move · Arrow keys to adjust</div></section></section>
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
const tables = createAttributeTables($("#table-panel"), {
  snapshot: () => snapshot,
  refresh: () => refresh(false, false),
  error: (error) => toast(String(error), true),
  changed: () => {
    syncTableLayout();
    tableWindows?.publish();
  },
  layout: () => {
    syncTableLayout();
    view.resize();
    view.onSceneChange?.();
  },
  suspended: () => tableWindows?.detached ?? false,
  detach: () => tableWindows.open(),
});
const { gisTable, tableSelection } = tables;
function syncTableLayout() {
  $("#table-panel").classList.toggle(
    "open",
    tables.tableOpen && !tableWindows?.detached,
  );
  $("#toggle-table").classList.toggle("active", tables.tableOpen);
}
const tableWindows = new TableWindowHost(
  tables,
  async () => {
    syncTableLayout();
    view.resize();
    await refresh(false, false);
  },
  (error) => toast(String(error), true),
);
async function table(
  preloaded?: any,
  parentGeneration = serial,
  selectedIds?: string[],
) {
  if (parentGeneration !== serial) return;
  await tables.render(preloaded, selectedIds);
}
const rendererStatus = new RendererStatus($("#backend"));
rendererStatus.update("Initializing renderer");
const view = new SpaceTimeView($("#scene"), (s) => rendererStatus.update(s));
$("#backend").addEventListener("click", () => {
  const dialog = modal(
    `${head("Reset map?")}<p class="description">The map will briefly disappear while its graphics and visible map layers reload. Your Events, filters, selections, camera and saved workspace are kept.</p><footer><button type="button" id="reset-map-cancel" autofocus>Cancel</button><button type="button" id="reset-map-confirm" class="primary">Reset map</button></footer>`,
    true,
  );
  const cancel = dialog.querySelector<HTMLButtonElement>("#reset-map-cancel")!;
  const confirm = dialog.querySelector<HTMLButtonElement>("#reset-map-confirm")!;
  cancel.onclick = closeModal;
  confirm.onclick = () => {
    closeModal();
    void view.recoverRenderer().catch((error) => toast(String(error), true));
  };
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.repeat) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  cancel.focus();
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
  measurement: measurementSettings,
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
    await sceneIdle();
    await syncScene(captureScene());
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
const measurementLegend = new MeasurementLegend($("#scene"));
const timeRange = new TimeRange(
  $("#time-range-track"),
  (start, end, final) => {
    const [lo, hi] = snapshot.time_bounds;
    $("#range-label").textContent =
      `${displayTime(lo + (hi - lo) * start)} — ${displayTime(lo + (hi - lo) * end)} UTC`;
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
/** Serialize local scene RPC acknowledgements, not UI transitions or refreshes.
 * No coordinator drain belongs inside this queue: its callers may own that turn.
 */
let sceneSyncWork: Promise<unknown> = Promise.resolve();
function syncScene(
  scene: Scene,
  expectedRevision?: number,
  expectedWorkspace = snapshot.workspace_id,
) {
  const work = sceneSyncWork
    .catch(() => {})
    .then(async () => {
      if (snapshot.workspace_id !== expectedWorkspace)
        throw Error("CONFLICT: workspace changed before scene synchronization");
      const fence = {
        workspace: expectedWorkspace,
        revision: snapshot.revision,
        expectedRevision,
      };
      const result = await call("scene_sync", {
        scene,
        expected_workspace: expectedWorkspace,
        ...(expectedRevision === undefined
          ? {}
          : { expected_revision: expectedRevision }),
      });
      if (snapshot.workspace_id !== expectedWorkspace)
        throw Error("CONFLICT: workspace changed before scene acknowledgement");
      editor.acknowledgeScene(fence, snapshot.workspace_id, result);
      if (view.nativeSnapshots) queueRepresentation("metadata-reconcile", true);
      return result;
    });
  sceneSyncWork = work;
  return work;
}
const workspace = new WorkspaceController({
  settle: async () => {
    await editor.idle();
    await filterIntent.flush();
    await viewsPanel.idle();
    // Save/close/autosave must observe queued toolbar intent and complete UI
    // restoration, not just the engine's already-committed snapshot.
    await sceneIdle();
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
    welcome.remember(path, snapshot.count);
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
  if (setDateTimeDisplay(preferences)) view.rebuild(true);
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
matchMedia("(prefers-color-scheme:dark)").addEventListener("change", () => {
  if (preferences?.theme !== "system") return;
  theme();
  void refresh(false, false).catch((error) => toast(String(error), true));
});

let renderBudget: 20000 | 100000 = 20000;
let renderLOD = false,
  geometryLOD = false,
  renderedCount = 0;
let viewportDataGeneration = 0;
let refreshWork: Promise<unknown> = Promise.resolve();
let cameraSaveWork: Promise<unknown> = Promise.resolve();
let flushSceneSync: () => Promise<unknown> = async () => {};
let snapshotRequestSerial = 0;
function snapshotIntent(lane: SnapshotRequestIntent["lane"], refreshGeneration: number, viewportGeneration: number, scoped = false): SnapshotRequestIntent {
  return Object.freeze({ ui_request_id: String(++snapshotRequestSerial), lane,
    refresh_generation: refreshGeneration, viewport_generation: viewportGeneration, mode,
    ...(scoped ? { expected_workspace: snapshot.workspace_id, expected_revision: snapshot.revision } : {}) });
}
function snapshotApplication(model: SnapshotModel, data: SnapshotData | null, rebuild = false): SnapshotApplication {
  const state = model.snapshot as Snapshot;
  const [lo, hi] = data?.timeBounds || [view.lo, view.hi];
  const epoch = state.time_bounds[0] + (state.time_bounds[1] - state.time_bounds[0]) * focus;
  return Object.freeze({ data, measurement: state.scene.measurement ? Object.freeze({ ...state.scene.measurement }) : null,
    display: Object.freeze({ ...displayOptions }), displayPacket: data ? model.display || null : view.displayLayer.packet || null,
    globeTime: !!state.scene.globe_time, globeAltitude: !!state.scene.globe_altitude, globeTimeScale: state.scene.globe_time_scale ?? view.globeTimeScale, timeHeight: view.timeHeight,
    theme: view.theme, selection: Object.freeze([...(model.selected as string[])]), rebuild,
    focus: hi > lo ? (epoch - lo) / (hi - lo) : 0, awaitEffects: !view.playback });
}
function refresh(render = true, resources = true): Promise<void> {
  const work = runRefresh(render, resources);
  refreshWork = Promise.all([refreshWork, work.catch(() => {})]).then(() => {});
  return work;
}
async function runRefresh(render = true, resources = true) {
  viewportDataGeneration++;
  tables.tableSerial++;
  const generation = ++serial;
  const scopeKey = JSON.stringify([
    tables.tableRespectFilters && !gisTable.layerId ? snapshot?.filter : null,
    tables.tableSource,
    tables.tableRespectFilters,
    tables.tableSort,
    tables.tableDescending,
    tables.tableDisplayCell,
    tables.tableSearch,
  ]);
  if (scopeKey !== tables.tableScopeKey) {
    tables.tableScopeKey = scopeKey;
    if (!tables.tableReveal) tables.resetTableScroll();
  }
  const requestedTablePage = tables.page;
  const requestedTableSerial = tables.tableSerial;
  const includeRender =
    render ||
    !!snapshot?.filter.selected_only ||
    renderLOD ||
    geometryLOD ||
    view.displayLayer.active;
  const model = await view.requestSnapshot({
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
    ...(tables.tableOpen && !tableWindows.detached && !gisTable.layerId
      ? {
          page: {
            command: "attribute_table" as const,
            args: tables.tablePageArguments(),
          },
        }
      : {}),
  }, snapshotIntent("refresh", generation, viewportDataGeneration)).catch((error: unknown) => {
    // Native offers can reject before the original post-read generation guard.
    // Only a demonstrably obsolete cancellation gets that silent-drop behavior.
    if (generation !== serial && (error as { name?: unknown } | null)?.name === "AbortError") return undefined;
    throw error;
  });
  if (!model) return;
  // Validate the complete point payload before publishing any new UI state.
  const decoded = model.render ? decode(model.render) : null;
  const s = model.snapshot as Snapshot;
  if (generation !== serial) return;
  snapshot = { ...s };
  welcome.update(
    s.workspace_id,
    s.count === 0 && !(s.gis_layers || []).length,
    projectPath,
  );
  await view.ready;
  await view.gis.sync((s.gis_layers || []) as GisLayer[]);
  if (generation !== serial) return;
  tables.tableScopeKey = JSON.stringify([
    tables.tableRespectFilters && !gisTable.layerId ? s.filter : null,
    tables.tableSource,
    tables.tableRespectFilters,
    tables.tableSort,
    tables.tableDescending,
    tables.tableDisplayCell,
    tables.tableSearch,
  ]);
  const colorChanged =
    JSON.stringify(customEntityColors) !==
    JSON.stringify(s.scene.entity_colors || {});
  customEntityColors = { ...s.scene.entity_colors };
  setEntityColors(customEntityColors);
  measurementLegend.update(s.scene.measurement);
  entityLegend.element.hidden = !!s.scene.measurement;
  displayOptions = viewsPanel.liveOptions || {
    ...defaultDisplay,
    ...s.scene.display,
  };
  updateNavigationControls();
  renderBudget = s.scene.render_budget === 100000 ? 100000 : 20000;
  projectPath = s.lifecycle?.source ?? null;
  preferences = s.preferences;
  const dateDisplayChanged = setDateTimeDisplay(preferences);
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
  await table(
    requestedTablePage === tables.page &&
      requestedTableSerial === tables.tableSerial
      ? model.page
      : undefined,
    generation,
    model.selected,
  );
  if (generation !== serial) return;
  let data: SnapshotData | null = null;
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
    data = Object.freeze({ points: Object.freeze(points), names: Object.freeze(names),
      studyBounds: Object.freeze([...(overrideBounds || (playbackPreserveFrame || timeScrubbing || displayPreserveFrame ? [...view.bounds] : bounds(coverage)))]) as Readonly<Bounds>,
      timeBounds: Object.freeze([...sceneTimeBounds(s)]) as readonly [number, number],
      geometries: Object.freeze([...geometries.features]) });
  }
  const publication = await view.publishSnapshot(model, snapshotApplication(model, data, colorChanged || dateDisplayChanged), () => generation === serial);
  if (generation !== serial) return;
  if (publication.kind === "stale") {
    if (view.nativeSnapshots) queueRepresentation("metadata-reconcile", true);
    return;
  }
  if (publication.kind === "needs-representation") {
    queueRepresentation("metadata-reconcile", true);
    return;
  }
  const dataChanged = publication.dataChanged;
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

  if (generation !== serial) return;
  updateNavigationControls();
  entityLegend.content.innerHTML =
    Object.keys(s.entities)
      .slice(0, 150)
      .map(
        (name, i) =>
          `<span class="legend-item"><i style="background:${entityColor(name)}"></i><span class="legend-label">${esc(name)}</span></span>`,
      )
      .join("") +
    '<span class="legend-item" title="Triangles have no observed coordinates. Their trail position is estimated between visible located events of the same entity and source."><span class="legend-label">● Source location · △ Time only (estimated position)</span></span>';
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
    `${displayTime(desiredTime.start ?? lo)} — ${displayTime(desiredTime.end ?? hi)} UTC`;
  timeRail.update(lo, hi, desiredTime.start, desiredTime.end);
}
function mapsEnabled() {
  return mapLayers(preferences).some((l) => l.config.enabled);
}
function currentMapZoom() {
  return view.mapZoom();
}

function geographyReadout() {
  // Provider names and zoom metadata belong to Layers/Maps, not the canvas.
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
      ? `<div class="layer-card" data-layer-kind="terrain" tabindex="0" role="group">${icon("terrain")}<div><strong>${preferences.terrain_builtin ? "Balanced world terrain" : "DTED terrain"}</strong><small>${preferences.terrain_builtin ? "1.9 km spacing · USGS GMTED2010" : `${terrainInfo.tiles.length} tile(s)`} · ${preferences.terrain_vertical_datum === "egm96" ? "EGM96 MSL → ellipsoid" : preferences.terrain_vertical_datum === "ellipsoid" ? "ellipsoid" : "datum unresolved; not displayed"} · ${preferences.terrain_exaggeration}× vertical</small></div><button class="icon" data-geography-options="terrain" aria-label="Terrain settings">⋯</button></div>`
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
  await tables.openAttributes(source);
  await tableWindows.focus();
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
    if (tables.tableRespectFilters && !gisTable.layerId) {
      tableSelection.anchor = null;
      tableSelection.activeId = null;
      tables.resetTableScroll();
    }
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
  if (reveal && tables.tableOpen) tables.tableReveal = ids[0] ?? null;
  await refresh(false);
}
view.onPick = (ids, add) => {
  if (add) {
    void select(ids, true, true).catch((error) => toast(String(error), true));
    return;
  }
  const workspace = snapshot.workspace_id;
  // The renderer knows only the selected evidence in its current packet.
  // Keep the full pre-click selection in the engine, including off-screen IDs
  // and selections too large for a snapshot or a select({ids}) request.
  const applied = call("selection_pick", {
    ids,
    mode: "replace",
    expected_workspace: workspace,
  });
  const report = (error: unknown) => {
    if (!String(error).includes("CONFLICT:")) toast(String(error), true);
  };
  void applied
    .then(async () => {
      if (tables.tableOpen) tables.tableReveal = ids[0] ?? null;
      await refresh(false);
    })
    .catch(report);
  return () => {
    void applied
      .then(async (receipt) => {
        await call("selection_restore", {
          pick_revision: receipt.pick_revision,
          expected_workspace: workspace,
        });
        await refresh(false);
      })
      .catch(report);
  };
};
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
        await sceneIdle();
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
        const restore = () =>
          call(
            button.dataset.viewIndex !== undefined
              ? "restore_view"
              : "restore_group",
            {
              index: Number(
                button.dataset.viewIndex ?? button.dataset.groupIndex,
              ),
            },
          );
        if (button.dataset.viewIndex !== undefined)
          await restoreCommand(restore);
        else await restore();
        closeModal();
        if (button.dataset.viewIndex === undefined) await refresh();
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
  dialogs.close();
}
function modal(html: string, small = false) {
  return dialogs.open(html, small);
}

function head(title: string) {
  return `<div class="modal-head"><h2>${title}</h2><button data-close class="icon">${icon("close")}</button></div>`;
}
async function openGisAttributes(id: string) {
  await tables.openGisAttributes(id);
  await tableWindows.focus();
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

const importDialog = new ImportDialog({
  workspace: () => snapshot.workspace_id,
  committed: async (append, result) => {
    if (!append) {
      projectPath = null;
      tables.resetTabs();
      tables.tableSource = null;
      tables.tableSort = "time";
      tables.tableDescending = false;
      tables.page = 0;
    }
    overrideBounds = null;
    findings = [];
    await refresh();
    view.fit();
    toast(
      result.aggregation
        ? `${result.accepted.toLocaleString()} accepted records → ${(result.retained ?? result.accepted).toLocaleString()} retained summaries/records`
        : `Imported ${result.accepted.toLocaleString()} Events`,
    );
  },
});
function importPreview(
  path: string,
  delimiter: NonNullable<
    EngineContracts["import_preview"]["args"]["delimiter"]
  >,
  gisLayer?: string,
) {
  return importDialog.open(path, delimiter, gisLayer);
}
type MapPreset = Exclude<
  EngineContracts["wmts_servers"]["result"],
  { dry_run: true }
>["presets"][number];
let mapPresets: MapPreset[] = [];
let capabilities: any = null;
let capabilitiesURL = "";
let mapUnavailable = false;

const mapSettings = createMapSettings({
  get preferences() {
    return preferences;
  },
  set preferences(value) {
    preferences = value;
  },
  get mapPresets() {
    return mapPresets;
  },
  set mapPresets(value) {
    mapPresets = value;
  },
  get capabilities() {
    return capabilities;
  },
  set capabilities(value) {
    capabilities = value;
  },
  get capabilitiesURL() {
    return capabilitiesURL;
  },
  set capabilitiesURL(value) {
    capabilitiesURL = value;
  },
  get mapUnavailable() {
    return mapUnavailable;
  },
  set mapUnavailable(value) {
    mapUnavailable = value;
  },
  view,
  modal,
  head,
  closeModal,
  toast,
  on,
  task,
  refresh,
  loadRasters: () => loadRasters(),
  cancelMap: () => cancelMap(),
  currentMapZoom,
});
const mapMenu = (...args: Parameters<typeof mapSettings.mapMenu>) =>
  mapSettings.mapMenu(...args);
const mapLayerMenu = () => mapSettings.mapLayerMenu();

let mapLoadGeneration = 0;
const activeMapJobs = new Set<string>();
const viewportDataRefresh = new ViewportRefresh(
  async (superseded) => {
    if (restoringScene) return;
    for (;;) { const observed = refreshWork; await observed.catch(() => {}); if (observed === refreshWork) break; }
    if (superseded()) return;
    const goal = representationGoal;
    representationGoal = undefined;
    if (goal && goal.workspace !== snapshot.workspace_id) return;
    await view.navigationIdle();
    if (superseded()) return;
    const bounds = view.visibleDataBounds() || view.visibleBounds() || goal?.fallback || null;
    if (bounds || goal?.force) await runViewportData(bounds, goal?.force, superseded, goal?.lane);
  },
  (e) => { if (!String(e).includes("CONFLICT:")) toast(String(e), true); },
);
const viewportResourceRefresh = new ViewportRefresh(
  refreshViewportResources,
  (e) => toast(String(e), true),
);
function cancelViewportRefresh() {
  viewportDataRefresh.cancel();
  representationGoal = undefined;
  viewportResourceRefresh.cancel();
}
let terrainLoadGeneration = 0;
let terrainSourceCatalog: unknown;
let terrainTileSource: TerrainTileSource | undefined;
function terrainSource() {
  if (terrainSourceCatalog !== terrainInfo) {
    terrainSourceCatalog = terrainInfo;
    const limit = preferences.terrain_builtin ? 89.999999 : 85.0511287798066;
    const coverage = terrainInfo.bounds as number[];
    const spacing = Math.min(
      ...terrainInfo.tiles.flatMap((t: any) => [
        t.longitude_step,
        t.latitude_step,
      ]),
    );
    const cells = preferences.terrain_builtin ? 128 : 32;
    terrainTileSource = {
      bounds: [
        coverage[0],
        Math.max(-limit, coverage[1]),
        coverage[2],
        Math.min(limit, coverage[3]),
      ],
      maximumLevel: Math.min(
        22,
        Math.max(0, Math.ceil(Math.log2(180 / (cells * spacing)))),
      ),
      load: (bounds, resolution) =>
        call("terrain_mesh", { bounds, resolution }),
    };
  }
  return terrainTileSource!;
}
const cancelMap = async () => {
  mapLoadGeneration++;
  activeRasterLoad = undefined;
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
let activeRasterLoad:
  { key: string; full: boolean; promise: Promise<void> } | undefined;
async function loadRasters(
  regionOverride?: Bounds,
  superseded?: () => boolean,
) {
  if (restoringScene) return;
  const key = JSON.stringify([
    mode,
    mapStackKey(),
    regionOverride || view.visibleBounds() || view.bounds,
    currentMapZoom(),
    $("#scene").clientWidth,
    $("#scene").clientHeight,
  ]);
  if (activeRasterLoad?.key === key) {
    // A direct refresh needs the whole viewport, even if a queued camera load
    // originally started it with permission to yield after a tile page.
    activeRasterLoad.full ||= !superseded;
    return activeRasterLoad.promise;
  }
  const load = { key, full: !superseded, promise: Promise.resolve() };
  activeRasterLoad = load;
  load.promise = loadRasterViewport(
    regionOverride,
    () => !load.full && !!superseded?.(),
  );
  try {
    await load.promise;
  } finally {
    if (activeRasterLoad === load) activeRasterLoad = undefined;
  }
}
async function loadRasterViewport(
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
  stack.compose();
  if (stack.hasContent) {
    lastMapStack = stack;
    lastRaster = stack.result;
    await view.setRasters(stack.result, current);
  }
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
        lastMapStack = stack;
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
  let region = cameraBounds || view.bounds;
  // A crossing viewport still uses the two continuous world terrain roots.
  if (region[0] > region[2]) region = [-180, region[1], 180, region[3]];
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
  const terrainLatitudeLimit = preferences.terrain_builtin
    ? 89.999999
    : 85.0511287798066;
  const padLon = (region[2] - region[0]) / 2;
  const padLat = (region[3] - region[1]) / 2;
  const bounds: Bounds = [
    Math.max(region[0] - padLon, coverage[0]),
    Math.max(region[1] - padLat, coverage[1], -terrainLatitudeLimit),
    Math.min(region[2] + padLon, coverage[2]),
    Math.min(region[3] + padLat, coverage[3], terrainLatitudeLimit),
  ];
  if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    // Keep the installed catalog outside its coverage too. Its tile mask
    // supplies ellipsoid ground there without resetting all imagery on return.
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
  await view.setTerrain(
    t,
    () => generation === terrainLoadGeneration,
    terrainSource(),
  );
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
type RepresentationGoal = { workspace: string; force: boolean; lane: "viewport" | "metadata-reconcile"; fallback?: Bounds };
let representationGoal: RepresentationGoal | undefined;
function queueRepresentation(lane: "viewport" | "metadata-reconcile", force = false, fallback?: Bounds) {
  representationGoal = { workspace: snapshot.workspace_id, force: force || !!representationGoal?.force,
    lane: force ? lane : representationGoal?.lane || lane, fallback: fallback ? [...fallback] : undefined };
  return viewportDataRefresh.request();
}
async function refreshViewportData(bounds?: Bounds) {
  const ticket = queueRepresentation("viewport", false, bounds);
  // This is an outer caller barrier. Publication callbacks enqueue replacements
  // without waiting on their own active request.
  void viewportDataRefresh.flush();
  const outcome = await ticket.done;
  if (outcome.kind === "failed") throw outcome.error;
}
async function runViewportData(bounds: Bounds | null, force = false, superseded = () => false, lane: "viewport" | "metadata-reconcile" = "viewport") {
  if (bounds && displayOptions.mode === "heatmap" && displayOptions.spatial_culling) {
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
    !force && !renderLOD &&
    !geometryLOD &&
    !displayOptions.spatial_culling &&
    !view.displayLayer.active
  )
    return;
  const generation = ++viewportDataGeneration,
    revision = snapshot.revision, workspace = snapshot.workspace_id, refreshGeneration = serial;
  const current = () => !superseded() && generation === viewportDataGeneration
    && revision === snapshot.revision && workspace === snapshot.workspace_id && refreshGeneration === serial;
  try {
    const model = await view.requestSnapshot({
      version: 1,
      generation: String(generation),
      include_render: true,
      display_level: displayLevel(),
      max_points: renderBudget,
      ...(displayOptions.spatial_culling && bounds ? { bounds } : {}),
      selection_ids: [],
    }, snapshotIntent(lane, refreshGeneration, generation, true));
    if (!current() || model.snapshot.revision !== revision || model.snapshot.workspace_id !== workspace) return;
    const packet = model.render,
      geometries = model.geometries,
      names = [...packet.entities];
    for (const f of geometries.features)
      if (!names.includes(f.entity)) names.push(f.entity);
    view.geometryLimited = geometries.limited;
    const data: SnapshotData = Object.freeze({ points: Object.freeze(decode(packet)), names: Object.freeze(names),
      studyBounds: Object.freeze([...view.bounds]) as Readonly<Bounds>,
      timeBounds: Object.freeze([...sceneTimeBounds(model.snapshot as Snapshot)]) as readonly [number, number],
      geometries: Object.freeze([...geometries.features]) });
    const publication = await view.publishSnapshot(model, snapshotApplication(model, data), current);
    if (!current()) return;
    if (publication.kind === "stale") { if (view.nativeSnapshots) queueRepresentation("metadata-reconcile", true); return; }
    if (publication.kind === "needs-representation") { queueRepresentation("metadata-reconcile", true); return; }
    renderLOD = packet.lod || !!model.display?.aggregated;
    renderedCount = packet.rendered_count;
    status(
      view.displayLayer.active
        ? `${model.display.count.toLocaleString()} located records · ${model.display.bins.length.toLocaleString()} display cells · exact source records retained`
        : `${snapshot.visible.toLocaleString()} visible events · ${renderedCount.toLocaleString()} viewport markers`,
    );
  } catch (e) {
    if (current()) throw e;
  }
}
function scheduleViewportResources() {
  if (restoringScene) return;
  // Slow imagery must not hold up event/cluster updates during navigation.
  queueRepresentation("viewport");
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
    `${head("Terrain")}<p class="description">Balanced world terrain is bundled for offline use at approximately 1.9 km spacing. You can unload it, restore it, or replace it with your own DTED file or folder.</p><div class="row"><button id="restore-balanced" class="secondary">Restore bundled terrain</button><button id="dted-file" class="primary">${icon("terrain")} Load DTED file</button><button id="dted-folder" class="secondary">${icon("folder")} Load folder</button></div><div class="notice">Standard WGS84 DT0/DT1/DT2. Voids remain holes. Choose the source vertical datum explicitly. EGM96 uses the bundled NGA geoid grid to convert mean-sea-level heights to ellipsoid heights for display. Unknown MSL remains undisplayed; source elevations are never modified.</div><label class="field">Source vertical datum<select id="terrain-datum" ${preferences.terrain_builtin ? "disabled" : ""}><option value="unresolved-msl" ${preferences.terrain_vertical_datum === "unresolved-msl" ? "selected" : ""}>Unresolved mean sea level (do not display)</option><option value="egm96" ${preferences.terrain_vertical_datum === "egm96" ? "selected" : ""}>EGM96 mean sea level</option><option value="ellipsoid" ${preferences.terrain_vertical_datum === "ellipsoid" ? "selected" : ""}>WGS84 ellipsoid heights</option></select></label><label class="field">Vertical exaggeration / ×<input id="exaggeration" type="range" min=".1" max="20" step=".1" value="${preferences.terrain_exaggeration}"></label><footer><button data-close>Close</button><span class="spacer"></span><button id="remove-terrain">Unload terrain</button><button id="apply-terrain" class="primary">Apply exaggeration</button></footer>`,
    true,
  );
  on("#remove-terrain", async () => {
    await call("terrain_unload");
    preferences = await call("preferences");
    terrainInfo = null;
    overrideBounds = null;
    await view.setTerrain(null);
    closeModal();
    await refresh();
    layers();
  });
  on("#restore-balanced", async () => {
    preferences = await task("Loading bundled terrain…", () =>
      call("preferences", {
        preferences: {
          terrain_builtin: true,
          terrain_path: null,
          terrain_vertical_datum: "egm96",
        },
      }),
    );
    terrainInfo = await call("terrain_info");
    overrideBounds = null;
    closeModal();
    await rebuildTerrain();
    layers();
    toast("Balanced world terrain restored");
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
async function showAnalysisResults(initial?: string) {
  await openAnalytics(
    async () => {
      await refresh();
    },
    (error) => toast(String(error), true),
    initial,
    launchGuidedAnalysis,
  );
}
async function launchGuidedAnalysis() {
  await filterIntent.flush();
  if (playTimer !== undefined) $("#play").click();
  const current = await call("snapshot", {
    compact: false,
    selection_limit: 0,
  });
  await openGuidedAnalysis(current as unknown as Snapshot, async (id) => {
    await refresh();
    await showAnalysisResults(id);
  });
}
const analyzeButton = document.createElement("button");
analyzeButton.id = "new-analysis";
analyzeButton.textContent = "Analyze";
analyzeButton.title = "Run a local analysis without an AI connection";
analyzeButton.onclick = () =>
  void launchGuidedAnalysis().catch((error) => toast(String(error), true));
const analyticsButton = document.createElement("button");
analyticsButton.id = "analytics-results";
analyticsButton.textContent = "Results";
analyticsButton.title =
  "Browse persistent analysis results, charts and linked Event rows";
$("#si").before(analyzeButton, analyticsButton);
analyticsButton.onclick = () =>
  void showAnalysisResults().catch((error) => toast(String(error), true));
const siHooks = {
  configure: siConnection,
  before: async () => {
    await filterIntent.flush();
    await sceneIdle();
    await syncScene(captureScene(), snapshot.revision);
  },
  after: async () => {
    await sceneIdle();
    await refresh();
    await restoreScene(snapshot.scene, snapshot.revision);
  },
  capture: async () => {
    await filterIntent.flush();
    await sceneIdle();
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
  const owner = dialogs.node;
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
    if (dialogs.node === owner) closeModal();
    if (!(await siWindows.focus())) await openSIChat();
  });
  on("#si-disconnect", async () => {
    await call("si_disconnect");
    if (dialogs.node === owner) closeModal();
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
const settings = createPreferencesController({
  preferences: () => preferences,
  budget: () => renderBudget,
  $,
  input,
  check,
  on,
  modal,
  closeModal,
  head,
  toast,
  save: async (nextPreferences, nextBudget) => {
    preferences = nextPreferences;
    await call("preferences", { preferences });
    const budgetChanged = nextBudget !== renderBudget;
    renderBudget = nextBudget;
    if (budgetChanged) await call("view_set", { render_budget: renderBudget });
    closeModal();
    theme();
    await refresh(budgetChanged, false);
  },
});

function timeWindow(
  start: number,
  end: number,
  delay = 0,
  progressive = false,
  playback = false,
): Promise<void> {
  if (!playback) playbackHistory = undefined;
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
  const value = color.value;
  void (async () => {
    await sceneIdle();
    customEntityColors = { ...customEntityColors, [name]: value };
    setEntityColors(customEntityColors);
    await syncScene(captureScene());
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
    tableSelection.work = tableSelection.work
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
      const restore = () =>
        call(
          b.dataset.viewIndex !== undefined ? "restore_view" : "restore_group",
          { index: Number(b.dataset.viewIndex ?? b.dataset.groupIndex) },
        );
      if (b.dataset.viewIndex !== undefined) await restoreCommand(restore);
      else {
        await restore();
        await refresh();
      }
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
        await restoreCommand(() => call(b.id as "undo" | "redo"));
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
        await sceneIdle();
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
  const navigationLabel = mode === "map" ? "Pan" : "Move";
  $("#navigate").setAttribute("aria-label", navigationLabel);
  $("#navigate").dataset.tooltip =
    mode === "map"
      ? "Drag to pan the flat map; scroll to zoom. Time filtering remains in the timeline."
      : "Drag to move; middle-drag rotates/tilts; right-drag or wheel zooms. Shift-click adds selection.";
  const spaceTime = mode === "space-time";
  const altitude = mode === "globe" && view.globeAltitude;
  const time = spaceTime ? view.timeHeight > 0 : view.globeTime;
  $("#time-height").hidden = !spaceTime;
  $("#time-height-label").hidden = !spaceTime;
  $("#globe-time-height").hidden = mode !== "globe";
  $("#globe-time-height-label").hidden = mode !== "globe";
  ($("#time-height") as HTMLInputElement).disabled = altitude;
  ($("#globe-time-height") as HTMLInputElement).disabled = altitude;
  $("#time-height-endpoints").dataset.disabled = String(altitude);
  $("#height-mode-selector").dataset.altitude = String(altitude);
  $("#navigation-time-group").hidden = mode === "map";
  $("#height-mode-time").setAttribute("aria-checked", String(!altitude));
  $("#height-mode-time").tabIndex = altitude ? -1 : 0;
  $("#height-mode-altitude").tabIndex = altitude ? 0 : -1;
  $("#height-mode-altitude").setAttribute("aria-checked", String(altitude));
  ($("#height-mode-altitude") as HTMLButtonElement).disabled = mode !== "globe";
  $("#height-mode-altitude").title = mode === "globe" ? "Use imported physical altitude" : "Altitude is available in Globe";
  $("#time-elevation-title").textContent = "Vertical display";
  $("#time-elevation").setAttribute("aria-label", "Time height and altitude");
  $("#time-elevation").classList.toggle("active", time || altitude);
  navigation.update();
  ($("#globe-time-height") as HTMLInputElement).value = String(globeElevationSlider(view.globeTime || altitude, view.globeTimeScale));
  const height = view.timeHeightMeters;
  const formatHeight = (h: number) => Math.abs(h) >= 1000 ? `${(h / 1000).toFixed(1)} km` : `${Math.round(h)} m`;
  const summary = view.altitudeSummary();
  $("#time-elevation-value").textContent = altitude
    ? summary.known ? `${formatHeight(summary.minimum)} – ${formatHeight(summary.maximum)}` : "No altitude"
    : !time ? "Ground" : spaceTime ? `${view.timeHeight.toFixed(1)}×` : formatHeight(height);
  $("#height-mode-note").textContent = altitude
    ? `Physical height in metres; no time scaling. ${summary.known.toLocaleString()} loaded points. ${summary.approximate ? "Reported heights are approximate because their vertical reference is unknown. " : ""}Points without a usable altitude are omitted. Ground display effects are paused.`
    : "Time Height raises Events by timestamp. Altitude uses imported physical heights in Globe. Set Time Height to zero to place Events on the ground.";
  ($(mode === "globe" ? "#globe-time-height" : "#time-height") as HTMLInputElement).setAttribute("aria-valuetext", altitude ? `${formatHeight(height)} (Time Height only)` : $("#time-elevation-value").textContent || "Ground");
}
const sceneTransitions = new SceneTransitions();
let viewModeGeneration = 0;
let viewModeWork: Promise<void> = Promise.resolve();
// Internal restores apply a mode without synthesizing a new user intent.
function applyViewMode(next: ViewMode, remember: boolean) {
  globeElevationGeneration++;
  cancelViewportRefresh();
  void cancelMap();
  mode = next;
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.view === mode),
    );
  view.setMode(mode, remember);
  updateNavigationControls();
  layers();
  if (lastRaster) view.setRasters(lastRaster).catch(() => {});
}
document.querySelectorAll<HTMLElement>("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    welcome.dismiss();
    const next = b.dataset.view! as ViewMode;
    const generation = ++viewModeGeneration;
    // Register immediately, even during a restoration. Later clicks supersede
    // queued work, while a started command finishes before the next transition.
    viewModeWork = sceneTransitions
      .enqueue(async () => {
        if (generation !== viewModeGeneration) return;
        applyViewMode(next, true);
        if (!snapshot) return;
        await syncScene(captureScene());
        if (generation !== viewModeGeneration) return;
        await refresh(true, false);
        if (generation !== viewModeGeneration) return;
        await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
        if (generation !== viewModeGeneration) return;
        cancelViewportRefresh();
        if (terrainInfo) await rebuildTerrain();
        else await loadRasters();
      })
      .catch((e) => toast(String(e), true));
  }),
);
on("#sync-views", async () => {
  const button = $("#sync-views") as HTMLButtonElement;
  button.disabled = true;
  try {
    await filterIntent.flush();
    await sceneIdle();
    view.syncViews();
    await syncScene(captureScene());
    await refresh(false, false);
    toast(
      `Synced ${mode === "space-time" ? "Time" : mode === "map" ? "Map" : "Globe"} bounds and orientation to the other views`,
    );
  } finally {
    button.disabled = false;
  }
});
on("#maps", () => mapMenu());
on("#terrain", terrainMenu);
on("#settings", () => settings());

on("#theme", async () => {
  preferences = {
    ...preferences,
    theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  };
  await call("preferences", { preferences });
  theme();
  await refresh(false, false);
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
    `${head("Display cell")}<p><strong>${bin.count.toLocaleString()} events</strong> · ${bin.selected_count.toLocaleString()} selected</p><p class="description">${displayTime(bin.first_time)}–${displayTime(bin.last_time)} UTC. This is a reversible display summary. Its position is not a measured event location.</p><footer><button id="cell-table">Open member attributes</button><button id="cell-select">Select all members</button><button id="cell-zoom" class="primary">Zoom to members</button></footer>`,
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
    await tables.openAttributes(null, bin.cell);
    await tableWindows.focus();
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
  await sceneIdle();
  await syncScene({
    ...captureScene(),
    display: next,
    measurement:
      next.mode === "points" && !next.bloom ? view.measurement : null,
  });
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
function measurementSettings() {
  const current = view.measurement;
  modal(`${head("Color by value")}<p class="description">Color event points and polygons using their numeric Value. The scale stays fixed while filtering; missing values appear gray.</p>
    <form id="measurement-form"><label class="field">Legend title<input id="measurement-title" required maxlength="128" value="${esc(current?.title || "Event value")}"></label>
    <div class="modal-grid"><label class="field">Minimum<input id="measurement-minimum" type="number" required step="any" value="${current?.minimum ?? 0}"></label><label class="field">Maximum<input id="measurement-maximum" type="number" required step="any" value="${current?.maximum ?? 100}"></label></div>
    <label class="field">Unit suffix<input id="measurement-unit" maxlength="32" value="${esc(current?.unit || "")}"></label>
    <label class="check-row"><input id="measurement-latest" type="checkbox" ${current?.latest_per_entity ? "checked" : ""}> Show the latest polygon per entity within the time window</label>
    <p id="measurement-error" role="alert"></p><footer><button type="button" id="measurement-clear">Use entity colors</button><span class="spacer"></span><button class="primary" type="submit">Apply scale</button></footer></form>`);
  const save = async (measurement: SceneState["measurement"]) => {
    await sceneIdle();
    const display = measurement
      ? { ...displayOptions, mode: "points" as const, bloom: false }
      : displayOptions;
    await syncScene({ ...captureScene(), measurement, display });
    closeModal();
    await refresh(true, false);
  };
  on("#measurement-clear", () => save(null));
  $("#measurement-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const minimum = Number(
      ($("#measurement-minimum") as HTMLInputElement).value,
    );
    const maximum = Number(
      ($("#measurement-maximum") as HTMLInputElement).value,
    );
    if (
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum >= maximum
    ) {
      $("#measurement-error").textContent =
        "Maximum must be greater than minimum.";
      return;
    }
    void save({
      title: ($("#measurement-title") as HTMLInputElement).value,
      unit: ($("#measurement-unit") as HTMLInputElement).value,
      minimum,
      maximum,
      latest_per_entity: ($("#measurement-latest") as HTMLInputElement).checked,
    }).catch((error) => toast(String(error), true));
  });
}
function displaySettings() {
  document.querySelector<HTMLButtonElement>('[data-tab="views"]')!.click();
}
function captureScene(): Scene {
  return {
    mode,
    ...view.captureCamera(),
    view_states: view.captureViewStates(),
    render_budget: renderBudget,
    display: displayOptions,
    entity_colors: customEntityColors,
    measurement: view.measurement,
    table_source: tables.tableSource,
    gis_table: gisTable.layerId,
    table_attributes: true,
    table_respect_filters: tables.tableRespectFilters,
    table_sort: tables.tableSort,
    table_descending: tables.tableDescending,
    table_column_offset: tables.tableColumnOffset,
    time_height: view.timeHeight,
    playback_fade: view.playbackFade,
    playback_fade_amount: view.playbackFadeAmount,
    globe_time: view.globeTime,
    globe_altitude: view.globeAltitude,
    globe_time_scale: view.globeTimeScale,
    focus,
    bounds: overrideBounds,
    table_open: tables.tableOpen,
    inspector_tab: tab,
    ...chartsPanel.capture(),
    expanded: document.body.classList.contains("fullscreen"),
  };
}
let restoringScene = false;
function restoreScene(scene: SceneState = {}, revision?: number) {
  return sceneTransitions.restore(revision, () => applyRestoredScene(scene));
}
// The command and its local UI application occupy one queue turn. Its emitted
// engine event may arrive first; commit joins/claims that same revision.
function restoreCommand<T>(
  action: () => Promise<T>,
  prepare?: (result: T) => void | Promise<void>,
) {
  viewModeGeneration++;
  return sceneTransitions.command(async (commit) => {
    const result = await action();
    await prepare?.(result);
    if (result && typeof result === "object" && "scene" in result) {
      const restored = result as { scene: SceneState; revision?: number };
      await commit(restored.revision, () => applyRestoredScene(restored.scene));
    }
    return result;
  });
}
async function applyRestoredScene(scene: SceneState) {
  globeElevationGeneration++;
  displayPreserveFrame = false;
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
    tables.beginRestore();
    tables.tableDisplayCell = null;
    mode = scene.mode || "space-time";
    view.restoreViewStates(scene.view_states || {});
    renderBudget = scene.render_budget === 100000 ? 100000 : 20000;
    view.timeHeight = scene.time_height ?? 2.8;
    view.setPlaybackFade(scene.playback_fade_amount ?? (scene.playback_fade === false ? 0 : 50));
    updatePlaybackFadeControl();
    view.setGlobeTimeScale(scene.globe_time_scale ?? 1);
    view.setGlobeTime(!!scene.globe_time);
    view.setGlobeAltitude(!!scene.globe_altitude);
    focus = scene.focus ?? 0.45;
    $("#time-height").setAttribute("value", String(view.timeHeight));
    ($("#time-height") as HTMLInputElement).value = String(view.timeHeight);
    applyViewMode(mode, false);
    tables.tableOpen = !!scene.table_open;
    // Older workspaces may request a compact table; every event table now
    // restores the complete attribute columns using the same source/scope.
    tables.tableSource = scene.table_source ?? null;
    gisTable.close();
    if (scene.gis_table) gisTable.open(scene.gis_table);
    tables.tableRespectFilters = scene.table_respect_filters ?? true;
    tables.tableSort = scene.table_sort || "time";
    tables.tableDescending = !!scene.table_descending;
    tables.tableColumnOffset = scene.table_column_offset || 0;
    tab = scene.inspector_tab || "inspect";
    $("#table-panel").classList.toggle("open", tables.tableOpen);
    $("#toggle-table").classList.toggle("active", tables.tableOpen);
    document
      .querySelectorAll<HTMLElement>("[data-tab]")
      .forEach((e) => e.classList.toggle("active", e.dataset.tab === tab));
    setWorkspaceExpanded(!!scene.expanded);
    findings = [];
    patternsPanel.reset();
    editor.deactivate();
    tables.page = 0;
    await refresh(true, false);
    if (!mapsEnabled()) {
      lastMapStack = undefined;
      lastRaster = null;
      view.clearRasters();
    }
    theme();
    if (!view.restoreCamera(scene) && !view.restoreCurrentView()) view.fit();
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
                await restoreCommand(
                  () => call("open", { path }),
                  () => {
                    projectPath = path;
                    lastRaster = null;
                    mapUnavailable = false;
                  },
                );
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
              const recovered = await restoreCommand(
                () => call("recovery_restore", { id: c.id }),
                async () => {
                  projectPath = (await call("workspace_status")).source;
                },
              );
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
// WorkspaceFiles issues its engine command inside the supplied task. Keep its
// opened callback in that same transition turn, including document identity.
let fileSceneCommit: RestoreCommit | undefined;
const workspaceFiles = new WorkspaceFiles({
  settle: () => filterIntent.flush(),
  guard: guardUnsaved,
  pause: () => {
    if (playTimer !== undefined) $("#play").click();
  },
  importData: (path) => importPreview(path, "auto"),
  importGis: openGisFile,
  opened: async (path, result) => {
    projectPath = path;
    lastRaster = null;
    mapUnavailable = false;
    if (fileSceneCommit)
      await fileSceneCommit(result.revision, () =>
        applyRestoredScene(result.scene),
      );
    else await restoreScene(result.scene, result.revision);
    welcome.remember(path, snapshot.count);
  },
  task: (label, action) => {
    viewModeGeneration++;
    return sceneTransitions.command(async (commit) => {
      fileSceneCommit = commit;
      try {
        return await task(label, action);
      } finally {
        fileSceneCommit = undefined;
      }
    });
  },
  notice: (message) => toast(message),
});
const welcome = new Welcome($(".workspace"), {
  icon,
  open: () => openFile(),
  openPath: (path) => workspaceFiles.openPath(path),
  demos: demoDatasets,
  help: () => showHelp(true),
  error: (error) => toast(String(error), true),
});
function openFile() {
  return workspaceFiles.open();
}
function saveWorkspace(saveAs = false): Promise<boolean> {
  return workspace.save(saveAs);
}

on("#open", openFile);
on("#save", () => saveWorkspace());
on("#export", () => workspaceFiles.exportEvents());
on("#toggle-table", showTablesMenu);
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
  // Migrate the removed whole-workspace expansion to the existing pane rails.
  document.body.classList.remove("fullscreen");
  if (expanded) {
    if (!paneLayout.sidebar.collapsed) $("#collapse-left-pane").click();
    if (!paneLayout.inspector.collapsed) $("#collapse-right-pane").click();
  }
}
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
let globeElevationWork: Promise<void> = Promise.resolve();
let globeElevationGeneration = 0;
$("#globe-time-height").addEventListener("input", () => {
  if (!snapshot || restoringScene || mode !== "globe") return;
  const value = Number(input("#globe-time-height"));
  const workspace = snapshot.workspace_id;
  const desiredEnabled = value > 0;
  const desiredScale = desiredEnabled ? globeElevationScale(value) : view.globeTimeScale;
  view.setGlobeTime(desiredEnabled, desiredScale);
  updateNavigationControls();
  const generation = ++globeElevationGeneration;
  const current = () =>
    generation === globeElevationGeneration &&
    snapshot.workspace_id === workspace;
  globeElevationWork = globeElevationWork
    .catch(() => {})
    .then(async () => {
      // Do not reconcile an older canonical scene over this unpersisted input.
      await transitionIdle();
      if (!current()) return;
      displayPreserveFrame = true;
      try {
        await syncScene(Object.freeze({ ...captureScene(), globe_time: desiredEnabled, globe_altitude: false,
          globe_time_scale: desiredScale }), undefined, workspace);
        if (!current()) return;
        await refresh(true, false);
        if (!current()) return;
        await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
      } finally {
        displayPreserveFrame = false;
      }
    })
    .catch((error) => toast(String(error), true));
});
for (const kind of ["time", "altitude"] as const) {
  $("#height-mode-" + kind).addEventListener("click", () => {
    if (!snapshot || restoringScene || mode === "map" || (kind === "altitude" && mode !== "globe")) return;
    if (mode === "space-time" || view.globeAltitude === (kind === "altitude")) return;
    const workspace = snapshot.workspace_id;
    if (kind === "altitude") view.setGlobeAltitude(true);
    else view.setGlobeTime(true);
    updateNavigationControls();
    const desired = Object.freeze({ ...captureScene() });
    const generation = ++globeElevationGeneration;
    const current = () => generation === globeElevationGeneration && snapshot.workspace_id === workspace;
    globeElevationWork = globeElevationWork.catch(() => {}).then(async () => {
      await transitionIdle(); if (!current()) return;
      await syncScene(desired, undefined, workspace); if (!current()) return;
      await refresh(true, false); if (!current()) return;
      await refreshViewportData(view.visibleDataBounds() || [...view.bounds]);
      updateNavigationControls();
    }).catch(error => toast(String(error), true));
  });
}
$("#height-mode-selector").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = [...$("#height-mode-selector").querySelectorAll<HTMLButtonElement>("button")].filter(button => !button.disabled);
  const target = buttons[event.key === "ArrowRight" || event.key === "End" ? buttons.length - 1 : 0];
  target?.focus();
  target?.click();
});
$("#time-height").addEventListener("input", () => {
  view.timeHeight = Number(input("#time-height"));
  updateNavigationControls();
  view.rebuild();
  view.onSceneChange();
  if (lastRaster) view.setRasters(lastRaster).catch(() => {});
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
        op: input("#rule-op") as Filter["predicates"][number]["op"],
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
function updatePlaybackFadeControl() {
  const amount = view.playbackFadeAmount;
  const slider = $("#playback-fade") as HTMLInputElement;
  slider.value = String(amount);
  slider.setAttribute("aria-valuetext", amount === 0 ? "Off; retain history until looping"
    : `${amount}% fade; ${amount === 100 ? "latest few time slices" : amount < 50 ? "longer history" : amount === 50 ? "standard history" : "shorter history"}`);
  $("#playback-fade-value").textContent = amount === 0 ? "Off" : `${amount}%`;
}
$("#playback-fade").addEventListener("input", () => {
  view.setPlaybackFade(Number(input("#playback-fade")));
  updatePlaybackFadeControl();
  view.onSceneChange();
});
async function togglePlayback() {
  if (playTimer !== undefined) {
    cancelAnimationFrame(playTimer);
    playTimer = undefined;
    playbackClock = undefined;
    view.setPlayback(false);
    $("#play").innerHTML = icon("play") + " Play";
    // A full-range sweep only moves the cursor; pausing it must retain the
    // same no-filter fast path as its animation frames.
    if (playbackWindow && (playbackWindow[0] !== 0 || playbackWindow[1] !== 1))
      await timeWindow(...playbackWindow, 0, false, true)
        .catch((error) => toast(String(error), true))
        .finally(() => {
          playbackPreserveFrame = playTimer !== undefined;
        });
    else playbackPreserveFrame = false;
    return;
  }
  const [lo, hi] = snapshot.time_bounds;
  const span = Math.max(1e-9, hi - lo);
  const windowStart = Math.max(
    0,
    Math.min(1, ((snapshot.filter.start ?? lo) - lo) / span),
  );
  const windowEnd = Math.max(
    windowStart,
    snapshot.filter.end === null
      ? 1
      : Math.min(1, (snapshot.filter.end - lo) / span),
  );
  const retained = playbackHistory?.workspace === snapshot.workspace_id &&
    playbackHistory.bounds[0] === lo && playbackHistory.bounds[1] === hi &&
    playbackHistory.last[0] === snapshot.filter.start &&
    playbackHistory.last[1] === snapshot.filter.end ? playbackHistory : undefined;
  const width = retained?.width ?? windowEnd - windowStart;
  const startAt = retained ? Math.max(0, Math.min(1 - width, windowEnd - width)) : windowStart;
  const endAt = startAt + width;
  playbackWindow = [startAt, endAt];
  const travel = 1 - width;
  const initialFocus = focus;
  playbackClock = new PlaybackClock(
    playbackSpeed.value,
    performance.now(),
    playbackIncrement.value,
  );
  const trailWindow = new PlaybackWindow(windowStart, view.playbackFadeAmount);
  playbackPreserveFrame = true;
  view.setPlayback(true);
  let lastUpdate = -Infinity;
  $("#play").innerHTML = icon("pause") + " Pause";
  const frame = (now: number) => {
    if (playTimer === undefined) return;
    const phase = playbackClock!.seconds(now) / span;
    const movingStart = travel > 1e-9 ? (startAt + phase) % travel : 0;
    const movingEnd = travel > 1e-9 ? movingStart + width
      : view.playbackFadeAmount > 50 ? (initialFocus + phase) % 1 : 1;
    const [start, end] = trailWindow.advance(
      movingStart,
      movingEnd,
      view.playbackFadeAmount,
      view.playbackHistorySpan / span,
      width,
    );
    playbackWindow = [start, end];
    focus =
      view.playbackFadeAmount > 50 ? end
        : travel > 1e-9 ? movingStart + width / 2 : (initialFocus + phase) % 1;
    updateTimeFocus();
    const cursor = $("#histogram").querySelector<HTMLElement>(".cursor");
    if (cursor) cursor.style.top = `${focus * 100}%`;
    timeRange.set(start, end, [lo, hi]);
    timeRail.update(lo, hi, lo + span * start, lo + span * end);
    // A full-range cursor sweep does not change the evidence. Avoid decoding
    // and republishing the same large packet just because another tick elapsed.
    const current = filterIntent.desired(snapshot.filter);
    const nextStart = start === 0 ? null : lo + (hi - lo) * start;
    const nextEnd = end === 1 ? null : lo + (hi - lo) * end;
    playbackHistory = { workspace: snapshot.workspace_id, width, last: [nextStart, nextEnd], bounds: [lo, hi] };
    // One data refresh at a time. Never accumulate work behind the render clock.
    if (
      !playbackUpdating &&
      !busy &&
      now - lastUpdate >= 50 &&
      (current.start !== nextStart || current.end !== nextEnd)
    ) {
      lastUpdate = now;
      playbackUpdating = true;
      void timeWindow(start, end, 0, false, true)
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
}
on("#play", togglePlayback);
async function agentPlayback(args: Record<string, any>) {
  const workspace = snapshot.workspace_id;
  if (args.action === "play" && playTimer === undefined) await togglePlayback();
  else if (args.action === "pause" && playTimer !== undefined)
    await togglePlayback();
  else if (args.action === "configure") {
    if (args.speed !== undefined) playbackSpeed.setValue(args.speed);
    if (args.increment_seconds !== undefined)
      playbackIncrement.setValue(args.increment_seconds);
    if (args.fade_amount !== undefined || args.fade !== undefined) {
      view.setPlaybackFade(args.fade_amount ?? args.fade);
      updatePlaybackFadeControl();
      await syncScene(captureScene(), undefined, workspace);
    }
  } else if (args.action === "seek" || args.action === "step") {
    if (playTimer !== undefined) await togglePlayback();
    await filterIntent.flush();
    const [lo, hi] = snapshot.time_bounds,
      span = hi - lo;
    if (!(span > 0))
      throw Error("UNAVAILABLE: playback requires a nonempty time span");
    const target =
      args.action === "seek"
        ? args.time
        : Math.max(
            lo,
            Math.min(
              hi,
              lo + focus * span + args.steps * playbackIncrement.value,
            ),
          );
    if (target < lo || target > hi)
      throw Error("INVALID_ARGUMENT: seek is outside dataset time bounds");
    const width = Math.max(
      0,
      Math.min(
        1,
        ((snapshot.filter.end ?? hi) - (snapshot.filter.start ?? lo)) / span,
      ),
    );
    const start = Math.max(0, Math.min(1 - width, (target - lo) / span));
    await timeWindow(start, start + width);
    playbackWindow = null;
    focus = (target - lo) / span;
    updateTimeFocus();
    histogram();
  }
  return {
    playing: playTimer !== undefined,
    fade: view.playbackFade,
    fade_amount: view.playbackFadeAmount,
    speed: playbackSpeed.value,
    increment_seconds: playbackIncrement.value,
    time:
      snapshot.time_bounds[0] +
      focus * (snapshot.time_bounds[1] - snapshot.time_bounds[0]),
    window: [snapshot.filter.start, snapshot.filter.end],
    workspace_id: snapshot.workspace_id,
  };
}

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
  const picker = modal(
    `${head("Demo datasets")}<p class="description">Explore observations, predicted orbits and launch history with saved views. All ${demos.length} datasets are bundled for offline use.</p><div class="demo-grid">${demos
      .map(
        (demo) =>
          `<section class="demo-card"><div class="demo-previews">${demo.previews
            .map(
              (preview) =>
                `<button class="demo-preview" data-demo-preview="${esc(demo.id)}" data-demo-view="${preview.view_index}" aria-label="Open ${esc(demo.name)} in ${esc(preview.label)}"><img src="/demos/${esc(demo.id)}-${esc(preview.key)}.jpg" alt="${esc(demo.name)} in ${esc(preview.label)} view" width="480" height="300"><span>${esc(preview.label)}</span></button>`,
            )
            .join(
              "",
            )}</div><button data-demo-id="${esc(demo.id)}" data-tooltip-disabled aria-label="Open ${esc(demo.name)}"><span class="demo-title">${esc(demo.name)}</span><span class="demo-description">${esc(demo.description)}</span><span class="demo-action">Open demo ${icon("collapse-right")}</span></button><details><summary>Source &amp; license</summary><p>${esc(demo.license)}</p><p class="demo-source">${esc(demo.source_url)}</p></details></section>`,
      )
      .join(
        "",
      )}</div><p class="demo-footnote">Each demo opens as a new workspace. Save a copy to keep your own investigation.</p>`,
  );
  picker.querySelector(".modal")!.classList.add("demo-picker");
  demos.forEach((demo) => {
    const openDemo = async (viewIndex?: number) => {
      closeModal();
      await filterIntent.flush();
      if (!(await guardUnsaved("open a demo dataset"))) return;
      if (playTimer !== undefined) $("#play").click();
      await task("Opening demo dataset…", async () => {
        await restoreCommand(
          async () => {
            const result = await call("demo_open", {
              id: demo.id as EngineContracts["demo_open"]["args"]["id"],
            });
            // Every preview opens its actual saved scene and filter, including year.
            return viewIndex === undefined
              ? result
              : call("restore_view", { index: viewIndex });
          },
          () => {
            projectPath = null;
            lastRaster = null;
            mapUnavailable = false;
          },
        );
      });
    };
    on(`[data-demo-id="${demo.id}"]`, () => openDemo());
    picker
      .querySelectorAll<HTMLButtonElement>(`[data-demo-preview="${demo.id}"]`)
      .forEach((button) => {
        button.addEventListener(
          "click",
          () =>
            void openDemo(Number(button.dataset.demoView)).catch((error) =>
              toast(String(error), true),
            ),
        );
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
    if (dialogs.node) closeModal();
    else if (notifications.isOpen) notifications.close();
    else if (layerMenu) closeLayerMenu();
    else if (view.cancelNavigation()) {
      if (view.boxMode) $("#navigate").click();
    } else if (view.boxMode) $("#navigate").click();
    else if (!editable) run(() => select([]));
    return;
  }
  if (dialogs.node || busy || notifications.isOpen || layerMenu) return;
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
        await restoreCommand(() =>
          call(key === "y" || e.shiftKey ? "redo" : "undo"),
        );
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
  syncScene,
  fitGisLayer,
});

const agentLab = createAgentLab({
  view,
  snapshot: () => snapshot,
  live: liveViewRequest,
  setView: async (args) => {
    const result = await restoreCommand(() => call("view_set", args));
    if (!("scene" in result))
      throw Error(
        "INVALID_ARGUMENT: scenarios require an executed view change",
      );
    await refresh(false, false);
    await sceneIdle();
  },
  playback: agentPlayback,
  record: recordAppWindow,
});
async function agentRequest(kind: string, args: Record<string, any> = {}) {
  if (kind === "view_profile") return agentLab.profile(args);
  if (kind === "view_wait") return agentLab.wait(args);
  if (kind === "view_scenario") return agentLab.scenario(args);
  if (kind === "view_playback") return agentLab.playback(args);
  if (kind === "view_recording") return agentLab.recording(args);
  return liveViewRequest(kind, args);
}

let drainSceneEvents: () => Promise<unknown> = async () => {};
function transitionIdle() { return sceneTransitions.idle(() => drainSceneEvents()); }
async function sceneIdle() {
  for (;;) {
    await transitionIdle();
    await flushSceneSync();
    const refresh = refreshWork, scene = sceneSyncWork, camera = cameraSaveWork;
    await Promise.all([refresh.catch(() => {}), scene.catch(() => {}), camera.catch(() => {}), viewportDataRefresh.drain()]);
    await transitionIdle();
    if (representationGoal && !restoringScene) { viewportDataRefresh.request(); continue; }
    if (refresh !== refreshWork || scene !== sceneSyncWork || camera !== cameraSaveWork) continue;
    const generation = viewportDataRefresh.generation;
    try { await view.snapshotIdle(); }
    catch (error) {
      if (refresh !== refreshWork || scene !== sceneSyncWork || camera !== cameraSaveWork
        || generation !== viewportDataRefresh.generation || representationGoal) continue;
      throw error;
    }
    if (refresh === refreshWork && scene === sceneSyncWork && camera === cameraSaveWork
      && generation === viewportDataRefresh.generation && !representationGoal) return;
  }
}
async function initialize() {
  await view.ready;
  projectPath = (await call("workspace_status")).source;
  [preferences, mapPresets] = await Promise.all([
    call("preferences"),
    call("wmts_servers").then((c) => c.presets),
  ]);
  theme();
  terrainInfo = await call("terrain_info");
  if (terrainInfo && !preferences.terrain_builtin)
    overrideBounds = terrainInfo.bounds;
  await refresh(true, false);
  layers();
  if (snapshot.scene) await restoreScene(snapshot.scene, snapshot.revision);
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
    let sceneSyncGeneration = 0, sceneSyncPending = false;
    const cancelSceneSync = () => { sceneSyncGeneration++; sceneSyncPending = false; clearTimeout(syncTimer); };
    const runSceneSync = () => {
      if (!sceneSyncPending) return cameraSaveWork;
      sceneSyncPending = false; clearTimeout(syncTimer);
      const generation = sceneSyncGeneration;
      const work = (async () => {
        if (restoringScene) return;
        try {
          await transitionIdle();
          if (generation !== sceneSyncGeneration) return;
          const scene = captureScene();
          const result = await syncScene(scene, snapshot.revision);
          if (result.revision >= snapshot.revision) { snapshot.revision = result.revision; snapshot.scene = scene; }
        } catch (error) { if (!String(error).includes("CONFLICT:")) toast(String(error), true); }
      })();
      cameraSaveWork = work;
      return work;
    };
    flushSceneSync = runSceneSync;
    view.onSceneChange = () => {
      if (restoringScene) return;
      cancelSceneSync(); sceneSyncPending = true;
      syncTimer = setTimeout(runSceneSync, 600);
    };
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let guiSync: Promise<void> = Promise.resolve();
    let pendingEngineRevision = 0;
    let pendingRestoreRevision: number | undefined;
    let restorePending = false,
      themePending = false,
      terrainPending = false,
      fitTerrainPending = false;
    const flushChanges = () => {
      clearTimeout(eventTimer);
      eventTimer = undefined;
      const requestedRevision = pendingEngineRevision;
      const restoreRevision = pendingRestoreRevision;
      pendingEngineRevision = 0;
      pendingRestoreRevision = undefined;
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
              overrideBounds = preferences.terrain_builtin
                ? null
                : terrainInfo?.bounds || null;
            if (!terrainInfo) await view.setTerrain(null);
          }
          const publish = async () => {
            await refresh();
            if (restore) await applyRestoredScene(snapshot.scene);
          };
          if (restore) {
            await sceneTransitions.restore(restoreRevision, publish);
            // A coalesced non-restore change still needs publication even when
            // its older restore echo was already applied by the direct caller.
            if (
              restoreRevision !== undefined &&
              requestedRevision > restoreRevision
            )
              await refresh();
          } else await publish();
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
    drainSceneEvents = async () => {
      for (;;) {
        if (eventTimer) flushChanges();
        const observed = guiSync;
        await observed;
        if (!eventTimer && observed === guiSync) return;
      }
    };
    let desktopRequests: Promise<unknown> = Promise.resolve();
    await listen<any>("engine-event", (e) => {
      const event = e.payload;
      if (event.command === "scene_sync") return;
      if (
        [
          "capture",
          "view_status",
          "view_reset",
          "view_navigate",
          "view_recording",
          "view_profile",
          "view_wait",
          "view_scenario",
          "view_playback",
          "assist_ui",
        ].includes(event.kind)
      ) {
        if (eventTimer) flushChanges();
        desktopRequests = desktopRequests
          .catch(() => {})
          .then(async () => {
            try {
              await filterIntent.flush();
              // This consumer runs outside the scene coordinator. Joining its
              // full drain here cannot wait on our own queue turn.
              await sceneIdle();
              if (Date.now() > event.expires_at_ms)
                throw Error(
                  "UNAVAILABLE: desktop request expired before execution",
                );
              if (
                [
                  "view_recording",
                  "view_profile",
                  "view_wait",
                  "view_scenario",
                  "view_playback",
                ].includes(event.kind)
              ) {
                const result = await agentRequest(event.kind, event.arguments);
                await call("view_response", {
                  request_id: event.request_id,
                  result,
                });
                return;
              }
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
                const data_url =
                  target === "map"
                    ? await view.screenshot()
                    : label === "main"
                      ? await view.captureConsistent(
                          () => captureAppWindow(label),
                          () => ({
                            revision: snapshot.revision,
                            workspace_id: snapshot.workspace_id,
                          }),
                        )
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
                if (event.kind === "view_navigate") cancelSceneSync();
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
      if (event.command === "preferences") {
        guiSync = guiSync
          .catch(() => {})
          .then(async () => {
            const next = await call("preferences");
            const { resourcesChanged, pathChanged } = preferenceEffects(
              preferences,
              next,
            );
            if (resourcesChanged) {
              await cancelMap();
              terrainLoadGeneration++;
              capabilities = null;
              terrainInfo = await call("terrain_info");
              if (pathChanged)
                overrideBounds = next.terrain_builtin
                  ? null
                  : terrainInfo?.bounds || null;
            }
            preferences = next;
            theme();
            await refresh(false, false);
            if (resourcesChanged) {
              mapUnavailable = false;
              if (terrainInfo) await rebuildTerrain();
              else await loadRasters();
            }
          });
        guiSync.catch((error) => toast(String(error), true));
        return;
      }
      const restoresScene = [
        "view_set",
        "restore_view",
        "open",
        "demo_open",
        "undo",
        "redo",
        "recovery_restore",
      ].includes(event.command);
      // A completed local application owns this revision, even when its echo
      // arrives after newer user navigation. It must not cancel that work.
      if (restoresScene && sceneTransitions.hasApplied(event.revision)) return;
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
        "recovery_restore",
      ].includes(event.command);
      const clearCache = event.command === "wmts_cache_clear";
      if (mapChange || catalogChange || clearCache) {
        void cancelMap();
        terrainLoadGeneration++;
        if (mapChange || clearCache) capabilities = null;
      }
      if (
        event.revision <= snapshot.revision &&
        !restoresScene &&
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
          "recovery_restore",
        ].includes(event.command)
      )
        cancelSceneSync();
      pendingEngineRevision = Math.max(
        pendingEngineRevision,
        event.revision || 0,
      );
      if (restoresScene)
        pendingRestoreRevision = Math.max(
          pendingRestoreRevision ?? 0,
          event.revision || 0,
        );
      restorePending ||= [
        "view_set",
        "restore_view",
        "open",
        "demo_open",
        "undo",
        "redo",
        "recovery_restore",
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
  view.onRepresentationInvalidated = () => { if (snapshot) queueRepresentation("metadata-reconcile", true); };
  view.onSnapshotError = error => toast(String(error), true);
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
  liveViewRequest: agentRequest,
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
  sceneIdle,
  filterIdle: () => filterIntent.flush(),
  displayIdle: () => viewsPanel.idle(),
  chartsIdle: () => chartsPanel.idle(),
  patternsIdle: () => patternsPanel.idle(),
  select,
  selectionIdle: () => tableSelection.work,
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
