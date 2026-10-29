import type { SpaceTimeView } from "./view";
import "./navigation-sphere.css";
import { compassRose } from "./compass-rose";

const glyph = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = {
  hand: "M18 11V7a2 2 0 0 0-4 0M14 10V5a2 2 0 0 0-4 0v5M10 10.5V7a2 2 0 0 0-4 0v9M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-1.2-6-3l-3-4a2 2 0 0 1 3-2l2 2",
  select: "M5 3v16l4-4 4 7 3-2-4-7h7L5 3z",
  sync: "M3 8h16m-4-4 4 4-4 4M21 16H5m4-4-4 4 4 4",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 12h6m-3-3v6",
  zoom: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0M6 10h8m-4-4v8",
  tilt: "M3 19h18M5 16l5-11 9 11zM10 5v11",
  time: "M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0M8 4v4l3 2M15 21h7M15 16h7M15 11h7m-3 8V6m-3 3 3-3 3 3",
  terrain: "m2 20 7-16 6 12 3-6 4 10zM6 11l3 2 3-3",
};
const tool = (id: string, label: string, name: keyof typeof icons) =>
  `<button type="button" id="${id}" class="navigation-tool" aria-label="${label}" title="${label}">${glyph(icons[name])}</button>`;

/** Rendered with the app so the existing mode/time/terrain handlers retain ownership. */
export function navigationTools() {
  return `<div class="navigation-toolbar" id="navigation-tools" role="group" aria-label="View tools">
    <div class="navigation-core">${tool("navigate", "Drag to move", "hand")}${tool("box-select", "Select events", "select")}${tool("sync-views", "Sync views · copy bounds and orientation to the other views", "sync")}
    <span class="navigation-divider"></span>
    ${tool("fit", "Fit visible events · F", "fit")}
    <button type="button" id="fit-terrain" class="navigation-tool" aria-label="Fit terrain" title="Fit terrain" hidden>${glyph(icons.terrain)}</button>
    <div class="navigation-sliders">
      <label class="navigation-slider" title="Zoom · drag up to zoom in">${glyph(icons.zoom)}<input id="navigation-zoom" type="range" min="0" max="100" step=".1" value="50" aria-label="Zoom"><span>Zoom</span></label>
      <label class="navigation-slider" id="navigation-tilt-group" title="Tilt · top-down to horizon">${glyph(icons.tilt)}<input id="navigation-tilt" type="range" min="0" max="85" step="1" value="0" aria-label="Tilt"><span>Tilt</span></label>
    </div>
    </div><span class="navigation-divider"></span>
    <div class="navigation-time-group" id="navigation-time-group">
      <button type="button" id="time-elevation" class="navigation-tool" data-tooltip-disabled aria-label="Time height and altitude" aria-expanded="false" aria-controls="time-elevation-popup">${glyph(icons.time)}</button>
      <div class="time-elevation-popup" id="time-elevation-popup" role="group" aria-labelledby="time-elevation-title" hidden>
        <div class="time-popup-title"><strong id="time-elevation-title">Vertical display</strong><output id="time-elevation-value"></output></div>
        <div id="height-mode-selector" class="height-mode-selector" role="radiogroup" aria-label="Height source" data-altitude="false">
          <button type="button" id="height-mode-time" role="radio" aria-checked="true" tabindex="0">Time Height</button>
          <button type="button" id="height-mode-altitude" role="radio" aria-checked="false" tabindex="-1">Altitude</button>
        </div>
        <label id="time-height-label" for="time-height" class="sr-only">Time height</label><input id="time-height" type="range" min="0" max="5" step=".1" value="2.8" aria-label="Time height">
        <label id="globe-time-height-label" for="globe-time-height" class="sr-only" hidden>Time elevation</label><input id="globe-time-height" type="range" min="0" max="100" step="1" value="50" aria-label="Globe time height" hidden>
        <div id="time-height-endpoints" class="time-height-endpoints" aria-hidden="true"><span>Off</span><span>Higher</span></div>
        <p id="height-mode-note">Time Height raises Events by timestamp. Altitude uses imported physical heights in Globe.</p>
      </div>
    </div>
  </div>`;
}

