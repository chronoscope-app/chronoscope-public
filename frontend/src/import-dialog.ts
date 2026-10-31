import { call, chooseFile } from "./bridge";
import { runJob } from "./operation-job";
import type { EngineContracts } from "./contracts";
import { escape as esc, displayTime as time } from "./types";
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
interface FieldFeedback {
  state: "valid" | "invalid" | "optional" | "inactive";
  message: string;
  required: boolean;
}
interface Converted {
  events: {
    time: number;
    entity: string;
    lat: number | null;
    lon: number | null;
    mgrs_precision?: number | null;
  }[];
  rejected: [number, string][];
  error?: string | null;
  fields?: Record<string, FieldFeedback>;
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
  fields?: Record<string, FieldFeedback>;
}
interface Preview {
  import_id: string;
  source: string;
  sheets: Sheet[];
  delimiter: string | null;
}
interface Hooks {
  workspace: () => string;
  layers: () => { source: string; count: number }[];
  committed: (append: boolean, result: Commit) => Promise<void>;
}
const coreFields = [
  ["time", "Timestamp / date"],
  ["entity", "Entity"],
  ["lat", "Latitude (DD / DMS)"],
  ["lon", "Longitude (DD / DMS)"],
  ["altitude", "Altitude"],
  ["category", "Category"],
  ["label", "Label"],
  ["value", "Numeric value"],
  ["end", "End timestamp"],
] as const;
const extraFields = [
  ["clock", "Separate time"],
  ["altitude_reference_column", "Altitude reference column"],
  ["coordinate_column", "Combined DD / DMS / UTM coordinate"],
  ["easting", "UTM easting"],
  ["northing", "UTM northing"],
  ["zone", "UTM zone"],
  ["hemisphere", "UTM hemisphere N/S"],
  ["mgrs", "MGRS reference"],
  ["geometry_wkt", "WKT geometry (X longitude, Y latitude)"],
  ["related_to", "Related entity"],
] as const;

/** Owns an import draft and inline validation. Publication remains with the engine. */
export class ImportDialog {
  private dialog?: HTMLDialogElement;
  private abort?: AbortController;
  private generation = 0;
  constructor(private hooks: Hooks) {}

