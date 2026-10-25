import { call } from "./bridge";
import { runJob } from "./operation-job";
import {
  analysisPlan,
  analysisTasks,
  type AnalysisDraft,
  type AnalysisTask,
} from "./guided-analysis-model";
import { roleFields, numericCount } from "./field-roles";
import { fieldLabel, measurementFields } from "./chart-guidance";
import { escape as esc, type Snapshot } from "./types";
import "./workflow-dialogs.css";

export async function openGuidedAnalysis(
  snapshot: Snapshot,
  completed: (id: string) => Promise<void>,
) {
  document.querySelector<HTMLDialogElement>("#guided-analysis")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "guided-analysis";
  dialog.className = "workflow-dialog analysis-dialog";
  dialog.setAttribute("aria-labelledby", "guided-analysis-title");
  dialog.innerHTML = `<header><div><h2 id="guided-analysis-title">New analysis</h2><p>Calculated locally · no AI connection required</p></div><button data-close aria-label="Close new analysis">×</button></header><div class="workflow-body"><p role="status">Loading fields…</p></div>`;
  document.body.append(dialog);
  dialog.showModal();
  let abort: AbortController | undefined;
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = () =>
    dialog.close();
  dialog.addEventListener("close", () => {
    abort?.abort();
    dialog.remove();
  });
  // Other application shortcuts must not operate the workspace behind this dialog.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  try {
    const schema = await call("dataset_schema", {
      include_attribute_types: true,
      attribute_limit: 512,
    });
    let offset = schema.next_attribute_offset;
    while (offset != null) {
      if (!dialog.isConnected) return;
      const page = await call("dataset_schema", {
        include_attribute_types: true,
        attribute_limit: 512,
        attribute_offset: offset,
      });
      schema.attributes.push(...page.attributes);
      Object.assign((schema.attribute_types ||= {}), page.attribute_types);
      offset = page.next_attribute_offset;
    }
    if (!dialog.isConnected) return;
    const fields = roleFields(schema).filter((f) => f.length <= 256);
    const numeric = fields.filter((f) => numericCount(schema, f) > 0);
    const recommended = measurementFields(schema, snapshot.field_roles || {});
    const draft: AnalysisDraft = {
      task: "profile",
      scope: "visible",
      fields: ["entity", "time", "value"],
      method: "iqr",
      threshold: 1.5,
      source: null,
    };
    dialog.querySelector(".workflow-body")!.innerHTML =
      `<form id="analysis-form"><div class="analysis-layout"><fieldset class="analysis-tasks"><legend>Suggested analyses</legend>${analysisTasks.map((t) => `<label><input type="radio" name="task" value="${t.id}" ${t.id === draft.task ? "checked" : ""}><span>${t.title}</span></label>`).join("")}<p class="description">Source Events are retained. Results are saved with your workspace.</p></fieldset><section class="analysis-detail" aria-labelledby="analysis-detail-title"><div class="analysis-detail-heading"><h3 id="analysis-detail-title"></h3><p id="analysis-description" class="description"></p><p id="analysis-output"></p></div><div class="modal-grid"><label class="field">Scope<select id="analysis-scope"><option value="visible">Filtered Events</option><option value="all">All Events</option><option value="selected">Selected Events within filters</option></select></label><label class="field">Layer<select id="analysis-source"><option value="">All Event layers</option>${snapshot.layers.map((l) => `<option value="${esc(l.source)}">${esc(l.source)}</option>`).join("")}</select></label></div><p class="analysis-scope-summary">${snapshot.count.toLocaleString()} total · ${snapshot.visible.toLocaleString()} filtered · ${snapshot.selected_count.toLocaleString()} selected</p><div id="analysis-parameters"></div><p id="analysis-assumptions" class="notice"></p></section></div><p id="analysis-status" role="status" aria-live="polite"></p><footer><button type="button" data-cancel>Cancel</button><span class="spacer"></span><button type="submit" class="primary" id="run-guided-analysis">Run analysis</button></footer></form>`;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const status = dialog.querySelector<HTMLElement>("#analysis-status")!;
    const run = dialog.querySelector<HTMLButtonElement>(
      "#run-guided-analysis",
    )!;
    const cancel = dialog.querySelector<HTMLButtonElement>("[data-cancel]")!;
    let running = false;
    const draw = () => {
      const task = analysisTasks.find((t) => t.id === draft.task)!;
      dialog.querySelector("#analysis-detail-title")!.textContent = task.title;
      dialog.querySelector("#analysis-description")!.textContent =
        task.description;
      dialog.querySelector("#analysis-output")!.textContent = {
        profile:
          "Output · one summary per field, including missing values and numeric statistics",
        duplicates:
          "Output · matching groups, counts and a linked example Event",
        outliers:
          "Output · flagged measurements, scores and linked source Events",
        trajectories:
          "Output · one summary per entity, with distance, duration and speed",
      }[draft.task];
      const host = dialog.querySelector("#analysis-parameters")!;
      const choices = draft.task === "outliers" ? numeric : fields;
      host.innerHTML =
        draft.task === "trajectories"
          ? ""
          : `<fieldset class="analysis-fields"><legend>${draft.task === "outliers" ? "Measurement" : "Fields to examine"}</legend>${draft.task === "outliers" ? `<label class="field">Numeric field<select id="analysis-measurement">${choices.map((f) => `<option value="${esc(f)}" ${f === draft.fields[0] ? "selected" : ""}>${esc(fieldLabel(f))}</option>`).join("")}</select></label><div class="modal-grid"><label class="field">Method<select id="analysis-method"><option value="iqr">Interquartile range (IQR)</option><option value="zscore">Population z-score</option></select></label><label class="field">Threshold<input id="analysis-threshold" type="number" min="0.01" max="20" step="any" value="${draft.threshold}" required></label></div>` : `<div class="analysis-field-list">${choices.map((f) => `<label class="check-row"><input type="checkbox" data-analysis-field value="${esc(f)}" ${draft.fields.includes(f) ? "checked" : ""}>${esc(fieldLabel(f))}</label>`).join("")}</div><small>Choose up to ${draft.task === "profile" ? 16 : 8} fields. Imported source columns are retained.</small>`}</fieldset>`;
      dialog.querySelector("#analysis-assumptions")!.textContent =
        draft.task === "trajectories"
          ? "Distances join recorded samples by entity using WGS84 geodesics. Missing locations are excluded and same-time conflicts are disclosed. These are not reconstructed continuous routes."
          : draft.task === "outliers"
            ? "Outliers are review candidates, not errors. Missing and nonnumeric measurements are excluded. Source Events are retained."
            : draft.task === "duplicates"
              ? "Only the chosen fields define a match. Matching records may describe distinct real events; nothing is deleted."
              : "Profiles describe the chosen scope, including missing values and numeric completeness. No source values are changed.";
      run.disabled =
        snapshot.count === 0 || (draft.task === "outliers" && !numeric.length);
      if (!numeric.length && draft.task === "outliers")
        status.textContent =
          "No numeric measurements are available. Choose another analysis.";
    };
    draw();
    form.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name !== "task") return;
      draft.task = input.value as AnalysisTask;
      draft.fields =
        draft.task === "profile"
          ? ["entity", "time", "value"]
          : draft.task === "duplicates"
            ? ["entity", "time", "lat", "lon"]
            : [recommended[0] || numeric[0]].filter(Boolean);
      draft.method = "iqr";
      draft.threshold = 1.5;
      status.textContent = "";
      draw();
    });
    const close = () => (running ? abort?.abort() : dialog.close());
    cancel.onclick = close;
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
    dialog.addEventListener("cancel", (e) => {
      if (running) {
        e.preventDefault();
        abort?.abort();
      }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (running) return;
      running = true;
      abort = new AbortController();
      void (async () => {
        try {
          draft.scope = dialog.querySelector<HTMLSelectElement>(
            "#analysis-scope",
          )!.value as AnalysisDraft["scope"];
          draft.source =
            dialog.querySelector<HTMLSelectElement>("#analysis-source")!
              .value || null;
          if (draft.task === "outliers") {
            draft.fields = [
              dialog.querySelector<HTMLSelectElement>("#analysis-measurement")!
                .value,
            ];
            draft.method = dialog.querySelector<HTMLSelectElement>(
              "#analysis-method",
            )!.value as AnalysisDraft["method"];
            draft.threshold = dialog.querySelector<HTMLInputElement>(
              "#analysis-threshold",
            )!.valueAsNumber;
          } else if (draft.task !== "trajectories")
            draft.fields = [
              ...dialog.querySelectorAll<HTMLInputElement>(
                "[data-analysis-field]:checked",
              ),
            ].map((f) => f.value);
          const plan = analysisPlan(draft);
          const current = await call("snapshot", { compact: true });
          if (current.workspace_id !== snapshot.workspace_id)
            throw Error(
              "Workspace changed. Reopen New analysis for the current document.",
            );
          if (draft.scope === "selected" && !current.selected_count)
            throw Error(
              "Select Events before running a selected-scope analysis.",
            );
          form
            .querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLButtonElement
            >("input,select,button[type=submit]")
            .forEach((el) => (el.disabled = true));
          cancel.textContent = "Cancel analysis";
          cancel.focus({ preventScroll: true });
          status.setAttribute("role", "status");
          status.textContent = "Starting analysis…";
          const result = await runJob(
            "analytics_run",
            {
              plan,
              source: draft.source,
              expected_revision: current.revision,
              expected_workspace: snapshot.workspace_id,
            },
            {
              signal: abort.signal,
              progress: (p) => {
                status.textContent = `${p.message || "Calculating"}${p.total ? ` · ${p.progress.toLocaleString()} / ${p.total.toLocaleString()}` : ""}`;
              },
            },
          );
          running = false;
          dialog.close();
          await completed(result.result_id);
        } catch (error) {
          status.textContent = String(error);
          status.setAttribute("role", "alert");
        } finally {
          running = false;
          abort = undefined;
          form
            .querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLButtonElement
            >("input,select,button[type=submit]")
            .forEach((el) => (el.disabled = false));
          cancel.textContent = "Close";
        }
      })();
    };
  } catch (error) {
    if (dialog.isConnected)
      dialog.querySelector(".workflow-body")!.textContent = String(error);
  }
}
