// Fixed column geometry makes the complete horizontal range reachable while
// keeping both the network projection and DOM bounded to one visible window.
export const TABLE_COLUMN_WIDTH = 200;
export const TABLE_COLUMN_WINDOW = 32;
export function columnWindowOffset(
  left: number,
  width: number,
  total: number,
  current: number,
) {
  const first = Math.floor(left / TABLE_COLUMN_WIDTH);
  const visible = Math.ceil(width / TABLE_COLUMN_WIDTH);
  const max = Math.max(0, total - TABLE_COLUMN_WINDOW);
  if (
    first >= current &&
    (current === max || first + visible + 4 <= current + TABLE_COLUMN_WINDOW)
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
  const left = offset * TABLE_COLUMN_WIDTH;
  const right = Math.max(0, total - offset - count) * TABLE_COLUMN_WIDTH;
  const table = host.querySelector<HTMLTableElement>("table")!;
  table.style.width = `${Math.max(1, total) * TABLE_COLUMN_WIDTH}px`;
  table.setAttribute("aria-colcount", String(total));
  host.querySelector("colgroup")!.innerHTML =
    (left ? `<col style="width:${left}px">` : "") +
    `<col style="width:${TABLE_COLUMN_WIDTH}px">`.repeat(count) +
    (right ? `<col style="width:${right}px">` : "");
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
