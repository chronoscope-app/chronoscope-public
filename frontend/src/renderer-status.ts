/** Render API status, outside the map. This is an indicator and map refresh action. */
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
    const paths = {
      cpu: "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4",
      webgl:
        "M3 5h18v13H3zM7 18v3m10-3v3M15 11a4 4 0 1 1-8 0 4 4 0 0 1 8 0M11 7v8m-4-4h8M18 8v6",
      webgpu: "m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10m1-16-4 5h6l-4 6",
      starting: "M5 3h14M5 21h14M7 3v5l10 8v5M17 3v5L7 16v5",
    };
    const label =
      mode === "webgl"
        ? /webgl2/i.test(status)
          ? "WebGL2"
          : "WebGL"
        : mode === "webgpu"
          ? "WebGPU"
          : mode === "cpu"
            ? "CPU"
            : "Starting";
    this.host.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[mode]}"/></svg><span>${label}</span>`;
    this.host.dataset.renderer = mode;
    this.host.dataset.warning = String(
      /error|lost|failed|restart/i.test(status),
    );
    this.host.title = `Renderer: ${status}. Click to refresh the map renderer.`;
    this.host.setAttribute(
      "aria-label",
      `Renderer: ${status}; refresh map renderer`,
    );
  }
}
