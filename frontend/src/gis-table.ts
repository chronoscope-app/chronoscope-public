import { columnWindow, TABLE_COLUMN_WINDOW } from "./table-columns";
import { call } from "./bridge";
import type { GisLayer, GisFeature } from "./gis";
const esc = (s: unknown) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
/** Shares the desktop's continuous table surface without coercing timeless GIS rows into Events. */
export class GisTable {
  layerId: string | null = null;
  sort = "id";
  descending = false;
  search = "";
  private anchor: number | null = null;
  private request = 0;
  private rows: GisFeature[] = [];
  private offset = 0;
  private selected = new Set<string>();
  private activeId: string | null = null;
  onChange: () => Promise<void> = async () => {};
  onError: (error: unknown) => void = () => {};
  onSort: () => void = () => {};
  constructor(
    private head: HTMLElement,
    private body: HTMLElement,
    private rowHeight: () => number,
  ) {
    head.addEventListener("click", (event) => {
      const field = (event.target as Element).closest<HTMLElement>(
        "[data-gis-sort]",
      )?.dataset.gisSort;
      if (field === undefined || !this.layerId) return;
      this.descending = this.sort === field ? !this.descending : false;
      this.sort = field;
      this.anchor = null;
      this.onSort();
    });
    body.addEventListener("click", (event) => {
      const id = (event.target as Element).closest<HTMLElement>(
        "[data-gis-row]",
      )?.dataset.gisRow;
      if (id !== undefined && this.layerId) {
        event.preventDefault();
        void this.select(
          id,
          event.shiftKey,
          event.ctrlKey || event.metaKey,
        ).catch(this.onError);
      }
    });
    body.addEventListener("keydown", (event) => {
      const row = (event.target as Element).closest<HTMLElement>(
        "[data-gis-row]",
      );
      if (!row || !this.layerId) return;
      const index = this.rows.findIndex((r) => r.id === row.dataset.gisRow);
      if (["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const next =
          this.rows[
            Math.max(
              0,
              Math.min(
                this.rows.length - 1,
                index + (event.key === "ArrowUp" ? -1 : 1),
              ),
            )
          ];
        if (next)
          void this.select(
            next.id,
            event.shiftKey,
            event.ctrlKey || event.metaKey,
          ).catch(this.onError);
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        void this.select(
          row.dataset.gisRow!,
          event.shiftKey,
          event.ctrlKey || event.metaKey,
        ).catch(this.onError);
      }
    });
  }
  open(id: string) {
    this.layerId = id;
    this.sort = "id";
    this.search = "";
    this.descending = false;
    this.anchor = null;
    this.activeId = null;
  }
  close() {
    this.layerId = null;
    this.request++;
  }
  capture() {
    return {
      layerId: this.layerId,
      sort: this.sort,
      descending: this.descending,
      search: this.search,
      anchor: this.anchor,
      activeId: this.activeId,
    };
  }
  restore(state: ReturnType<GisTable["capture"]>) {
    this.request++;
    this.rows = [];
    this.selected.clear();
    this.layerId = state.layerId;
    this.sort = state.sort;
    this.descending = state.descending;
    this.search = state.search;
    this.anchor = state.anchor;
    this.activeId = state.activeId;
  }
  private args() {
    return {
      id: this.layerId!,
      sort: this.sort,
      descending: this.descending,
      search: this.search,
    };
  }
  async render(layer: GisLayer, offset: number, columnOffset: number) {
    const request = ++this.request;
    const r = await call("gis_table", {
      ...this.args(),
      offset,
      limit: 50,
      column_offset: columnOffset,
      column_limit: TABLE_COLUMN_WINDOW,
    });
    if (request !== this.request || layer.id !== this.layerId) return null;
    this.rows = r.rows;
    this.offset = offset;
    this.selected = new Set(layer.selected);
    const columns = r.columns;
    const window = columnWindow(
      this.head.closest<HTMLElement>(".table-panel")!,
      columnOffset,
      columns.length,
      r.total_columns,
    );
    this.head.innerHTML = `<tr>${window.before("th")}${columns.map((c, i) => `<th aria-colindex="${columnOffset + i + 1}"><button data-gis-sort="${esc(c)}" title="${esc(c)}">${esc(c)}${this.sort === c ? (this.descending ? " ↓" : " ↑") : ""}</button></th>`).join("")}${window.after("th")}</tr>`;
    const spacer = (n: number) =>
      n
        ? `<tr class="table-spacer" aria-hidden="true"><td colspan="${window.span}" style="height:${n * this.rowHeight()}px"></td></tr>`
        : "";
    const value = (row: GisFeature, c: string) =>
      ["id", "entity", "time", "end"].includes(c)
        ? (row as any)[c]
        : row.properties[c];
    const focus = !!document.activeElement?.closest("[data-gis-row]");
    this.body.innerHTML =
      spacer(offset) +
      (r.rows
        .map(
          (row, i) =>
            `<tr data-gis-row="${esc(row.id)}" tabindex="${row.id === this.activeId || (!this.activeId && i === 0) ? 0 : -1}" aria-rowindex="${offset + i + 2}" aria-selected="${this.selected.has(row.id)}" class="${this.selected.has(row.id) ? "selected" : ""}">${window.before("td")}${columns.map((c, i) => `<td aria-colindex="${columnOffset + i + 1}" title="${esc(value(row, c))}">${esc(value(row, c))}</td>`).join("")}${window.after("td")}</tr>`,
        )
        .join("") ||
        `<tr><td colspan="${window.span}">No reference features in this scope.</td></tr>`) +
      spacer(Math.max(0, r.count - offset - r.rows.length));
    if (focus && this.activeId)
      Array.from(this.body.querySelectorAll<HTMLElement>("[data-gis-row]"))
        .find((r) => r.dataset.gisRow === this.activeId)
        ?.focus({ preventScroll: true });
    return r;
  }
  private async select(id: string, range: boolean, additive: boolean) {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index < 0 || !this.layerId) return;
    const position = this.offset + index,
      next = additive ? new Set(this.selected) : new Set<string>();
    if (range && this.anchor !== null) {
      const offset = Math.min(this.anchor, position),
        limit = Math.abs(this.anchor - position) + 1;
      if (limit > 1000)
        throw Error(
          "Reference selection supports 1,000 features. Import as Events for larger selections and analysis.",
        );
      const rows = await call("gis_table", {
        ...this.args(),
        offset,
        limit,
        column_offset: 0,
        column_limit: 1,
      });
      rows.rows.forEach((row) => next.add(row.id));
    } else {
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      this.anchor = position;
    }
    if (next.size > 1000)
      throw Error(
        "Reference selection supports 1,000 features. Import as Events for larger selections.",
      );
    this.activeId = id;
    this.selected = next;
    await call("gis_set", { id: this.layerId, selected: [...next] });
    await this.onChange();
  }
}
