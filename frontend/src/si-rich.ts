import { call } from "./bridge";
import type { EngineContracts } from "./contracts";
import { openAnalytics } from "./analytics";
import { createResultChart } from "./si-chart";
export interface RichHooks {
  after: () => Promise<void>;
  error: (e: unknown) => void;
}
const text = (tag: string, value: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
};
const format = (value: any) =>
  value == null
    ? "—"
    : typeof value === "number"
      ? new Intl.NumberFormat(undefined, {
          maximumSignificantDigits: 7,
        }).format(value)
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
export async function renderRichBlock(
  block: any,
  hooks: RichHooks,
): Promise<{ node: HTMLElement; dispose: () => void }> {
  const card = document.createElement("section");
  card.className = "si-result-card";
  let dispose = () => {};
  if (block.type === "image") {
    card.append(text("h4", block.title || "Map snapshot"));
    const image = await call("si_chat_image", { image_id: block.image_id });
    if (!image.data_url.startsWith("data:image/png;base64,"))
      throw Error("Unsupported image type");
    const picture = document.createElement("img");
    picture.src = image.data_url;
    picture.alt = block.title || "Captured Chronoscope map view";
    picture.loading = "lazy";
    picture.className = "si-map-picture";
    card.append(
      picture,
      text(
        "small",
        `${block.project_name || "Workspace"} · ${block.captured_utc || "Captured view"} · revision ${block.source_revision}`,
      ),
    );
  } else if (block.type === "evidence") {
    card.append(text("h4", block.title || "Tool evidence"));
    const summary = document.createElement("dl");
    summary.className = "si-result-facts";
    for (const [key, value] of Object.entries(block.summary || {})
      .filter(([, v]) => v != null && typeof v !== "object")
      .slice(0, 12)) {
      const pair = document.createElement("div");
      pair.append(
        text("dt", key.replaceAll("_", " ")),
        text("dd", format(value)),
      );
      summary.append(pair);
    }
    card.append(summary);
    if (block.rows?.length) {
      const scroll = document.createElement("div");
      scroll.className = "si-rich-table";
      const table = document.createElement("table"),
        head = document.createElement("thead"),
        body = document.createElement("tbody"),
        tr = document.createElement("tr");
      const keys = [
        ...new Set<string>(block.rows.flatMap((r: any) => Object.keys(r))),
      ].slice(0, 12);
      for (const key of keys) tr.append(text("th", key.replaceAll("_", " ")));
      head.append(tr);
      for (const row of block.rows) {
        const tr = document.createElement("tr");
        for (const key of keys) tr.append(text("td", format(row[key])));
        body.append(tr);
      }
      table.append(head, body);
      scroll.append(table);
      card.append(scroll);
    }
    card.append(text("small", block.note || "Read-only tool preview"));
  } else if (block.type === "analysis") {
    const result = await call("analytics_result", {
      result_id: block.result_id,
      section: "details",
    });
    card.append(
      text("h4", block.title || result.capability.replaceAll("_", " ")),
    );
    card.append(
      text(
        "p",
        `${result.input_count.toLocaleString()} input Events · ${result.evaluated_count.toLocaleString()} evaluated · ${result.excluded_count.toLocaleString()} excluded${result.prepared_count !== result.input_count ? ` · ${result.prepared_count?.toLocaleString()} prepared rows` : ""}`,
      ),
    );
    if (result.data_stale)
      card.append(
        text(
          "p",
          "Source data has changed. These findings describe an earlier data version.",
        ),
      );
    const facts = document.createElement("dl");
    facts.className = "si-result-facts";
    for (const [key, value] of Object.entries(result.summary)
      .filter(([, v]) => v == null || typeof v !== "object")
      .slice(0, 10)) {
      const item = document.createElement("div");
      item.append(
        text("dt", key.replaceAll("_", " ")),
        text("dd", format(value)),
      );
      facts.append(item);
    }
    card.append(facts);
    for (const warning of result.warnings || [])
      card.append(text("p", warning));
    const requested = block.chart || "auto",
      metadata = result.chart || {};
    const kind = requested === "auto" ? metadata.type : requested;
    const x = block.x || metadata.x,
      y = block.y || metadata.y;
    const fieldLabel = (key: string) =>
      key.startsWith("group_")
        ? String(
            result.summary.group_fields?.[Number(key.slice(6))] || key,
          ).replaceAll("_", " ")
        : key.replaceAll("_", " ");
    const wantsChart =
      ["bar", "line", "scatter"].includes(kind) &&
      typeof x === "string" &&
      typeof y === "string";
    let rows: any[] = [],
      next: number | null = 0;
    do {
      const page: EngineContracts["analytics_result"]["result"] = await call(
        "analytics_result",
        {
          result_id: block.result_id,
          section: "rows",
          offset: next,
          limit: 200,
        },
      );
      rows.push(...(page.rows || []));
      next = page.next_offset;
    } while (wantsChart && next != null && rows.length < 2000);
    const select = async (row: any) => {
      if (typeof row.event_id !== "string") return;
      const observed = await call("revision");
      const fresh = await call("analytics_result", {
        result_id: block.result_id,
      });
      if (fresh.data_stale)
        throw Error(
          "Source data changed; rerun this analysis before selecting Events",
        );
      await call("select", {
        ids: [row.event_id],
        mode: "replace",
        expected_revision: observed.revision,
      });
      await hooks.after();
    };
    if (wantsChart && rows.some((r) => typeof r[y] === "number")) {
      const host = document.createElement("div");
      host.className = "si-result-chart";
      host.setAttribute("role", "img");
      host.setAttribute("aria-label", `${kind} chart: ${y} by ${x}`);
      card.append(host);
      // Defer initialization until the card has been inserted and measured.
      let cancelled = false,
        cleanup = () => {};
      requestAnimationFrame(() => {
        if (!cancelled && host.isConnected)
          cleanup = createResultChart(
            host,
            rows,
            kind,
            x,
            y,
            (row) => void select(row).catch(hooks.error),
          );
      });
      dispose = () => {
        cancelled = true;
        cleanup();
      };
      card.append(
        text(
          "small",
          `${fieldLabel(y)} by ${fieldLabel(x)} · chart shows ${rows.length.toLocaleString()} of ${result.retained_rows.toLocaleString()} retained output rows; computation covers the input counts above.`,
        ),
      );
    }
    if (rows.length) {
      const details = document.createElement("details");
      details.open = !wantsChart;
      details.append(
        text(
          "summary",
          `Result table · first ${Math.min(rows.length, 50)} rows`,
        ),
      );
      const scroll = document.createElement("div");
      scroll.className = "si-rich-table";
      const table = document.createElement("table"),
        head = document.createElement("thead"),
        body = document.createElement("tbody"),
        tr = document.createElement("tr");
      const keys = [
        ...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r))),
      ].slice(0, 12);
      for (const key of keys) tr.append(text("th", fieldLabel(key)));
      head.append(tr);
      for (const row of rows.slice(0, 50)) {
        const tr = document.createElement("tr");
        for (const key of keys) {
          const td = text("td", format(row[key]));
          td.title = String(row[key] ?? "");
          tr.append(td);
        }
        if (typeof row.event_id === "string" && !result.data_stale) {
          tr.tabIndex = 0;
          tr.title = "Select this Event in the workspace";
          const choose = () =>
            void select(row)
              .then(() => {
                for (const other of body.rows) {
                  other.classList.remove("selected");
                  other.setAttribute("aria-selected", "false");
                }
                tr.classList.add("selected");
                tr.setAttribute("aria-selected", "true");
              })
              .catch(hooks.error);
          tr.onclick = choose;
          tr.onkeydown = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              choose();
            }
          };
        }
        body.append(tr);
      }
      table.append(head, body);
      scroll.append(table);
      details.append(scroll);
      card.append(details);
    }
    if (result.limited)
      card.append(
        text(
          "p",
          `${result.retained_rows.toLocaleString()} of ${result.total_rows?.toLocaleString()} output rows retained. Input was not silently sampled.`,
        ),
      );
    const open = text("button", "Open analysis result") as HTMLButtonElement;
    open.onclick = () =>
      void openAnalytics(hooks.after, hooks.error, block.result_id).catch(
        hooks.error,
      );
    card.append(open);
    const provenance = document.createElement("details");
    provenance.append(text("summary", "Method and provenance"));
    let loaded = false;
    provenance.addEventListener("toggle", () => {
      if (provenance.open && !loaded) {
        loaded = true;
        void call("analytics_result", {
          result_id: block.result_id,
          section: "provenance",
        })
          .then((p) =>
            provenance.append(
              text(
                "pre",
                JSON.stringify(
                  {
                    summary: result.summary,
                    scope: p.scope,
                    parameters: p.parameters,
                    prepare: p.prepare,
                    source_revision: p.source_revision,
                  },
                  null,
                  2,
                ),
              ),
            ),
          )
          .catch(hooks.error);
      }
    });
    card.append(provenance);
  } else throw Error("Unsupported presentation block");
  return { node: card, dispose };
}
