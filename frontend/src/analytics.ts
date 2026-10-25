import { explainResult } from "./focused-ai";
import { call } from "./bridge";

/** Persistent derived evidence, rendered as ordinary app controls. */
export async function openAnalytics(
  after: () => Promise<void>,
  error: (e: unknown) => void,
  initial?: string,
  create?: () => Promise<void>,
) {
  document.querySelector("#analytics-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "analytics-dialog";
  dialog.className = "analytics-dialog";
  const header = document.createElement("header"),
    title = document.createElement("h2"),
    close = document.createElement("button");
  title.textContent = "Analysis results";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close analysis results");
  close.onclick = () => dialog.close();
  const actions = document.createElement("div");
  actions.className = "row";
  if (create) {
    const add = document.createElement("button");
    add.textContent = "New analysis";
    add.className = "primary";
    add.onclick = () => {
      dialog.close();
      void create().catch(error);
    };
    actions.append(add);
  }
  actions.append(close);
  header.append(title, actions);
  const layout = document.createElement("div"),
    list = document.createElement("nav"),
    content = document.createElement("section");
  layout.className = "analytics-layout";
  list.setAttribute("aria-label", "Saved analyses");
  layout.append(list, content);
  dialog.append(header, layout);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  const text = (tag: string, value: string) => {
    const e = document.createElement(tag);
    e.textContent = value;
    return e;
  };
  const all = await call("analytics_list");
  if (!all.results.length)
    content.append(
      text(
        "p",
        "Choose New analysis to profile data, find duplicates or outliers, or summarize trajectories. Analyses run locally and are included when you save the project.",
      ),
    );
  let request = 0;
  const show = async (id: string, offset = 0) => {
    const current = ++request;
    content.replaceChildren(text("p", "Loading analysis…"));
    const [details, rawPage] = await Promise.all([
      call("analytics_result", { result_id: id, section: "details" }),
      call("analytics_result", {
        result_id: id,
        section: "rows",
        offset,
        limit: 100,
      }),
    ]);
    if (!dialog.isConnected || current !== request) return;
    const page = {
      ...rawPage,
      rows: rawPage.rows || [],
      next_offset: rawPage.next_offset,
    };
    for (const button of list.querySelectorAll("button"))
      button.setAttribute(
        "aria-current",
        String(button.dataset.resultId === id),
      );
    content.replaceChildren(
      text("h3", details.capability.replaceAll("_", " ")),
    );
    content.append(
      text(
        "p",
        `${details.input_count.toLocaleString()} input Events · ${(details.prepared_count ?? details.input_count).toLocaleString()} prepared rows · ${details.evaluated_count.toLocaleString()} evaluated · ${details.excluded_count.toLocaleString()} excluded`,
      ),
    );
    if (details.data_stale)
      content.append(
        text(
          "p",
          "Source data has changed. These results describe the earlier dataset version.",
        ),
      );
    if (details.limited)
      content.append(
        text(
          "p",
          `${details.retained_rows.toLocaleString()} of ${(details.total_rows ?? 0).toLocaleString()} output rows retained. The calculation used the declared full input scope.`,
        ),
      );
    for (const warning of details.warnings || [])
      content.append(text("p", warning));
    const format = (v: unknown): string =>
      typeof v === "number"
        ? new Intl.NumberFormat(undefined, {
            maximumSignificantDigits: 7,
          }).format(v)
        : v == null
          ? "—"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
    const label = (key: string) =>
      key.replaceAll("_", " ").replace(/\butc\b/gi, "UTC");
    const explain = text("button", "Explain result") as HTMLButtonElement;
    explain.className = "secondary";
    explain.onclick = () => void explainResult({ result_id: id });
    content.append(explain);
    const findings = document.createElement("dl");
    findings.className = "analytics-findings";
    for (const [key, value] of Object.entries(details.summary))
      if (value === null || typeof value !== "object") {
        const pair = document.createElement("div");
        pair.append(text("dt", label(key)), text("dd", format(value)));
        findings.append(pair);
      }
    content.append(findings);
    const summary = document.createElement("details");
    summary.append(
      text("summary", "Full method details"),
      text("pre", JSON.stringify(details.summary, null, 2)),
    );
    content.append(summary);
    const chart = details.chart;
    if (chart?.x && chart?.y && page.rows.length) {
      const data = page.rows
        .filter((r: any) => typeof r[chart.y] === "number")
        .slice(0, 50);
      if (data.length) {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", "0 0 680 180");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "Chart of the displayed result page");
        const values = data.map((r: any) => r[chart.y]);
        const low = Math.min(0, ...values),
          high = Math.max(0, ...values);
        const span = high - low || 1;
        data.forEach((r: any, j: number) => {
          const bar = document.createElementNS(svg.namespaceURI, "rect");
          const y = 155 - ((r[chart.y] - low) / span) * 140;
          const zero = 155 - ((0 - low) / span) * 140;
          bar.setAttribute("x", String((j * 660) / data.length + 10));
          bar.setAttribute("y", String(Math.min(zero, y)));
          bar.setAttribute("width", String(Math.max(1, 660 / data.length - 3)));
          bar.setAttribute("height", String(Math.max(1, Math.abs(zero - y))));
          bar.setAttribute("fill", "currentColor");
          const tip = document.createElementNS(svg.namespaceURI, "title");
          tip.textContent = `${r[chart.x]}: ${r[chart.y]}`;
          bar.append(tip);
          svg.append(bar);
          if (data.length <= 12) {
            const tick = document.createElementNS(svg.namespaceURI, "text");
            tick.setAttribute(
              "x",
              String(((j + 0.5) * 660) / data.length + 10),
            );
            tick.setAttribute("y", "175");
            tick.setAttribute("text-anchor", "middle");
            tick.textContent = String(r[chart.x]);
            svg.append(tick);
          }
        });
        content.append(
          svg,
          text(
            "small",
            `Chart: ${label(chart.y)} by ${label(chart.x.startsWith("group_") ? details.summary.group_fields?.[Number(chart.x.slice(6))] || chart.x : chart.x)}; first ${data.length} rows of this page.`,
          ),
        );
      }
    }
    const scroll = document.createElement("div"),
      table = document.createElement("table"),
      head = document.createElement("thead"),
      body = document.createElement("tbody");
    scroll.className = "analytics-table";
    const keys: string[] = [
      ...new Set(page.rows.flatMap((r: any) => Object.keys(r))),
    ];
    keys.sort(
      (a, b) =>
        (a.startsWith("group_")
          ? 0
          : a === "event_id" || a === "example_event_id"
            ? 2
            : 1) -
        (b.startsWith("group_")
          ? 0
          : b === "event_id" || b === "example_event_id"
            ? 2
            : 1),
    );
    const hr = document.createElement("tr");
    for (const key of keys)
      hr.append(
        text(
          "th",
          key.startsWith("group_")
            ? label(details.summary.group_fields?.[Number(key.slice(6))] || key)
            : label(key),
        ),
      );
    head.append(hr);
    for (const row of page.rows) {
      const tr = document.createElement("tr");
      for (const key of keys) {
        const isYear =
          key.startsWith("group_") &&
          details.summary.group_fields?.[Number(key.slice(6))] === "year_utc";
        const td = text("td", isYear ? String(row[key]) : format(row[key]));
        td.title = String(row[key] ?? "");
        tr.append(td);
      }
      const linkedId =
        typeof row.event_id === "string" ? row.event_id : row.example_event_id;
      if (typeof linkedId === "string" && !details.data_stale) {
        tr.tabIndex = 0;
        tr.title = row.event_id
          ? "Select this Event on the map and in its attribute table"
          : "Select one example Event from this group";
        const select = async (add: boolean) => {
          const observed = await call("revision");
          const fresh = await call("analytics_result", { result_id: id });
          if (fresh.data_stale)
            throw Error(
              "Source data changed; rerun this analysis before selecting Events",
            );
          await call("select", {
            ids: [linkedId],
            mode: add ? "toggle" : "replace",
            expected_revision: observed.revision,
          });
          if (!add)
            for (const other of body.rows) other.classList.remove("selected");
          tr.classList.toggle("selected");
          await after();
        };
        tr.onclick = (e) => void select(e.ctrlKey || e.metaKey).catch(error);
        tr.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void select(e.ctrlKey || e.metaKey).catch(error);
          }
        };
      }
      body.append(tr);
    }
    table.append(head, body);
    scroll.append(table);
    content.append(scroll);
    const nav = document.createElement("div");
    nav.className = "row";
    const prev = text("button", "Previous") as HTMLButtonElement,
      next = text("button", "Next") as HTMLButtonElement;
    prev.disabled = offset === 0;
    next.disabled = page.next_offset == null;
    prev.onclick = () => void show(id, Math.max(0, offset - 100)).catch(error);
    next.onclick = () => void show(id, page.next_offset).catch(error);
    const remove = text("button", "Remove result") as HTMLButtonElement;
    remove.title = "Delete this derived result; source Events are retained";
    remove.onclick = () => {
      remove.disabled = true;
      void call("analytics_remove", { result_id: id })
        .then(async () => {
          dialog.close();
          await after();
          await openAnalytics(after, error, undefined, create);
        })
        .catch((e) => {
          remove.disabled = false;
          error(e);
        });
    };
    nav.append(
      prev,
      text(
        "small",
        `${offset + (page.rows.length ? 1 : 0)}–${offset + page.rows.length} of ${details.retained_rows}`,
      ),
      next,
      remove,
    );
    content.append(nav);
    const provenance = document.createElement("details");
    provenance.append(text("summary", "Scope and provenance"));
    provenance.addEventListener("toggle", () => {
      if (provenance.open && provenance.children.length === 1)
        void call("analytics_result", { result_id: id, section: "provenance" })
          .then((v) =>
            provenance.append(
              text(
                "pre",
                JSON.stringify(
                  {
                    source_revision: v.source_revision,
                    scope: v.scope,
                    parameters: v.parameters,
                    prepare: v.prepare,
                  },
                  null,
                  2,
                ),
              ),
            ),
          )
          .catch(error);
    });
    content.append(provenance);
  };
  for (const result of all.results) {
    const b = text(
      "button",
      `${result.capability.replaceAll("_", " ")}${result.data_stale ? " · earlier data" : ""}`,
    );
    b.dataset.resultId = result.result_id;
    b.title = `Created ${result.created_utc} · ${result.result_id.slice(0, 8)}`;
    b.onclick = () => void show(result.result_id).catch(error);
    list.append(b);
  }
  if (initial || all.results.length)
    await show(initial || all.results[all.results.length - 1].result_id);
}
