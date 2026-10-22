import { defaultDisplay, type DisplayOptions } from "./display-options";

export function bloomAmount(options: DisplayOptions) {
  return Math.max(
    0,
    Math.min(100, ((options.bloom_strength - 0.2) / 2.2) * 100),
  );
}
export function withBloomAmount(
  options: DisplayOptions,
  value: number,
): DisplayOptions {
  const t = Math.max(0, Math.min(1, value / 100));
  return {
    ...options,
    bloom_strength: 0.2 + 2.2 * t,
    bloom_radius: 0.02 + 0.72 * t ** 3,
    bloom_threshold: 0.18 - 0.16 * t,
  };
}
export function heatAmount(radius: number) {
  return (Math.log(radius / 4) / Math.log(32)) * 100;
}
export function heatRadius(value: number) {
  return 4 * 32 ** (Math.max(0, Math.min(100, value)) / 100);
}

function amountText(key: string, value: number) {
  if (key === "points") return `${Math.round((0.4 + value * 0.026) * 100)}%`;
  if (key === "cluster") return `${Math.round(8 + value * 1.2)} px`;
  if (key === "heat") return `${Math.round(heatRadius(value))} px`;
  return `${Math.round(value)}%`;
}
const amountLabels: Record<string, string> = {
  points: "Marker size",
  tracks: "Track opacity",
  trails: "Stem opacity",
  auto: "Cluster size",
  density: "Cell size",
  heatmap: "Smoothing radius",
  bloom: "Glow intensity",
};

