import "./time-rail.css";
import { time } from "./types";

/** One live time window, with device-local collapse and reusable popup controls. */
export class TimeRail {
  private element: HTMLElement;
  private collapse: HTMLButtonElement;
  private triggers: Record<"range" | "playback", HTMLButtonElement>;
  private popups: Record<"range" | "playback", HTMLElement>;
  private inputs: HTMLInputElement[];
  private play: HTMLButtonElement;
  private popupPlay: HTMLButtonElement;
  private current?: "range" | "playback";
  private opening?: ReturnType<typeof setTimeout>;
  private closing?: ReturnType<typeof setTimeout>;
  private collapsed = false;
  private values: [number, number] = [0, 1];
  private keyboard = false;
  private suppressFocus = false;
  private readonly storageKey = "chronoscope.time-rail.collapsed";

  constructor(
    private workspace: HTMLElement,
    private options: {
      icon: (name: string) => string;
      apply: (start: string, end: string) => Promise<void>;
      interact: () => void;
      error: (error: unknown) => void;
    },
  ) {
    const timeline = workspace.querySelector<HTMLElement>(".timeline")!;
    const track = timeline.querySelector<HTMLElement>("#time-range-track")!;
    const range = timeline.querySelector<HTMLElement>("#range-label")!;
    const full = timeline.querySelector<HTMLButtonElement>("#full-range")!;
    this.play = timeline.querySelector<HTMLButtonElement>("#play")!;
    timeline.replaceChildren();
    timeline.classList.add("time-rail");
    timeline.id = "time-rail";
    timeline.setAttribute("aria-label", "Time window");
    workspace.querySelector(".center")!.before(timeline);
    this.element = timeline;
    const button = (id: string, label: string, glyph: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "pane-icon";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = options.icon(glyph);
      return b;
    };
    this.collapse = button(
      "collapse-time-rail",
      "Collapse time rail",
      "collapse-left",
    );
    const heading = document.createElement("header");
    heading.className = "time-rail-heading";
    heading.append(this.collapse);
    this.triggers = {
      range: button("time-rail-range", "Time range", "clock"),
      playback: button("time-rail-playback", "Playback controls", "settings"),
    };
    const body = document.createElement("div");
    body.className = "time-rail-body";
    body.append(track);
    const summary = document.createElement("div");
    summary.className = "time-rail-mini";
    summary.setAttribute("aria-hidden", "true");
    summary.innerHTML = "<span></span>";
    const tools = document.createElement("div");
    tools.className = "time-rail-tools";
    tools.append(this.play, this.triggers.playback);
    this.popups = {
      range: document.createElement("section"),
      playback: document.createElement("section"),
    };
    for (const kind of ["range", "playback"] as const) {
      const popup = this.popups[kind];
      popup.id = `time-rail-${kind}-popup`;
      popup.className = "time-rail-popup";
      popup.hidden = true;
      popup.setAttribute("role", "region");
      popup.setAttribute(
        "aria-label",
        kind === "range" ? "Time range" : "Playback controls",
      );
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = kind === "range" ? "Time range · UTC" : "Playback";
      const close = button(
        `close-time-${kind}`,
        "Close time controls",
        "close",
      );
      close.addEventListener("click", () => this.close(true));
      header.append(title, close);
      popup.append(header);
      const trigger = this.triggers[kind];
      trigger.setAttribute("aria-controls", popup.id);
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("data-tooltip-disabled", "");
      trigger.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch" || event.buttons) return;
        clearTimeout(this.opening);
        clearTimeout(this.closing);
        this.opening = setTimeout(() => this.open(kind, false), 80);
      });
      trigger.addEventListener("click", (event) => {
        if (event.detail === 0) this.open(kind, true, true);
        else if (this.current === kind && this.keyboard) this.close();
        else this.open(kind, true);
      });
      trigger.addEventListener("focus", () => {
        if (!this.suppressFocus && trigger.matches(":focus-visible"))
          this.open(kind, true);
      });
      new ResizeObserver(() => this.position()).observe(popup);
    }
    const form = document.createElement("form");
    this.inputs = (["Start", "End"] as const).map((name) => {
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = `${name} / UTC`;
      const input = document.createElement("input");
      input.id = `rail-exact-${name.toLowerCase()}`;
      input.placeholder = "Unbounded";
      input.autocomplete = "off";
      label.append(input);
      form.append(label);
      return input;
    });
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.id = "rail-exact-apply";
    apply.className = "secondary";
    apply.textContent = "Apply range";
    form.append(apply);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      // Capture both drafts before parsing or refreshing the workspace.
      const [start, end] = this.inputs.map((input) => input.value);
      this.options.interact();
      apply.disabled = true;
      void options
        .apply(start, end)
        .then(() => this.close(true))
        .catch(options.error)
        .finally(() => {
          apply.disabled = false;
        });
    });
    this.popups.range.append(range, form, full);
    this.popupPlay = button("time-rail-popup-play", "Play", "play");
    this.popupPlay.className = "secondary";
    this.popupPlay.addEventListener("click", () => this.play.click());
    const settings = document.createElement("div");
    settings.id = "time-rail-playback-settings";
    this.popups.playback.append(this.popupPlay, settings);
    timeline.append(
      heading,
      this.triggers.range,
      body,
      summary,
      tools,
      ...Object.values(this.popups),
    );
    this.collapse.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed);
      try {
        localStorage.setItem(this.storageKey, String(this.collapsed));
      } catch {
        /* Optional local layout storage. */
      }
    });
    try {
      this.collapsed = localStorage.getItem(this.storageKey) === "true";
    } catch {
      /* Storage may be disabled. */
    }
    this.setCollapsed(this.collapsed);
    const syncPlay = () => {
      const label = this.play.textContent?.trim() || "Play";
      this.play.setAttribute("aria-label", label);
      this.play.title = label;
      this.play.setAttribute("aria-pressed", String(label === "Pause"));
      this.popupPlay.innerHTML = this.play.innerHTML;
      this.popupPlay.setAttribute("aria-label", label);
      this.popupPlay.setAttribute("aria-pressed", String(label === "Pause"));
    };
    new MutationObserver(syncPlay).observe(this.play, {
      childList: true,
      subtree: true,
    });
    syncPlay();
    timeline.addEventListener("pointerenter", () => clearTimeout(this.closing));
    timeline.addEventListener("pointerleave", () => {
      clearTimeout(this.opening);
      if (!this.keyboard) this.closing = setTimeout(() => this.close(), 180);
    });
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          this.current &&
          !this.popups[this.current].querySelector(
            '[role="menu"]:not([hidden])',
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
      },
      true,
    );
    timeline.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest(".time-range-track")) this.close();
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!timeline.contains(event.target as Node)) this.close();
      },
      true,
    );
    window.addEventListener("blur", () => this.close());
    window.addEventListener("resize", () => this.position());
    new ResizeObserver(() => this.position()).observe(
      workspace.querySelector(".center")!,
    );
  }

  mountPlayback() {
    const settings = this.element.querySelector(
      "#time-rail-playback-settings",
    )!;
    for (const [id, title] of [
      ["playback-speed", "Speed"],
      ["playback-increment", "Step"],
    ]) {
      const choice = document.getElementById(id)!.parentElement!;
      const row = document.createElement("div");
      row.className = "time-rail-setting";
      const label = document.createElement("span");
      label.textContent = title;
      row.append(label, choice);
      settings.append(row);
    }
    const fade = document.createElement("label");
    fade.className = "time-rail-fade";
    fade.htmlFor = "playback-fade";
    fade.innerHTML =
      '<span>Fade</span><output id="playback-fade-value" for="playback-fade">50%</output><input id="playback-fade" type="range" min="0" max="100" step="1" value="50" aria-label="Fade playback history"><small><span>Linger</span><span>Faster</span></small>';
    fade.title =
      "Higher fade keeps a shorter history and fades entities and trails faster. Maximum keeps the latest few time slices. Zero retains history until the next loop.";
    settings.append(fade);
    // Menu expansion changes the flyout height. Reposition in the same task,
    // before the next paint, rather than waiting for the next resize frame.
    new MutationObserver(() => this.position()).observe(settings, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  update(lo: number, hi: number, start: number | null, end: number | null) {
    this.values = [start ?? lo, end ?? hi];
    const span = Math.max(1e-9, hi - lo);
    const mini = this.element.querySelector<HTMLElement>(
      ".time-rail-mini span",
    )!;
    const a = Math.max(0, Math.min(1, (this.values[0] - lo) / span));
    const b = Math.max(a, Math.min(1, (this.values[1] - lo) / span));
    mini.style.top = `${a * 100}%`;
    mini.style.height = `${(b - a) * 100}%`;
  }

  private setCollapsed(value: boolean) {
    this.close();
    this.collapsed = value;
    this.element.classList.toggle("is-collapsed", value);
    this.workspace.classList.toggle("time-rail-collapsed", value);
    const body = this.element.querySelector<HTMLElement>(".time-rail-body")!;
    body.hidden = value;
    body.inert = value;
    this.collapse.setAttribute(
      "aria-label",
      value ? "Expand time rail" : "Collapse time rail",
    );
    this.collapse.setAttribute("aria-expanded", String(!value));
    this.collapse.innerHTML = this.options.icon(
      value ? "collapse-right" : "collapse-left",
    );
  }

  private open(kind: "range" | "playback", keyboard: boolean, focus = false) {
    clearTimeout(this.opening);
    clearTimeout(this.closing);
    if (this.current !== kind) {
      this.close();
      this.current = kind;
      if (kind === "range")
        this.inputs.forEach((input, i) => {
          input.value = time(this.values[i]);
        });
    }
    this.keyboard = keyboard;
    this.popups[kind].hidden = false;
    this.triggers[kind].setAttribute("aria-expanded", "true");
    this.position();
    if (focus) {
      const target = kind === "range" ? this.inputs[0] : this.popupPlay;
      target.focus();
    }
  }

  private close(restore = false) {
    clearTimeout(this.opening);
    clearTimeout(this.closing);
    if (!this.current) return;
    const kind = this.current;
    this.current = undefined;
    this.popups[kind].hidden = true;
    this.triggers[kind].setAttribute("aria-expanded", "false");
    this.keyboard = false;
    if (restore) {
      this.suppressFocus = true;
      this.triggers[kind].focus();
      this.suppressFocus = false;
    }
  }

  private position() {
    if (!this.current) return;
    const popup = this.popups[this.current];
    const anchor = this.triggers[this.current].getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(this.element.getBoundingClientRect().right + 8, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.top, innerHeight - popup.offsetHeight - 8))}px`;
  }
}