  async open(
    path: string,
    delimiter: Delimiter = "auto",
    gisLayer?: string,
    appendInitial = false,
  ) {
    const generation = ++this.generation;
    this.abort?.abort();
    this.dialog?.close();
    const workspace = this.hooks.workspace();
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.id = "import-dialog";
    dialog.className = "workflow-dialog import-dialog";
    dialog.setAttribute("aria-labelledby", "import-title");
    dialog.innerHTML =
      '<header><h2 id="import-title">Import data</h2><button data-close aria-label="Close import">×</button></header><p role="status">Reading source…</p>';
    document.body.append(dialog);
    dialog.showModal();
    let running = false;
    let sampleVersion = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      clearTimeout(timer);
      sampleVersion++;
      if (this.dialog === dialog) {
        this.abort?.abort();
        this.dialog = undefined;
      }
      dialog.remove();
    });
    const alive = () =>
      dialog.open && dialog.isConnected && generation === this.generation;
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
      if (!preview.sheets.length)
        throw Error("This source has no worksheets to import.");
      let sheet = 0;
      const drafts = preview.sheets.map((s) => structuredClone(s.mapping));
      let targetSource = "";
      const existingLayers = this.hooks.layers();
      let append = appendInitial,
        aggregate = false,
        windowMinutes = 15,
        radius = 100;
      let review: Review | undefined;
      let acceptedRejections = false;
      let fields = preview.sheets[0].fields || {};
      let checking = false;
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
      const controls = () => {
        if (!alive()) return;
        $<HTMLButtonElement>("#commit-import").disabled =
          running ||
          !review?.accepted ||
          (!!review.rejected && !acceptedRejections);
        $<HTMLButtonElement>("#commit-import").textContent =
          `${append ? "Append" : "Import"} ${review ? review.accepted.toLocaleString() + " valid" : preview.sheets[sheet].count.toLocaleString()} Events`;
        $<HTMLButtonElement>("#review-import").disabled =
          running || mapping().time == null;
        $<HTMLButtonElement>("#preview-mapping").disabled = running;
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
            controls();
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
          altitude_unit: input("#altitude-unit"),
          altitude_reference: input("#altitude-reference"),
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
        append = check("#append-import");
        targetSource = input("#import-target-layer");
        if (targetSource) append = true;
        const appendInput = $<HTMLInputElement>("#append-import");
        appendInput.checked = append;
        appendInput.disabled = !!targetSource;
        aggregate = check("#import-aggregate");
        windowMinutes = Number(input("#import-aggregate-window"));
        radius = Number(input("#import-aggregate-radius"));
      };
      const normalized = (sample: Converted | null) => {
        $("#normalized-preview").innerHTML =
          `<strong>Converted sample / UTC · first six source rows only</strong>${sample?.error ? `<p class="error">${esc(sample.error)}</p>` : ""}${sample?.events.map((e) => `<p>${time(e.time)} · ${esc(e.entity)} · ${e.lat == null ? "Unlocated" : `${e.lat.toFixed(6)}, ${e.lon!.toFixed(6)}`}${e.mgrs_precision == null ? "" : ` · ${10 ** (5 - e.mgrs_precision)} m MGRS grid`}</p>`).join("") || ""}${sample?.rejected.map(([row, reason]) => `<p class="error">Row ${row}: ${esc(reason)}</p>`).join("") || ""}${!sample ? "<p>Resolve the highlighted fields to preview converted Events.</p>" : ""}`;
      };
      const paintFields = () => {
        let valid = 0,
          attention = 0;
        dialog.querySelectorAll<HTMLElement>("[data-field]").forEach((card) => {
          const key = card.dataset.field!;
          const selected = mapping()[key as keyof Mapping] != null;
          const feedback = fields[key];
          const m = mapping();
          const required =
            feedback?.required ??
            (key === "time" ||
              (["dd", "dms"].includes(m.coordinate_system || "dd") &&
                m.coordinate_column == null &&
                ((key === "lat" && m.lon != null) ||
                  (key === "lon" && m.lat != null))) ||
              (m.coordinate_system === "utm" &&
                m.coordinate_column == null &&
                ["easting", "northing"].includes(key)) ||
              (m.coordinate_system === "mgrs" && key === "mgrs"));
          const state =
            feedback?.state ||
            (selected
              ? checking
                ? "checking"
                : "invalid"
              : required
                ? "invalid"
                : "optional");
          card.dataset.state = state;
          const select = card.querySelector<HTMLSelectElement>("[data-map]")!;
          select.setAttribute("aria-invalid", String(state === "invalid"));
          select.setAttribute("aria-required", String(required));
          card.querySelector<HTMLElement>("[data-required]")!.textContent =
            required ? " *" : "";
          const auto =
            selected &&
            preview.sheets[sheet].mapping[key as keyof Mapping] ===
              mapping()[key as keyof Mapping];
          card.querySelector<HTMLElement>("[data-feedback]")!.textContent =
            feedback
              ? `${state === "valid" && auto ? "Auto-selected · " : ""}${feedback.message}`
              : selected && checking
                ? "Checking sample…"
                : required && !selected
                  ? "Required — choose a source column"
                  : selected
                    ? "Needs validation"
                    : "Optional · not mapped";
          if (state === "valid") valid++;
          if (state === "invalid") attention++;
        });
        $("#import-validation-summary").textContent = checking
          ? "Checking sample…"
          : `${attention ? `${attention} field${attention === 1 ? " needs" : "s need"} attention` : "Selected fields valid in sample"} · ${valid} validated`;
        controls();
      };
      const reviewMarkup = () => {
        $("#import-review").innerHTML = !review
          ? '<h3>Check before importing</h3><p class="description">Sample shading covers the first six rows. Check all rows to review rejected records and enable import.</p>'
          : `<h3>All source rows checked</h3><div class="import-quality"><div><strong>${review.accepted.toLocaleString()}</strong><span>Valid Events</span></div><div><strong>${review.rejected.toLocaleString()}</strong><span>Rejected rows</span></div><div><strong>${review.missing_locations.toLocaleString()}</strong><span>Without a location</span></div><div><strong>${review.duplicate_candidates.toLocaleString()}</strong><span>Duplicate candidates</span></div></div><p class="description">${append ? "Append to the current workspace" : "Replace the Event dataset"}${aggregate ? ` · Aggregate accepted records into ${windowMinutes}-minute / ${radius}-metre summaries` : " · Keep individual records"}. Nothing has been imported yet. Missing locations and duplicate candidates are retained.</p>${review.rejected ? `<h3>Rejected source rows</h3><p class="description">${review.reasons_limited ? "Showing bounded examples. Export includes every rejection." : "Every rejected row is listed below."}</p><div class="import-rejections">${(review.reasons as [number, string][]).map(([row, reason]) => `<p>Row ${row}: ${esc(reason)}</p>`).join("")}</div><button id="export-import-rejections">Export rejected-row report…</button><label class="check-row"><input id="accept-rejections" type="checkbox" ${acceptedRejections ? "checked" : ""}>Import valid rows and exclude ${review.rejected.toLocaleString()} rejected rows</label>` : '<p class="description">No rejected rows.</p>'}`;
        $<HTMLInputElement>("#accept-rejections")?.addEventListener(
          "change",
          () => {
            acceptedRejections = check("#accept-rejections");
            controls();
          },
        );
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
          if (alive())
            status(
              `Exported ${result.exported!.toLocaleString()} rejected rows.`,
            );
        });
        controls();
      };
      const validate = async (clearMessage = true) => {
        clearTimeout(timer);
        const version = ++sampleVersion;
        const arguments_ = args();
        checking = true;
        paintFields();
        try {
          const sample = (await call("import_validate", {
            ...arguments_,
            field_feedback: true,
          })) as unknown as Converted;
          if (!alive() || version !== sampleVersion) return;
          fields = sample.fields || {};
          normalized(sample);
          if (clearMessage && !running) status("");
        } catch (error) {
          if (!alive() || version !== sampleVersion) return;
          fields = {};
          status(`Could not validate the sample: ${String(error)}`, true);
        } finally {
          if (alive() && version === sampleVersion) {
            checking = false;
            paintFields();
          }
        }
      };
      const changed = (element: HTMLInputElement | HTMLSelectElement) => {
        if (running) return;
        saveMapping();
        sampleVersion++;
        clearTimeout(timer);
        review = undefined;
        acceptedRejections = false;
        const key = element.dataset.map || element.id;
        const temporal = ["time", "clock", "end"];
        const spatial = [
          "lat",
          "lon",
          "coordinate_column",
          "easting",
          "northing",
          "zone",
          "hemisphere",
          "mgrs",
          "geometry_wkt",
        ];
        const affected =
          temporal.includes(key) ||
          [
            "date-order",
            "date-format",
            "default-date",
            "time-offset",
            "time-encoding",
          ].includes(key)
            ? temporal
            : spatial.includes(key) ||
                ["import-crs", "default-zone", "default-hemisphere"].includes(
                  key,
                )
              ? spatial
              : ["altitude-unit", "altitude-reference", "altitude_reference_column", "altitude"].includes(key)
                ? ["altitude", "altitude_reference_column"]
              : key === "decimal-comma"
                ? [...spatial, "value", "altitude"]
                : key === "default-entity"
                  ? ["entity"]
                  : [key];
        // Keep independent, already checked cards green while the edited field
        // and its dependencies await new feedback.
        fields = Object.fromEntries(
          Object.entries(fields).filter(([field]) => !affected.includes(field)),
        );
        checking = true;
        reviewMarkup();
        paintFields();
        $("#normalized-preview").textContent = "Checking updated sample…";
        status("");
        timer = setTimeout(() => void validate(), 250);
      };
      const draw = () => {
        const s = preview.sheets[sheet],
          m = mapping();
        const field = ([key, title]: readonly [keyof Mapping, string]) =>
          `<div class="import-field field" data-field="${key}"><label for="import-map-${key}">${title}<span data-required></span></label><select id="import-map-${key}" data-map="${key}" aria-describedby="import-feedback-${key}"><option value="">Not mapped</option>${s.headers.map((h, i) => `<option value="${i}" ${m[key] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select><small id="import-feedback-${key}" data-feedback></small>${
            key === "time"
              ? `<label class="import-subfield" for="date-order">Date order<select id="date-order">${[
                  ["auto", "Auto / reject ambiguous"],
                  ["dmy", "Day / month / year"],
                  ["mdy", "Month / day / year"],
                ]
                  .map(
                    ([v, t]) =>
                      `<option value="${v}" ${m.date_order === v ? "selected" : ""}>${t}</option>`,
                  )
                  .join("")}</select></label>`
              : ""
          }</div>`;
        dialog.innerHTML = `<header><div><h2 id="import-title">Import data</h2><p>${esc(preview.source)} · ${s.count.toLocaleString()} source rows · ${s.headers.length} columns</p></div><button data-close aria-label="Close import">×</button></header><div class="import-legend" aria-label="Field validation legend"><span data-state="valid">Valid / recommended in sample</span><span data-state="invalid">Needs attention</span><span>Optional</span></div><div class="workflow-body" id="import-body"><div class="modal-grid import-source"><label class="field">Worksheet<select id="import-sheet">${preview.sheets.map((v, i) => `<option value="${i}" ${i === sheet ? "selected" : ""}>${esc(v.sheet)}</option>`).join("")}</select></label>${
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
        }</div><div class="import-section-heading"><h3>Match source columns</h3><span>Required fields are marked *</span></div><div class="modal-grid import-field-grid">${coreFields.map(field).join("")}</div><div class="modal-grid import-options"><label class="field">Altitude unit<select id="altitude-unit">${[["meters", "Metres"], ["feet", "Feet"], ["kilometers", "Kilometres"]].map(([v, label]) => `<option value="${v}" ${m.altitude_unit === v ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field">Altitude reference<select id="altitude-reference">${[["unspecified", "Unknown · retain, do not plot"], ["ellipsoid", "WGS84 ellipsoid"], ["egm96", "Mean sea level · EGM96"], ["reported", "Reported height · approximate"]].map(([v, label]) => `<option value="${v}" ${m.altitude_reference === v ? "selected" : ""}>${label}</option>`).join("")}</select></label></div><p class="description">Altitude is optional. Verify the source unit and vertical reference. Pressure altitude and unknown sea-level datums can be shown approximately using Reported height; they are not converted to precise physical height.</p><details id="import-advanced"><summary>Coordinate, date and additional fields</summary><label class="field">Input coordinates<select id="import-crs">${["dd", "dms", "utm", "mgrs"].map((v) => `<option ${m.coordinate_system === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><p class="description">Locations are optional. Map both latitude/longitude columns (DD or DMS), or leave both unmapped to keep records without a location. Input must already use WGS84.</p><div class="modal-grid import-field-grid">${extraFields.map(field).join("")}</div><div class="modal-grid import-options"><label class="field">Default entity<input id="default-entity" value="${esc(m.default_entity || "")}"></label><label class="field">Default UTM zone<input id="default-zone" type="number" min="1" max="60" value="${m.default_zone || ""}"></label><label class="field">Default hemisphere<select id="default-hemisphere">${["", "N", "S"].map((v) => `<option value="${v}" ${m.default_hemisphere === v ? "selected" : ""}>${v || "Choose…"}</option>`).join("")}</select></label><label class="field">Numeric time encoding<select id="time-encoding">${["auto", "unix_seconds", "unix_milliseconds", "unix_microseconds", "unix_nanoseconds", "excel_serial", "excel1904", "time_of_day"].map((v) => `<option value="${v}" ${m.time_encoding === v ? "selected" : ""}>${v.replaceAll("_", " ")}</option>`).join("")}</select></label><label class="field">Default date<input id="default-date" value="${esc(m.default_date || "")}" placeholder="YYYY-MM-DD"></label><label class="field">Custom timestamp format<input id="date-format" value="${esc(m.custom_format || "")}" placeholder="%d/%m/%Y %H:%M:%S"></label><label class="field">Naive UTC offset / minutes<input id="time-offset" type="number" value="${m.offset_minutes || 0}"></label><label class="check-row"><input id="decimal-comma" type="checkbox" ${m.decimal_comma ? "checked" : ""}>Decimal comma numbers</label></div><p class="description">Explicit timestamp offsets take priority over the default offset.</p></details><section aria-label="Source data preview"><h3>Source preview</h3><div class="preview-scroll"><table><thead><tr>${s.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.preview.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section><div class="notice import-detection-notes">${(s.notes || []).map((v) => `<p>${esc(v)}</p>`).join("")}</div><button id="preview-mapping">Refresh sample validation</button><div id="normalized-preview" class="notice" aria-live="polite"></div><details><summary>Aggregate during import (optional)</summary><label class="check-row"><input id="import-aggregate" type="checkbox" ${aggregate ? "checked" : ""}>Keep time/proximity summaries instead of individual rows</label><div class="modal-grid"><label class="field">Time window / minutes<input id="import-aggregate-window" type="number" value="${windowMinutes}"></label><label class="field">Radius / metres<input id="import-aggregate-radius" type="number" value="${radius}"></label></div><p class="description">Lossy. Keep the original source for individual records. The full-file check reviews source rows before aggregation.</p></details><label class="field">Destination layer<select id="import-target-layer"><option value="">Create a layer for this file / worksheet</option>${existingLayers.map((layer) => `<option value="${esc(layer.source)}" ${targetSource === layer.source ? "selected" : ""}>Add to ${esc(layer.source || "Unattributed data")} · ${layer.count.toLocaleString()} records</option>`).join("")}</select></label><p class="description">Add matching files to an existing layer to keep one entry in Layers. Original file, worksheet, source rows and imported attributes are retained.</p><label class="check-row"><input id="append-import" type="checkbox" ${append ? "checked" : ""}>Append to the current workspace</label><p class="description" id="import-replace-note">${append ? "Existing Events will be retained." : "Import will replace the Event dataset. The change can be undone during this session."} Original source columns and row numbers are retained.</p><section id="import-review" aria-live="polite"></section></div><footer><div><p id="import-validation-summary" role="status" aria-live="polite"></p><p id="import-status" role="status" aria-live="polite"></p></div><div class="import-actions"><button data-close-footer>Cancel</button><button id="review-import">Check all rows</button><button id="commit-import" class="primary" disabled>Import Events</button></div></footer>`;
        $<HTMLButtonElement>("[data-close]").onclick = close;
        $<HTMLDetailsElement>("#import-advanced").open =
          m.coordinate_system !== "dd" ||
          extraFields.some(([key]) => m[key] != null) ||
          !m.default_entity?.trim();
        normalized(checking ? null : s.normalized);
        paintFields();
        reviewMarkup();
        $<HTMLSelectElement>("#import-sheet").onchange = () => {
          clearTimeout(timer);
          sampleVersion++;
          sheet = Number(input("#import-sheet"));
          review = undefined;
          acceptedRejections = false;
          fields = {};
          checking = true;
          draw();
          $<HTMLSelectElement>("#import-sheet").focus({ preventScroll: true });
          void validate();
        };
        const delimiterSelect = $<HTMLSelectElement>("#import-delimiter");
        if (delimiterSelect)
          delimiterSelect.onchange = () => {
            void this.open(
              path,
              delimiterSelect.value as Delimiter,
              gisLayer,
              append,
            ).catch((e) => status(String(e), true));
          };
        dialog
          .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            "#import-body input, #import-body select",
          )
          .forEach((el) => {
            if (el.id === "import-sheet" || el.id === "import-delimiter")
              return;
            el.addEventListener(
              el instanceof HTMLInputElement && el.type !== "checkbox"
                ? "input"
                : "change",
              () => {
                changed(el);
                $("#import-replace-note").textContent =
                  `${append ? "Existing Events will be retained." : "Import will replace the Event dataset. The change can be undone during this session."} Original source columns and row numbers are retained.`;
              },
            );
          });
        bind("#preview-mapping", validate);
        bind("#review-import", async () => {
          const refreshSample = checking;
          clearTimeout(timer);
          sampleVersion++;
          saveMapping();
          review = undefined;
          acceptedRejections = false;
          reviewMarkup();
          try {
            review = await work<Review>("import_review", args());
            if (alive()) {
              reviewMarkup();
              status(
                "All rows checked. Review the results below the mapping fields.",
              );
              $("#import-review").scrollIntoView({ block: "nearest" });
            }
          } finally {
            // Complete sample feedback even if the full check superseded its
            // debounce, without clearing an operation error or its result.
            if (alive() && refreshSample) void validate(false);
          }
        });
        bind("#commit-import", async () => {
          if (!review?.accepted || (review.rejected && !acceptedRejections))
            return;
          const result = await work<Commit>("import_commit", {
            ...args(),
            append,
            ...(targetSource ? { target_source: targetSource } : {}),
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
            review = undefined;
            acceptedRejections = false;
            reviewMarkup();
            status(
              "The source needs another full-file check before importing.",
              true,
            );
            return;
          }
          if (!alive() || this.hooks.workspace() !== workspace) return;
          dialog.close();
          await this.hooks.committed(append, result);
        });
        bind("[data-close-footer]", close);
      };
      draw();
      $<HTMLSelectElement>("[data-map=time]").focus({ preventScroll: true });
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