const minimumDistance = 2;
const maximumDistance = 8e7;
const zoomValue = (distance: number) =>
  Math.max(
    0,
    Math.min(
      100,
      100 *
        (1 -
          Math.log(Math.max(minimumDistance, distance) / minimumDistance) /
            Math.log(maximumDistance / minimumDistance)),
    ),
  );
const zoomDistance = (value: number) =>
  minimumDistance * (maximumDistance / minimumDistance) ** (1 - value / 100);

/** A compass rose sharing the scene camera and navigation rail. */
export class NavigationSphere {
  private fitting = false;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private pinned = false;
  private dragging?: { id: number; x: number; y: number };
  private resizeObserver: ResizeObserver;
  private sphere: HTMLButtonElement;
  private zoom: HTMLInputElement;
  private tilt: HTMLInputElement;
  private popup: HTMLElement;
  private timeGroup: HTMLElement;
  private timeButton: HTMLButtonElement;

  constructor(
    private host: HTMLElement,
    private view: SpaceTimeView,
    private fit: () => void | Promise<void> = () => view.fit(),
  ) {
    host.className = "sphere-navigator";
    host.innerHTML = `<div class="navigation-orb"><button type="button" class="navigation-sphere navigation-compass" aria-label="Drag compass to orbit; arrow keys rotate and tilt" title="Grab to orbit · arrow keys rotate and tilt">${compassRose()}</button><output class="sphere-heading" aria-label="Heading">000°</output></div>`;
    host.append(document.querySelector("#navigation-tools")!);
    host.querySelector("#navigate")!.classList.add("active");
    host.querySelector("#navigate")!.setAttribute("aria-pressed", "true");
    host.querySelector("#box-select")!.setAttribute("aria-pressed", "false");
    this.sphere = host.querySelector(".navigation-sphere")!;
    this.zoom = host.querySelector("#navigation-zoom")!;
    this.tilt = host.querySelector("#navigation-tilt")!;
    this.popup = host.querySelector("#time-elevation-popup")!;
    this.timeGroup = host.querySelector("#navigation-time-group")!;
    this.timeButton = host.querySelector("#time-elevation")!;
    this.sphere.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.view.cancelNavigation();
      this.sphere.focus({ preventScroll: true });
      this.sphere.setPointerCapture(event.pointerId);
      this.dragging = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      this.sphere.classList.add("grabbing");
    });
    this.sphere.addEventListener("pointermove", (event) => {
      const drag = this.dragging;
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (view.mode === "map") view.panPixels(dx, dy);
      else view.orbitPixels(dx, dy);
      this.update();
    });
    const stopDrag = () => {
      this.dragging = undefined;
      this.sphere.classList.remove("grabbing");
    };
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      this.sphere.addEventListener(name, stopDrag);
    window.addEventListener("blur", stopDrag);
    this.sphere.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      view.cancelNavigation();
      if (event.key === "Home") view.setBearing(0);
      else if (view.mode === "map") {
        view.panPixels(
          event.key === "ArrowLeft" ? -30 : event.key === "ArrowRight" ? 30 : 0,
          event.key === "ArrowUp" ? -30 : event.key === "ArrowDown" ? 30 : 0,
        );
      } else
        view.orbitPixels(
          event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0,
          event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0,
        );
      this.update();
    });
    this.zoom.addEventListener("input", () => {
      view.cancelNavigation();
      view.zoom(
        view.navigationDistance() / zoomDistance(Number(this.zoom.value)),
      );
      this.update();
    });
    this.tilt.addEventListener("input", () => {
      view.cancelNavigation();
      view.setTilt(Number(this.tilt.value));
      this.update();
    });
    host.querySelector("#fit")!.addEventListener("click", () => {
      if (this.fitting) return;
      this.fitting = true;
      this.update();
      void Promise.resolve()
        .then(() => this.fit())
        .finally(() => {
          this.fitting = false;
          this.update();
        });
    });
    this.timeGroup.addEventListener("pointerenter", () => this.openTime());
    this.timeGroup.addEventListener("pointerleave", () => this.scheduleClose());
    this.timeGroup.addEventListener("focusin", () => this.openTime());
    this.timeGroup.addEventListener("focusout", () => this.scheduleClose());
    this.timeButton.addEventListener("click", () => {
      this.pinned = !this.pinned;
      this.setTimeOpen(this.pinned);
    });
    document.addEventListener("pointerdown", (event) => {
      if (this.timeGroup.contains(event.target as Node)) return;
      this.pinned = false;
      this.setTimeOpen(false);
    });
    this.timeGroup.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.pinned = false;
      this.timeButton.focus();
      this.setTimeOpen(false);
    });
    host.addEventListener(
      "wheel",
      (event) => {
        // Sliders own arrow keys and pointer drags; wheel navigation is on the compass only.
        if (!this.sphere.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        const delta =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? view.host.clientHeight
              : 1);
        view.cancelNavigation();
        view.zoom(Math.exp(Math.max(-0.65, Math.min(0.65, -delta * 0.002))));
        this.update();
      },
      { passive: false },
    );
    this.resizeObserver = new ResizeObserver(() => {
      host.style.setProperty(
        "--navigation-height",
        `${view.host.clientHeight}px`,
      );
      host.classList.toggle(
        "compact-sphere-navigation",
        view.host.clientHeight < 600,
      );
      host.classList.toggle(
        "short-sphere-navigation",
        view.host.clientHeight < 400,
      );
    });
    this.resizeObserver.observe(view.host);
  }
  private openTime() {
    clearTimeout(this.closeTimer);
    this.setTimeOpen(true);
  }
  private scheduleClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (
        !this.pinned &&
        !this.timeGroup.matches(":hover") &&
        !this.timeGroup.contains(document.activeElement)
      )
        this.setTimeOpen(false);
    }, 180);
  }
  private setTimeOpen(open: boolean) {
    this.popup.hidden = !open;
    this.timeButton.setAttribute("aria-expanded", String(open));
  }
  update() {
    if (!this.view.controls) return;
    if (this.view.mode === "map") {
      this.pinned = false;
      this.setTimeOpen(false);
    }
    const bearing = this.view.bearing(),
      tilt = this.view.tilt(),
      flat = this.view.mode === "map";
    this.host.querySelector(".sphere-heading")!.textContent =
      `${String(Math.round(bearing) % 360).padStart(3, "0")}°`;
    this.sphere.setAttribute(
      "aria-label",
      flat
        ? "Drag compass to pan the 2D map; arrow keys pan"
        : `Drag compass to orbit; heading ${Math.round(bearing) % 360} degrees, tilt ${Math.round(tilt)} degrees; arrow keys rotate and tilt`,
    );
    this.sphere.dataset.tooltip = flat
      ? "Grab to pan the map"
      : "Grab to orbit · arrow keys rotate and tilt · Home restores north";
    this.sphere.removeAttribute("title");
    this.zoom.value = String(zoomValue(this.view.navigationDistance()));
    this.zoom.setAttribute(
      "aria-valuetext",
      `Zoom ${this.view.mapZoom().toFixed(1)}`,
    );
    this.tilt.value = String(tilt);
    this.tilt.setAttribute(
      "aria-valuetext",
      `${Math.round(tilt)} degrees from top-down`,
    );
    this.tilt.disabled = flat;
    this.host.querySelector<HTMLElement>("#navigation-tilt-group")!.hidden =
      flat;
    this.host.querySelector<HTMLButtonElement>("#fit")!.disabled = this.fitting;
    this.host
      .querySelector(".compass-rotation")!
      .setAttribute("transform", `rotate(${-bearing} 50 50)`);
    // Rotate cardinal positions with the rose, keeping their glyphs upright.
    for (const label of this.host.querySelectorAll<SVGTextElement>(
      ".compass-cardinals text",
    )) {
      const angle =
        ((Number(label.dataset.direction) - bearing) * Math.PI) / 180;
      label.setAttribute("x", String(50 + 43 * Math.sin(angle)));
      label.setAttribute("y", String(50 - 43 * Math.cos(angle)));
    }
  }
}
