/** Map reset control; renderer health remains available in its tooltip. */
export class RendererStatus {
  constructor(private host: HTMLElement) {}
  update(status: string) {
    const mode = /webgpu/i.test(status)
      ? "webgpu"
      : /webgl/i.test(status)
        ? "webgl"
        : /cpu/i.test(status)
          ? "cpu"
          : "starting";
    this.host.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/></svg>`;
    this.host.dataset.renderer = mode;
    this.host.dataset.warning = String(
      /error|lost|failed|restart|refreshing/i.test(status),
    );
    this.host.title = `Reset map · ${status}`;
    this.host.setAttribute("aria-label", "Reset map");
  }
}