interface Model {
  options: DisplayOptions;
}
interface Actions {
  display: (options: DisplayOptions) => Promise<void>;
  preview: (options: DisplayOptions) => void;
  saved: () => void;
  error: (error: unknown) => void;
}
export class ViewsPanel {
  private model!: Model;
  private signature = "";
  private work: Promise<void> = Promise.resolve();
  private openAdvanced = false;
  private pendingDisplay?: DisplayOptions;
  private displayRunning = false;
  private previewFrame = 0;
  private draggingRange = false;
  private previewDirty = false;
  constructor(
    private host: HTMLElement,
    private actions: Actions,
  ) {
    host.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLInputElement).type === "range")
        this.draggingRange = true;
    });
    const releaseRange = () => {
      if (!this.draggingRange) return;
      this.draggingRange = false;
      if (this.previewDirty) {
        this.previewDirty = false;
        this.queueDisplay({ ...this.model.options });
      }
      void this.idle().then(() => {
        if (this.model && this.host.querySelector(".views-controls"))
          this.render(this.model, true);
      });
    };
    window.addEventListener("pointerup", releaseRange);
    window.addEventListener("pointercancel", releaseRange);
    window.addEventListener("blur", releaseRange);
    host.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.dataset.amount) return;
      const value = Number(input.value),
        key = input.dataset.amount;
      let options = { ...this.model.options };
      if (key === "heat") options.heat_radius = heatRadius(value);
      else if (key === "bloom") options = withBloomAmount(options, value);
      else if (key === "cluster") options.cluster_pixels = 8 + value * 1.2;
      else if (key === "points") options.point_scale = 0.4 + value * 0.026;
      else if (key === "tracks") options.track_opacity = value / 100;
      else if (key === "trails") options.trail_opacity = value / 100;
      this.model.options = options;
      this.previewDirty = true;
      if (!this.previewFrame)
        this.previewFrame = requestAnimationFrame(() => {
          this.previewFrame = 0;
          this.actions.preview(this.model.options);
        });
      input.parentElement!.querySelector("output")!.textContent = amountText(
        key!,
        value,
      );
      input.setAttribute("aria-valuetext", amountText(key!, value));
    });
    host.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.amount) {
        if (this.previewDirty) {
          this.previewDirty = false;
          this.queueDisplay({ ...this.model.options });
        }
      } else if (input.dataset.effect) {
        const key = input.dataset.effect;
        let options = { ...this.model.options };
        if (key === "tracks") options.show_tracks = input.checked;
        else if (key === "trails") options.show_trails = input.checked;
        else if (key === "points") options.show_points = input.checked;
        else if (key === "centroids") options.show_centroids = input.checked;
        else if (key === "bloom") options.bloom = input.checked;
        else
          options.mode = input.checked
            ? (key as DisplayOptions["mode"])
            : "points";
        if (input.checked && (key === "auto" || key === "density"))
          options.bloom = false;
        this.model.options = options;
        this.queueDisplay(options);
      }
    });
    host.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "[data-views-action]",
      );
      if (!button) return;
      const action = button.dataset.viewsAction;
      if (action === "saved") this.actions.saved();
      if (action === "reset")
        this.queue(() => this.actions.display({ ...defaultDisplay }));
      if (action === "advanced") {
        const form = host.querySelector<HTMLFormElement>(
          "#views-advanced-form",
        )!;
        if (!form.reportValidity()) return;
        const value = (id: string) =>
          host.querySelector<HTMLInputElement>(id)!.value;
        const n = (id: string) => Number(value(id));
        const optional = (id: string) => (value(id) === "" ? null : n(id));
        this.queue(() =>
          this.actions.display({
            ...this.model.options,
            mode: value("#display-mode") as DisplayOptions["mode"],
            cluster_pixels: n("#display-spacing"),
            time_bin_minutes: n("#display-time"),
            spatial_culling:
              host.querySelector<HTMLInputElement>("#display-culling")!.checked,
            trail_pixels: n("#display-trail"),
            trail_gap_minutes: n("#display-gap"),
            heat_radius: n("#display-radius"),
            heat_weight: value(
              "#display-weight",
            ) as DisplayOptions["heat_weight"],
            heat_max: optional("#display-max"),
            heat_reference_zoom: optional("#display-reference"),
            bloom_strength: n("#bloom-strength"),
            bloom_radius: n("#bloom-radius"),
            bloom_threshold: n("#bloom-threshold"),
          }),
        );
      }
    });
    host.addEventListener("submit", (event) => event.preventDefault());
  }
  get liveOptions() {
    return this.draggingRange || this.displayRunning
      ? this.model?.options
      : undefined;
  }
  async idle() {
    // Calls arriving while a render is in flight replace the queued value.
    for (;;) {
      const work = this.work;
      await work;
      if (work === this.work) return;
    }
  }
  private queueDisplay(options: DisplayOptions) {
    this.pendingDisplay = { ...options };
    if (this.displayRunning) return;
    this.displayRunning = true;
    this.queue(async () => {
      try {
        while (this.pendingDisplay) {
          const next = this.pendingDisplay;
          this.pendingDisplay = undefined;
          await this.actions.display(next);
        }
      } finally {
        this.displayRunning = false;
      }
    });
  }
  private queue(work: () => Promise<void>) {
    this.work = this.work.then(work).catch(this.actions.error);
  }
  render(model: Model, force = false) {
    if (!force && this.draggingRange) return;
    const focusedLabel = this.host.contains(document.activeElement)
      ? document.activeElement?.getAttribute("aria-label")
      : null;
    this.model = model;
    const signature = JSON.stringify([
      model,
      document.documentElement.dataset.theme,
    ]);
    if (
      !force &&
      signature === this.signature &&
      this.host.querySelector(".views-controls")
    )
      return;
    this.signature = signature;
    this.openAdvanced =
      this.host.querySelector<HTMLDetailsElement>("#display-advanced")?.open ??
      this.openAdvanced;
    const o = model.options;
    const effect = (
      key: string,
      label: string,
      enabled: boolean,
      amount: number,
      description: string,
    ) => {
      const amountKey =
        key === "heatmap"
          ? "heat"
          : key === "auto" || key === "density"
            ? "cluster"
            : key;
      return `<section class="view-effect" data-tooltip="${description}"><label class="check-row"><input id="display-${key === "heatmap" ? "heat" : key}" type="checkbox" data-effect="${key}" data-tooltip="${description}" aria-description="${description}" ${enabled ? "checked" : ""}><span class="view-effect-name">${label}</span> <span class="view-effect-description">${description}</span></label><label class="view-amount named-amount"><span>${amountLabels[key]}</span><output>${amountText(amountKey, amount)}</output><input type="range" min="0" max="100" step="1" data-tooltip="${description}" aria-description="${description}" data-amount="${amountKey}" value="${Math.round(amount)}" aria-label="${amountLabels[key]}" aria-valuetext="${amountText(amountKey, amount)}"></label></section>`;
    };
    this.host.innerHTML = `<div class="views-controls"><div class="section-head"><h3>Views</h3><button data-views-action="saved">Saved views…</button></div><h3 class="view-subheading">Display layers</h3><label class="check-row"><input id="display-centroids" type="checkbox" data-effect="centroids" ${o.show_centroids ? "checked" : ""}> Polygon centroid markers and tracks</label>${effect("points", "Events", o.show_points, (o.point_scale - 0.4) / 0.026, "Marker size; exact rows stay in the table.")}${effect("tracks", "Tracks", o.show_tracks, o.track_opacity * 100, "Lines connecting records of the same entity.")}${effect("trails", "Stems", o.show_trails, o.trail_opacity * 100, "Lines from events down to the map.")}${effect("auto", "Clustering", !o.bloom && (o.mode === "auto" || o.mode === "clusters"), (o.cluster_pixels - 8) / 1.2, "Combines nearby events of the same entity; retains colors and tracks.")}${effect("density", "Density cells", !o.bloom && o.mode === "density", (o.cluster_pixels - 8) / 1.2, "More uses larger count cells.")}${effect("heatmap", "Heat", o.mode === "heatmap", heatAmount(o.heat_radius), "More increases kernel smoothing and overlap.")}${effect("bloom", "Bloom", o.bloom, bloomAmount(o), "More widens the ground glow and increases brightness.")}<details id="display-advanced" ${this.openAdvanced ? "open" : ""}><summary>Advanced parameters</summary><form id="views-advanced-form" novalidate><label class="field">Representation<select id="display-mode">${["auto", "points", "clusters", "density", "heatmap"].map((mode) => `<option ${o.mode === mode ? "selected" : ""}>${mode}</option>`).join("")}</select></label>${[
      ["spacing", "Cluster spacing / px", o.cluster_pixels, 8, 128],
      [
        "time",
        "Time slab / minutes (0 auto)",
        o.time_bin_minutes,
        0,
        5259600000,
      ],
      ["trail", "Track tolerance / px", o.trail_pixels, 0, 20],
      [
        "gap",
        "Break tracks at gaps / minutes",
        o.trail_gap_minutes,
        0,
        5259600000,
      ],
      ["radius", "Heat radius / px", o.heat_radius, 4, 128],
    ]
      .map(
        ([id, label, value, min, max]) =>
          `<label class="field">${label}<input id="display-${id}" type="number" required min="${min}" max="${max}" step="${id === "time" || id === "gap" ? 1 : "any"}" value="${value}"></label>`,
      )
      .join(
        "",
      )}<label class="check-row"><input id="display-culling" type="checkbox" ${o.spatial_culling ? "checked" : ""}>Cull to camera region</label><label class="field">Heat weight<select id="display-weight"><option value="count">Event count</option><option value="value" ${o.heat_weight === "value" ? "selected" : ""}>Numeric value</option></select></label><label class="field">Heat maximum (blank auto)<input id="display-max" type="number" min="0.000001" step="any" value="${o.heat_max ?? ""}"></label><label class="field">Reference zoom (blank dynamic)<input id="display-reference" type="number" min="0" max="24" step="any" value="${o.heat_reference_zoom ?? ""}"></label>${[
      ["strength", o.bloom_strength, 3],
      ["radius", o.bloom_radius, 1],
      ["threshold", o.bloom_threshold, 1],
    ]
      .map(
        ([key, value, max]) =>
          `<label class="field">Bloom ${key}<input id="bloom-${key}" type="number" required min="0" max="${max}" step="any" value="${value}"></label>`,
      )
      .join(
        "",
      )}<button type="button" id="display-apply" class="secondary" data-views-action="advanced">Apply parameters</button></form></details><button id="display-reset" data-views-action="reset">Reset display defaults</button></div>`;
    if (focusedLabel)
      this.host
        .querySelector<HTMLElement>(
          `[aria-label="${CSS.escape(focusedLabel)}"]`,
        )
        ?.focus({ preventScroll: true });
  }
}
