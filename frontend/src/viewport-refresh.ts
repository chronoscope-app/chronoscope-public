/** Refresh during continuous movement, with one active load and one latest
 * pending viewport. Slow loads finish instead of being cancelled every frame. */
export class ViewportRefresh {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private pending = false;

  constructor(
    private refresh: (superseded: () => boolean) => Promise<void>,
    private onError: (error: unknown) => void,
    private interval = 120,
  ) {}

  request() {
    this.pending = true;
    if (this.timer !== undefined || this.running) return;
    this.timer = setTimeout(() => void this.run(), this.interval);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  private async run() {
    this.timer = undefined;
    this.pending = false;
    this.running = true;
    try {
      // Read camera bounds when the load starts, rather than queueing old ones.
      await this.refresh(() => this.pending);
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
      if (this.pending) this.request();
    }
  }
}
