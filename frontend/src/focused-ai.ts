import { call } from "./bridge";
import type { EngineContracts } from "./contracts";
import type { Snapshot } from "./types";
import "./focused-ai.css";

type Provider = "apple-local" | "connected";
type ExplainSource =
  { result_id: string } | { scan_id: string; finding_id: string };
type Tags = EngineContracts["assist_tags"]["result"];
const text = <K extends keyof HTMLElementTagNameMap>(tag: K, value: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
};
let activeDialog: FeatureDialog | undefined;
class FeatureDialog {
  dialog = document.createElement("dialog");
  body = document.createElement("div");
  controls = document.createElement("div");
  result = document.createElement("div");
  provider = document.createElement("select");
  disclosure = text("p", "Checking AI availability…");
  status = document.createElement("p");
  spinner = document.createElement("span");
  message = document.createElement("span");
  run = text("button", "Generate");
  cancel = text("button", "Close");
  footer = document.createElement("footer");
  busy = false;
  closed = false;
  job?: string;
  private cancelRequested = false;
  private providers: EngineContracts["assist_status"]["result"]["providers"] =
    [];
  constructor(title: string) {
    activeDialog?.close();
    activeDialog = this;
    this.dialog.className = "focused-ai-dialog";
    this.dialog.setAttribute("aria-label", title);
    const header = document.createElement("header");
    const close = text("button", "×");
    close.setAttribute("aria-label", "Close " + title);
    close.onclick = () => this.close();
    header.append(text("h2", title), close);
    this.body.className = "focused-ai-body";
    this.controls.className = "focused-ai-controls";
    this.result.className = "focused-ai-result";
    const label = text("label", "AI provider");
    label.className = "field";
    this.provider.id = "focused-ai-provider";
    label.append(this.provider);
    this.provider.disabled = true;
    this.disclosure.className = "description";
    this.status.className = "focused-ai-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.spinner.className = "focused-ai-spinner";
    this.spinner.setAttribute("aria-hidden", "true");
    this.spinner.hidden = true;
    this.status.append(this.spinner, this.message);
    this.body.append(
      label,
      this.disclosure,
      this.controls,
      this.result,
      this.status,
    );
    this.run.id = "focused-ai-generate";
    this.run.className = "primary";
    this.run.disabled = true;
    this.cancel.id = "focused-ai-cancel";
    this.cancel.onclick = () => (this.busy ? void this.stop() : this.close());
    this.footer.append(this.cancel, this.run);
    this.dialog.append(header, this.body, this.footer);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("close", () => {
      this.closed = true;
      if (activeDialog === this) activeDialog = undefined;
      if (this.job)
        void call("job_cancel", { job_id: this.job }).catch(() => {});
      this.dialog.remove();
    });
    this.provider.onchange = () => {
      localStorage.setItem(
        "chronoscope.focused-ai.provider",
        this.provider.value,
      );
      this.describe();
      this.result.replaceChildren();
    };
    document.body.append(this.dialog);
    this.dialog.showModal();
  }
  close() {
    if (this.job) void call("job_cancel", { job_id: this.job }).catch(() => {});
    this.dialog.close();
  }
  async stop() {
    this.cancelRequested = true;
    this.message.textContent = "Cancelling AI…";
    this.cancel.disabled = true;
    if (this.job)
      await call("job_cancel", { job_id: this.job }).catch((error) =>
        this.error(error),
      );
  }
  error(error: unknown) {
    this.message.textContent = String(error);
  }
  private describe() {
    const selected = this.providers.find((p) => p.id === this.provider.value);
    this.disclosure.textContent =
      this.provider.value === "apple-local"
        ? "Apple Intelligence processes this on your Mac. No text is sent to a model service."
        : "The supplied source text or result evidence will be sent to your connected SI model service. Chat history and action tools are excluded.";
    if (!selected?.available)
      this.disclosure.textContent =
        selected?.reason ||
        "No AI provider is available. Enable Apple Intelligence on a supported Mac or connect a model in SI settings.";
    this.run.disabled = !selected?.available;
  }
  async ready() {
    try {
      const state = await call("assist_status");
      if (this.closed) return;
      this.providers = state.providers;
      for (const p of state.providers) {
        const option = text(
          "option",
          p.label + (p.available ? "" : " · Unavailable"),
        );
        option.value = p.id;
        option.disabled = !p.available;
        this.provider.append(option);
      }
      const saved = localStorage.getItem("chronoscope.focused-ai.provider");
      this.provider.value =
        state.providers.find((p) => p.id === saved && p.available)?.id ||
        state.providers.find((p) => p.available)?.id ||
        "apple-local";
      this.provider.disabled = false;
      this.describe();
    } catch (error) {
      this.error(error);
    }
  }
  async generate(
    command: "assist_explain" | "assist_tags",
    args:
      | Omit<EngineContracts["assist_explain"]["args"], "provider">
      | Omit<EngineContracts["assist_tags"]["args"], "provider">,
    label: string,
  ) {
    if (this.busy || this.closed) return null;
    this.busy = true;
    this.cancelRequested = false;
    this.spinner.hidden = false;
    this.run.disabled = true;
    this.run.setAttribute("aria-busy", "true");
    const previous = this.run.textContent;
    this.run.textContent = label;
    this.provider.disabled = true;
    for (const input of this.controls.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input,select"))
      input.disabled = true;
    this.cancel.textContent = "Cancel AI";
    this.result.replaceChildren();
    this.message.textContent = label;
    try {
      const request = {
        command,
        arguments: { ...args, provider: this.provider.value as Provider },
      } as Extract<
        EngineContracts["job_start"]["args"],
        { command: "assist_explain" | "assist_tags" }
      >;
      const started = await call("job_start", request);
      this.job = started.job_id;
      if (this.closed || this.cancelRequested)
        await call("job_cancel", { job_id: this.job });
      for (;;) {
        const status = await call("job_status", { job_id: this.job });
        if (!this.closed) this.message.textContent = status.message || label;
        if (status.status === "completed") {
          const result = (await call("job_result", { job_id: this.job }))
            .result;
          return this.closed ? null : result;
        }
        if (["failed", "cancelled"].includes(status.status))
          throw new Error(
            status.status === "cancelled"
              ? "Cancelled. Nothing was changed."
              : status.error?.message ||
                  "AI request failed. Nothing was changed.",
          );
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    } catch (error) {
      if (!this.closed) this.error(error);
      return null;
    } finally {
      if (this.job)
        await call("job_release", { job_id: this.job }).catch(() => {});
      this.job = undefined;
      this.busy = false;
      this.spinner.hidden = true;
      this.run.removeAttribute("aria-busy");
      this.run.textContent = previous;
      this.provider.disabled = false;
      this.run.disabled = !this.providers.find(
        (p) => p.id === this.provider.value,
      )?.available;
      this.cancel.disabled = false;
      this.cancel.textContent = "Close";
      for (const input of this.controls.querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >("input,select"))
        input.disabled = false;
    }
  }
}
export async function explainResult(source: ExplainSource) {
  const d = new FeatureDialog("Explain result");
  d.controls.append(
    text(
      "p",
      "AI will explain this completed finding using its recorded method and evidence. The original calculation remains the source of truth.",
    ),
  );
  d.run.textContent = "Explain result";
  d.run.onclick = async () => {
    const result = (await d.generate(
      "assist_explain",
      {
        source:
          "result_id" in source
            ? { kind: "analysis", result_id: source.result_id }
            : { kind: "pattern", ...source },
      },
      "AI is explaining…",
    )) as EngineContracts["assist_explain"]["result"] | null;
    if (!result) return;
    const answer = text("p", result.text);
    answer.className = "focused-ai-answer";
    const details = document.createElement("details");
    details.append(
      text("summary", "Source evidence"),
      text("pre", JSON.stringify(result.evidence, null, 2)),
    );
    d.result.append(
      text("small", "AI-generated explanation · Review against the evidence"),
      answer,
    );
    if (result.source_changed)
      d.result.append(
        text(
          "p",
          "The workspace has changed. This explanation describes the earlier result and its recorded scope.",
        ),
      );
    d.result.append(details);
    d.message.textContent = "Explanation ready.";
  };
  await d.ready();
}
export async function suggestTags(
  snapshot: Snapshot,
  after: () => Promise<unknown>,
) {
  const d = new FeatureDialog("Suggest tags");
  if (
    !snapshot.selected_count ||
    snapshot.selected_count > 25 ||
    snapshot.selected.length !== snapshot.selected_count
  ) {
    d.disclosure.textContent =
      "Select between 1 and 25 Events to review tag suggestions. Larger selections must be split explicitly; records are never silently sampled.";
    return;
  }
  d.controls.append(
    text(
      "p",
      `${snapshot.selected_count} selected Events · Existing tags will be preserved. Unsaved note edits must be applied before generating suggestions.`,
    ),
  );
  const label = text("label", "Text to analyze");
  label.className = "field";
  const field = document.createElement("select");
  field.id = "focused-ai-field";
  for (const [id, name] of [
    ["note", "Analyst note"],
    ["label", "Event label"],
  ]) {
    const option = text("option", name);
    option.value = id;
    field.append(option);
  }
  label.append(field);
  d.controls.append(label);
  let preview: Tags | undefined;
  const apply = text("button", "Apply accepted tags");
  apply.id = "focused-ai-apply";
  apply.hidden = true;
  d.footer.insertBefore(apply, d.run);
  const discard = () => {
    preview = undefined;
    apply.hidden = true;
    d.result.replaceChildren();
  };
  field.onchange = discard;
  d.provider.addEventListener("change", discard);
  d.run.textContent = "Generate tag suggestions";
  d.run.onclick = async () => {
    discard();
    const result = (await d.generate(
      "assist_tags",
      {
        ids: snapshot.selected,
        field: field.value,
        expected_revision: snapshot.revision,
        expected_workspace: snapshot.workspace_id,
      },
      "AI is suggesting tags…",
    )) as Tags | null;
    if (!result) return;
    preview = result;
    const table = document.createElement("table");
    table.className = "focused-ai-tags";
    const head = document.createElement("thead");
    const heading = document.createElement("tr");
    for (const title of [
      "Accept",
      "Event and source text",
      "Suggested tags · editable",
    ])
      heading.append(text("th", title));
    head.append(heading);
    table.append(head);
    const body = document.createElement("tbody");
    for (const row of result.records) {
      const tr = document.createElement("tr");
      tr.dataset.eventId = row.id;
      const accept = document.createElement("input");
      accept.type = "checkbox";
      accept.checked = row.tags.length > 0;
      accept.disabled = row.skipped || !row.tags.length;
      accept.setAttribute("aria-label", "Accept tags for Event " + row.id);
      const select = document.createElement("td");
      select.append(accept);
      const source = document.createElement("td");
      source.append(
        text("strong", "Event " + row.id),
        text("p", row.text || "No text · skipped"),
      );
      if (row.existing_tags.length)
        source.append(
          text("small", "Existing: " + row.existing_tags.join(", ")),
        );
      const edits = document.createElement("td");
      const tags = document.createElement("input");
      tags.type = "text";
      tags.value = row.tags.join(", ");
      tags.disabled = row.skipped;
      tags.setAttribute("aria-label", "Suggested tags for Event " + row.id);
      tags.oninput = () => {
        accept.disabled = !tags.value.trim();
        accept.checked = !!tags.value.trim();
      };
      edits.append(tags);
      tr.append(select, source, edits);
      body.append(tr);
    }
    table.append(body);
    d.result.append(
      text(
        "p",
        "AI-generated suggestions. Review each source record and edit or uncheck tags before applying.",
      ),
      table,
    );
    d.message.textContent = `${result.processed_count} ${result.processed_count === 1 ? "Event" : "Events"} processed · ${result.skipped_count} blank ${result.skipped_count === 1 ? "Event" : "Events"} skipped. Nothing has been changed.`;
    apply.hidden = false;
  };
  apply.onclick = async () => {
    if (!preview || d.busy) return;
    const items = [
      ...d.result.querySelectorAll<HTMLTableRowElement>("tr[data-event-id]"),
    ]
      .filter(
        (row) =>
          row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
            .checked,
      )
      .map((row) => ({
        id: row.dataset.eventId!,
        tags: row
          .querySelector<HTMLInputElement>('input[type="text"]')!
          .value.split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }));
    if (!items.length) {
      d.message.textContent = "Choose at least one tag suggestion to apply.";
      return;
    }
    apply.disabled = true;
    d.run.disabled = true;
    apply.textContent = "Applying tags…";
    try {
      await call("assist_tags_apply", {
        items,
        expected_revision: preview.revision,
        expected_workspace: preview.workspace_id,
      });
      await after();
      d.close();
    } catch (error) {
      d.error(error);
    } finally {
      apply.disabled = false;
      d.run.disabled = false;
      apply.textContent = "Apply accepted tags";
    }
  };
  try {
    const schema = await call("dataset_schema", {
      include_attribute_types: true,
      attribute_limit: 512,
    });
    for (const name of schema.attributes)
      if (schema.attribute_types?.[name]?.kind !== "numeric") {
        const option = text("option", "Imported · " + name);
        option.value = "attribute:" + name;
        field.append(option);
      }
  } catch (error) {
    d.error(error);
  }
  await d.ready();
}

/** Fixed native/MCP actions exercise the real controls without arbitrary UI scripting. */
export async function focusedUI(
  args: EngineContracts["assist_ui"]["args"],
  snapshot: Snapshot,
  after: () => Promise<unknown>,
) {
  if (args.action === "open-tags") await suggestTags(snapshot, after);
  if (args.action === "open-explain") {
    const source = args.source!;
    if (source.result_id) await explainResult({ result_id: source.result_id });
    else
      await explainResult({
        scan_id: source.scan_id!,
        finding_id: source.finding_id!,
      });
  }
  if (args.action === "close") activeDialog?.close();
  if (args.action === "cancel") await activeDialog?.stop();
  if (args.action === "generate") {
    const d = activeDialog;
    if (!d || d.closed || d.busy)
      throw Error("Open an idle AI feature dialog first");
    const option = [...d.provider.options].find(
      (option) => option.value === args.provider && !option.disabled,
    );
    if (!option) throw Error("The requested AI provider is unavailable");
    d.provider.value = args.provider!;
    d.provider.dispatchEvent(new Event("change"));
    if (args.field) {
      const field =
        d.controls.querySelector<HTMLSelectElement>("#focused-ai-field");
      if (
        !field ||
        ![...field.options].some((option) => option.value === args.field)
      )
        throw Error("Choose an available text field");
      field.value = args.field;
      field.dispatchEvent(new Event("change"));
    }
    d.run.click();
  }
  const d = activeDialog;
  return {
    open: !!d && !d.closed,
    busy: d?.busy || false,
    status: d?.message.textContent || "",
    provider: d?.provider.value || "",
    field:
      d?.controls.querySelector<HTMLSelectElement>("#focused-ai-field")
        ?.value || "",
    explanation:
      d?.result.querySelector(".focused-ai-answer")?.textContent || "",
    tag_rows: d?.result.querySelectorAll("tr[data-event-id]").length || 0,
  };
}
