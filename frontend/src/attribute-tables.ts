import { call } from "./bridge";
import { TableSelection } from "./table-selection";
import { tableMarkup, tableRows } from "./table-dom";
import {
  columnWindow,
  columnWindowOffset,
  TABLE_COLUMN_WIDTH,
  TABLE_COLUMN_WINDOW,
} from "./table-columns";
import { GisTable } from "./gis-table";
import type { GisLayer } from "./gis";
import type { DisplayCell } from "./display-options";
import type { Snapshot } from "./types";
import { displayTime } from "./types";
const esc = (s: unknown) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const attributeTableMarkup = `<div class="table-tabs" role="tablist" aria-label="Open attribute tables" id="table-tabs"></div><div class="table-header"><input id="table-search" type="search" maxlength="1024" placeholder="Search this table…" aria-label="Search this table" title="Search record text and original attribute values in this table"><small class="muted" id="table-count" role="status"></small><span class="spacer"></span><label class="check-row" id="table-filter-option" hidden><input id="table-respect-filters" type="checkbox"> Respect workspace filters</label><button id="table-all" hidden>All sources</button><button id="table-popout" title="Move all attribute tabs to a separate window" aria-label="Detach attribute tables">Detach</button></div><div class="table-scroll"><table><colgroup></colgroup><thead id="table-head"></thead><tbody id="table-body"></tbody></table></div>`;

export type AttributeTab = {
  key: string;
  source: string | null;
  gis: string | null;
  sort: string;
  descending: boolean;
  filters: boolean;
  column: number;
  columnCount: number;
  search: string;
  page: number;
  top: number;
  left: number;
  cell: DisplayCell | null;
  reveal: string | null;
  anchor: string | null;
  active: string | null;
  gisState: ReturnType<GisTable["capture"]>;
};
export type AttributeTableState = {
  workspace: string;
  open: boolean;
  active: string | null;
  tabs: AttributeTab[];
};

