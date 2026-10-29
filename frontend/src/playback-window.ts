/** Higher fade retains less history and removes departing geometry sooner. */
export function fadeAmount(value: boolean | number): number {
  return typeof value === "boolean"
    ? value
      ? 50
      : 0
    : Math.round(
        Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50)),
      );
}
export function departureDuration(value: boolean | number): number {
  const amount = fadeAmount(value);
  if (!amount) return 0;
  return amount <= 50
    ? 800 * 2 ** ((50 - amount) / 20)
    : 800 * (120 / 800) ** ((amount - 50) / 50);
}
/** Three most recent distinct times; concurrent entities share a time slice.
 * Constant storage, one pass per installed packet, outside the animation loop.
 */
export function recentHistorySpan(
  ...sources: Iterable<{ time: number }>[]
): number {
  let a = -Infinity,
    b = -Infinity,
    c = -Infinity;
  for (const points of sources)
    for (const { time } of points) {
      if (!Number.isFinite(time) || time === a || time === b || time === c)
        continue;
      if (time > a) {
        c = b;
        b = a;
        a = time;
      } else if (time > b) {
        c = b;
        b = time;
      } else if (time > c) c = time;
    }
  return Number.isFinite(c) ? a - c : Number.isFinite(b) ? 2 * (a - b) : 0;
}

/** Visible history remains in the ordinary exact filter and rendering budget. */
export class PlaybackWindow {
  private anchor: number;
  private previous: number;
  private visibleStart: number;
  private lastAmount: number;
  private fading: boolean;
  constructor(start: number, value: boolean | number) {
    this.anchor = this.previous = this.visibleStart = start;
    this.lastAmount = fadeAmount(value);
    this.fading = this.lastAmount > 0;
  }
  advance(
    start: number,
    end: number,
    value: boolean | number,
    recentSpan = 0,
    baseWidth = end - start,
  ): [number, number] {
    const amount = fadeAmount(value),
      fading = amount > 0;
    if (start < this.previous - 1e-9) this.anchor = start;
    else if (this.fading && !fading)
      this.anchor =
        this.lastAmount < 50 ? Math.min(this.visibleStart, start) : start;
    this.previous = start;
    this.fading = fading;
    this.lastAmount = amount;
    if (!fading) {
      this.visibleStart = Math.min(this.anchor, start);
      return [this.visibleStart, end];
    }
    if (amount === 50) {
      this.visibleStart = start;
      return [start, end];
    }
    const minimum = Math.min(
      baseWidth,
      Math.max(1e-12, recentSpan || baseWidth / 100),
    );
    const width =
      amount <= 50
        ? baseWidth * 4 ** ((50 - amount) / 50)
        : minimum + (baseWidth - minimum) * ((100 - amount) / 50) ** 2;
    // Linger within this loop's played history, without revealing records
    // before the user's initial window just because fade was reduced.
    this.visibleStart = Math.max(0, this.anchor, end - width);
    return [this.visibleStart, end];
  }
}
