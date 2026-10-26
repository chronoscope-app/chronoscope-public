/** Own one modal, its keyboard focus, and restoration to the initiating control. */
export class DialogController {
  node: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  constructor(private beforeClose: () => void = () => {}) {}
  close() {
    this.beforeClose();
    this.node?.remove();
    this.node = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }
  open(html: string, small = false) {
    const returnFocus =
      this.returnFocus ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    this.close();
    this.returnFocus = returnFocus;
    this.node = document.createElement("div");
    this.node.className = "modal-backdrop";
    this.node.innerHTML = `<section class="modal ${small ? "small" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${html}</section>`;
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
      } else if (event.key === "Tab") {
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
    (
      this.node.querySelector<HTMLElement>("button,input,select,textarea") ||
      this.node.querySelector<HTMLElement>(".modal")
    )?.focus();
    return this.node;
  }
}
