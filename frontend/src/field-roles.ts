import { call } from "./bridge";
import { escape as esc, type Snapshot } from "./types";
import type { EngineContracts } from "./contracts";

export type FieldRole =
  | "measurement"
  | "category"
  | "identifier"
  | "timestamp"
  | "coordinate"
  | "unit"
  | "ignore";
export type FieldRoles = Record<string, FieldRole>;
export type FieldSchema = EngineContracts["dataset_schema"]["result"];
export const roleNames: Record<FieldRole, string> = {
  measurement: "Measurement",
  category: "Category",
  identifier: "Identifier",
  timestamp: "Date/time",
  coordinate: "Coordinate",
  unit: "Currency / unit",
  ignore: "Exclude from suggestions",
};
export const roleFields = (schema: FieldSchema) => [
  ...schema.canonical.filter((f) => f !== "attrs"),
  "time_utc",
  "year_utc",
  ...schema.attributes.map((name) => `attribute:${name}`),
];
export function numericCount(schema: FieldSchema, field: string): number {
  return field.startsWith("attribute:")
    ? Number(schema.attribute_types?.[field.slice(10)]?.numeric_count || 0)
    : Number(
        schema.numeric_counts?.[field === "year_utc" ? "time" : field] || 0,
      );
}
export const numericRoleAllowed = (field: string) =>
  field.startsWith("attribute:") ||
  ["value", "lat", "lon", "time", "end", "year_utc"].includes(field);

