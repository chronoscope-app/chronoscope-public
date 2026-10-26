import { FieldRolesEditor } from "./field-roles";
import { call } from "./bridge";
import { escape as esc, time, displayTime, type Snapshot } from "./types";
import type { EngineContracts } from "./contracts";
import {
  categoryField,
  activeChartTask,
  weekdays,
  hourLabel,
  periodLabel,
  relationshipFields,
  axisLabel,
  chartTasks,
  chartTitle,
  fieldLabel,
  intervalLabel,
  measurementFields,
  measurementLabel,
  operationLabel,
  scopeLabel,
  suggestedTimeBucket,
  timeBuckets,
  type ChartTask,
} from "./chart-guidance";
export { fieldLabel } from "./chart-guidance";
export interface ChartConfig {
  kind:
    | "bar"
    | "line"
    | "area"
    | "scatter"
    | "histogram"
    | "boxplot"
    | "heatmap"
    | "period";
  scope: "all" | "visible" | "selected";
  source: string | null;
  x: string;
  y: string;
  group: string;
  aggregate: "count" | "sum" | "mean" | "min" | "max";
  x_axis: "category" | "number" | "time";
  time_bucket:
    | "none"
    | "millisecond"
    | "second"
    | "minute"
    | "hour"
    | "day"
    | "week"
    | "month"
    | "year";
  stacked: boolean;
  y2: string;
  trendline: boolean;
  bins: number;
  limit: number;
  title: string;
  x_label: string;
  y_label: string;
  y2_label: string;
  period_a: [number, number] | null;
  period_b: [number, number] | null;
}
export const defaultChart: ChartConfig = {
  kind: "bar",
  scope: "visible",
  source: null,
  x: "entity",
  y: "value",
  group: "",
  aggregate: "count",
  x_axis: "category",
  time_bucket: "day",
  stacked: false,
  y2: "",
  trendline: false,
  bins: 20,
  limit: 2000,
  title: "",
  x_label: "",
  y_label: "",
  y2_label: "",
  period_a: null,
  period_b: null,
};
export type ChartReport = EngineContracts["chart_data"]["result"];
export interface ChartMark {
  x: any;
  series: any;
  value?: number | null;
  axis?: number;
}
export const chartValue = (v: any) =>
  v === null
    ? "[Missing]"
    : typeof v === "number"
      ? new Intl.NumberFormat(undefined, {
          maximumSignificantDigits: 7,
        }).format(v)
      : String(v);
