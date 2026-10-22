import { call } from "./bridge";
import type { Snapshot } from "./types";

/** Discover original fields once per dataset, without scanning per playback frame. */
export class SidebarFields {
  private key = "";
  private fields: string[] = ["entity", "category"];
  private request?: Promise<void>;
  private snapshot?: Snapshot;
  constructor(
    changed: (kind: "entity" | "category", field: string) => Promise<void>,
    onError: (error: unknown) => void,
  ) {
    for (const kind of ["entity", "category"] as const) {
      const select = document.querySelector<HTMLSelectElement>(
        `#${kind}-field`,
      )!;
      select.addEventListener("click", (e) => e.stopPropagation());
      select.addEventListener("keydown", (e) => e.stopPropagation());
      select.addEventListener("change", () => {
        const previous = this.snapshot?.filter.facet_fields?.[kind] || kind;
        select.disabled = true;
        void changed(kind, select.value)
          .catch((error) => {
            select.value = previous;
            onError(error);
          })
          .finally(() => {
            select.disabled = false;
          });
      });
    }
  }
  async render(snapshot: Snapshot) {
    this.snapshot = snapshot;
    const key = JSON.stringify([
      snapshot.name,
      snapshot.count,
      snapshot.layers?.map((l) => l.source),
    ]);
    if (key !== this.key) {
      this.key = key;
      this.request = (async () => {
        const schema = await call("dataset_schema", { attribute_limit: 512 });
        let next = schema.next_attribute_offset;
        while (next != null) {
          const page = await call("dataset_schema", {
            attribute_limit: 512,
            attribute_offset: next,
          });
          schema.attributes.push(...page.attributes);
          next = page.next_attribute_offset;
        }
        if (this.key !== key) return;
        this.fields = [
          ...schema.canonical.filter(
            (f) => !["geometry_wkt", "tags"].includes(f),
          ),
          ...schema.attributes.map((f) => `attribute:${f}`),
        ];
      })().catch((e) => {
        if (this.key === key) this.key = "";
        throw e;
      });
    }
    await this.request;
    if (this.key !== key) return;
    for (const kind of ["entity", "category"] as const) {
      const select = document.querySelector<HTMLSelectElement>(
        `#${kind}-field`,
      )!;
      const value = this.snapshot?.filter.facet_fields?.[kind] || kind;
      const options = [...new Set([kind, ...this.fields, value])];
      if (select.dataset.fields !== JSON.stringify(options)) {
        select.replaceChildren(
          ...options.map(
            (field) =>
              new Option(
                field.startsWith("attribute:")
                  ? `Imported · ${field.slice(10)}`
                  : field.replaceAll("_", " "),
                field,
              ),
          ),
        );
        select.dataset.fields = JSON.stringify(options);
      }
      select.value = value;
    }
  }
}
