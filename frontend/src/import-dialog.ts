import { call, chooseFile } from "./bridge";
import { runJob } from "./operation-job";
import type { EngineContracts } from "./contracts";
import { escape as esc, time } from "./types";
import "./workflow-dialogs.css";

type Mapping = NonNullable<EngineContracts["import_commit"]["args"]["mapping"]>;
type Delimiter = NonNullable<
  EngineContracts["import_preview"]["args"]["delimiter"]
>;
type Review = EngineContracts["import_review"]["result"];
type Commit = Exclude<
  EngineContracts["import_commit"]["result"],
  { dry_run: true }
>;
interface Converted {
  events: {
    time: number;
    entity: string;
    lat: number | null;
    lon: number | null;
    mgrs_precision?: number | null;
  }[];
  rejected: [number, string][];
}
interface Sheet {
  sheet: string;
  headers: string[];
  count: number;
  preview: string[][];
  mapping: Mapping;
  notes: string[];
  warnings: string[];
  normalized: Converted | null;
}
interface Preview {
  import_id: string;
  source: string;
  sheets: Sheet[];
  delimiter: string | null;
}
interface Hooks {
  workspace: () => string;
  committed: (append: boolean, result: Commit) => Promise<void>;
}
const coreFields = [
  ["time", "Timestamp / date *"],
  ["entity", "Entity"],
  ["lat", "Latitude (DD)"],
  ["lon", "Longitude (DD)"],
  ["category", "Category"],
  ["label", "Label"],
  ["value", "Numeric value"],
] as const;
const extraFields = [
  ["clock", "Separate time"],
  ["coordinate_column", "Combined DD / UTM coordinate"],
  ["easting", "UTM easting"],
  ["northing", "UTM northing"],
  ["zone", "UTM zone"],
  ["hemisphere", "UTM hemisphere N/S"],
  ["mgrs", "MGRS reference"],
  ["geometry_wkt", "WKT geometry (X longitude, Y latitude)"],
  ["related_to", "Related entity"],
  ["end", "End timestamp"],
] as const;

/** Owns import drafts and steps. Workspace publication remains with the shared engine. */
export class ImportDialog {
  private dialog?: HTMLDialogElement;
  private abort?: AbortController;
  private generation = 0;
  constructor(private hooks: Hooks) {}