export function createAttributeTables(
  host: HTMLElement,
  hooks: {
    snapshot: () => Snapshot;
    refresh: () => Promise<void>;
    error: (error: unknown) => void;
    changed?: () => void;
    layout?: () => void;
    suspended?: () => boolean;
    detach?: () => Promise<void>;
  },
) {
  const $ = (selector: string) => host.querySelector<HTMLElement>(selector)!;
  const toast = (error: unknown, _failure?: boolean) => hooks.error(error);
  const check = (selector: string) => ($(selector) as HTMLInputElement).checked;
  const input = (selector: string) => ($(selector) as HTMLInputElement).value;
  const on = (selector: string, action: () => unknown) =>
    $(selector).addEventListener("click", () => {
      void Promise.resolve().then(action).catch(hooks.error);
    });
  let page = 0,
    tableOpen = false;
  let storedTop = 0,
    storedLeft = 0;
  let tableDisplayCell: DisplayCell | null = null;
  let tableColumnOffset = 0;
  let tableColumnCount = 0;
  let tableSearch = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let tableSource: string | null = null,
    tableRespectFilters = true,
    tableSort = "time",
    tableDescending = false,
    tableTotal = 0,
    tableSerial = 0;
  const tableSelection = new TableSelection({
    scope: () => ({
      source: tableSource,
      apply_filter: tableRespectFilters,
      table_search: tableSearch,
      ...(tableDisplayCell ? { display_cell: tableDisplayCell } : {}),
      sort_by: tableSort,
      descending: tableDescending,
    }),
    workspace: () => hooks.snapshot().workspace_id,
    rowHeight: () => TABLE_ROW_HEIGHT,
    reveal: (id) => {
      tableReveal = id;
    },
    refresh: () => hooks.refresh(),
    error: (error) => toast(String(error), true),
  });
  let tableReveal: string | null = null;
  const TABLE_ROW_HEIGHT = 32;
  const TABLE_WINDOW = 100;
  let tableScrollFrame = 0;
  let tableScrollLoading = false;
  let changingScope = false;
  let visibleScope = "";
  // Stay below native browser scroll-height limits even for multi-million-row data.
  const tableRowUnit = () =>
    Math.min(TABLE_ROW_HEIGHT, 32_000_000 / Math.max(1, tableTotal));
  let tableScopeKey = "";
  function resetTableScroll() {
    page = 0;
    storedTop = 0;
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
      column_limit: TABLE_COLUMN_WINDOW,
      table_search: tableSearch,
      offset: page * 50,
      limit: TABLE_WINDOW,
    };
  }
  const gisTable = new GisTable($("#table-head"), $("#table-body"), () =>
    tableRowUnit(),
  );
  gisTable.onChange = () => hooks.refresh();
  gisTable.onError = (error) => toast(String(error), true);
  gisTable.onSort = () => {
    resetTableScroll();
    void table().catch(gisTable.onError);
  };
  $("#table-search").addEventListener("input", () => {
    tableSearch = input("#table-search");
    gisTable.search = tableSearch;
    tableSelection.anchor = tableSelection.activeId = null;
    tableSerial++;
    $(".table-scroll").setAttribute("aria-busy", "true");
    changingScope = true;
    resetTableScroll();
    saveTab();
    hooks.changed?.();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void table().catch(hooks.error);
    }, 180);
  });
  let tabs = new Map<string, AttributeTab>();
  let activeTab: string | null = null;
  let workspaceId = "";
  let receiving = false;
  function currentKey() {
    return gisTable.layerId
      ? `gis:${gisTable.layerId}`
      : `events:${JSON.stringify([tableSource, tableDisplayCell])}`;
  }
  function captureTab(): AttributeTab {
    return {
      key: activeTab || currentKey(),
      source: tableSource,
      gis: gisTable.layerId,
      sort: tableSort,
      descending: tableDescending,
      filters: tableRespectFilters,
      column: tableColumnOffset,
      columnCount: tableColumnCount,
      search: tableSearch,
      page,
      top: storedTop,
      left: storedLeft,
      cell: tableDisplayCell,
      reveal: tableReveal,
      anchor: tableSelection.anchor,
      active: tableSelection.activeId,
      gisState: gisTable.capture(),
    };
  }
  function saveTab() {
    if (activeTab && tableOpen) tabs.set(activeTab, captureTab());
  }
  function applyTab(value: AttributeTab) {
    tableSerial++;
    activeTab = value.key;
    tableSource = value.source;
    tableDisplayCell = value.cell;
    tableSort = value.sort;
    tableDescending = value.descending;
    tableRespectFilters = value.filters;
    clearTimeout(searchTimer);
    tableColumnOffset = value.column;
    tableColumnCount = value.columnCount || 0;
    tableSearch = value.search ?? value.gisState.search ?? "";
    page = value.page;
    tableReveal = value.reveal;
    storedTop = value.top;
    storedLeft = value.left;
    tableSelection.anchor = value.anchor;
    tableSelection.activeId = value.active;
    gisTable.restore(value.gisState);
    ($("#table-search") as HTMLInputElement).value = tableSearch;
    $(".table-scroll").scrollTop = value.top;
    $(".table-scroll").scrollLeft = value.left;
  }
  function label(value: AttributeTab) {
    if (value.gis)
      return (
        hooks.snapshot().gis_layers?.find((l) => l.id === value.gis)?.name ||
        "GIS layer"
      );
    return value.cell ? "Display cell members" : value.source || "All sources";
  }
  function syncTabs() {
    if (tableOpen && !activeTab) {
      activeTab = currentKey();
      tableSearch =
        tabs.get(activeTab)?.search ??
        (gisTable.layerId ? gisTable.search : "");
      gisTable.search = tableSearch;
      ($("#table-search") as HTMLInputElement).value = tableSearch;
    }
    tableScopeKey = JSON.stringify([
      tableRespectFilters && !gisTable.layerId ? hooks.snapshot().filter : null,
      tableSource,
      tableRespectFilters,
      tableSort,
      tableDescending,
      tableDisplayCell,
      tableSearch,
    ]);
    saveTab();
    const focusKey =
      $("#table-tabs").querySelector<HTMLElement>(":focus")?.dataset.tableTab;
    tableMarkup(
      $("#table-tabs"),
      [...tabs.values()]
        .map(
          (value, i) =>
            `<div class="attribute-tab"><button role="tab" id="attribute-tab-${i}" aria-controls="attribute-table-content" aria-selected="${value.key === activeTab}" tabindex="${value.key === activeTab ? 0 : -1}" data-table-tab="${esc(value.key)}" title="${esc(label(value))}">${esc(label(value))}</button><button ${value.key === activeTab ? 'id="close-table"' : ""} class="attribute-tab-close" data-close-tab="${esc(value.key)}" aria-label="Close ${esc(label(value))}">×</button></div>`,
        )
        .join(""),
    );
    if (focusKey)
      [...$("#table-tabs").querySelectorAll<HTMLElement>("[data-table-tab]")]
        .find((el) => el.dataset.tableTab === focusKey)
        ?.focus({ preventScroll: true });
    $(".table-scroll").id = "attribute-table-content";
    $(".table-scroll").setAttribute("role", "tabpanel");
    const index = [...tabs.keys()].indexOf(activeTab || "");
    if (index >= 0)
      $(".table-scroll").setAttribute(
        "aria-labelledby",
        `attribute-tab-${index}`,
      );
  }
  function pruneTabs() {
    const snapshot = hooks.snapshot();
    for (const [key, value] of tabs) {
      const missing = value.gis
        ? !snapshot.gis_layers?.some((layer) => layer.id === value.gis)
        : value.source !== null &&
          !snapshot.layers.some((source) => source.source === value.source);
      if (!missing) continue;
      tabs.delete(key);
      if (activeTab === key) {
        activeTab = null;
        const next = tabs.values().next().value;
        if (next) applyTab(next);
        else {
          tableOpen = false;
          gisTable.close();
        }
      }
    }
  }
  async function activate(key: string) {
    clearTimeout(searchTimer);
    saveTab();
    const next = tabs.get(key);
    if (!next) return;
    applyTab(next);
    tableOpen = true;
    // Restore scroll after rows establish the new table's scroll extent.
    const position = { top: next.top, left: next.left };
    await table();
    $(".table-scroll").scrollTop = position.top;
    $(".table-scroll").scrollLeft = position.left;
    hooks.layout?.();
  }
  async function closeTab(key: string | null) {
    if (!key) return;
    clearTimeout(searchTimer);
    saveTab();
    const keys = [...tabs.keys()],
      index = keys.indexOf(key);
    tabs.delete(key);
    if (activeTab === key) {
      tableSerial++;
      gisTable.close();
      activeTab = null;
      const next = [...tabs.keys()][Math.min(index, tabs.size - 1)];
      if (next) return activate(next);
      tableOpen = false;
      tableReveal = null;
      tableDisplayCell = null;
      tableSelection.anchor = tableSelection.activeId = null;
    }
    syncTabs();
    hooks.changed?.();
    hooks.layout?.();
  }
  async function openAttributes(
    source: string | null,
    cell: DisplayCell | null = null,
  ) {
    saveTab();
    const key = `events:${JSON.stringify([source, cell])}`;
    if (tabs.has(key)) return activate(key);
    gisTable.close();
    tableSelection.anchor = tableSelection.activeId = null;
    tableSource = source;
    tableDisplayCell = cell;
    tableColumnOffset = 0;
    tableColumnCount = 0;
    tableSearch = "";
    clearTimeout(searchTimer);
    ($("#table-search") as HTMLInputElement).value = "";
    tableRespectFilters = true;
    tableSort = "time";
    tableDescending = false;
    tableReveal = null;
    activeTab = key;
    tableOpen = true;
    resetTableScroll();
    storedLeft = 0;
    $(".table-scroll").scrollLeft = 0;
    await table();
    hooks.layout?.();
  }
  async function openGisAttributes(id: string) {
    saveTab();
    const key = `gis:${id}`;
    if (tabs.has(key)) return activate(key);
    clearTimeout(searchTimer);
    gisTable.open(id);
    tableColumnOffset = 0;
    tableColumnCount = 0;
    tableSearch = "";
    tableSelection.anchor = tableSelection.activeId = null;
    tableDisplayCell = null;
    tableReveal = null;
    activeTab = key;
    tableOpen = true;
    resetTableScroll();
    storedLeft = 0;
    $(".table-scroll").scrollLeft = 0;
    ($("#table-search") as HTMLInputElement).value = "";
    await table();
    hooks.layout?.();
  }
  function capture(): AttributeTableState {
    saveTab();
    return {
      workspace: hooks.snapshot()?.workspace_id || workspaceId,
      open: tableOpen,
      active: activeTab,
      tabs: [...tabs.values()],
    };
  }
  async function receive(state: AttributeTableState) {
    if (state.workspace !== hooks.snapshot().workspace_id) return;
    receiving = true;
    try {
      tableSerial++;
      workspaceId = state.workspace;
      tabs = new Map(state.tabs.map((value) => [value.key, value]));
      activeTab = state.active;
      tableOpen = state.open;
      const value = tabs.get(activeTab || "");
      if (value) applyTab(value);
      await table();
      if (value) {
        $(".table-scroll").scrollTop = value.top;
        $(".table-scroll").scrollLeft = value.left;
      }
    } finally {
      receiving = false;
    }
  }
  on("#table-popout", () => hooks.detach?.());
  $("#table-tabs").addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (target?.dataset.tableTab)
      void activate(target.dataset.tableTab).catch(hooks.error);
    if (target?.dataset.closeTab)
      void closeTab(target.dataset.closeTab).catch(hooks.error);
  });
  $("#table-tabs").addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(event.key)
    )
      return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[role=tab]",
    );
    if (!target) return;
    event.preventDefault();
    const keys = [...tabs.keys()],
      index = keys.indexOf(target.dataset.tableTab!);
    if (event.key === "Delete") {
      void closeTab(keys[index]).catch(hooks.error);
      return;
    }
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? keys.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) %
            keys.length;
    void activate(keys[next])
      .then(() => $("#table-tabs [aria-selected=true]").focus())
      .catch(hooks.error);
  });
  async function table(preloaded?: any, selectedIds?: string[], notify = true) {
    const workspace = hooks.snapshot().workspace_id;
    if (workspace !== workspaceId) {
      tabs.clear();
      activeTab = null;
      workspaceId = workspace;
    }
    pruneTabs();
    const generation = ++tableSerial;
    syncTabs();
    if (!receiving && notify) hooks.changed?.();
    if (hooks.suspended?.() || !tableOpen) return;
    const scroll = $(".table-scroll");
    const scope = JSON.stringify([
      workspace,
      activeTab,
      tableSearch,
      tableSort,
      tableDescending,
      tableRespectFilters,
      tableRespectFilters && !gisTable.layerId ? hooks.snapshot().filter : null,
      gisTable.sort,
      gisTable.descending,
    ]);
    if (scope !== visibleScope) {
      visibleScope = scope;
      changingScope = true;
    }
    scroll.setAttribute("aria-busy", "true");
    try {
      if (gisTable.layerId) {
        const layer = ((hooks.snapshot().gis_layers || []) as GisLayer[]).find(
          (l) => l.id === gisTable.layerId,
        );
        if (!layer) return closeTab(activeTab);
        $("#table-filter-option").hidden = true;
        $("#table-all").hidden = false;
        host.setAttribute("aria-label", `GIS · ${layer.name}`);
        const r = await gisTable.render(layer, page * 50, tableColumnOffset);
        if (!r || generation !== tableSerial) return;
        tableTotal = r.count;
        tableColumnCount = r.total_columns;
        if (
          tableColumnOffset >
          Math.max(0, tableColumnCount - TABLE_COLUMN_WINDOW)
        ) {
          tableColumnOffset = Math.max(
            0,
            tableColumnCount - TABLE_COLUMN_WINDOW,
          );
          return table();
        }
        $("#table-count").textContent =
          `${r.count.toLocaleString()} reference features · ${layer.selected.length} selected`;
        $(".table-scroll table").setAttribute(
          "aria-rowcount",
          String(r.count + 1),
        );
        storedTop = scroll.scrollTop;
        storedLeft = scroll.scrollLeft;
        saveTab();
        if (!receiving && notify) hooks.changed?.();
        return;
      }
      const requestedWindow = page;
      const r =
        preloaded || (await call("attribute_table", tablePageArguments()));
      if (generation !== tableSerial) return;
      if (!tableReveal && requestedWindow !== page) return;
      const exactSelected = new Set(
        selectedIds ||
          (
            await call("selection_contains", {
              ids: r.events.map((e: any) => e.id),
            })
          ).selected,
      );
      if (generation !== tableSerial) return;
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
      tableColumnCount = r.total_columns;
      if (
        tableColumnOffset > Math.max(0, tableColumnCount - TABLE_COLUMN_WINDOW)
      ) {
        tableColumnOffset = Math.max(0, tableColumnCount - TABLE_COLUMN_WINDOW);
        return table();
      }
      host.setAttribute(
        "aria-label",
        tableDisplayCell
          ? "Display cell members"
          : tableSource || "All sources",
      );
      // Read the live viewport after asynchronous reads, before patching rows.
      // A playback response must not restore a position from before a wheel event.
      storedTop = scroll.scrollTop;
      storedLeft = scroll.scrollLeft;
      const window = columnWindow(
        host,
        tableColumnOffset,
        r.columns.length,
        tableColumnCount,
      );
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
      tableMarkup(
        $("#table-head"),
        `<tr>${window.before("th")}${headers.map(([c, title], i) => `<th aria-colindex="${tableColumnOffset + i + 1}" aria-sort="${tableSort === c ? (tableDescending ? "descending" : "ascending") : "none"}"><button data-table-sort="${esc(c)}" aria-label="Sort by ${esc(c)}" title="${esc(title)}">${esc(title)}${tableSort === c ? (tableDescending ? " ↓" : " ↑") : ""}</button></th>`).join("")}${window.after("th")}</tr>`,
      );
      const value = (e: any, c: string) => {
        if (c.startsWith("attribute:"))
          return e[c] ?? e.attrs?.[c.slice(10)] ?? "";
        if (c === "time" || c === "end")
          return e[c] == null ? "" : displayTime(e[c]);
        if (Array.isArray(e[c])) return e[c].join("; ");
        return e[c] ?? "";
      };
      const hadTableFocus = !!document.activeElement?.closest(
        "#table-body [data-event]",
      );
      const spacer = (rows: number) =>
        rows > 0
          ? `<tr class="table-spacer" aria-hidden="true"><td colspan="${window.span}" style="height:${rows * tableRowUnit()}px"></td></tr>`
          : "";
      tableRows(
        $("#table-body"),
        spacer(r.offset) +
          (r.events
            .map(
              (e: any, index: number) =>
                `<tr tabindex="${e.id === tableSelection.activeId || (!tableSelection.activeId && index === 0) ? 0 : -1}" aria-rowindex="${page * 50 + index + 2}" data-event="${esc(e.id)}" aria-selected="${exactSelected.has(e.id)}" class="${exactSelected.has(e.id) ? "selected" : ""}">${window.before("td")}${columns.map((c, i) => `<td aria-colindex="${tableColumnOffset + i + 1}" title="${esc(value(e, c))}">${esc(value(e, c))}</td>`).join("")}${window.after("td")}</tr>`,
            )
            .join("") ||
            `<tr><td colspan="${window.span}">No events in this scope.</td></tr>`) +
          spacer(Math.max(0, tableTotal - r.offset - r.events.length)),
        "data-event",
      );
      $(".table-scroll table").setAttribute(
        "aria-rowcount",
        String(tableTotal + 1),
      );
      if (hadTableFocus && tableSelection.activeId) {
        const active = Array.from(
          $("#table-body").querySelectorAll<HTMLElement>("[data-event]"),
        ).find((row) => row.dataset.event === tableSelection.activeId);
        active?.focus({ preventScroll: true });
      }
      if (reveal) {
        const row = Array.from(
          $("#table-body").querySelectorAll<HTMLElement>("[data-event]"),
        ).find((row) => row.dataset.event === reveal);
        if (row) {
          storedTop = row.offsetTop - $("#table-head").clientHeight;
        }
      }
      $(".table-scroll").scrollTop = storedTop;
      $(".table-scroll").scrollLeft = storedLeft;
      saveTab();
      if (!receiving && notify) hooks.changed?.();
    } finally {
      if (generation === tableSerial) {
        scroll.setAttribute("aria-busy", "false");
        changingScope = false;
      }
    }
  }
  $("#table-head").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-table-sort]");
    if (!b) return;
    const c = b.dataset.tableSort!;
    tableDescending = tableSort === c ? !tableDescending : false;
    tableSort = c;
    tableSelection.anchor = null;
    tableSelection.activeId = null;
    resetTableScroll();
    table().catch((e) => toast(String(e), true));
  });
  $("#table-respect-filters").addEventListener("change", () => {
    tableRespectFilters = check("#table-respect-filters");
    tableSelection.anchor = null;
    tableSelection.activeId = null;
    resetTableScroll();
    table().catch((e) => toast(String(e), true));
  });
  on("#table-all", () => openAttributes(null));
  function scheduleScroll(event?: Event) {
    if (!tableOpen || hooks.suspended?.() || receiving) return;
    if (event?.type === "scroll") {
      storedTop = $(".table-scroll").scrollTop;
      storedLeft = $(".table-scroll").scrollLeft;
    }
    if (tableScrollFrame) return;
    tableScrollFrame = requestAnimationFrame(() => {
      tableScrollFrame = 0;
      storedTop = $(".table-scroll").scrollTop;
      storedLeft = $(".table-scroll").scrollLeft;
      const nextPage = Math.floor(
        Math.max(0, Math.floor(storedTop / tableRowUnit()) - 20) / 50,
      );
      const nextColumn = columnWindowOffset(
        storedLeft,
        $(".table-scroll").clientWidth,
        tableColumnCount,
        tableColumnOffset,
      );
      if (
        (nextPage === page || tableReveal) &&
        nextColumn === tableColumnOffset
      ) {
        saveTab();
        if (!receiving) hooks.changed?.();
        return;
      }
      if (!tableReveal) page = nextPage;
      tableColumnOffset = nextColumn;
      if (tableScrollLoading) return;
      tableScrollLoading = true;
      void (async () => {
        try {
          for (;;) {
            const requested = `${page}:${tableColumnOffset}:${activeTab}:${tableSearch}`;
            await table();
            if (
              requested ===
              `${page}:${tableColumnOffset}:${activeTab}:${tableSearch}`
            )
              break;
          }
        } finally {
          tableScrollLoading = false;
        }
      })().catch(hooks.error);
    });
  }
  $(".table-scroll").addEventListener("scroll", scheduleScroll);
  new ResizeObserver(() => scheduleScroll()).observe($(".table-scroll"));
  $("#table-body").addEventListener(
    "click",
    (event) => {
      if (changingScope) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  tableSelection.bind($("#table-body"), $(".table-scroll"), $("#table-head"));
  return {
    gisTable,
    tableSelection,
    render: table,
    resetTableScroll,
    tablePageArguments,
    openAttributes,
    openGisAttributes,
    capture,
    receive,
    beginRestore() {
      saveTab();
      activeTab = null;
      tableSerial++;
    },
    resetTabs() {
      tabs.clear();
      activeTab = null;
      tableSerial++;
    },
    get page() {
      return page;
    },
    set page(value: typeof page) {
      page = value;
    },
    get tableOpen() {
      return tableOpen;
    },
    set tableOpen(value: typeof tableOpen) {
      tableOpen = value;
    },
    get tableDisplayCell() {
      return tableDisplayCell;
    },
    set tableDisplayCell(value: typeof tableDisplayCell) {
      tableDisplayCell = value;
    },
    get tableColumnOffset() {
      return tableColumnOffset;
    },
    set tableColumnOffset(value: typeof tableColumnOffset) {
      tableColumnOffset = value;
      storedLeft = value * TABLE_COLUMN_WIDTH;
    },
    get tableSource() {
      return tableSource;
    },
    set tableSource(value: typeof tableSource) {
      tableSource = value;
    },
    get tableRespectFilters() {
      return tableRespectFilters;
    },
    set tableRespectFilters(value: typeof tableRespectFilters) {
      tableRespectFilters = value;
    },
    get tableSort() {
      return tableSort;
    },
    set tableSort(value: typeof tableSort) {
      tableSort = value;
    },
    get tableDescending() {
      return tableDescending;
    },
    set tableDescending(value: typeof tableDescending) {
      tableDescending = value;
    },
    get tableTotal() {
      return tableTotal;
    },
    set tableTotal(value: typeof tableTotal) {
      tableTotal = value;
    },
    get tableSerial() {
      return tableSerial;
    },
    set tableSerial(value: typeof tableSerial) {
      tableSerial = value;
    },
    get tableReveal() {
      return tableReveal;
    },
    set tableReveal(value: typeof tableReveal) {
      tableReveal = value;
    },
    get tableSearch() {
      return tableSearch;
    },
    get tableScopeKey() {
      return tableScopeKey;
    },
    set tableScopeKey(value: typeof tableScopeKey) {
      tableScopeKey = value;
    },
  };
}
export type AttributeTables = ReturnType<typeof createAttributeTables>;
