import type { SceneState } from "./types";
import "./measurement-style.css";

export type MeasurementStyle = NonNullable<SceneState["measurement"]>;
export const measurementStops = [
  "#253494",
  "#2c7fb8",
  "#41b6c4",
  "#a1dab4",
  "#ffffcc",
];
export const missingColor = "#707986";

/** Fixed domain, including signed values. Missing observations never become zero. */
export function measurementColor(
  value: number | null | undefined,
  style: MeasurementStyle,
): string {
  if (value == null || !Number.isFinite(value)) return missingColor;
  const t =
    Math.max(
      0,
      Math.min(1, (value - style.minimum) / (style.maximum - style.minimum)),
    ) * 4;
  const index = Math.min(3, Math.floor(t));
  const a = measurementStops[index],
    b = measurementStops[index + 1];
  return (
    "#" +
    [1, 3, 5]
      .map((offset) => {
        const start = parseInt(a.slice(offset, offset + 2), 16);
        const end = parseInt(b.slice(offset, offset + 2), 16);
        return Math.round(start + (end - start) * (t - index))
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

export class MeasurementLegend {
  readonly element = document.createElement("aside");
  private signature = "";
  private style: MeasurementStyle | null | undefined;
  private dismissed = new Set<string>();
  constructor(host: HTMLElement) {
    try {
      const saved = JSON.parse(localStorage.getItem("chronoscope-hidden-color-legends") || "[]");
      if (Array.isArray(saved)) this.dismissed = new Set(saved.filter(value => typeof value === "string"));
    } catch { /* Legend visibility still works when local storage is unavailable. */ }
    this.element.className = "measurement-legend";
    this.element.setAttribute("aria-label", "Measurement color scale");
    this.element.hidden = true;
    host.append(this.element);
  }
  get visible() { return !!this.style && !this.dismissed.has(this.signature); }
  setVisible(visible: boolean) {
    if (!this.style) return;
    if (visible) this.dismissed.delete(this.signature);
    else this.dismissed.add(this.signature);
    try {
      localStorage.setItem("chronoscope-hidden-color-legends", JSON.stringify([...this.dismissed].slice(-100)));
    } catch { /* Keep the choice for this session. */ }
    this.element.hidden = !this.visible;
  }
  update(style: MeasurementStyle | null | undefined) {
    const signature = JSON.stringify(style ?? null);
    if (signature === this.signature) return;
    this.signature = signature;
    this.style = style;
    this.element.hidden = !this.visible;
    this.element.replaceChildren();
    if (!style) return;
    const title = document.createElement("strong");
    title.textContent = style.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "measurement-legend-close";
    close.setAttribute("aria-label", "Hide color legend");
    close.title = "Hide legend · restore in Views → Color by value";
    close.textContent = "×";
    close.addEventListener("click", event => {
      event.stopPropagation();
      this.setVisible(false);
    });
    const ramp = document.createElement("div");
    ramp.className = "measurement-ramp";
    const ticks = document.createElement("div");
    ticks.className = "measurement-ticks";
    for (const fraction of [0, 0.5, 1]) {
      const tick = document.createElement("span");
      tick.textContent = `${Number((style.minimum + fraction * (style.maximum - style.minimum)).toFixed(2))}${style.unit}`;
      ticks.append(tick);
    }
    const note = document.createElement("small");
    note.textContent = style.latest_per_entity
      ? "Latest year in window · gray = no observation"
      : "Fixed scale · gray = no observation";
    this.element.append(title, close, ramp, ticks, note);
  }
}