  async open(path: string, delimiter: Delimiter = "auto", gisLayer?: string) {
    const generation = ++this.generation;
    this.dialog?.close();
    const workspace = this.hooks.workspace();
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.id = "import-dialog";
    dialog.className = "workflow-dialog";
    dialog.setAttribute("aria-labelledby", "import-title");
    dialog.innerHTML =
      '<header><h2 id="import-title">Import data</h2><button data-close aria-label="Close import">×</button></header><p role="status">Reading source…</p>';
    document.body.append(dialog);
    dialog.showModal();
    let running = false;
    const close = () => (running ? this.abort?.abort() : dialog.close());
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
    dialog.addEventListener("cancel", (e) => {
      if (running) {
        e.preventDefault();
        this.abort?.abort();
      }
    });
    dialog.addEventListener("keydown", (e) => e.stopPropagation());
    dialog.addEventListener("close", () => {
      if (this.dialog === dialog) {
        this.abort?.abort();
        this.dialog = undefined;
      }
      dialog.remove();
    });
    const alive = () => dialog.isConnected && generation === this.generation;
    try {
      const raw = gisLayer
        ? await call("gis_import_preview", {
            id: gisLayer,
            expected_workspace: workspace,
          })
        : await call("import_preview", {
            path,
            delimiter,
            expected_workspace: workspace,
          });
      if (!alive()) return;
      const preview = raw as unknown as Preview;
      let sheet = 0;
      let step: "source" | "mapping" | "review" = "source";
      const drafts = preview.sheets.map((s) => structuredClone(s.mapping));
      let append = false,
        aggregate = false,
        windowMinutes = 15,
        radius = 100;
      let review: Review | undefined;
      const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
        dialog.querySelector<T>(selector)!;
      const input = (selector: string) => $<HTMLInputElement>(selector).value;
      const check = (selector: string) => $<HTMLInputElement>(selector).checked;
      const mapping = () => drafts[sheet];
      const args = () => ({
        sheet,
        mapping: structuredClone(mapping()),
        import_id: preview.import_id,
        expected_workspace: workspace,
      });
      const status = (message: string, error = false) => {
        if (!alive()) return;
        $("#import-status").textContent = message;
        $("#import-status").setAttribute("role", error ? "alert" : "status");
      };
      const work = async <T>(
        command: Parameters<typeof runJob>[0],
        arguments_: unknown,
      ): Promise<T> => {
        running = true;
        const controller = new AbortController();
        this.abort = controller;
        dialog
          .querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLButtonElement
          >("input,select,button:not([data-close])")
          .forEach((el) => (el.disabled = true));
        $<HTMLButtonElement>("[data-close]").textContent = "Cancel operation";
        $<HTMLButtonElement>("[data-close]").focus({ preventScroll: true });
        try {
          return (await runJob(command, arguments_ as never, {
            signal: controller.signal,
            progress: (p) =>
              status(
                `${p.message || "Working"}${p.progress ? ` · ${p.progress.toLocaleString()} rows` : ""}`,
              ),
          })) as T;
        } finally {
          running = false;
          if (this.abort === controller) this.abort = undefined;
          if (alive()) {
            dialog
              .querySelectorAll<
                HTMLInputElement | HTMLSelectElement | HTMLButtonElement
              >("input,select,button")
              .forEach((el) => (el.disabled = false));
            $<HTMLButtonElement>("[data-close]").textContent = "×";
            const commit = $<HTMLButtonElement>("#commit-import");
            if (commit && review)
              commit.disabled =
                !review.accepted ||
                (review.rejected > 0 && !check("#accept-rejections"));
          }
        }
      };
      const bind = (
        selector: string,
        action: () => Promise<unknown> | unknown,
      ) => {
        $(selector)?.addEventListener("click", () => {
          if (!running)
            void Promise.resolve()
              .then(action)
              .catch((e) => status(String(e), true));
        });
      };
      const saveMapping = () => {
        dialog
          .querySelectorAll<HTMLSelectElement>("[data-map]")
          .forEach((el) => {
            (mapping() as Record<string, unknown>)[el.dataset.map!] =
              el.value === "" ? null : Number(el.value);
          });
        Object.assign(mapping(), {
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
        aggregate = check("#import-aggregate");
        windowMinutes = Number(input("#import-aggregate-window"));
        radius = Number(input("#import-aggregate-radius"));
      };
      const normalized = (sample: Converted | null) => {
        $("#normalized-preview").innerHTML =
          `<strong>Converted sample / UTC · first six source rows only</strong>${sample?.events.map((e) => `<p>${time(e.time)} · ${esc(e.entity)} · ${e.lat == null ? "Unlocated" : `${e.lat.toFixed(6)}, ${e.lon!.toFixed(6)}`}${e.mgrs_precision == null ? "" : ` · ${10 ** (5 - e.mgrs_precision)} m MGRS grid`}</p>`).join("") || ""}${sample?.rejected.map(([row, reason]) => `<p class="error">Row ${row}: ${esc(reason)}</p>`).join("") || ""}`;
      };
      const draw = () => {
        const focusedId = dialog.contains(document.activeElement)
          ? document.activeElement?.id
          : "";
        const s = preview.sheets[sheet],
          m = mapping();
        const field = ([key, title]: readonly [keyof Mapping, string]) =>
          `<label class="field">${title}<select data-map="${key}"><option value="">Not mapped</option>${s.headers.map((h, i) => `<option value="${i}" ${m[key] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`;
        dialog.innerHTML = `<header><div><h2 id="import-title">Import data</h2><p>${esc(preview.source)} · ${s.count.toLocaleString()} source rows</p></div><button data-close aria-label="Close import">×</button></header><ol class="workflow-steps" aria-label="Import progress">${["source", "mapping", "review"].map((name, i) => `<li ${name === step ? 'aria-current="step"' : ""}>${i + 1}. ${name === "source" ? "Source" : name === "mapping" ? "Map fields" : "Review & import"}</li>`).join("")}</ol><div class="workflow-body" id="import-body"></div><p id="import-status" role="status" aria-live="polite"></p>`;
        $<HTMLButtonElement>("[data-close]").onclick = close;
        const body = $("#import-body");
        if (step === "source") {
          body.innerHTML = `<div class="modal-grid"><label class="field">Worksheet<select id="import-sheet">${preview.sheets.map((v, i) => `<option value="${i}" ${i === sheet ? "selected" : ""}>${esc(v.sheet)}</option>`).join("")}</select></label>${
            gisLayer
              ? ""
              : `<label class="field">CSV delimiter<select id="import-delimiter">${[
                  ["auto", "Auto detect"],
                  [",", "Comma"],
                  [";", "Semicolon"],
                  ["\t", "Tab"],
                  ["|", "Pipe"],
                ]
                  .map(
                    ([v, title]) =>
                      `<option value="${v}" ${v === delimiter ? "selected" : ""}>${title}</option>`,
                  )
                  .join("")}</select></label>`
          }</div><label class="check-row"><input id="append-import" type="checkbox" ${append ? "checked" : ""}>Append to the current workspace</label><p class="description">${append ? "Existing Events will be retained." : "Import will replace the Event dataset. The change can be undone during this session."} Original source columns and row numbers are retained.</p><div class="preview-scroll"><table><thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.preview.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><footer><button data-close-footer>Cancel</button><span class="spacer"></span><button class="primary" id="import-next">Map fields →</button></footer>`;
          $<HTMLSelectElement>("#import-sheet").onchange = () => {
            sheet = Number(input("#import-sheet"));
            draw();
          };
          const delimiterSelect = $<HTMLSelectElement>("#import-delimiter");
          if (delimiterSelect)
            delimiterSelect.onchange = () => {
              void this.open(
                path,
                delimiterSelect.value as Delimiter,
                gisLayer,
              ).catch((e) => status(String(e), true));
            };
          $<HTMLInputElement>("#append-import").onchange = () => {
            append = check("#append-import");
            draw();
          };
          bind("#import-next", () => {
            step = "mapping";
            draw();
          });
        } else if (step === "mapping") {
          body.innerHTML = `<p class="description">Review the timestamp and identity first. Locations are optional; unknown locations remain available in the table and timeline.</p><div class="modal-grid">${coreFields.map(field).join("")}<label class="field">Default entity<input id="default-entity" value="${esc(m.default_entity || "")}"></label></div><details id="import-advanced"><summary>Coordinate, date and additional fields</summary><div class="modal-grid"><label class="field">Input coordinates<select id="import-crs">${["dd", "utm", "mgrs"].map((v) => `<option ${m.coordinate_system === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>${extraFields.map(field).join("")}<label class="field">Default UTM zone<input id="default-zone" type="number" min="1" max="60" value="${m.default_zone || ""}"></label><label class="field">Default hemisphere<select id="default-hemisphere">${["", "N", "S"].map((v) => `<option value="${v}" ${m.default_hemisphere === v ? "selected" : ""}>${v || "Choose…"}</option>`).join("")}</select></label><label class="field">Date order<select id="date-order">${[
            ["auto", "Auto / reject ambiguous"],
            ["dmy", "Day first"],
            ["mdy", "Month first"],
          ]
            .map(
              ([v, t]) =>
                `<option value="${v}" ${m.date_order === v ? "selected" : ""}>${t}</option>`,
            )
            .join(
              "",
            )}</select></label><label class="field">Numeric time encoding<select id="time-encoding">${["auto", "unix_seconds", "unix_milliseconds", "unix_microseconds", "unix_nanoseconds", "excel_serial", "excel1904"].map((v) => `<option value="${v}" ${m.time_encoding === v ? "selected" : ""}>${v.replaceAll("_", " ")}</option>`).join("")}</select></label><label class="field">Default date<input id="default-date" value="${esc(m.default_date || "")}" placeholder="YYYY-MM-DD"></label><label class="field">Custom timestamp format<input id="date-format" value="${esc(m.custom_format || "")}" placeholder="%d/%m/%Y %H:%M:%S"></label><label class="field">Naive UTC offset / minutes<input id="time-offset" type="number" value="${m.offset_minutes || 0}"></label><label class="check-row"><input id="decimal-comma" type="checkbox" ${m.decimal_comma ? "checked" : ""}>Decimal comma numbers</label></div></details><div class="notice">${[...(s.notes || []), ...(s.warnings || [])].map((v) => `<p>${esc(v)}</p>`).join("")}Input must already use WGS84. Explicit timestamp offsets take priority; timestamps without an offset use ${m.offset_minutes || 0} minutes from UTC.</div><details><summary>Aggregate during import (optional)</summary><label class="check-row"><input id="import-aggregate" type="checkbox" ${aggregate ? "checked" : ""}>Keep time/proximity summaries instead of individual rows</label><div class="modal-grid"><label class="field">Time window / minutes<input id="import-aggregate-window" type="number" value="${windowMinutes}"></label><label class="field">Radius / metres<input id="import-aggregate-radius" type="number" value="${radius}"></label></div><p class="description">Lossy. Keep the original source for individual records. The review checks source rows before aggregation.</p></details><button id="preview-mapping">Preview conversions</button><div id="normalized-preview" class="notice"></div><footer><button id="import-back">← Source</button><span class="spacer"></span><button id="review-import" class="primary">Review all rows →</button></footer>`;
          normalized(s.normalized);
          // Automatically reveal the advanced mappings when the detected source uses them.
          $<HTMLDetailsElement>("#import-advanced").open =
            m.coordinate_system !== "dd" ||
            extraFields.some(([key]) => m[key] != null) ||
            !!s.warnings?.length;
          bind("#preview-mapping", async () => {
            saveMapping();
            normalized(
              (await call("import_validate", args())) as unknown as Converted,
            );
          });
          bind("#import-back", () => {
            saveMapping();
            step = "source";
            draw();
          });
          bind("#review-import", async () => {
            saveMapping();
            review = await work<Review>("import_review", args());
            if (alive()) {
              step = "review";
              draw();
            }
          });
        } else if (review) {
          body.innerHTML = `<h3>All source rows checked</h3><div class="import-quality"><div><strong>${review.accepted.toLocaleString()}</strong><span>Valid Events</span></div><div><strong>${review.rejected.toLocaleString()}</strong><span>Rejected rows</span></div><div><strong>${review.missing_locations.toLocaleString()}</strong><span>Without a location</span></div><div><strong>${review.duplicate_candidates.toLocaleString()}</strong><span>Duplicate candidates</span></div></div><p class="description">${append ? "Append to the current workspace" : "Replace the Event dataset"}${aggregate ? ` · Aggregate accepted records into ${windowMinutes}-minute / ${radius}-metre summaries` : " · Keep individual records"}. Nothing has been imported yet.</p><p class="notice">Times without an explicit offset use ${mapping().offset_minutes || 0} minutes from UTC. Missing locations are retained. Duplicate candidates match canonical identity, time, location and descriptive values; source attributes may differ. Candidates are retained and can be examined with Find duplicates after import.</p>${review.rejected ? `<h3>Rejected source rows</h3><p>${review.reasons_limited ? "Showing bounded examples. Export includes every rejection." : "Every rejected row is listed below."}</p><div class="import-rejections">${(review.reasons as [number, string][]).map(([row, reason]) => `<p>Row ${row}: ${esc(reason)}</p>`).join("")}</div><button id="export-import-rejections">Export rejected-row report…</button><label class="check-row"><input id="accept-rejections" type="checkbox">Import valid rows and exclude ${review.rejected.toLocaleString()} rejected rows</label>` : '<p class="description">No rejected rows.</p>'}<footer><button id="import-back">← Edit mappings</button><span class="spacer"></span><button id="commit-import" class="primary" ${!review.accepted || review.rejected ? "disabled" : ""}>${append ? "Append" : "Import"} ${review.accepted.toLocaleString()} valid Events</button></footer>`;
          const commit = $<HTMLButtonElement>("#commit-import");
          $<HTMLInputElement>("#accept-rejections")?.addEventListener(
            "change",
            () => {
              commit.disabled =
                !review!.accepted || !check("#accept-rejections");
            },
          );
          bind("#import-back", () => {
            review = undefined;
            step = "mapping";
            draw();
          });
          bind("#export-import-rejections", async () => {
            const dest = await chooseFile({
              save: true,
              title: "Export rejected source rows and reasons",
              defaultPath: "import-rejections.csv",
              filters: [{ name: "CSV report", extensions: ["csv"] }],
            });
            if (!dest || !alive()) return;
            const result = await work<Review>("import_rejections_export", {
              ...args(),
              path: dest,
              overwrite: false,
            });
            if (alive()) {
              draw();
              status(
                `Exported ${result.exported!.toLocaleString()} rejected rows.`,
              );
            }
          });
          bind("#commit-import", async () => {
            if (
              !review?.accepted ||
              (review.rejected && !check("#accept-rejections"))
            )
              return;
            const result = await work<Commit>("import_commit", {
              ...args(),
              append,
              accept_rejected: review.rejected > 0,
              ...(aggregate
                ? {
                    aggregation: {
                      window_minutes: windowMinutes,
                      radius_m: radius,
                    },
                  }
                : {}),
            });
            if (result.needs_review) {
              draw();
              status(
                "The source needs another review. Return to mapping and review again.",
                true,
              );
              return;
            }
            if (!alive() || this.hooks.workspace() !== workspace) return;
            dialog.close();
            await this.hooks.committed(append, result);
          });
        }
        bind("[data-close-footer]", close);
        const focusTarget =
          (focusedId &&
            dialog.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`)) ||
          (step === "source"
            ? $("#import-sheet")
            : step === "mapping"
              ? $("[data-map=time]")
              : $("#import-title"));
        if (step === "review" && focusTarget.id === "import-title")
          focusTarget.tabIndex = -1;
        focusTarget.focus({ preventScroll: true });
      };
      draw();
    } catch (error) {
      if (alive()) {
        dialog.querySelector("[role=status]")?.remove();
        const message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.textContent = String(error);
        dialog.append(message);
      }
    }
  }
}
