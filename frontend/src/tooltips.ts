export const TOOLTIP_DELAY_MS = 1000;
const tips: Record<string, string> = {
  "display-settings":
    "Choose automatic clusters, points, density or heat map; tune stems and optional bloom. Source records are retained.",
  "display-mode":
    "Automatic uses exact-count clusters above 2,000 located events; points return as filters and zoom reduce matches.",
  "display-spacing":
    "Requested cluster size in screen pixels. The engine may coarsen the grid to fit its bounded packet; the status bar shows actual cells.",
  "display-time":
    "UTC start-time slab width in minutes. Zero chooses an automatic width in space-time; 2D/globe combine the current time window.",
  "display-partition":
    "Separate count clusters by entity or source. Density and heat maps combine partitions.",
  "display-culling":
    "Request events in a conservative camera region. Workspace time and geographic filters still apply.",
  "display-trail":
    "Maximum simplification deviation in screen pixels for displayed tracks. Zero keeps full displayed detail; source tracks do not change.",
  "display-gap":
    "Break displayed tracks across time gaps above this many minutes. Zero disables this gap threshold.",
  "display-radius":
    "Visual kernel influence in CSS pixels; smoothing uses exact pre-binned weights and is an approximation.",
  "display-max":
    "Leave blank for a view-relative color maximum. A fixed positive value makes colors comparable across views.",
  "display-reference":
    "Optional reference map zoom: influence scales with zoom instead of maintaining its screen radius.",
  "display-bloom":
    "Glow around bright event glyphs. Off by default; adds GPU work without changing data.",
  "close-table":
    "Close this table and give its space back to the scene. Table settings are retained.",
  "agent-toggle":
    "Enable or disable live CLI/MCP access. No folder selection required.",
  "agent-config":
    "Show ready-to-use local MCP configuration and a Codex setup command.",
  "wmts-cache":
    "Configure direct disk caching, offline reuse and normal concurrent map downloads. No proxy required.",
  "wmts-level":
    "Automatic uses the canvas resolution. A chosen matrix level is honored; all covering tiles are paged without a testing-only tile cap.",
  "cancel-map":
    "Stop before the next map page. Completed tiles remain in the direct disk cache; an active page may finish first.",
  "edit-wkt":
    "Original WGS84 WKT geometry. X=longitude, Y=latitude. Z/M are preserved but not used as altitude/time. Changing point coordinates replaces the WKT geometry.",

  si: "Open SI chat. Use its gear for AI service and connected tool settings.",
  "si-send":
    "Send this request and its requested tool data to your configured service. Billing is determined by that provider.",
  "si-key":
    "API key is held in memory for this session; never included in project files or logs.",
  "si-edits":
    "Enable record edits, deletion and aggregation for this request; file operations also require a chosen folder.",
  "si-stop":
    "Cancel the current request before its next action. An active network call may take up to 60 seconds to return.",
  "aggregate-events":
    "Preview or create time/proximity summaries of visible records. Creating summaries replaces the workspace; save a copy first.",
  "import-aggregate":
    "Reduce retained imported records into summaries. Raw member rows are discarded; preserve the original file.",
  "aggregate-window":
    "Fixed, UTC epoch-aligned time bucket width in minutes. Events exactly at the next boundary start a new group.",
  "aggregate-radius":
    "Maximum WGS84 ellipsoidal distance to the group's first anchor, in metres. Separate entity/category/source groups.",

  open: "Open a workspace, CSV/Excel, Shapefile, vector GeoPackage, GeoJSON/TopoJSON, KML/KMZ, CZML, GPX, local tileset.json or glTF/GLB. JSON content is detected automatically. Ctrl/Cmd+O (Ctrl/Cmd+I also works).",
  "display-centroids":
    "Show derived polygon centroid circles and track anchors. Full polygon shapes remain visible; centroids can lie outside a polygon or inside a hole.",
  save: "Save data and display setup to the current workspace, or choose a file on first save. Ctrl/Cmd+S.",
  "table-respect-filters":
    "Restrict this attribute table to events matching the workspace filters; unchecked shows every row in the selected source.",
  "table-search":
    "Search record text and original attribute values in this tab without changing workspace filters.",
  "table-all": "Open the combined attribute table for all imported sources.",
  maps: "Streets is the default worldwide basemap. Advanced settings manage custom WMTS servers, layers and cache.",
  "wmts-auth":
    "Automatic OS certificate/PIN handling on macOS and Windows, or optional local identity overrides. No PINs or private keys are stored.",
  "auth-reset":
    "Close native TLS sessions and forget certificate choices. This does not lock the card, delete overrides or remove cached imagery.",
  terrain:
    "Load DTED files or folders and drape Streets and custom WMTS layers over the terrain.",
  help: "User guide, keyboard shortcuts and application information. F1 opens the guide.",
  search: "Filter events by matching text. Ctrl/Cmd+F.",
  "entity-search":
    "Find an entity in this list; this does not filter the dataset.",
  "selected-only":
    "Show only the current selection. Other data remains in the workspace.",
  "select-all": "Select all events matching the current filters. Ctrl/Cmd+A.",
  clear: "Clear selection without deleting events.",
  "reset-filters":
    "Remove all time, entity, category, attribute, search and region restrictions.",
  navigate:
    "Drag to move; middle-drag rotates and tilts; right-drag or wheel zooms. Click markers to select.",
  "box-select":
    "Drag a rectangle to select visible markers on screen. Hold Shift to add.",
  fit: "Fit event coverage and restore the camera. F.",
  "navigation-zoom":
    "Continuous zoom. Drag up to zoom in; arrow keys make small adjustments.",
  "navigation-tilt":
    "Continuous tilt from top-down to horizon. Camera tilt does not change event time height.",
  "fit-terrain": "Fit the geographic extent of the loaded terrain.",
  "time-height":
    "Adjust vertical time scale in space-time view. Stored timestamps do not change.",
  "window-start": "Inclusive start of the visible UTC time window.",
  "window-end": "Inclusive end of the visible UTC time window.",
  play: "Move a time window through the data. Space plays or pauses.",
  "full-range": "Clear time restrictions and show the full dataset time span.",
  "toggle-table":
    "Open layers as tabs in one attribute-table panel. Use Detach to move the tab group into a separate window.",
  export:
    "Export visible selected events, or all visible events if none are selected. Ctrl/Cmd+E.",
  "date-format":
    "Optional chrono format matching the source, e.g. %d/%m/%Y %H:%M:%S. Overrides automatic parsing.",
  "time-offset":
    "Assumed offset from UTC, in minutes, for values without a timezone. +120 means UTC+02:00.",
  "date-order": "Resolve ambiguous numeric dates as day/month or month/day.",
  "time-encoding":
    "Override numeric timestamp detection: Unix epoch units or Excel date serials.",
  "default-date":
    "Date assigned to time-only values when no separate date column exists.",
  "decimal-comma":
    "Use comma as decimal mark in numeric fields; periods act as grouping marks.",
  "default-zone":
    "Explicit UTM zone 1–60 when no zone column is mapped. Never guessed.",
  "default-hemisphere":
    "UTM hemisphere N or S. A latitude-band letter is a different value.",
  "save-view":
    "Save current filters, selection, camera and display state under a name.",
  "save-group": "Save a named set of selected events.",
  delete: "Review deletion of selected events. Undo restores them.",
  "run-analysis":
    "Find candidate patterns in visible data using the thresholds below.",
  radius:
    "Spatial radius in metres. Consider source grid precision when choosing it.",
  tolerance:
    "Allowed difference between event timestamps, in seconds; fractional seconds are supported.",
  duration: "Minimum observed duration, in seconds.",
  gap: "Maximum gap between consecutive observed samples, in seconds.",
  speed: "Speed threshold in kilometres per hour between observed samples.",
  cluster: "Minimum number of events in a spatial cluster.",
};
export function installTooltips() {
  const bubble = document.createElement("div");
  bubble.className = "tooltip";
  bubble.id = "control-tooltip";
  bubble.setAttribute("role", "tooltip");
  document.body.append(bubble);
  let active: HTMLElement | null = null,
    timer: number | undefined;
  function annotate() {
    document
      .querySelectorAll<HTMLElement>(
        "button,input,select,textarea,summary,[data-event],[data-layer-source],[data-layer-kind],[data-bin],[data-finding]",
      )
      .forEach((e) => {
        if (e.dataset.tooltip || e.hasAttribute("data-tooltip-disabled"))
          return;
        const label =
          e.getAttribute("aria-label") ||
          e.closest("label")?.textContent?.trim().split("\n")[0] ||
          e.textContent?.trim() ||
          e.getAttribute("placeholder") ||
          e.id;
        let text = tips[e.id] || e.getAttribute("title");
        if (!text && e.hasAttribute("data-layer-source"))
          text =
            "Imported data layer. Double-click to open its attribute table, or right-click / use the options button. The checkbox controls visibility.";
        if (!text && e.dataset.view)
          text = `Switch to ${e.textContent?.trim()} view. Filters and selections are shared.`;
        if (!text && e.dataset.tab)
          text = `Open the ${e.textContent?.trim()} inspector.`;
        if (!text && e.dataset.map)
          text = `Choose the source column for ${e.closest("label")?.firstChild?.textContent?.trim()}. Leave unmapped if absent.`;
        if (!text && e.dataset.entity)
          text = `Show or hide entity ${e.dataset.entity}.`;
        if (!text && e.dataset.category)
          text = `Show or hide category ${e.dataset.category}.`;
        if (!text && e.dataset.bin !== undefined)
          text =
            "Select events in this time bin. " +
            (e.getAttribute("title") || "");
        if (!text && e.dataset.finding !== undefined)
          text = "Select the events supporting this pattern finding.";
        if (!text && e.dataset.event)
          text =
            "Select this event. Ctrl/Cmd toggles rows; Shift selects a range.";
        if (!text && e.hasAttribute("data-close"))
          text = "Close this dialog. Escape.";
        if (!text && e.dataset.viewIndex)
          text = "Restore saved filters, selection and camera.";
        if (!text && e.dataset.groupIndex)
          text = "Restore this saved selection group.";
        if (!text && label)
          text =
            e.tagName === "SUMMARY"
              ? `Expand ${label}.`
              : e.tagName === "BUTTON"
                ? label
                : `Set ${label}.`;
        if (text) {
          e.dataset.tooltip = text;
          e.setAttribute("aria-description", text);
          e.removeAttribute("title");
          if (!label && e.tagName === "BUTTON")
            e.setAttribute("aria-label", text);
        }
      });
  }
  function hide() {
    clearTimeout(timer);
    bubble.classList.remove("visible");
    if (active) active.removeAttribute("aria-describedby");
    active = null;
  }
  function show(target: EventTarget | null) {
    const e =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-tooltip]")
        : null;
    if (!e) {
      hide();
      return;
    }
    if (active === e) return;
    hide();
    active = e;
    timer = window.setTimeout(() => {
      if (active !== e || !e.isConnected) return;
      bubble.textContent = e.dataset.tooltip!;
      bubble.classList.add("visible");
      e.setAttribute("aria-describedby", bubble.id);
      const r = e.getBoundingClientRect();
      bubble.style.left = `${Math.max(8, Math.min(innerWidth - bubble.offsetWidth - 8, r.left))}px`;
      bubble.style.top = `${Math.max(8, r.bottom + bubble.offsetHeight + 12 < innerHeight ? r.bottom + 8 : r.top - bubble.offsetHeight - 8)}px`;
    }, TOOLTIP_DELAY_MS);
  }
  annotate();
  const observer = new MutationObserver(() => {
    annotate();
    if (active && !active.isConnected) hide();
  });
  observer.observe(document.getElementById("app")!, {
    childList: true,
    subtree: true,
  });
  observer.observe(document.body, { childList: true });
  document.addEventListener("pointerover", (e) => show(e.target));
  document.addEventListener("pointerout", (e) => {
    if (
      active &&
      !(e.relatedTarget instanceof Node && active.contains(e.relatedTarget))
    )
      hide();
  });
  document.addEventListener("focusin", (e) => show(e.target));
  document.addEventListener("focusout", hide);
  document.addEventListener("click", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, true);
}
