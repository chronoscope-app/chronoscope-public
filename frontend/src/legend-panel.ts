/** Stable chrome around legends whose contents change with every render. */
export class LegendPanel {
  readonly content = document.createElement("div");
  private toggle = document.createElement("button");
  constructor(
    readonly element: HTMLElement,
    title: string,
  ) {
    element.classList.add("legend-panel");
    this.content.className = "legend-content";
    this.content.id = `${element.id || element.classList[0]}-content`;
    this.toggle.className = "legend-toggle";
    this.toggle.type = "button";
    this.toggle.textContent = title;
    this.toggle.setAttribute("aria-controls", this.content.id);
    this.toggle.setAttribute("aria-expanded", "false");
    this.content.hidden = true;
    element.classList.add("is-collapsed");
    this.toggle.title =
      "Collapse or expand legend; drag its lower-right corner to resize";
    this.toggle.addEventListener("click", () => {
      const collapsed = !this.content.hidden;
      this.content.hidden = collapsed;
      element.classList.toggle("is-collapsed", collapsed);
      this.toggle.setAttribute("aria-expanded", String(!collapsed));
    });
    element.replaceChildren(this.toggle, this.content);
  }
}
