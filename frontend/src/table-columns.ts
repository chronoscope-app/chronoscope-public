import { tableMarkup } from "./table-dom.ts";
// Unknown fields use a compact estimate; measured and user widths retain the
// full horizontal range while network/DOM projection stays bounded.
export const TABLE_COLUMN_WIDTH = 100;
export const TABLE_COLUMN_WINDOW = 32;
type Geometry = {
  widths: number[];
  fit: number[];
  offset: number;
  count: number;
  total: number;
  bound?: boolean;
};
const states = new WeakMap<HTMLElement, Geometry>();
function state(host: HTMLElement) {
  let value = states.get(host);
  if (!value) {
    value = { widths: [], fit: [], offset: 0, count: 0, total: 0 };
    states.set(host, value);
  }
  return value;
}
export function captureColumnWidths(host: HTMLElement) {
  return [...state(host).widths];
}
export function restoreColumnWidths(host: HTMLElement, widths: number[] = []) {
  state(host).widths = widths.map((w) =>
    Number.isFinite(w) ? Math.max(56, Math.min(1200, w)) : 0,
  );
}
export function columnPixelOffset(host: HTMLElement, index: number) {
  const widths = state(host).widths;
  let pixels = 0;
  for (let i = 0; i < index; i++) pixels += widths[i] || TABLE_COLUMN_WIDTH;
  return pixels;
}
export function fitColumnWidths(
  host: HTMLElement,
  offset: number,
  headers: string[],
  rows: unknown[][],
) {
  const geometry = state(host);
  const context = document.createElement("canvas").getContext("2d");
  if (context)
    context.font =
      getComputedStyle(host.querySelector("table") || host).font ||
      "12px sans-serif";
  headers.forEach((header, i) => {
    const measure = (value: unknown) =>
      context?.measureText(String(value ?? "").slice(0, 256)).width ??
      String(value ?? "").length * 7;
    const width = Math.max(
      56,
      Math.min(
        300,
        Math.ceil(
          Math.max(
            measure(header) + 36,
            ...rows.map((row) => measure(row[i]) + 20),
          ),
        ),
      ),
    );
    geometry.fit[offset + i] = width;
    if (!geometry.widths[offset + i]) geometry.widths[offset + i] = width;
  });
}
export function columnWindowOffset(
  left: number,
  width: number,
  total: number,
  current: number,
  host?: HTMLElement,
) {
  const widths = host ? state(host).widths : [];
  let first = 0,
    x = 0;
  while (first < total && x + (widths[first] || TABLE_COLUMN_WIDTH) <= left)
    x += widths[first++] || TABLE_COLUMN_WIDTH;
  let last = first,
    end = x;
  while (last < total && end < left + width)
    end += widths[last++] || TABLE_COLUMN_WIDTH;
  const max = Math.max(0, total - TABLE_COLUMN_WINDOW);
  if (
    first >= current &&
    (current === max || last + 4 <= current + TABLE_COLUMN_WINDOW)
  )
    return current;
  return Math.min(max, Math.max(0, Math.floor((first - 4) / 16) * 16));
}
export function columnWindow(
  host: HTMLElement,
  offset: number,
  count: number,
  total: number,
) {
  const geometry = state(host);
  Object.assign(geometry, { offset, count, total });
  const left = columnPixelOffset(host, offset);
  const right =
    columnPixelOffset(host, total) - columnPixelOffset(host, offset + count);
  const table = host.querySelector<HTMLTableElement>("table")!;
  table.style.width = `${columnPixelOffset(host, Math.max(1, total))}px`;
  table.setAttribute("aria-colcount", String(total));
  tableMarkup(
    host.querySelector("colgroup")!,
    (left ? `<col style="width:${left}px">` : "") +
      Array.from(
        { length: count },
        (_, i) =>
          `<col style="width:${geometry.widths[offset + i] || TABLE_COLUMN_WIDTH}px">`,
      ).join("") +
      (right ? `<col style="width:${right}px">` : ""),
  );
  const resize = (index: number, width: number) => {
    geometry.widths[index] = Math.max(56, Math.min(1200, width));
    columnWindow(host, geometry.offset, geometry.count, geometry.total);
    host.dispatchEvent(new Event("table-column-resize"));
  };
  if (!geometry.bound) {
    geometry.bound = true;
    host.addEventListener("pointerdown", (event) => {
      const handle = (event.target as Element).closest<HTMLElement>(
        "[data-column-resize]",
      );
      if (!handle || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = Number(handle.dataset.columnResize),
        start = event.clientX,
        width = geometry.widths[index] || TABLE_COLUMN_WIDTH;
      const events = new AbortController();
      window.addEventListener(
        "pointermove",
        (e) => resize(index, width + e.clientX - start),
        { signal: events.signal },
      );
      window.addEventListener("pointerup", () => events.abort(), {
        once: true,
        signal: events.signal,
      });
      window.addEventListener("blur", () => events.abort(), {
        once: true,
        signal: events.signal,
      });
      window.addEventListener("pointercancel", () => events.abort(), {
        once: true,
        signal: events.signal,
      });
    });
    host.addEventListener("dblclick", (event) => {
      const handle = (event.target as Element).closest<HTMLElement>(
        "[data-column-resize]",
      );
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      const index = Number(handle.dataset.columnResize);
      resize(index, geometry.fit[index] || TABLE_COLUMN_WIDTH);
    });
    host.addEventListener("keydown", (event) => {
      const handle = (event.target as Element).closest<HTMLElement>(
        "[data-column-resize]",
      );
      if (!handle || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const index = Number(handle.dataset.columnResize);
      resize(
        index,
        (geometry.widths[index] || TABLE_COLUMN_WIDTH) +
          (event.key === "ArrowLeft" ? -10 : 10),
      );
    });
  }
  const spacer = (tag: "th" | "td", pixels: number) =>
    pixels
      ? `<${tag} class="table-column-spacer" aria-hidden="true" style="width:${pixels}px"></${tag}>`
      : "";
  return {
    before: (tag: "th" | "td") => spacer(tag, left),
    after: (tag: "th" | "td") => spacer(tag, right),
    span: count + Number(left > 0) + Number(right > 0),
  };
}
export const columnResizeHandle = (index: number) =>
  `<span class="column-resize" data-column-resize="${index}" role="separator" aria-orientation="vertical" aria-label="Resize column; double-click to fit" tabindex="0" title="Drag to resize · double-click to fit · arrow keys adjust"></span>`;
