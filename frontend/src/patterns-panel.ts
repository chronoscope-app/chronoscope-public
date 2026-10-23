import { explainResult } from "./focused-ai";
import { call } from "./bridge";
import { escape as esc, type Snapshot } from "./types";
import { fieldLabel } from "./charts-panel";
import type { EngineContracts } from "./contracts";
type Config = NonNullable<EngineContracts["pattern_scan"]["args"]["config"]>;
type Response = EngineContracts["pattern_scan"]["result"];
type Finding = NonNullable<Response["report"]>["findings"][number];
const defaults = {
  scope: "visible" as const,
  fields: [] as string[],
  minimum_records: 20,
  correlation_threshold: 0.6,
  outlier_multiplier: 1.5,
};
interface Actions {
  prepare: () => Promise<void>;
  selected: () => Promise<void>;
  table: () => Promise<void>;
  error: (e: unknown) => void;
}
export class PatternsPanel {
  private config: Config = { ...defaults };
  private result?: Response;
  private current?: Response;
  private request = 0;
  private workspaceGeneration = 0;
  private job?: string;
  private selecting = false;
  private running = false;
  private message = "Press Find patterns to scan the current filtered data.";
  private schemaKey = "";
  private fieldOptions: string[] = [];
  private work: Promise<void> = Promise.resolve();
  constructor(
    private host: HTMLElement,
    private actions: Actions,
  ) {
    this.host.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-pattern-explain]",
      );
      if (button && this.result)
        void explainResult({
          scan_id: this.result.scan_id,
          finding_id: button.dataset.patternExplain!,
        }).catch(this.actions.error);
    });
  }
  private get visible() {
    return !!this.host.querySelector(".pattern-scan");
  }
  reset() {
    this.workspaceGeneration++;
    this.config.fields = [];
    this.config.scope = "visible";
    this.message = "Press Find patterns to scan the current filtered data.";
    if (this.job) void call("job_cancel", { job_id: this.job }).catch(() => {});
    this.result = undefined;
    this.current = undefined;
    this.schemaKey = "";
    this.request++;
  }
  async idle() {
    await this.work;
  }
  render(snapshot: Snapshot, manual: string, manualFindings: string) {
    if (!this.visible) {
      this.host.innerHTML = `<section class="pattern-scan"><h3>Patterns</h3><div class="pattern-scan-actions"><button type="button" class="primary" id="find-patterns">Find patterns</button><button type="button" id="cancel-pattern-scan" hidden>Cancel</button><select id="pattern-scan-scope" aria-label="Pattern scan scope"><option value="visible">Filtered records</option><option value="selected">Selected filtered records</option></select></div><p id="pattern-scan-status" role="status" aria-live="polite"></p><details id="pattern-scan-options"><summary>Scan options</summary><label class="field">Minimum numeric records<input id="pattern-minimum" type="number" min="4" max="100000" value="${this.config.minimum_records}"></label><label class="field">Minimum relationship strength |r|<input id="pattern-correlation" type="number" min="0" max="1" step="0.05" value="${this.config.correlation_threshold}"></label><label class="field">Outlier fence / × IQR<input id="pattern-iqr" type="number" min="0.5" max="10" step="0.5" value="${this.config.outlier_multiplier}"></label><p class="muted">Fields: leave unchecked for automatic choices, or choose up to eight measurements.</p><div id="pattern-scan-fields" class="pattern-scan-fields"></div></details><div id="pattern-scan-results"></div></section><details id="pattern-manual"><summary>Spatial and custom analysis</summary>${manual}<div id="pattern-manual-findings"></div></details>`;
      (
        this.host.querySelector("#pattern-scan-scope") as HTMLSelectElement
      ).value = this.config.scope || "visible";
      this.host
        .querySelector("#find-patterns")!
        .addEventListener("click", () => {
          this.work = this.run().catch(this.actions.error);
        });
      this.host
        .querySelector("#cancel-pattern-scan")!
        .addEventListener("click", () => {
          if (this.job)
            void call("job_cancel", { job_id: this.job }).catch(
              this.actions.error,
            );
        });
      this.host
        .querySelector("#pattern-scan-scope")!
        .addEventListener("change", (e) => {
          this.config.scope = (e.target as HTMLSelectElement).value as
            "visible" | "selected";
          void this.lookup().catch(this.actions.error);
        });
      for (const [id, key] of [
        ["pattern-minimum", "minimum_records"],
        ["pattern-correlation", "correlation_threshold"],
        ["pattern-iqr", "outlier_multiplier"],
      ] as const) {
        this.host.querySelector(`#${id}`)!.addEventListener("change", (e) => {
          this.config[key] = Number((e.target as HTMLInputElement).value);
          void this.lookup().catch(this.actions.error);
        });
      }
      this.host
        .querySelector("#pattern-scan-options")!
        .addEventListener("toggle", () => {
          if (
            (
              this.host.querySelector(
                "#pattern-scan-options",
              ) as HTMLDetailsElement
            )?.open
          )
            void this.fields(snapshot).catch(this.actions.error);
        });
      this.host
        .querySelector("#pattern-scan-results")!
        .addEventListener("click", (e) => {
          const target = (e.target as Element).closest<HTMLButtonElement>(
            "[data-pattern-evidence]",
          );
          if (target)
            this.work = this.select(
              target.dataset.patternEvidence!,
              (e as MouseEvent).shiftKey,
            ).catch(this.actions.error);
        });
    }
    this.host.querySelector("#pattern-manual-findings")!.innerHTML =
      manualFindings;
    if (!this.running) void this.lookup().catch(this.actions.error);
    this.draw();
  }
  private async lookup() {
    const request = ++this.request;
    const current = await call("pattern_scan", {
      config: this.config,
      cached_only: true,
    });
    if (request !== this.request) return;
    this.current = current;
    if (current.report) this.result = current;
    this.draw();
  }
  private async fields(snapshot: Snapshot) {
    const key = JSON.stringify([
      snapshot.name,
      snapshot.count,
      snapshot.layers?.map((l) => l.source),
    ]);
    if (this.schemaKey !== key) {
      const schema = await call("dataset_schema", {
        include_attribute_types: true,
        attribute_limit: 512,
      });
      let next = schema.next_attribute_offset;
      while (next != null) {
        const page = await call("dataset_schema", {
          include_attribute_types: true,
          attribute_limit: 512,
          attribute_offset: next,
        });
        schema.attributes.push(...page.attributes);
        Object.assign((schema.attribute_types ||= {}), page.attribute_types);
        next = page.next_attribute_offset;
      }
      this.fieldOptions = [
        "value",
        "lat",
        "lon",
        ...schema.attributes
          .filter(
            (f) => (schema.attribute_types?.[f]?.numeric_count as number) > 0,
          )
          .map((f) => `attribute:${f}`),
      ].filter((f) => f.length <= 256);
      this.schemaKey = key;
    }
    if (!this.visible) return;
    const host = this.host.querySelector("#pattern-scan-fields")!;
    host.innerHTML = this.fieldOptions
      .map(
        (f) =>
          `<label class="check-row"><input type="checkbox" value="${esc(f)}" ${this.config.fields?.includes(f) ? "checked" : ""} ${this.running ? "disabled" : ""}>${esc(fieldLabel(f))}</label>`,
      )
      .join("");
    host.querySelectorAll<HTMLInputElement>("input").forEach((input) =>
      input.addEventListener("change", () => {
        const fields = Array.from(
          host.querySelectorAll<HTMLInputElement>("input:checked"),
        ).map((e) => e.value);
        if (fields.length > 8) {
          input.checked = false;
          this.actions.error("Choose at most eight measurement fields.");
          return;
        }
        this.config.fields = fields;
        void this.lookup().catch(this.actions.error);
      }),
    );
  }
  private async run() {
    if (this.running) return;
    const workspaceGeneration = this.workspaceGeneration;
    this.running = true;
    this.message = "Preparing scan…";
    this.draw();
    try {
      await this.actions.prepare();
      if (workspaceGeneration !== this.workspaceGeneration) return;
      const config = structuredClone(this.config);
      const job = await call("job_start", {
        command: "pattern_scan",
        arguments: { config },
      });
      this.job = job.job_id;
      for (;;) {
        const state = await call("job_result", { job_id: this.job });
        if (workspaceGeneration !== this.workspaceGeneration) {
          if (
            state.status === "completed" ||
            state.status === "failed" ||
            state.status === "cancelled"
          )
            break;
          await call("job_cancel", { job_id: this.job });
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        this.message = state.message || "Scanning…";
        this.drawStatus();
        if (state.status === "completed") {
          this.result = state.result as Response;
          this.message = this.result.cache_hit
            ? "Reused cached results."
            : "Scan complete.";
          await this.lookup();
          break;
        }
        if (state.status === "cancelled") {
          this.message = "Scan cancelled. Previous results remain available.";
          break;
        }
        if (state.status === "failed")
          throw Error(state.error?.message || "Pattern scan failed");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      this.message = String(error);
      throw error;
    } finally {
      if (this.job)
        await call("job_release", { job_id: this.job }).catch(() => {});
      this.job = undefined;
      this.running = false;
      this.draw();
    }
  }
  private async select(id: string, add: boolean) {
    if (
      this.selecting ||
      !this.result ||
      this.result.scan_id !== this.current?.scan_id ||
      !this.current.report
    )
      return;
    this.selecting = true;
    this.drawStatus();
    try {
      await call("select_query", {
        pattern_scan_id: this.result.scan_id,
        pattern_finding_id: id,
        mode: add ? "add" : "replace",
      });
      await this.actions.selected();
      await this.actions.table();
      await this.lookup();
    } finally {
      this.selecting = false;
      this.drawStatus();
    }
  }
  private drawStatus() {
    if (!this.visible) return;
    (this.host.querySelector("#find-patterns") as HTMLButtonElement).disabled =
      this.running;
    (
      this.host.querySelector("#cancel-pattern-scan") as HTMLButtonElement
    ).hidden = !this.running;
    this.host
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "#pattern-scan-options input,#pattern-scan-scope",
      )
      .forEach((e) => (e.disabled = this.running));
    const stale =
      !!this.result &&
      (this.result.scan_id !== this.current?.scan_id || !this.current?.report);
    this.host.querySelector("#pattern-scan-status")!.textContent = this.running
      ? this.message
      : stale
        ? "Data, scope, scan options or cached results changed. Press Find patterns to update."
        : this.result
          ? `${this.result.report?.input_count.toLocaleString()} scoped records · ${this.result.report?.findings.length} candidates · cached on this computer`
          : this.message;
    this.host
      .querySelectorAll<HTMLButtonElement>(
        "[data-pattern-evidence],[data-pattern-explain]",
      )
      .forEach((e) => (e.disabled = stale || this.running || this.selecting));
  }
  private draw() {
    if (!this.visible) return;
    this.drawStatus();
    const result = this.result?.report;
    const host = this.host.querySelector("#pattern-scan-results")!;
    if (!result) {
      host.removeAttribute("data-result");
      host.innerHTML =
        '<p class="muted">The scan checks values, relationships, trends, gaps and recording rhythms. Review field meanings and collection schedules before interpreting a candidate.</p>';
      return;
    }
    const statistical = result.findings.filter(
      (f) => !["missing", "duplicates"].includes(f.kind),
    );
    const quality = result.findings.filter((f) =>
      ["missing", "duplicates"].includes(f.kind),
    );
    const signature = this.result!.scan_id;
    if (host.getAttribute("data-result") !== signature) {
      host.setAttribute("data-result", signature);
      host.innerHTML = `<p class="pattern-scan-summary">${result.sampled ? "Sampled" : "All scoped"} records analyzed. ${result.inspected_fields.length} columns inspected; ${result.numeric_fields.length} varying numeric fields after duplicate checks.</p><details><summary>Methods and coverage</summary><p>Columns: ${esc(result.inspected_fields.map(fieldLabel).join(", "))}.</p><ul>${result.checks.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>${result.profiles?.length ? `<div class="pattern-example-table"><table><thead><tr><th>Field</th><th>Numeric</th><th>Excluded numeric</th><th>Missing/blank</th></tr></thead><tbody>${(result.profiles as Record<string, unknown>[]).map((p) => `<tr><td>${esc(fieldLabel(String(p.field)))}</td><td>${esc(String(p.numeric_count))}</td><td>${esc(String(p.numeric_excluded))}</td><td>${esc(String(p.missing_or_blank_count))}</td></tr>`).join("")}</tbody></table></div>` : ""}${result.warnings.map((v) => `<p>${esc(v)}</p>`).join("")}</details>${statistical.length ? statistical.map((f) => this.card(f)).join("") : '<p class="notice">No statistical candidates met the screening rules in this scope. This does not establish that the data has no patterns.</p>'}${quality.length ? `<details class="pattern-data-quality"><summary>Data quality · ${quality.length} findings</summary>${quality.map((f) => this.card(f)).join("")}</details>` : ""}`;
    }
    this.drawStatus();
  }
  private card(f: Finding) {
    const format = (value: unknown) =>
      typeof value === "number"
        ? new Intl.NumberFormat(undefined, {
            maximumSignificantDigits: 7,
          }).format(value)
        : value == null
          ? "—"
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
    const examples = f.examples as Record<string, unknown>[];
    const metrics = f.metrics as Record<string, unknown>;
    const duration = (seconds: number) => {
      const [unit, label] =
        seconds >= 86400
          ? [86400, "days"]
          : seconds >= 3600
            ? [3600, "hours"]
            : seconds >= 60
              ? [60, "minutes"]
              : [1, "seconds"];
      return `${format(seconds / Number(unit))} ${label}`;
    };
    const summary =
      f.kind === "periodicity"
        ? `A candidate cycle of about ${duration(Number(metrics.period_seconds))} contributes ${format(Number(metrics.positive_frequency_power_fraction) * 100)}% of positive-frequency power.`
        : f.kind === "gaps"
          ? `${format(f.count)} of ${format(f.denominator)} positive recording intervals exceed ${duration(Number(metrics.threshold_seconds))}.`
          : f.summary;

    return `<article class="pattern-card" data-pattern-kind="${esc(f.kind)}"><h4>${esc(f.title)}</h4><p>${esc(summary)}</p><button type="button" data-pattern-evidence="${esc(f.id)}" title="Select every supporting source record and open its attribute table. Shift-click adds to selection.">Select supporting records</button><button type="button" class="secondary pattern-ai-action" data-pattern-explain="${esc(f.id)}">Explain result</button><details><summary>Method and examples</summary><p>${esc(f.method)}</p><dl>${Object.entries(
      f.metrics as Record<string, unknown>,
    )
      .map(
        ([k, v]) =>
          `<dt>${esc(k.replaceAll("_", " "))}</dt><dd>${esc(format(v))}</dd>`,
      )
      .join(
        "",
      )}</dl><p>Up to five source-record examples; these examples are not the full evidence set.</p>${
      examples.length
        ? `<div class="pattern-example-table"><table><thead><tr>${Object.keys(
            examples[0],
          )
            .map((k) => `<th>${esc(fieldLabel(k))}</th>`)
            .join("")}</tr></thead><tbody>${examples
            .map(
              (row) =>
                `<tr>${Object.keys(examples[0])
                  .map(
                    (k) =>
                      `<td>${esc(k === "event_id" ? String(row[k]) : k === "time" && typeof row[k] === "number" ? new Date(Number(row[k]) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC") : format(row[k]))}</td>`,
                  )
                  .join("")}</tr>`,
            )
            .join("")}</tbody></table></div>`
        : "<p>No examples available.</p>"
    }</details></article>`;
  }
}
