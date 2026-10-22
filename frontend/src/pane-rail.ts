export interface PaneSection {
  id: string;
  label: string;
  icon: string;
  target: HTMLElement;
  activate?: () => void | Promise<void>;
}

/** Reuses live pane controls: opening a flyout never clones or rebuilds a form. */
export class PaneRail {
  private body = document.createElement("div");
  private rail = document.createElement("nav");
  private heading = document.createElement("div");
  private title = document.createElement("span");
  private buttons = new Map<string, HTMLButtonElement>();
  private current?: PaneSection;
  private wasOpen = false;
  private keyboard = false;
  private suppressFocus = false;
  private opening?: ReturnType<typeof setTimeout>;
  private closing?: ReturnType<typeof setTimeout>;
  private activation: Promise<void> = Promise.resolve();
  private expand: HTMLButtonElement;
  constructor(
    private pane: HTMLElement,
    private side: "left" | "right",
    private sections: PaneSection[],
    icon: (name: string) => string,
    private change: (collapsed: boolean) => void,
    private error: (error: unknown) => void,
  ) {
    const button = (label: string, glyph: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pane-icon";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = icon(glyph);
      return b;
    };
    this.body.className = "pane-content";
    this.body.id = `${side}-pane-content`;
    this.body.append(...pane.childNodes);
    const heading = document.createElement("header");
    heading.className = "pane-heading";
    const label = document.createElement("span");
    label.textContent = side === "left" ? "Data & filters" : "Inspector";
    const collapse = button(`Collapse ${side} pane`, `collapse-${side}`);
    collapse.id = `collapse-${side}-pane`;
    collapse.addEventListener("click", () => {
      this.change(true);
      this.expand.focus();
    });
    heading.append(label, collapse);
    this.rail.className = "pane-rail";
    this.rail.setAttribute(
      "aria-label",
      `${side === "left" ? "Left" : "Right"} pane sections`,
    );
    this.expand = button(
      `Expand ${side} pane`,
      `collapse-${side === "left" ? "right" : "left"}`,
    );
    this.expand.addEventListener("click", () => this.change(false));
    this.rail.append(this.expand);
    this.heading.className = "pane-popover-heading";
    const pin = button(`Pin ${side} pane open`, "pin");
    pin.addEventListener("click", () => this.change(false));
    this.heading.append(this.title, pin);
    this.body.prepend(this.heading);
    pane.append(heading, this.rail, this.body);
    for (const section of sections) {
      const b = button(section.label, section.icon);
      b.dataset.paneSection = section.id;
      b.setAttribute("aria-controls", this.body.id);
      b.setAttribute("aria-expanded", "false");
      this.buttons.set(section.id, b);
      this.rail.append(b);
      b.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        clearTimeout(this.opening);
        this.cancelClose();
        this.opening = setTimeout(() => this.reveal(section.id, false), 80);
      });
      b.addEventListener("focus", () => {
        if (!this.suppressFocus && b.matches(":focus-visible"))
          this.reveal(section.id, true);
      });
      b.addEventListener("click", (event) => {
        this.reveal(section.id, event.detail === 0);
        if (event.detail === 0) this.focusContent();
      });
    }
    this.rail.addEventListener("keydown", (event) => {
      const buttons = [
        ...this.rail.querySelectorAll<HTMLButtonElement>("button"),
      ];
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const forward = side === "left" ? "ArrowRight" : "ArrowLeft";
      if (!["ArrowDown", "ArrowUp", "Home", "End", forward].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === forward) return this.focusContent();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    });
    pane.addEventListener("pointerenter", () => this.cancelClose());
    pane.addEventListener("pointerleave", () => {
      clearTimeout(this.opening);
      if (!this.keyboard) this.scheduleClose();
    });
    pane.addEventListener("focusout", (event) => {
      if (
        !pane.contains(event.relatedTarget as Node | null) &&
        (this.keyboard || !pane.matches(":hover"))
      )
        this.scheduleClose();
    });
    // Capture Escape before native selects consume it.
    pane.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || !this.current) return;
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!pane.contains(event.target as Node)) this.close();
      },
      true,
    );
  }

  get collapsed() {
    return this.pane.classList.contains("pane-collapsed");
  }

  setCollapsed(collapsed: boolean) {
    const focused = this.pane.contains(document.activeElement);
    this.close();
    this.pane.classList.toggle("pane-collapsed", collapsed);
    this.rail.hidden = !collapsed;
    this.body.hidden = collapsed;
    this.body.inert = collapsed;
    this.pane.querySelector<HTMLElement>(".pane-heading")!.hidden = collapsed;
    if (!collapsed && focused)
      this.pane
        .querySelector<HTMLButtonElement>(".pane-heading button")
        ?.focus();
  }

  reveal(id: string, keyboard?: boolean) {
    if (!this.collapsed) return;
    clearTimeout(this.opening);
    this.cancelClose();
    if (this.current?.id === id) {
      if (keyboard !== undefined) this.keyboard = keyboard;
      return this.activation;
    }
    const section = this.sections.find((section) => section.id === id);
    if (!section) return;
    this.close();
    this.current = section;
    this.keyboard = keyboard ?? false;
    this.wasOpen =
      section.target instanceof HTMLDetailsElement && section.target.open;
    if (section.target instanceof HTMLDetailsElement)
      section.target.open = true;
    section.target.classList.add("pane-section-active");
    this.title.textContent = section.label;
    this.pane.dataset.peekSection = id;
    this.pane.classList.add("pane-peeking");
    this.body.hidden = false;
    this.body.inert = false;
    this.body.setAttribute("aria-label", section.label);
    this.body.setAttribute("role", "region");
    this.buttons.get(id)!.setAttribute("aria-expanded", "true");
    try {
      this.activation = Promise.resolve(section.activate?.()).catch(this.error);
    } catch (error) {
      this.error(error);
      this.activation = Promise.resolve();
    }
    return this.activation;
  }

  close(restoreFocus = false) {
    clearTimeout(this.opening);
    this.cancelClose();
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    current.target.classList.remove("pane-section-active");
    if (current.target instanceof HTMLDetailsElement)
      current.target.open = this.wasOpen;
    this.buttons.get(current.id)!.setAttribute("aria-expanded", "false");
    this.pane.classList.remove("pane-peeking");
    delete this.pane.dataset.peekSection;
    this.body.hidden = this.collapsed;
    this.body.inert = this.collapsed;
    this.body.removeAttribute("role");
    this.body.removeAttribute("aria-label");
    this.keyboard = false;
    if (this.body.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    if (restoreFocus) {
      this.suppressFocus = true;
      this.buttons.get(current.id)!.focus();
      this.suppressFocus = false;
    }
  }

  private cancelClose() {
    clearTimeout(this.closing);
  }
  private scheduleClose() {
    this.cancelClose();
    this.closing = setTimeout(() => this.close(), 180);
  }
  private focusContent() {
    this.body
      .querySelector<HTMLElement>(
        ".pane-section-active :is(input,select,textarea,button,[tabindex='0']):not([disabled])",
      )
      ?.focus();
  }
}