/** Bounded, searchable editor for dataset metadata; never a row-data editor. */
export class FieldRolesEditor {
  private dialog?: HTMLDialogElement;
  private schema?: FieldSchema;
  private snapshot?: Snapshot;
  private base: FieldRoles = {};
  private draft: Record<string, FieldRole | null> = {};
  private limit = 100;
  private saving = false;
  private work: Promise<void> = Promise.resolve();
  constructor(private saved: () => Promise<void>) {}
  update(schema: FieldSchema | undefined, snapshot: Snapshot) {
    const changed =
      this.schema !== schema ||
      this.snapshot?.count !== snapshot.count ||
      JSON.stringify(this.snapshot?.field_roles) !==
        JSON.stringify(snapshot.field_roles);
    this.schema = schema;
    this.snapshot = snapshot;
    if (changed && this.dialog?.open) this.rows();
  }
  idle() {
    return this.work;
  }
  close() {
    this.dialog?.close();
  }
  open() {
    if (!this.schema || !this.snapshot) return;
    if (this.dialog) {
      this.dialog.focus();
      return;
    }
    this.base = { ...this.snapshot.field_roles };
    this.draft = {};
    this.limit = 100;
    const dialog = document.createElement("dialog");
    dialog.className = "field-roles-dialog";
    dialog.setAttribute("aria-labelledby", "field-roles-title");
    dialog.innerHTML = `<header><h2 id="field-roles-title">Field roles</h2><button type="button" data-close aria-label="Close field roles">×</button></header><p>Tell chart starters what each column means. Explicit measurements are preferred; categories guide Compare groups. Automatic uses the usual name and numeric checks.</p><p class="muted">Roles do not rewrite values, convert currencies or units, or change Event Time. Date/time and currency/unit columns are excluded from measurement suggestions. Use import mapping to choose a different Event clock. Existing charts keep their configured fields; choose a starter to use your roles.</p><div class="field-roles-search"><label class="field">Find a field<input id="field-roles-search" type="search" placeholder="Search canonical and imported fields…"></label><label class="check-row"><input id="field-roles-assigned" type="checkbox"> Assigned only</label></div><div class="field-roles-scroll"><table><thead><tr><th>Field</th><th>Role</th><th>Numeric values · entire dataset</th></tr></thead><tbody id="field-roles-rows"></tbody></table></div><div class="row"><small id="field-roles-coverage" class="muted"></small><button id="field-roles-more">Show 100 more</button></div><p id="field-roles-status" role="status" aria-live="polite"></p><footer><small id="field-roles-pending"></small><span class="spacer"></span><button type="button" data-close>Cancel</button><button type="button" id="field-roles-apply" class="primary">Apply roles</button></footer>`;
    document.body.append(dialog);
    this.dialog = dialog;
    dialog
      .querySelectorAll("[data-close]")
      .forEach((b) => b.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("cancel", (e) => {
      if (this.saving) e.preventDefault();
    });
    // Keep workspace navigation/playback shortcuts out of this modal. Handle
    // Escape here before the app's global Escape handler prevents native cancel.
    dialog.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (!this.saving) dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      this.dialog = undefined;
      this.draft = {};
    });
    dialog
      .querySelector("#field-roles-search")!
      .addEventListener("input", () => {
        this.limit = 100;
        this.rows();
      });
    dialog
      .querySelector("#field-roles-assigned")!
      .addEventListener("change", () => {
        this.limit = 100;
        this.rows();
      });
    dialog.querySelector("#field-roles-more")!.addEventListener("click", () => {
      this.limit += 100;
      this.rows();
    });
    dialog
      .querySelector("#field-roles-rows")!
      .addEventListener("change", (e) => {
        const select = e.target as HTMLSelectElement,
          field = select.dataset.roleField;
        if (!field || this.saving) return;
        const next = select.value ? (select.value as FieldRole) : null;
        if (next === (this.base[field] || null)) delete this.draft[field];
        else this.draft[field] = next;
        this.pending();
      });
    dialog
      .querySelector("#field-roles-apply")!
      .addEventListener("click", () => {
        this.work = this.apply().catch((error) => {
          if (this.dialog)
            this.dialog.querySelector("#field-roles-status")!.textContent =
              String(error);
        });
      });
    this.rows();
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("#field-roles-search")!.focus();
  }
  private pending() {
    if (!this.dialog) return;
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-close]")
      .forEach((b) => (b.disabled = this.saving));
    const count = Object.keys(this.draft).length;
    this.dialog.querySelector("#field-roles-pending")!.textContent =
      `${count} pending change${count === 1 ? "" : "s"} · saved with this workspace`;
    this.dialog.querySelector<HTMLButtonElement>(
      "#field-roles-apply",
    )!.disabled = !count || this.saving;
  }
  private rows() {
    const dialog = this.dialog,
      schema = this.schema,
      snapshot = this.snapshot;
    if (!dialog || !schema || !snapshot) return;
    const search = dialog
      .querySelector<HTMLInputElement>("#field-roles-search")!
      .value.trim()
      .toLowerCase();
    const assigned = dialog.querySelector<HTMLInputElement>(
      "#field-roles-assigned",
    )!.checked;
    const current = snapshot.field_roles || {};
    const available = new Set(roleFields(schema));
    const effective = (field: string) =>
      field in this.draft ? this.draft[field] : current[field] || null;
    const fields = [...new Set([...available, ...Object.keys(current)])].filter(
      (f) =>
        (!search || f.toLowerCase().includes(search)) &&
        (!assigned || !!effective(f)),
    );
    dialog.querySelector("#field-roles-rows")!.innerHTML =
      fields
        .slice(0, this.limit)
        .map((field) => {
          const numeric = numericCount(schema, field),
            role = effective(field),
            exists = available.has(field);
          return `<tr><td title="${esc(field)}">${esc(field.startsWith("attribute:") ? field.slice(10) : field)}<small class="muted">${exists ? (field.startsWith("attribute:") ? "Imported column" : "Canonical / derived field") : "Unavailable in current data · reset to Automatic to remove"}</small></td><td><select data-role-field="${esc(field)}" aria-label="Role for ${esc(field)}" ${this.saving ? "disabled" : ""}><option value="" ${!role ? "selected" : ""}>Automatic</option>${Object.entries(
            roleNames,
          )
            .map(
              ([value, name]) =>
                `<option value="${value}" ${role === value ? "selected" : ""} ${!exists || (value === "measurement" && !numericRoleAllowed(field)) ? "disabled" : ""}>${name}</option>`,
            )
            .join(
              "",
            )}</select></td><td>${numericRoleAllowed(field) ? `${numeric.toLocaleString()} / ${snapshot.count.toLocaleString()}` : "—"}${role === "measurement" && !numeric ? '<small class="muted">No numeric values; starter unavailable for this field.</small>' : ""}</td></tr>`;
        })
        .join("") || '<tr><td colspan="3">No matching fields.</td></tr>';
    dialog.querySelector("#field-roles-coverage")!.textContent =
      `Showing ${Math.min(this.limit, fields.length)} of ${fields.length} matching fields · up to 512 assigned roles`;
    dialog.querySelector<HTMLButtonElement>("#field-roles-more")!.hidden =
      this.limit >= fields.length;
    this.pending();
  }
  private async apply() {
    const snapshot = this.snapshot,
      dialog = this.dialog;
    if (!snapshot || !dialog || this.saving || !Object.keys(this.draft).length)
      return;
    for (const field of Object.keys(this.draft)) {
      if (
        this.base[field] !== snapshot.field_roles?.[field] &&
        this.draft[field] !== (snapshot.field_roles?.[field] || null)
      )
        throw Error(
          `The role for ${field} changed elsewhere. Reopen Field roles to review the current assignments.`,
        );
    }
    this.saving = true;
    this.rows();
    dialog.querySelector("#field-roles-status")!.textContent =
      "Saving field roles…";
    try {
      await call("field_roles_set", {
        assignments: { ...this.draft },
        expected_revision: snapshot.revision,
      });
      this.draft = {};
      await this.saved();
      dialog.close();
    } catch (error) {
      // Refresh revision/schema evidence without discarding the user's choices.
      await this.saved().catch(() => {});
      throw error;
    } finally {
      this.saving = false;
      this.rows();
    }
  }
}
