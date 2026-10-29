export type ViewportRefreshOutcome =
  | { kind: "accepted" | "superseded" | "canceled"; generation: number }
  | { kind: "failed"; generation: number; error: unknown };

export interface ViewportRefreshTicket {
  readonly generation: number;
  /** Always resolves, including when ignored by ordinary movement callers. */
  readonly done: Promise<ViewportRefreshOutcome>;
}

export interface ViewportRefreshIdle {
  readonly generation: number;
  readonly outcome: ViewportRefreshOutcome | undefined;
}

interface Work extends ViewportRefreshTicket {
  settle: (outcome: ViewportRefreshOutcome) => void;
  finished: Promise<void>;
  finish: () => void;
}

/** One active load and one latest pending viewport. Bounds are read by refresh
 * when work starts. Supersession/cancellation invalidates acceptance but does
 * not interrupt a running load or permit overlap. "accepted" means the refresh
 * callback completed while current; the caller still owns publication checks.
 *
 * flush/drain/idle are outer barriers: never await them from refresh/onError,
 * whose completion they necessarily await. They do not wait for imagery. */
export class ViewportRefresh {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Work;
  private pending?: Work;
  private version = 0;
  private draining = 0;
  private readonly quiet = Promise.resolve();
  private completion: Promise<void> = this.quiet;
  private latest?: ViewportRefreshOutcome;

  constructor(
    private refresh: (superseded: () => boolean) => Promise<void>,
    private onError: (error: unknown) => void,
    private interval = 120,
  ) {}

  get generation() {
    return this.version;
  }

  /** Current active/pending completion. Coalescing may reuse the active promise;
   * compare generation too, or use drain, which also flushes the timer. */
  get tail() {
    return this.completion;
  }

  request(): ViewportRefreshTicket {
    const generation = ++this.version;
    if (this.pending) {
      this.settle(this.pending, {
        kind: "superseded",
        generation: this.pending.generation,
      });
      this.pending.finish();
    }
    let settle!: Work["settle"];
    let finish!: Work["finish"];
    const work: Work = {
      generation,
      done: new Promise((resolve) => {
        settle = resolve;
      }),
      settle: (outcome) => settle(outcome),
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    this.pending = work;
    this.schedule();
    this.updateTail();
    return { generation, done: work.done };
  }

  cancel() {
    const generation = ++this.version;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending) {
      this.settle(this.pending, {
        kind: "canceled",
        generation: this.pending.generation,
      });
      this.pending.finish();
      this.pending = undefined;
    }
    if (this.active)
      this.settle(this.active, {
        kind: "canceled",
        generation: this.active.generation,
      });
    this.latest = { kind: "canceled", generation };
    this.updateTail();
  }

  /** Start scheduled work now and return its quiescence barrier. */
  flush(): Promise<ViewportRefreshIdle> {
    return this.drain();
  }

  idle(): Promise<ViewportRefreshIdle> {
    return this.drain();
  }

  async drain(): Promise<ViewportRefreshIdle> {
    this.draining++;
    try {
      for (;;) {
        this.startPending();
        const generation = this.version;
        const tail = this.completion;
        await tail;
        // Include work enqueued by completion callbacks in this stable barrier.
        await Promise.resolve();
        if (
          generation === this.version &&
          tail === this.completion &&
          !this.active &&
          !this.pending &&
          this.timer === undefined
        )
          return { generation, outcome: this.latest };
      }
    } finally {
      this.draining--;
    }
  }

  private settle(work: Work, outcome: ViewportRefreshOutcome) {
    work.settle(outcome);
    if (!this.latest || outcome.generation > this.latest.generation)
      this.latest = outcome;
  }

  private updateTail() {
    // Reuse work promises instead of attaching one new active-load reaction per
    // camera event. A long load retains only the active and latest pending work.
    this.completion =
      this.active?.finished ?? this.pending?.finished ?? this.quiet;
  }

  private schedule() {
    if (this.timer !== undefined || this.active || !this.pending) return;
    if (this.draining) {
      this.startPending();
      return;
    }
    this.timer = setTimeout(() => this.startPending(), this.interval);
  }

  private startPending() {
    if (this.active || !this.pending) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const work = this.pending;
    this.pending = undefined;
    this.active = work;
    this.updateTail();
    void this.run(work);
  }

  private async run(work: Work) {
    try {
      await this.refresh(() => work.generation !== this.version);
      this.settle(work, {
        kind: work.generation === this.version ? "accepted" : "superseded",
        generation: work.generation,
      });
    } catch (error) {
      this.settle(work, { kind: "failed", generation: work.generation, error });
      // A reporting callback cannot strand the queue or create an unhandled
      // rejection. The original error remains available through the ticket.
      try {
        this.onError(error);
      } catch {
        /* reported by the failed ticket */
      }
    } finally {
      this.active = undefined;
      work.finish();
      this.schedule();
      this.updateTail();
    }
  }
}
