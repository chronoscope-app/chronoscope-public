/** Own one dialog, its dismissal, and restoration to the initiating control. */
export class DialogController {
  node: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private lifetime?: AbortController;
  private resizeObserver?: ResizeObserver;
  constructor(private beforeClose: () => void = () => {}) {}
  close(restoreFocus = true) {
    this.beforeClose();
    this.lifetime?.abort();
    this.resizeObserver?.disconnect();
    this.lifetime = undefined;
    this.resizeObserver = undefined;
    this.node?.remove();
    this.node = null;
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }
  open(html: string, small = false) {
    return this.create(html, small);
  }
  openPopover(html: string, anchor: { x: number; y: number }) {
    return this.create(html, false, anchor);
  }
  private create(html: string, small: boolean, anchor?: { x: number; y: number }) {
    const returnFocus =
      this.returnFocus ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    this.close();
    this.returnFocus = returnFocus;
    this.node = document.createElement("div");
    this.lifetime = new AbortController();
    this.node.className = anchor ? "context-popover" : "modal-backdrop";
    this.node.innerHTML = `<section class="${anchor ? "popover" : `modal ${small ? "small" : ""}`}" role="dialog" aria-modal="${!anchor}" aria-labelledby="modal-title" tabindex="-1">${html}</section>`;
    document.body.append(this.node);
    this.node
      .querySelectorAll("[data-close]")
      .forEach((e) => e.addEventListener("click", () => this.close()));
    this.node.querySelector("h2")?.setAttribute("id", "modal-title");
    this.node.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else if (event.key === "Tab" && !anchor) {
        const controls = [
          ...this.node!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]',
          ),
        ].filter((e) => e.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !controls.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !controls.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    if (anchor) {
      const node = this.node;
      const position = () => {
        const width = node.offsetWidth, height = node.offsetHeight;
        const left = anchor.x + width + 8 <= innerWidth ? anchor.x + 8 : anchor.x - width - 8;
        const top = anchor.y + height + 8 <= innerHeight ? anchor.y + 8 : anchor.y - height - 8;
        node.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, left))}px`;
        node.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, top))}px`;
      };
      position();
      this.resizeObserver = new ResizeObserver(position);
      this.resizeObserver.observe(node);
      window.addEventListener("resize", position, { signal: this.lifetime.signal });
      document.addEventListener("pointerdown", event => {
        if (!node.contains(event.target as Node)) this.close();
      }, { capture: true, signal: this.lifetime.signal });
      node.addEventListener("focusout", event => {
        if (event.relatedTarget instanceof Node && !node.contains(event.relatedTarget)) this.close(false);
      });
    }
    (
      this.node.querySelector<HTMLElement>("button,input,select,textarea") ||
      this.node.querySelector<HTMLElement>(".modal")
    )?.focus();
    return this.node;
  }
}
