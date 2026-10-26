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
  constructor(host: HTMLElement) {
    this.element.className = "measurement-legend";
    this.element.setAttribute("aria-label", "Measurement color scale");
    this.element.hidden = true;
    host.append(this.element);
  }
  update(style: MeasurementStyle | null | undefined) {
    const signature = JSON.stringify(style ?? null);
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.hidden = !style;
    this.element.replaceChildren();
    if (!style) return;
    const title = document.createElement("strong");
    title.textContent = style.title;
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
    this.element.append(title, ramp, ticks, note);
  }
}
