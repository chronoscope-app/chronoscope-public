/** Serial latest-intent writes. Each update rebases only its changed fields on
 * current engine state; CAS prevents overwriting an intervening external write. */
export class FilterIntent<T extends object> {
  private pending: Partial<T> | null = null;
  private applying: Partial<T> | null = null;
  private work: Promise<void> | null = null;
  private resolve: (() => void) | null = null;
  private reject: ((e: unknown) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private draining = false;
  private progressive = false;
  private failure: unknown;
  constructor(
    private read: () => Promise<{ filter: T; revision: number }>,
    private write: (filter: T, revision: number) => Promise<unknown>,
    private applied: () => Promise<void>,
  ) {}
  desired(base: T): T {
    return { ...base, ...this.applying, ...this.pending };
  }
  protects(key: keyof T): boolean {
    return (
      !!this.work &&
      (key in (this.pending || {}) || key in (this.applying || {}))
    );
  }
  enqueue(delta: Partial<T>, delay = 0, progressive = false): Promise<void> {
    this.progressive ||= progressive;
    this.pending = { ...this.pending, ...delta };
    this.failure = undefined;
    if (!this.work)
      this.work = new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
    clearTimeout(this.timer);
    if (delay) this.timer = setTimeout(() => this.start(), delay);
    else this.start();
    return this.work!;
  }
  idle(): Promise<void> {
    return (
      this.work ||
      (this.failure ? Promise.reject(this.failure) : Promise.resolve())
    );
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.start();
    return this.idle();
  }
  private start() {
    if (this.draining || !this.work) return;
    this.draining = true;
    void this.drain();
  }
  private async drain() {
    try {
      while (this.pending) {
        const delta = this.pending;
        this.pending = null;
        this.applying = delta;
        try {
          for (let attempt = 0; ; attempt++) {
            const state = await this.read();
            try {
              await this.write({ ...state.filter, ...delta }, state.revision);
              break;
            } catch (e) {
              if (attempt >= 2 || !(e as Error).message?.includes("CONFLICT:"))
                throw e;
            }
          }
        } catch (e) {
          this.pending = Object.assign({}, delta, this.pending);
          throw e;
        }
        this.applying = null;
        // Scrubbing must publish intermediate frames even while newer input arrives.
        // The next write still coalesces all pending deltas into one latest intent.
        if (!this.pending || this.progressive) await this.applied();
      }
      this.resolve?.();
    } catch (e) {
      this.failure = e;
      this.reject?.(e);
    } finally {
      this.applying = null;
      this.draining = false;
      this.progressive = false;
      this.work = null;
      this.resolve = null;
      this.reject = null;
    }
  }
}
