import { time, displayDate, displayClock } from "./types";
/** UTC labels retain calendar context at the scale of the full histogram. */
export function timelineTicks(lo: number, hi: number) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
  const span = hi - lo;
  const day = 86400;
  return [0, 0.25, 0.5, 0.75, 1].map((position) => {
    const date = new Date((lo + (hi - lo) * position) * 1000);
    return {
      label:
        span < 1
          ? displayClock(lo + (hi - lo) * position, true)
          : span >= 4 * 366 * day
            ? String(date.getUTCFullYear())
            : displayDate(lo + (hi - lo) * position) +
              (span < 7 * day
                ? " " + displayClock(lo + (hi - lo) * position, span < 300)
                : ""),
      full: time(lo + (hi - lo) * position) + " UTC",
    };
  });
}
