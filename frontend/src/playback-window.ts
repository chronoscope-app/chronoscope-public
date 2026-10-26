/** Visible playback history stays in the normal filtered dataset and render budget.
 * Fade off accumulates the current window until playback wraps, without ghost
 * records that would disagree with the table, selection or exact queries.
 */
export class PlaybackWindow {
  private anchor: number;
  private previous: number;
  constructor(
    start: number,
    private fading: boolean,
  ) {
    this.anchor = this.previous = start;
  }
  advance(start: number, end: number, fading: boolean): [number, number] {
    if (start < this.previous - 1e-9 || (this.fading && !fading))
      this.anchor = start;
    this.previous = start;
    this.fading = fading;
    return [fading ? start : Math.min(this.anchor, start), end];
  }
}
