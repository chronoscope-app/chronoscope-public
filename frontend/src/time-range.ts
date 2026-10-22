import { time } from "./types";
type Part = "start" | "end" | "move";
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** One selected interval: resize either bracket or translate both endpoints. */
export class TimeRange {
  private start = 0;
  private end = 1;
  private lo = 0;
  private hi = 60;
  private drag?: {
    id: number;
    part: Part;
    x: number;
    width: number;
    start: number;
    end: number;
  };
  private band: HTMLElement;
  private handles: Record<"start" | "end", HTMLElement>;
  constructor(
    private track: HTMLElement,
    private change: (start: number, end: number, final: boolean) => void,
    private interact: () => void,
    private orientation: "horizontal" | "vertical" = "horizontal",
  ) {
    track.insertAdjacentHTML(
      "beforeend",
      `<div class="time-range-window" id="time-range-window" role="slider" tabindex="0" aria-label="Move time window" aria-orientation="horizontal" title="Drag to move the selected time window"><span aria-hidden="true" class="time-range-grip">⋮⋮</span></div><button type="button" class="time-range-handle start" id="window-start" role="slider" aria-label="Time window start" aria-orientation="horizontal" title="Drag the left bracket to change the start"></button><button type="button" class="time-range-handle end" id="window-end" role="slider" aria-label="Time window end" aria-orientation="horizontal" title="Drag the right bracket to change the end"></button>`,
    );
    this.band = track.querySelector("#time-range-window")!;
    this.handles = {
      start: track.querySelector("#window-start")!,
      end: track.querySelector("#window-end")!,
    };
    for (const [part, element] of Object.entries(this.handles)) {
      const label = document.createElement("span");
      label.className = "time-range-date";
      const name = document.createElement("strong");
      name.textContent = part === "start" ? "Start" : "End";
      label.append(name, document.createElement("output"));
      element.append(label);
      element.title = `Drag to change the ${part} time`;
    }
    for (const [part, element] of [
      ["move", this.band],
      ["start", this.handles.start],
      ["end", this.handles.end],
    ] as const) {
      element.setAttribute("aria-orientation", orientation);
      element.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.interact();
        element.focus({ preventScroll: true });
        element.setPointerCapture(e.pointerId);
        this.drag = {
          id: e.pointerId,
          part,
          x: orientation === "vertical" ? e.clientY : e.clientX,
          width: Math.max(
            1,
            orientation === "vertical"
              ? track.getBoundingClientRect().height
              : track.getBoundingClientRect().width,
          ),
          start: this.start,
          end: this.end,
        };
        track.classList.add("dragging");
        track.dataset.dragPart = part;
      });
      element.addEventListener("pointermove", (e) => {
        const d = this.drag;
        if (!d || d.id !== e.pointerId) return;
        const position = orientation === "vertical" ? e.clientY : e.clientX;
        this.adjust(d.part, (position - d.x) / d.width, d.start, d.end);
        this.change(this.start, this.end, false);
      });
      const finish = (e: PointerEvent) => {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        this.drag = undefined;
        track.classList.remove("dragging");
        delete track.dataset.dragPart;
        this.change(this.start, this.end, true);
      };
      element.addEventListener("pointerup", finish);
      element.addEventListener("pointercancel", finish);
      element.addEventListener("lostpointercapture", finish);
      element.addEventListener("keydown", (e) => {
        if (
          ![
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
          ].includes(e.key)
        )
          return;
        e.preventDefault();
        this.interact();
        const width = this.end - this.start;
        if (e.key === "Home" || e.key === "End") {
          const last = e.key === "End";
          if (part === "move")
            this.setValue(last ? 1 - width : 0, last ? 1 : width);
          else if (part === "start")
            this.setValue(last ? this.end - this.minimum : 0, this.end);
          else this.setValue(this.start, last ? 1 : this.start + this.minimum);
        } else {
          const step = e.altKey
            ? this.minimum
            : Math.max(this.minimum, e.shiftKey ? 0.1 : 0.01);
          this.adjust(
            part,
            (orientation === "vertical"
              ? ["ArrowRight", "ArrowDown"]
              : ["ArrowRight", "ArrowUp"]
            ).includes(e.key)
              ? step
              : -step,
            this.start,
            this.end,
          );
        }
        this.change(this.start, this.end, true);
      });
    }
    this.paint();
  }
  private get minimum() {
    return Math.min(
      1,
      Math.max(1e-6, Math.abs(this.lo) * Number.EPSILON * 2) /
        Math.max(1e-9, this.hi - this.lo),
    );
  }
  set(start: number, end: number, bounds?: [number, number]) {
    if (bounds) [this.lo, this.hi] = bounds;
    if (!this.drag) this.setValue(start, end);
  }
  private setValue(start: number, end: number) {
    this.start = clamp(start, 0, 1);
    this.end = clamp(end, this.start, 1);
    this.paint();
  }
  private adjust(part: Part, delta: number, start: number, end: number) {
    if (part === "start")
      this.setValue(clamp(start + delta, 0, end - this.minimum), end);
    else if (part === "end")
      this.setValue(start, clamp(end + delta, start + this.minimum, 1));
    else {
      const width = end - start,
        left = clamp(start + delta, 0, 1 - width);
      this.setValue(left, left + width);
    }
  }
  private paint() {
    const position = this.orientation === "vertical" ? "top" : "left";
    const extent = this.orientation === "vertical" ? "height" : "width";
    this.band.style[position] = `${this.start * 100}%`;
    this.band.style[extent] = `${(this.end - this.start) * 100}%`;
    const label = (v: number) =>
      `${time(this.lo + (this.hi - this.lo) * v)} UTC`;
    for (const [part, element] of Object.entries(this.handles) as [
      "start" | "end",
      HTMLElement,
    ][]) {
      const v = part === "start" ? this.start : this.end;
      element.style[position] = `${v * 100}%`;
      element.querySelector("output")!.textContent = label(v);
      element.setAttribute(
        "aria-valuemin",
        String(part === "end" ? this.start : 0),
      );
      element.setAttribute(
        "aria-valuemax",
        String(part === "start" ? this.end : 1),
      );
      element.setAttribute("aria-valuenow", String(v));
      element.setAttribute("aria-valuetext", label(v));
    }
    this.band.setAttribute("aria-valuemin", "0");
    this.band.setAttribute(
      "aria-valuemax",
      String(1 - (this.end - this.start)),
    );
    this.band.setAttribute("aria-valuenow", String(this.start));
    this.band.setAttribute(
      "aria-valuetext",
      `${label(this.start)} to ${label(this.end)}`,
    );
  }
}
