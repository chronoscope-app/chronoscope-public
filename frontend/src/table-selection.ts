import { call } from "./bridge";
import type { EngineContracts } from "./contracts";

type Query = EngineContracts["query"]["args"];
type Scope = Pick<
  Query,
  "source" | "apply_filter" | "display_cell" | "sort_by" | "descending"
>;
interface Host {
  scope: () => Scope;
  workspace: () => string;
  rowHeight: () => number;
  reveal: (id: string) => void;
  refresh: () => Promise<void>;
  error: (error: unknown) => void;
}

export function tableTargetRank(
  key: string,
  current: number,
  count: number,
  page: number,
  jump: boolean,
) {
  let next = current;
  if (key === "Home" || (jump && key === "ArrowUp")) next = 0;
  else if (key === "End" || (jump && key === "ArrowDown")) next = count - 1;
  else
    next +=
      key === "ArrowDown"
        ? 1
        : key === "ArrowUp"
          ? -1
          : (key === "PageDown" ? 1 : -1) * Math.max(1, page);
  return Math.max(0, Math.min(count - 1, next));
}

/** Serialized table gestures share an anchor across pages and retain exact IDs. */
export class TableSelection {
  anchor: string | null = null;
  activeId: string | null = null;
  work: Promise<void> = Promise.resolve();
  constructor(private host: Host) {}
  bind(body: HTMLElement, scroll: HTMLElement, head: HTMLElement) {
    body.addEventListener("click", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[data-event]");
      if (!row) return;
      e.preventDefault();
      const id = row.dataset.event!,
        additive = e.ctrlKey || e.metaKey;
      this.activeId = id;
      row.focus({ preventScroll: true });
      const anchor = this.anchor,
        scope = this.host.scope(),
        workspace = this.host.workspace();
      if (!e.shiftKey || !anchor) this.anchor = id;
      const range =
        e.shiftKey && anchor
          ? {
              source: scope.source,
              apply_filter: scope.apply_filter,
              display_cell: scope.display_cell,
              table_range: {
                anchor,
                target: id,
                sort_by: scope.sort_by,
                descending: scope.descending,
              },
              mode: additive ? ("add" as const) : ("replace" as const),
              expected_workspace: workspace,
            }
          : null;
      this.work = this.work
        .then(async () => {
          if (range) await call("select_query", range);
          else
            await call("select", {
              ids: [id],
              mode: additive ? "toggle" : "replace",
              expected_workspace: workspace,
            });
          await this.host.refresh();
        })
        .catch(this.host.error);
    });
    body.addEventListener("keydown", (event) => {
      if (
        !["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(
          event.key,
        )
      )
        return;
      const row = (event.target as Element).closest<HTMLElement>(
        "[data-event]",
      );
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const key = event.key,
        extend = event.shiftKey,
        jump = event.ctrlKey || event.metaKey;
      const scope = this.host.scope(),
        workspace = this.host.workspace();
      this.activeId ??= row.dataset.event!;
      this.work = this.work
        .then(async () => {
          const currentId = this.activeId;
          if (!currentId) return;
          const current = await call("query", {
            ...scope,
            reveal_id: currentId,
            limit: 1,
            fields: ["id"],
          });
          if (!current.reveal_found || !current.count) return;
          const rank = tableTargetRank(
            key,
            current.offset,
            current.count,
            Math.floor(
              (scroll.clientHeight - head.clientHeight) / this.host.rowHeight(),
            ),
            jump,
          );
          const next = await call("query", {
            ...scope,
            offset: rank,
            limit: 1,
            fields: ["id"],
          });
          const id = next.events[0]?.id as string | undefined;
          if (!id) return;
          const anchor = this.anchor || currentId;
          if (extend)
            await call("select_query", {
              source: scope.source,
              apply_filter: scope.apply_filter,
              display_cell: scope.display_cell,
              table_range: {
                anchor,
                target: id,
                sort_by: scope.sort_by,
                descending: scope.descending,
              },
              mode: "replace",
              expected_workspace: workspace,
            });
          else
            await call("select", {
              ids: [id],
              mode: "replace",
              expected_workspace: workspace,
            });
          this.anchor = extend ? anchor : id;
          this.activeId = id;
          this.host.reveal(id);
          await this.host.refresh();
          const active = [
            ...body.querySelectorAll<HTMLElement>("[data-event]"),
          ].find((r) => r.dataset.event === id);
          active?.focus({ preventScroll: true });
          active?.scrollIntoView({ block: "nearest" });
        })
        .catch(this.host.error);
    });
  }
}
