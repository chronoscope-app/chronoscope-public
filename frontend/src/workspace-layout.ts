import "./workspace-layout.css";
import { PaneRail, type PaneSection } from "./pane-rail";
type Pane = "sidebar" | "inspector" | "table";
type Sizes = Record<Pane, number>;
const storageKey = "chronoscope.workspace-layout.v1";
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Device-local pane preferences; never changes dataset filters or camera state. */
export function installWorkspaceLayout(
  workspace: HTMLElement,
  options: {
    icon: (name: string) => string;
    sidebar: PaneSection[];
    inspector: PaneSection[];
    error: (error: unknown) => void;
  },
) {
  workspace.classList.add("workspace-resizable");
  const center = workspace.querySelector<HTMLElement>(".center")!;
  const table = workspace.querySelector<HTMLElement>(".table-panel")!;
  const defaults = (): Sizes => ({
    sidebar: workspace.clientWidth <= 1200 ? 210 : 248,
    inspector: workspace.clientWidth <= 1200 ? 250 : 290,
    table: 220,
  });
  const desired = defaults();
  const collapsed = { sidebar: false, inspector: false };
  let chartInspector = workspace.clientWidth * 0.43;
  const chartMode = () => workspace.classList.contains("chart-docked");
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (Number.isFinite(saved?.chart_inspector))
      chartInspector = saved.chart_inspector;
    for (const side of ["sidebar", "inspector"] as const)
      collapsed[side] = saved?.collapsed?.[side] === true;
    for (const key of Object.keys(desired) as Pane[]) {
      if (Number.isFinite(saved?.[key])) desired[key] = saved[key];
    }
  } catch {
    /* Storage may be disabled or contain an older invalid value. */
  }
  let actual = { ...desired };
  const separators = new Map<Pane, HTMLElement>();
  const min = { sidebar: 200, inspector: 250, table: 120 };
  const timeWidth = () =>
    workspace.classList.contains("time-rail-collapsed") ? 24 : 64;
  const limits = (key: Pane) => {
    const left = collapsed.sidebar ? 44 : actual.sidebar;
    const right = collapsed.inspector ? 44 : actual.inspector;
    const other = key === "sidebar" ? right : left;
    const max =
      key === "sidebar" || key === "inspector"
        ? Math.min(
            key === "sidebar" ? 420 : chartMode() ? 840 : 540,
            workspace.clientWidth - other - timeWidth() - 372,
          )
        : Math.min(520, workspace.clientHeight - 226);
    return [min[key], Math.max(min[key], max)] as const;
  };
  const apply = () => {
    // Clamp both side panes together so reopening a wide layout on a smaller
    // display always preserves room for the scene and both sidebars.
    const available = Math.max(450, workspace.clientWidth - timeWidth() - 372);
    actual.sidebar = clamp(
      desired.sidebar,
      200,
      Math.min(420, available - (collapsed.inspector ? 44 : 250)),
    );
    actual.inspector = clamp(
      chartMode() ? chartInspector : desired.inspector,
      250,
      Math.max(
        250,
        Math.min(
          chartMode() ? 840 : 540,
          available - (collapsed.sidebar ? 44 : actual.sidebar),
        ),
      ),
    );
    actual.table = clamp(desired.table, ...limits("table"));
    for (const key of Object.keys(actual) as Pane[]) {
      workspace.style.setProperty(`--${key}-size`, `${actual[key]}px`);
      const separator = separators.get(key);
      if (separator) {
        const hidden =
          (key === "sidebar" || key === "inspector") && collapsed[key];
        separator.inert = hidden;
        separator.tabIndex = hidden ? -1 : 0;
        separator.setAttribute("aria-hidden", String(hidden));
        const [lo, hi] = limits(key);
        separator.setAttribute("aria-valuemin", String(lo));
        separator.setAttribute("aria-valuemax", String(hi));
        separator.setAttribute(
          "aria-valuenow",
          String(Math.round(actual[key])),
        );
        separator.setAttribute(
          "aria-valuetext",
          `${Math.round(actual[key])} pixels`,
        );
      }
    }
  };
  const save = () => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...desired,
          chart_inspector: chartInspector,
          collapsed,
        }),
      );
    } catch {
      /* Layout still works without persistence. */
    }
  };
  for (const key of ["sidebar", "inspector", "table"] as const) {
    const vertical = key === "sidebar" || key === "inspector";
    const separator = document.createElement("div");
    separator.id = `resize-${key}`;
    separator.className = `pane-resizer ${vertical ? "vertical" : "horizontal"}`;
    separator.tabIndex = 0;
    separator.setAttribute("role", "separator");
    separator.setAttribute(
      "aria-label",
      `Resize ${key === "table" ? "attribute table" : key}`,
    );
    separator.setAttribute(
      "aria-orientation",
      vertical ? "vertical" : "horizontal",
    );
    separator.setAttribute(
      "aria-description",
      "Drag or use arrow keys to resize. Shift changes the step. Enter or double-click resets the size.",
    );
    separators.set(key, separator);
    if (key === "sidebar")
      workspace.querySelector(".time-rail")!.before(separator);
    else if (key === "inspector") center.after(separator);
    else table.before(separator);
    let drag: { id: number; start: number; size: number } | undefined;
    const coordinate = (event: PointerEvent) =>
      vertical ? event.clientX : event.clientY;
    const sign = key === "sidebar" ? 1 : -1;
    const resize = (value: number) => {
      if (key === "inspector" && chartMode())
        chartInspector = clamp(value, ...limits(key));
      else desired[key] = clamp(value, ...limits(key));
      apply();
    };
    separator.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      separator.focus({ preventScroll: true });
      separator.setPointerCapture(event.pointerId);
      drag = {
        id: event.pointerId,
        start: coordinate(event),
        size: actual[key],
      };
      separator.classList.add("dragging");
    });
    separator.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      resize(drag.size + sign * (coordinate(event) - drag.start));
    });
    const finish = () => {
      if (!drag) return;
      drag = undefined;
      separator.classList.remove("dragging");
      save();
    };
    separator.addEventListener("pointerup", finish);
    separator.addEventListener("pointercancel", finish);
    separator.addEventListener("lostpointercapture", finish);
    const reset = () => {
      if (key === "inspector" && chartMode())
        chartInspector = workspace.clientWidth * 0.43;
      else desired[key] = defaults()[key];
      apply();
      save();
    };
    separator.addEventListener("dblclick", reset);
    separator.addEventListener("keydown", (event) => {
      const backward = vertical ? "ArrowLeft" : "ArrowUp";
      const forward = vertical ? "ArrowRight" : "ArrowDown";
      if (![backward, forward, "Home", "End", "Enter"].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") return reset();
      const [lo, hi] = limits(key);
      resize(
        event.key === "Home"
          ? lo
          : event.key === "End"
            ? hi
            : actual[key] +
              (event.key === forward ? 1 : -1) *
                sign *
                (event.shiftKey ? 40 : 10),
      );
      save();
    });
  }
  const rails = {} as Record<"sidebar" | "inspector", PaneRail>;
  for (const side of ["sidebar", "inspector"] as const) {
    rails[side] = new PaneRail(
      workspace.querySelector<HTMLElement>(`.${side}`)!,
      side === "sidebar" ? "left" : "right",
      options[side],
      options.icon,
      (value) => {
        collapsed[side] = value;
        workspace.classList.toggle(`${side}-collapsed`, value);
        rails[side].setCollapsed(value);
        apply();
        save();
      },
      options.error,
    );
    workspace.classList.toggle(`${side}-collapsed`, collapsed[side]);
    rails[side].setCollapsed(collapsed[side]);
  }
  new ResizeObserver(apply).observe(workspace);
  new MutationObserver(apply).observe(workspace, {
    attributes: true,
    attributeFilter: ["class"],
  });
  new MutationObserver(apply).observe(table, {
    attributes: true,
    attributeFilter: ["class"],
  });
  new MutationObserver(() => {
    if (document.body.classList.contains("fullscreen")) {
      rails.sidebar.close();
      rails.inspector.close();
    }
    apply();
  }).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  apply();
  return rails;
}