interface Plot {
  update: (report: ChartReport) => void;
  dispose: () => void;
}
interface Actions {
  rolesChanged: () => Promise<void>;
  changed: () => Promise<void>;
  selected: () => Promise<void>;
  table: (source: string | null) => Promise<void>;
  error: (e: unknown) => void;
}
export class ChartsPanel {
  config = { ...defaultChart };
  presets: { name: string; config: ChartConfig }[] = [];
  private snapshot!: Snapshot;
  private schema?: EngineContracts["dataset_schema"]["result"];
  private schemaKey = "";
  private schemaRequestKey = "";
  private schemaRequest?: Promise<EngineContracts["dataset_schema"]["result"]>;
  private signature = "";
  private presentation = "";
  private generation = 0;
  private pending?: {
    snapshot: Snapshot;
    config: ChartConfig;
    generation: number;
  };
  private loading = false;
  private work: Promise<void> = Promise.resolve();
  private persistWork: Promise<void> = Promise.resolve();
  private selectionWork: Promise<void> = Promise.resolve();
  private periodWork: Promise<void> = Promise.resolve();
  private periodGeneration = 0;
  private result?: ChartReport;
  private plot?: Plot;
  private docked = true;
  private tablePage = 0;
  private rolesEditor: FieldRolesEditor;
  constructor(
    private host: HTMLElement,
    private actions: Actions,
  ) {
    this.rolesEditor = new FieldRolesEditor(actions.rolesChanged);
  }
  capture() {
    return {
      chart: { ...this.config },
      chart_presets: this.presets.map((p) => ({
        name: p.name,
        config: { ...p.config },
      })),
    };
  }
  restore(scene: any) {
    this.generation++;
    this.periodGeneration++;
    this.pending = undefined;
    this.rolesEditor.close();
    this.docked = true;
    this.config = { ...defaultChart, ...scene.chart };
    this.presets = (scene.chart_presets || []).map((p: any) => ({
      name: p.name,
      config: { ...defaultChart, ...p.config },
    }));
    this.signature = "";
    this.schemaKey = "";
    this.schemaRequestKey = "";
    this.result = undefined;
  }
  hide() {
    this.rolesEditor.close();
    document.querySelector(".workspace")?.classList.remove("chart-docked");
    document.querySelector(".workspace")?.classList.remove("chart-mini");
    this.generation++;
    this.pending = undefined;
    this.plot?.dispose();
    this.plot = undefined;
    this.signature = "";
  }
  private persist() {
    this.persistWork = this.persistWork
      .then(this.actions.changed)
      .catch(this.actions.error);
    return this.persistWork;
  }
  async idle() {
    await this.rolesEditor.idle();
    await this.selectionWork;
    await this.periodWork;
    await this.persistWork;
    await this.schemaRequest;
    for (;;) {
      const work = this.work;
      await work;
      if (work === this.work) return;
    }
  }
  async render(snapshot: Snapshot) {
    this.snapshot = snapshot;
    if (!this.host.querySelector(".charts-panel")) {
      this.host.innerHTML = `<section class="charts-panel"><div class="section-head"><h3>Charts</h3><button id="chart-expand" aria-pressed="false">Widen chart</button></div><div id="chart-heading"><h4 id="chart-title"></h4><p id="chart-caption" class="muted"></p></div><div id="chart-start-controls"></div><div id="chart-status" role="status" aria-live="polite">Preparing chart…</div><div id="chart-preview" class="chart-preview" role="img" aria-label="Interactive chart of scoped workspace records"></div><details id="chart-notes" open hidden><summary>Chart notes</summary><div id="chart-warnings" class="chart-warnings"></div></details><div id="chart-guidance" class="chart-guidance"></div><p class="chart-selection-hint muted">Click a mark to select its Events · Shift-click adds · Scatter: use the rectangle brush · Ctrl-scroll zooms</p><div id="chart-controls"></div><div class="row"><button id="chart-select-all" title="Select source Events represented by the displayed marks only">Select displayed Events</button><button id="chart-table">Open attribute table</button></div><details id="chart-data-details"><summary>Chart data</summary><div id="chart-data"></div></details></section>`;
      this.host
        .querySelector("#chart-expand")!
        .addEventListener("click", () => {
          this.docked = !this.docked;
          this.syncDock();
        });
      this.host
        .querySelector("#chart-select-all")!
        .addEventListener("click", () => {
          if (this.result)
            void this.select(
              this.result.rows.flatMap((r: any) => this.rowMarks(r)),
            ).catch(this.actions.error);
        });
      this.host
        .querySelector("#chart-table")!
        .addEventListener(
          "click",
          () =>
            void this.actions
              .table(this.config.source)
              .catch(this.actions.error),
        );
      this.host
        .querySelector("#chart-data-details")!
        .addEventListener("toggle", () => this.dataTable());
      this.host.querySelector("#chart-data")!.addEventListener("click", (e) => {
        const b = (e.target as Element).closest<HTMLButtonElement>("button");
        if (!b) return;
        if (b.dataset.chartRow !== undefined) {
          const r = this.result?.rows[Number(b.dataset.chartRow)];
          if (r)
            void this.select(
              this.rowMarks(r),
              (e as MouseEvent).shiftKey,
            ).catch(this.actions.error);
        } else if (b.dataset.chartPage) {
          this.tablePage += Number(b.dataset.chartPage);
          this.dataTable();
        }
      });
    }
    this.syncDock();
    const key = JSON.stringify([
      snapshot.workspace_id,
      snapshot.name,
      snapshot.count,
      snapshot.layers?.map((l) => l.source),
    ]);
    if (key !== this.schemaKey) {
      if (this.schemaRequestKey !== key) {
        this.schemaRequestKey = key;
        this.schemaRequest = (async () => {
          const schema = await call("dataset_schema", {
            include_attribute_types: true,
            attribute_limit: 512,
          });
          let offset = schema.next_attribute_offset;
          while (offset !== null && offset !== undefined) {
            const page = await call("dataset_schema", {
              include_attribute_types: true,
              attribute_limit: 512,
              attribute_offset: offset,
            });
            schema.attributes.push(...page.attributes);
            Object.assign(
              (schema.attribute_types ||= {}),
              page.attribute_types,
            );
            offset = page.next_attribute_offset;
          }
          return schema;
        })();
      }
      let schema: EngineContracts["dataset_schema"]["result"];
      try {
        schema = await this.schemaRequest!;
      } catch (error) {
        this.schemaRequestKey = "";
        this.status(String(error));
        throw error;
      }
      if (
        !this.host.querySelector(".charts-panel") ||
        this.schemaRequestKey !== key
      )
        return;
      this.schema = schema;
      this.schemaKey = key;
    }
    this.rolesEditor.update(this.schema, snapshot);
    this.controls();
    const signature = JSON.stringify([snapshot.revision, this.config]);
    const presentation = JSON.stringify([
      snapshot.preferences.date_format,
      snapshot.preferences.time_format,
      document.documentElement.dataset.theme,
    ]);
    const presentationChanged = presentation !== this.presentation;
    this.presentation = presentation;
    if (signature === this.signature) {
      if (presentationChanged && this.result) {
        this.plot?.update(this.result);
        this.dataTable();
        this.comparison(this.result);
      }
      return;
    }
    this.signature = signature;
    const generation = ++this.generation;
    this.pending = { snapshot, config: { ...this.config }, generation };
    if (this.loading) return;
    this.loading = true;
    this.work = (async () => {
      try {
        while (this.pending) {
          const request = this.pending;
          this.pending = undefined;
          this.status("Calculating chart…");
          this.result = undefined;
          this.selectionEnabled(false);
          try {
            const result = await call("chart_data", { config: request.config });
            if (
              request.generation !== this.generation ||
              !this.host.querySelector(".charts-panel")
            )
              continue;
            this.result = result;
            this.tablePage = 0;
            const { createWorkspaceChart } = await import("./chart-renderer");
            if (
              request.generation !== this.generation ||
              !this.host.querySelector(".charts-panel")
            )
              continue;
            if (!this.plot)
              this.plot = createWorkspaceChart(
                this.host.querySelector("#chart-preview")!,
                (marks, add) =>
                  void this.select(marks, add).catch(this.actions.error),
              );
            this.plot.update(result);
            this.controls();
            this.heading();
            this.comparison(result);
            this.status(this.summary(result));
            const notes = this.notes(result);
            this.host.querySelector("#chart-warnings")!.textContent = notes;
            this.host.querySelector<HTMLDetailsElement>(
              "#chart-notes",
            )!.hidden = !notes;
            this.guidance(result);
            this.selectionEnabled(result.rows.length > 0);
            this.dataTable();
          } catch (error) {
            if (request.generation === this.generation) {
              this.status(String(error));
              this.selectionEnabled(false);
              this.plot?.dispose();
              this.plot = undefined;
              this.host.querySelector("#chart-guidance")?.replaceChildren();
              this.host.querySelector("#chart-data")?.replaceChildren();
              this.host.querySelector("#chart-comparison")?.replaceChildren();
            }
          }
        }
      } finally {
        this.loading = false;
      }
    })();
    await this.work;
  }
  private status(value: string) {
    const e = this.host.querySelector("#chart-status");
    if (e) e.textContent = value;
  }
  private selectionEnabled(enabled: boolean) {
    const b = this.host.querySelector<HTMLButtonElement>("#chart-select-all");
    if (b) b.disabled = !enabled;
  }
  private fields(numeric = false) {
    const s = this.schema;
    if (!s) return [];
    return [
      ...(numeric
        ? s.numeric_fields || ["value", "lat", "lon", "time", "end"]
        : [
            ...s.canonical.filter(
              (f) => !["attrs", "geometry_wkt"].includes(f),
            ),
            "year_utc",
          ]),
      ...s.attributes
        .filter(
          (name) =>
            !numeric || Number(s.attribute_types?.[name]?.numeric_count) > 0,
        )
        .map((name) => `attribute:${name}`),
    ];
  }
  private controls() {
    const host = this.host.querySelector<HTMLElement>("#chart-controls");
    if (host) this.renderControls(host, "chart");
    this.heading();
  }
  private renderControls(host: HTMLElement, prefix: string) {
    const signature = JSON.stringify([
      this.config,
      this.presets,
      this.schemaKey,
      this.snapshot.field_roles,
      this.snapshot.layers?.map((l) => [l.source, l.count]),
      this.config.kind === "period"
        ? [this.result?.config.period_a, this.result?.config.period_b]
        : null,
    ]);
    if (host.dataset.signature === signature) return;
    const c = this.config;
    const detailsState = new Map(
      [...this.host.querySelectorAll<HTMLDetailsElement>("details")].map(
        (e) => [e.id, e.open],
      ),
    );
    const presetDraft =
      host.querySelector<HTMLInputElement>(`#${prefix}-preset-name`)?.value ||
      "";
    host.dataset.signature = signature;
    const text = (value: string) =>
      ({
        bar: "Bars",
        line: "Lines",
        area: "Area",
        scatter: "Scatter",
        histogram: "Histogram",
        boxplot: "Boxplot",
        heatmap: "Weekday/hour grid",
        period: "Period comparison",
        none: "Individual timestamps",
        hour: "Hour",
        day: "Day",
        week: "Week",
        month: "Month",
        year: "Year",
        category: "Categories",
        number: "Numbers",
        time: "Time",
      })[value] || fieldLabel(value);
    const options = (values: string[], current: string, label = text) =>
      values
        .map(
          (v) =>
            `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(label(v))}</option>`,
        )
        .join("");
    const field = (
      id: string,
      label: string,
      values: string[],
      current: string,
      extra = "",
      formatter = text,
    ) =>
      `<label class="field">${label}<select id="${prefix}-${id}" data-chart-key="${id}" ${extra}>${options(values, current, formatter)}</select></label>`;
    const numeric = this.fields(true),
      all = this.fields(),
      measurements = measurementFields(this.schema, this.snapshot.field_roles);
    const layers = this.snapshot.layers || [];
    const task = activeChartTask(c);
    const labels = (
      ["title", "x_label", "y_label", ...(c.y2 ? ["y2_label"] : [])] as const
    )
      .map(
        (key) =>
          `<label class="field">${{ title: "Chart title", x_label: c.kind === "heatmap" ? "Hour axis label" : "X axis label", y_label: c.kind === "heatmap" ? "Color scale label (include units)" : "Y axis label (include units)", y2_label: "Second Y axis label" }[key]}<input maxlength="256" data-chart-key="${key}" value="${esc(c[key as keyof ChartConfig] as string)}" placeholder="Automatic"></label>`,
      )
      .join("");
    const category = categoryField(this.snapshot.field_roles, this.schema);
    const unavailable = (task: ChartTask) =>
      ["compare", "composition", "periods"].includes(task)
        ? !category
        : task === "spread"
          ? !category || measurements.length < 1
          : ["distribution", "relationship"].includes(task) &&
            measurements.length < (task === "relationship" ? 2 : 1);
    const reason = (task: ChartTask) =>
      ["compare", "composition", "periods", "spread"].includes(task) &&
      !category
        ? "Assign a Category field in Field roles, or choose grouping in Customize."
        : task === "relationship"
          ? "Assign two numeric measurements in Field roles, or choose fields in Customize."
          : "Assign a numeric measurement in Field roles, or choose a field in Customize.";
    const effective = this.result?.config || c;
    const periodFields = (["a", "b"] as const)
      .map((name) => {
        const range = effective[`period_${name}`];
        return `<fieldset><legend>Period ${name.toUpperCase()} · UTC</legend>${["start", "end"].map((edge, i) => `<label class="field">${edge === "start" ? "Start (inclusive)" : "End (exclusive)"}<input id="${prefix}-period-${name}-${edge}" maxlength="128" value="${esc(range ? time(range[i]) : "")}" placeholder="YYYY-MM-DD HH:mm:ss" autocomplete="off"></label>`).join("")}</fieldset>`;
      })
      .join("");
    const periodControls =
      c.kind === "period"
        ? `<details class="chart-period-controls" id="${prefix}-periods"><summary>Comparison periods · ${c.period_a ? "Custom" : "Automatic halves of scope"}</summary><p class="muted">UTC starts included, ends excluded. Enter full dates and times; seconds and fractions are supported.</p><div class="chart-editor-grid">${periodFields}</div><div class="row"><button id="${prefix}-apply-periods">Apply periods</button><button id="${prefix}-auto-periods">Use automatic halves</button></div></details>`
        : "";
    host.innerHTML = `<div class="chart-starters" role="group" aria-label="Start with a question">${chartTasks.map((t) => `<button data-chart-task="${t.id}" aria-pressed="${task === t.id}" title="${esc(unavailable(t.id) ? reason(t.id) : t.id === "compare" ? "Count Events by " + fieldLabel(categoryField(this.snapshot.field_roles, this.schema) || "category") : t.hint)}" ${unavailable(t.id) ? 'disabled aria-describedby="chart-starter-note"' : ""}>${t.title}</button>`).join("")}</div>${chartTasks.some((t) => unavailable(t.id)) ? '<small id="chart-starter-note" class="muted">Unavailable starters need numeric measurements or a grouping field. Assign Field roles or choose fields in Customize.</small>' : ""}<div class="chart-quick-controls">${field("scope", "Events", ["all", "visible", "selected"], c.scope, "", scopeLabel)}${layers.length > 1 ? `<label class="field">Layer<select id="${prefix}-source" data-chart-key="source"><option value="">All event layers</option>${layers.map((l) => `<option value="${esc(l.source)}" ${c.source === l.source ? "selected" : ""}>${esc(l.source)}</option>`).join("")}</select></label>` : ""}</div>${periodControls}<div class="chart-role-actions"><button id="${prefix}-field-roles">Field roles…</button><small class="muted">${Object.keys(this.snapshot.field_roles || {}).length} assigned</small></div><details id="${prefix}-customize"><summary>Customize</summary><div class="chart-editor-grid">${field("kind", "Chart type", ["bar", "line", "area", "scatter", "histogram", "boxplot", "heatmap", "period"], c.kind)}${c.kind !== "histogram" ? field("x", c.kind === "boxplot" || c.kind === "period" ? "Group by" : c.kind === "heatmap" ? "Time field" : "X field", c.kind === "heatmap" ? ["time", "end"] : c.kind === "scatter" ? numeric : all, c.x) : ""}${field("y", c.kind === "histogram" ? "Distribution field" : "Y field", numeric, c.y, c.aggregate === "count" && !["scatter", "histogram", "boxplot"].includes(c.kind) ? "disabled" : "")}${!["scatter", "histogram", "boxplot"].includes(c.kind) ? field("aggregate", "Calculation", ["count", "sum", "mean", "min", "max"], c.aggregate, "", operationLabel) : ""}${!["heatmap", "period"].includes(c.kind) ? `<label class="field">Series<select id="${prefix}-group" data-chart-key="group"><option value="">No grouping</option>${options(all, c.group)}</select></label>` : ""}${c.x_axis === "time" && !["histogram", "heatmap", "period"].includes(c.kind) ? field("time_bucket", "UTC interval", ["none", ...timeBuckets], c.time_bucket) : ""}</div><details id="${prefix}-options"><summary>More chart options</summary>${!["histogram", "scatter", "heatmap", "period"].includes(c.kind) ? field("x_axis", "X axis", ["category", "number", ...(["time", "end"].includes(c.x) ? ["time"] : [])], c.x_axis) : ""}${["bar", "line", "area"].includes(c.kind) ? `<label class="field">Second Y field<select id="${prefix}-y2" data-chart-key="y2"><option value="">None</option>${options(numeric, c.y2)}</select></label><label class="check-row"><input type="checkbox" data-chart-key="stacked" ${c.stacked ? "checked" : ""}> Stack grouped series</label>` : ""}${c.kind === "scatter" ? `<label class="check-row"><input id="${prefix}-trendline" type="checkbox" data-chart-key="trendline" ${c.trendline ? "checked" : ""}> OLS trendline · full scope</label>` : ""}${c.kind === "histogram" ? `<label class="field">Bins<input id="${prefix}-bins" data-chart-key="bins" type="number" min="2" max="100" step="1" value="${c.bins}"></label>` : ""}<label class="field">Maximum displayed marks<input id="${prefix}-limit" data-chart-key="limit" type="number" min="${c.kind === "period" ? 2 : 1}" max="10000" step="1" value="${c.limit}"></label></details><details id="${prefix}-labels"><summary>Title, labels and units</summary>${labels}<small class="muted">Labels describe the chart; they do not convert values or units. Automatic units require a consistent explicit value_unit in the source.</small></details></details><details id="${prefix}-presets"><summary>Saved charts (${this.presets.length})</summary><div class="chart-presets-list">${this.presets.map((p, i) => `<div class="row"><button data-chart-load="${i}" class="grow">${esc(p.name)}</button><button data-chart-remove="${i}" aria-label="Remove chart preset ${esc(p.name)}">×</button></div>`).join("") || '<small class="muted">No saved charts yet.</small>'}</div><label class="field">Chart name<input id="${prefix}-preset-name" maxlength="128" placeholder="Name this chart…"></label><button id="${prefix}-save-preset">Save chart</button></details><button id="${prefix}-refresh-fields" class="secondary">Refresh available fields</button>`;
    for (const [id, open] of detailsState) {
      const details =
        host.querySelector<HTMLDetailsElement>(`#${id}`) ||
        this.host.querySelector<HTMLDetailsElement>(`#${id}`);
      if (details) details.open = open;
    }
    host.querySelector<HTMLInputElement>(`#${prefix}-preset-name`)!.value =
      presetDraft;
    host.onchange = (e) => {
      const el = e.target as HTMLInputElement;
      const key = el.dataset.chartKey as keyof ChartConfig | undefined;
      if (!key || (el instanceof HTMLInputElement && !el.reportValidity()))
        return;
      const next = {
        ...this.config,
        [key]:
          el.type === "checkbox"
            ? el.checked
            : el.type === "number"
              ? Number(el.value)
              : el.value,
      } as ChartConfig;
      if (key === "source") next.source = el.value || null;
      if (key === "x")
        next.x_axis =
          next.kind === "period"
            ? "category"
            : ["time", "end"].includes(next.x)
              ? "time"
              : numeric.includes(next.x)
                ? "number"
                : "category";
      if (key === "kind") {
        next.period_a = null;
        next.period_b = null;
        if (["heatmap", "period"].includes(next.kind)) {
          next.group = "";
          next.stacked = false;
          if (next.kind === "heatmap") {
            next.x = "time";
            next.x_axis = "time";
          } else {
            next.x =
              categoryField(this.snapshot.field_roles, this.schema) || "entity";
            next.x_axis = "category";
            next.limit = Math.max(2, next.limit);
          }
        }
        if (next.kind === "scatter") {
          next.x_axis = "number";
          if (!numeric.includes(next.x))
            next.x = numeric.find((f) => f !== next.y) || "time";
        }
        if (!["bar", "line", "area"].includes(next.kind)) {
          next.y2 = "";
          next.stacked = false;
        }
        if (next.kind !== "scatter") next.trendline = false;
        // Switching between different plot semantics can change which field or
        // calculation an axis represents (for example, Value to bin counts).
        if (
          !["bar", "line", "area"].includes(this.config.kind) ||
          !["bar", "line", "area"].includes(next.kind)
        ) {
          next.x_label = "";
          next.y_label = "";
          next.y2_label = "";
        }
      }
      // Field-specific labels must not survive a change to another field.
      if (key === "x") next.x_label = "";
      if (key === "y" || key === "aggregate") next.y_label = "";
      if (key === "y2") next.y2_label = "";
      this.applyConfig(next);
    };
    host.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.id === `${prefix}-auto-periods`) {
        this.applyConfig({ ...this.config, period_a: null, period_b: null });
        return;
      }
      if (b.id === `${prefix}-apply-periods`) {
        const captured = this.config;
        const generation = ++this.periodGeneration;
        const inputs = ["a-start", "a-end", "b-start", "b-end"].map((name) =>
          this.host.querySelector<HTMLInputElement>(
            `#${prefix}-period-${name}`,
          )!,
        );
        const drafts = inputs.map((input) => input.value.trim());
        this.periodWork = (async () => {
          const values: number[] = [];
          for (const [index, input] of inputs.entries()) {
            if (
              this.config !== captured ||
              generation !== this.periodGeneration
            )
              return;
            input.setCustomValidity("");
            try {
              values.push(
                (await call("time_parse", { value: drafts[index] })).epoch,
              );
            } catch {
              input.setCustomValidity("Enter a valid UTC date and time.");
              input.reportValidity();
              return;
            }
          }
          const a: [number, number] = [values[0], values[1]],
            b: [number, number] = [values[2], values[3]];
          if (this.config !== captured || generation !== this.periodGeneration)
            return;
          if (a[0] >= a[1] || b[0] >= b[1] || (a[0] < b[1] && b[0] < a[1])) {
            const input = inputs[0];
            input.setCustomValidity(
              "Choose two non-overlapping periods, each with its start before its end.",
            );
            input.reportValidity();
            return;
          }
          if (this.config === captured)
            this.applyConfig({ ...captured, period_a: a, period_b: b });
        })().catch(this.actions.error);
        return;
      }
      if (b.id === `${prefix}-field-roles`) {
        this.rolesEditor.open();
        return;
      }
      if (b.dataset.chartTask) {
        this.start(b.dataset.chartTask as ChartTask);
        return;
      }
      if (b.id === `${prefix}-refresh-fields`) {
        this.schemaKey = "";
        this.schemaRequestKey = "";
        this.signature = "";
        host.dataset.signature = "";
        void this.render(this.snapshot).catch(this.actions.error);
        return;
      }
      if (b.id === `${prefix}-save-preset`) {
        const input = host.querySelector<HTMLInputElement>(
          `#${prefix}-preset-name`,
        )!;
        const name = input.value.trim();
        if (!name) {
          input.setCustomValidity("Enter a chart name.");
          input.reportValidity();
          input.oninput = () => input.setCustomValidity("");
          return;
        }
        const found = this.presets.find((p) => p.name === name);
        if (found) found.config = { ...this.config };
        else if (this.presets.length < 32)
          this.presets.push({ name, config: { ...this.config } });
        else {
          this.actions.error(
            Error("A workspace supports up to 32 chart presets."),
          );
          return;
        }
      } else if (b.dataset.chartLoad !== undefined)
        this.config = { ...this.presets[Number(b.dataset.chartLoad)].config };
      else if (b.dataset.chartRemove !== undefined)
        this.presets.splice(Number(b.dataset.chartRemove), 1);
      else return;
      host.dataset.signature = "";
      this.applyConfig(this.config);
    };
    const quick = this.host.querySelector<HTMLElement>("#chart-start-controls");
    if (quick) {
      quick.replaceChildren(
        ...host.querySelectorAll(
          ".chart-starters, #chart-starter-note, .chart-quick-controls, .chart-period-controls",
        ),
      );
      quick.onclick = host.onclick;
      quick.onchange = host.onchange;
    }
  }
  private applyConfig(config: ChartConfig) {
    this.periodGeneration++;
    this.config = config;
    this.generation++;
    this.pending = undefined;
    this.result = undefined;
    this.selectionEnabled(false);
    this.signature = "";
    this.controls();
    this.host.querySelector("#chart-guidance")?.replaceChildren();
    this.host.querySelector("#chart-comparison")?.replaceChildren();
    void this.persist();
  }
  private start(task: ChartTask) {
    const fields = measurementFields(this.schema, this.snapshot.field_roles);
    const next = {
      ...defaultChart,
      scope: this.config.scope,
      source: this.config.source,
    };
    if (task === "compare") {
      const category = categoryField(this.snapshot.field_roles, this.schema);
      if (!category) return;
      next.x = category;
    }
    if (task === "time")
      Object.assign(next, {
        kind: "line",
        x: "time",
        x_axis: "time",
        time_bucket: suggestedTimeBucket(this.snapshot.time_bounds),
      });
    if (task === "spread") {
      const category = categoryField(this.snapshot.field_roles, this.schema);
      if (!category || !fields.length) return;
      Object.assign(next, { kind: "boxplot", x: category, y: fields[0] });
    }
    if (task === "patterns")
      Object.assign(next, { kind: "heatmap", x: "time", x_axis: "time" });
    if (task === "composition") {
      const category = categoryField(this.snapshot.field_roles, this.schema);
      if (!category) return;
      Object.assign(next, {
        kind: "area",
        x: "time",
        x_axis: "time",
        group: category,
        stacked: true,
        time_bucket: suggestedTimeBucket(
          this.snapshot.time_bounds,
          32,
          next.limit,
        ),
      });
    }
    if (task === "periods") {
      const category = categoryField(this.snapshot.field_roles, this.schema);
      if (!category) return;
      Object.assign(next, { kind: "period", x: category });
    }
    if (task === "distribution")
      Object.assign(next, { kind: "histogram", y: fields[0] || "value" });
    if (task === "relationship") {
      const pair = relationshipFields(fields, this.snapshot.field_roles);
      Object.assign(next, {
        kind: "scatter",
        x: pair[0] || "time",
        y: pair[1] || "value",
        x_axis: "number",
      });
    }
    this.applyConfig(next as ChartConfig);
  }
  private mark(row: any, axis = 0): ChartMark {
    return {
      x: row.x,
      series: row.series,
      value: this.config.kind === "scatter" ? row.y : null,
      axis,
    };
  }
  private rowMarks(row: any): ChartMark[] {
    return this.result?.config.y2
      ? [this.mark(row), this.mark(row, 1)]
      : [this.mark(row)];
  }
  private select(marks: ChartMark[], add = false): Promise<void> {
    const captured = this.result;
    if (!captured || !marks.length) return Promise.resolve();
    const config = JSON.stringify(captured.config);
    const work = this.selectionWork.then(async () => {
      if (!this.result) await this.work;
      const result = this.result;
      if (!result || JSON.stringify(result.config) !== config)
        throw Error("Chart changed; select records from the current chart.");
      this.status("Selecting matching source records…");
      try {
        await call("select_query", {
          config: result.config as ChartConfig,
          chart_marks: marks,
          mode: add ? "add" : "replace",
          expected_revision: result.revision,
        });
        await this.actions.selected();
        await this.work;
      } catch (error) {
        this.signature = "";
        await this.actions.selected();
        throw error;
      }
    });
    this.selectionWork = work.catch(() => {});
    return work;
  }
  private dataTable() {
    const host = this.host.querySelector("#chart-data"),
      details = this.host.querySelector<HTMLDetailsElement>(
        "#chart-data-details",
      );
    if (!host || !details?.open || !this.result) return;
    const start = this.tablePage * 25,
      rows = this.result.rows.slice(start, start + 25);
    const c = this.config;
    const pattern = c.kind === "heatmap",
      period = c.kind === "period";
    const xLabel = (r: any) =>
      pattern
        ? `${hourLabel(r.x)}–${hourLabel(r.x + 1)} UTC`
        : c.x_axis === "time" && c.kind !== "histogram"
          ? displayTime(r.x) + " UTC"
          : chartValue(
              r.range
                ? `${chartValue(r.range[0])} – ${chartValue(r.range[1])}`
                : r.x,
            );
    const seriesLabel = (r: any) =>
      pattern
        ? weekdays[r.series]
        : period
          ? periodLabel(r.series)
          : chartValue(r.series ?? "—");
    host.innerHTML = `<div class="chart-data-scroll"><table><thead><tr><th>${esc(pattern ? "Hour (UTC)" : fieldLabel(c.kind === "histogram" ? c.y : c.x))}</th><th>${pattern ? "Weekday" : period ? "Period" : "Series"}</th><th>Value</th>${c.y2 ? `<th>${esc(axisLabel(c, "y2", this.result))}</th>` : ""}<th>Records</th>${period ? "<th>B − A</th><th>Change %</th>" : ""}<th></th></tr></thead><tbody>${rows.map((r: any, i) => `<tr><td>${esc(xLabel(r))}</td><td>${esc(seriesLabel(r))}</td><td>${esc(r.box ? r.box.map(chartValue).join(" · ") : chartValue(r.y))}</td>${c.y2 ? `<td>${esc(chartValue(r.y2))}</td>` : ""}<td>${r.count}</td>${period ? `<td>${esc(r.change === null ? "—" : chartValue(r.change))}</td><td>${esc(r.percent_change === null ? "Undefined" : chartValue(r.percent_change) + "%")}</td>` : ""}<td><button data-chart-row="${start + i}" aria-label="Select source records for chart row ${start + i + 1}">Select</button></td></tr>`).join("")}</tbody></table></div><div class="row"><button data-chart-page="-1" ${start === 0 ? "disabled" : ""}>Previous</button><span>${this.result.rows.length ? start + 1 : 0}–${Math.min(start + 25, this.result.rows.length)} of ${this.result.rows.length}</span><button data-chart-page="1" ${start + 25 >= this.result.rows.length ? "disabled" : ""}>Next</button></div>`;
  }
  private summary(result: ChartReport) {
    return `${result.input_count.toLocaleString()} scoped records · ${result.excluded_count.toLocaleString()} without usable values · ${result.outside_period_count ? result.outside_period_count.toLocaleString() + " outside periods · " : ""}${result.rows.length.toLocaleString()} of ${result.total_marks.toLocaleString()} marks`;
  }
  private comparison(result: ChartReport) {
    let host = this.host.querySelector<HTMLElement>("#chart-comparison");
    if (!host) {
      host = document.createElement("div");
      host.id = "chart-comparison";
      this.host.querySelector("#chart-preview")!.after(host);
    }
    if (result.config.kind !== "period") {
      host.replaceChildren();
      return;
    }
    const groups = result.rows.filter((r: any) => r.series === 1) as any[];
    const window = (key: "period_a" | "period_b") =>
      (result.config[key] || []).map((t: number) => displayTime(t)).join(" → ");
    host.innerHTML = `<div class="chart-period-dates"><span>A: ${esc(window("period_a"))}</span><span>B: ${esc(window("period_b"))}</span><small>UTC · starts included, ends excluded</small></div>${
      groups.length
        ? `<div class="chart-data-scroll"><table><thead><tr><th>${esc(fieldLabel(result.config.x))}</th><th>A</th><th>B</th><th>B − A</th><th>Change %</th></tr></thead><tbody>${groups
            .slice(0, 5)
            .map(
              (r) =>
                `<tr><td>${esc(chartValue(r.x))}</td><td>${esc(r.before === null ? "—" : chartValue(r.before))}</td><td>${esc(r.after === null ? "—" : chartValue(r.after))}</td><td>${esc(r.change === null ? "—" : chartValue(r.change))}</td><td title="Percentage change is undefined when A is zero or a measurement is missing">${esc(r.percent_change === null ? "Undefined" : chartValue(r.percent_change) + "%")}</td></tr>`,
            )
            .join(
              "",
            )}</tbody></table></div>${groups.length > 5 ? `<small class="muted">First 5 of ${groups.length} displayed groups; see Chart data for all values and source selection.</small>` : ""}`
        : ""
    }`;
  }
  private notes(result: ChartReport) {
    const t = result.trend as any;
    return (
      result.warnings.join(" ") +
      (t
        ? ` OLS: y = ${chartValue(t.slope)}x + ${chartValue(t.intercept)}; R² ${chartValue(t.r_squared)} · ${t.count.toLocaleString()} complete pairs.`
        : "")
    );
  }
  private title() {
    return chartTitle(this.config, this.presets, this.result);
  }
  private heading() {
    const panel = this.host.querySelector<HTMLElement>(".charts-panel");
    if (panel) panel.dataset.chartKind = this.config.kind;
    const title = this.host.querySelector("#chart-title");
    if (title) title.textContent = this.title();
    const caption = this.host.querySelector("#chart-caption");
    if (caption)
      caption.textContent = [
        scopeLabel(this.config.scope),
        this.config.kind,
        this.config.x_axis === "time" &&
        !["histogram", "heatmap", "period"].includes(this.config.kind)
          ? intervalLabel(this.config.time_bucket) + " · UTC"
          : "",
        this.result?.value_metadata?.description || "",
      ]
        .filter(Boolean)
        .join(" · ");
  }
  private guidance(result: ChartReport) {
    const host = this.host.querySelector<HTMLElement>("#chart-guidance");
    if (!host) return;
    const c = this.config;
    const noValues =
      result.input_count > result.outside_period_count && !result.rows.length;
    const isTime =
      c.x_axis === "time" &&
      !["histogram", "boxplot", "scatter", "heatmap", "period"].includes(
        c.kind,
      );
    const nextBucket =
      timeBuckets[
        timeBuckets.indexOf(c.time_bucket as (typeof timeBuckets)[number]) + 1
      ];
    const range = result.value_extent;
    host.innerHTML = `${!result.input_count ? `<p>No Events in this scope. ${c.scope === "selected" ? "Select Events on the map or table, or choose Filtered Events." : "Check your filters and layer choice."}</p>` : ""}${noValues ? '<p>No usable numeric values for these fields in this scope. Try Event counts over time or choose another measurement in Customize.</p><button data-chart-suggest="counts">Show Event counts over time</button>' : ""}${result.outside_period_count ? `<p>${result.outside_period_count.toLocaleString()} scoped Events fall outside both comparison periods.</p>` : ""}${result.excluded_count ? `<p>${result.excluded_count.toLocaleString()} of ${result.input_count.toLocaleString()} Events lack usable values for this chart. Originals are retained.</p>` : ""}${result.limited ? `<p>Showing ${result.rows.length.toLocaleString()} of ${result.total_marks.toLocaleString()} marks. Selection covers displayed marks only; calculations use the full scope.</p>${isTime && nextBucket ? `<button data-chart-suggest="coarser">Use ${intervalLabel(nextBucket).toLowerCase()} UTC intervals</button>` : "<p>Narrow the grouping or filters, or adjust the mark limit in Customize.</p>"}` : ""}${range ? `<p>Source measurement range: ${esc(chartValue(range[0]))}–${esc(chartValue(range[1]))} ${esc(measurementLabel(c.y, result))}. ${!["histogram", "boxplot"].includes(c.kind) && c.aggregate !== "count" ? '<button data-chart-suggest="spread">Inspect spread and outliers</button>' : ""}</p>` : ""}`;
    host.onclick = (e) => {
      const action = (e.target as Element).closest<HTMLElement>(
        "[data-chart-suggest]",
      )?.dataset.chartSuggest;
      if (action === "counts") this.start("time");
      if (action === "coarser" && nextBucket)
        this.applyConfig({
          ...c,
          time_bucket: nextBucket,
          title: "",
          x_label: "",
          y_label: "",
        });
      if (action === "spread")
        this.applyConfig({
          ...c,
          kind: "boxplot",
          x: "entity",
          x_axis: "category",
          group: "",
          y2: "",
          trendline: false,
          title: "",
          x_label: "",
          y_label: "",
        });
    };
  }
  private syncDock() {
    const workspace = this.host.closest<HTMLElement>(".workspace");
    const inspector = this.host.closest<HTMLElement>(".inspector");
    if (!workspace || !inspector) return;
    workspace.classList.toggle("chart-docked", this.docked);
    workspace.classList.toggle("chart-mini", !this.docked);
    const notes = this.host.querySelector<HTMLDetailsElement>("#chart-notes");
    if (notes && notes.dataset.mini !== String(!this.docked)) {
      notes.open = this.docked;
      notes.dataset.mini = String(!this.docked);
    }
    const button = this.host.querySelector<HTMLButtonElement>("#chart-expand");
    if (button) {
      button.textContent = this.docked ? "Compact chart" : "Widen chart";
      button.setAttribute("aria-pressed", String(this.docked));
    }
  }
}
