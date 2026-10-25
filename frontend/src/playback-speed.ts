import { TOOLTIP_DELAY_MS } from "./tooltips";

export const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const playbackIncrements = [0.001, 1, 60, 3600, 86400, 604800];

// Integrate simulated seconds before changing either rate, preserving the cursor.
export class PlaybackClock {
  private elapsed = 0;
  constructor(
    private speed: number,
    private last = performance.now(),
    private increment = 86400,
  ) {}
  seconds(now = performance.now()) {
    this.elapsed +=
      (Math.max(0, now - this.last) / 1000) * this.speed * this.increment;
    this.last = Math.max(this.last, now);
    return this.elapsed;
  }
  setSpeed(speed: number, now = performance.now()) {
    this.seconds(now);
    this.speed = speed;
  }
  setIncrement(increment: number, now = performance.now()) {
    this.seconds(now);
    this.increment = increment;
  }
}

class PlaybackChoice {
  value: number;
  private trigger: HTMLButtonElement;
  private menu: HTMLElement;
  private choose!: (value: number) => void;
  setValue(value: number) {
    this.choose(value);
  }
  constructor(
    after: HTMLElement,
    changed: (value: number) => void,
    config: {
      id: string;
      name: string;
      values: number[];
      value: number;
      label: (value: number) => string;
      icon: string;
    },
  ) {
    this.value = config.value;
    const host = document.createElement("div");
    host.className = "playback-speed";
    host.innerHTML = `<button id="${config.id}" data-tooltip-disabled aria-label="${config.name}: ${config.label(this.value)}" aria-haspopup="menu" aria-expanded="false" aria-controls="${config.id}-menu">${config.icon}<span>${config.label(this.value)}</span></button><div id="${config.id}-menu" role="menu" aria-label="${config.name}" hidden>${config.values.map((value) => `<button role="menuitemradio" aria-checked="${value === this.value}" data-speed="${value}" tabindex="-1"><span>${config.label(value)}</span><span class="speed-check" aria-hidden="true">✓</span></button>`).join("")}</div>`;
    after.after(host);
    this.trigger = host.querySelector("button")!;
    this.menu = host.querySelector("[role=menu]")!;
    const items = [...this.menu.querySelectorAll<HTMLButtonElement>("button")];
    let hoverTimer: number | undefined;
    let openedByHover = false;
    const cancelHover = () => {
      clearTimeout(hoverTimer);
      hoverTimer = undefined;
    };
    const close = (restore = false) => {
      cancelHover();
      openedByHover = false;
      this.menu.hidden = true;
      this.trigger.setAttribute("aria-expanded", "false");
      if (restore) this.trigger.focus();
    };
    const open = (keyboard = true) => {
      cancelHover();
      document.dispatchEvent(
        new CustomEvent("chronoscope-playback-menu-open", { detail: host }),
      );
      openedByHover = !keyboard;
      this.menu.hidden = false;
      this.trigger.setAttribute("aria-expanded", "true");
      // Hover should not take keyboard focus away from the current control.
      if (keyboard)
        items
          .find((item) => Number(item.dataset.speed) === this.value)!
          .focus();
    };
    this.trigger.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch" || event.buttons || !this.menu.hidden)
        return;
      cancelHover();
      hoverTimer = window.setTimeout(() => {
        if (this.trigger.isConnected && !this.trigger.disabled) open(false);
      }, TOOLTIP_DELAY_MS);
    });
    this.trigger.addEventListener("pointerleave", cancelHover);
    this.trigger.addEventListener("pointerdown", cancelHover);
    host.addEventListener("pointerleave", () => {
      cancelHover();
      if (openedByHover && !this.menu.contains(document.activeElement)) close();
    });
    document.addEventListener("chronoscope-playback-menu-open", (event) => {
      if ((event as CustomEvent).detail !== host) close();
    });
    document.addEventListener("keydown", (event) => {
      // Hover leaves focus elsewhere, so Escape must also work outside this host.
      if (event.key === "Escape") close();
    });
    window.addEventListener("blur", () => close());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) close();
    });
    this.trigger.addEventListener("click", () => {
      if (this.menu.hidden) open();
      else close();
    });
    this.trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    });
    this.choose = (value) => {
      if (!config.values.includes(value))
        throw Error("INVALID_ARGUMENT: unsupported playback choice");
      this.value = value;
      changed(value);
      this.trigger.querySelector("span")!.textContent = config.label(value);
      this.trigger.setAttribute(
        "aria-label",
        `${config.name}: ${config.label(value)}`,
      );
      items.forEach((item) =>
        item.setAttribute(
          "aria-checked",
          String(Number(item.dataset.speed) === value),
        ),
      );
    };
    items.forEach((item) =>
      item.addEventListener("click", () => {
        this.choose(Number(item.dataset.speed));
        close(true);
      }),
    );
    host.addEventListener("keydown", (event) => {
      cancelHover();
      if (["Escape", "Tab"].includes(event.key) && !this.menu.hidden) {
        if (event.key === "Escape") event.preventDefault();
        event.stopPropagation();
        close(event.key === "Escape");
      } else if (
        !this.menu.hidden &&
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length
        ].focus();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!host.contains(event.target as Node)) close();
    });
  }
}

export class PlaybackSpeed extends PlaybackChoice {
  constructor(after: HTMLElement, changed: (value: number) => void) {
    super(after, changed, {
      id: "playback-speed",
      name: "Playback speed",
      values: playbackSpeeds,
      value: 1,
      label: (value) => `${value}×`,
      icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 9c-2-2-3-7-1-7s3 4 3 6c0-3 2-6 3-5s0 5-1 6c3 1 4 3 4 5l-3 1-2 5H7c-4 0-5-2-4-5s4-5 7-4M7 20c-2-4 1-7 4-6M3 14a2 2 0 1 0 0 4"/><circle cx="18" cy="11.5" r=".6" fill="currentColor" stroke="none"/></svg>`,
    });
  }
}
export class PlaybackIncrement extends PlaybackChoice {
  constructor(after: HTMLElement, changed: (value: number) => void) {
    const stored = Number(
      localStorage.getItem("chronoscope-playback-increment"),
    );
    super(
      after,
      (value) => {
        localStorage.setItem("chronoscope-playback-increment", String(value));
        changed(value);
      },
      {
        id: "playback-increment",
        name: "Playback increment",
        values: playbackIncrements,
        value: playbackIncrements.includes(stored) ? stored : 86400,
        label: (value) =>
          ({
            0.001: "Millisecond",
            1: "Second",
            60: "Minute",
            3600: "Hour",
            86400: "Day",
            604800: "Week",
          })[value] || `${value} s`,
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-9 3v5m-2-2 2 2 2-2"/></svg>',
      },
    );
  }
}
