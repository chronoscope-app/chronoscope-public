/** Opt-in bounded compositor-adjacent CPU telemetry; never claims GPU timing. */
export class ViewProfiles {
  private sessions = new Map<string, any>();
  constructor(
    private observe: (listener: () => void) => () => void,
    private sample: () => number[],
    private now = () => performance.now(),
    private epoch = () => performance.timeOrigin + performance.now(),
  ) {}
  request(args: Record<string, any>) {
    if (args.action === "start") {
      if (
        [...this.sessions.values()].filter((s) => s.state === "recording")
          .length >= 2
      )
        throw Error(
          "RESOURCE_LIMIT: two performance recordings are already active",
        );
      while (this.sessions.size >= 8) {
        const oldest = [...this.sessions].find(
          ([, s]) => s.state === "complete",
        );
        if (!oldest) break;
        this.sessions.delete(oldest[0]);
      }
      const id = crypto.randomUUID(),
        start = this.now();
      const s: any = {
        id,
        state: "recording",
        started_unix_ms: this.epoch(),
        columns: [
          "elapsed_ms",
          "frame_interval_ms",
          "cpu_submission_ms",
          "imagery_pending",
          "terrain_pending",
          "terrain_provider_changes",
          "render_errors",
          "context_recoveries",
        ],
        samples: [],
        summary: {},
        start,
        cleanup: () => {},
        timer: 0,
      };
      this.sessions.set(id, s);
      s.cleanup = this.observe(() => {
        if (s.state !== "recording") return;
        s.samples.push(
          [this.now() - start, ...this.sample()].map(
            (v) => Math.round(v * 1000) / 1000,
          ),
        );
        if (s.samples.length >= 6000) this.finish(s, "sample_limit");
      });
      s.timer = setTimeout(
        () => this.finish(s, "duration_limit"),
        (args.max_seconds ?? 30) * 1000,
      );
      return this.public(s);
    }
    const s = this.sessions.get(args.id);
    if (!s)
      throw Error(
        "NOT_FOUND: performance recording not found in this app session",
      );
    if (args.action === "stop") this.finish(s, "stopped");
    return this.public(s);
  }
  private finish(s: any, reason: string) {
    if (s.state === "complete") return;
    s.state = "complete";
    s.cleanup();
    clearTimeout(s.timer);
    const intervals = s.samples
      .map((r: number[]) => r[1])
      .filter((n: number) => n > 0)
      .sort((a: number, b: number) => a - b);
    s.summary = {
      reason,
      duration_ms: this.now() - s.start,
      rendered_frames: s.samples.length,
      frame_p95_ms: intervals[Math.floor(intervals.length * 0.95)] ?? null,
      gaps_over_250_ms: s.samples.filter((r: number[]) => r[1] > 250).length,
      gap_interpretation:
        "Long intervals may be idle or stalled; correlate with input/scenario timestamps",
      cpu_timing: "CPU submission only; asynchronous GPU time is not measured",
      sample_limit: 6000,
      truncated: reason === "sample_limit",
    };
  }
  private public(s: any) {
    return {
      id: s.id,
      state: s.state,
      started_unix_ms: s.started_unix_ms,
      columns: s.columns,
      samples: s.samples.map((row: number[]) => [...row]),
      summary: s.summary,
    };
  }
}
