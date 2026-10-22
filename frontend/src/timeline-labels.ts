import { time } from "./types";
/** UTC labels retain calendar context at the scale of the full histogram. */
export function timelineTicks(lo: number, hi: number) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
  const span = hi - lo;
  const day = 86400;
  const crossYear =
    new Date(lo * 1000).getUTCFullYear() !==
    new Date(hi * 1000).getUTCFullYear();
  const options: Intl.DateTimeFormatOptions =
    span >= 4 * 366 * day
      ? { year: "numeric" }
      : span >= 180 * day
        ? { month: "short", year: "numeric" }
        : span >= 7 * day
          ? {
              month: "short",
              day: "numeric",
              ...(crossYear ? ({ year: "numeric" } as const) : {}),
            }
          : {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              ...(span < 300 ? { second: "2-digit" as const } : {}),
              hourCycle: "h23",
              ...(crossYear ? ({ year: "numeric" } as const) : {}),
            };
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  });
  return [0, 0.25, 0.5, 0.75, 1].map((position) => {
    const date = new Date((lo + (hi - lo) * position) * 1000);
    return {
      label:
        span < 1
          ? time(lo + (hi - lo) * position).split(" ")[1]
          : formatter.format(date),
      full: time(lo + (hi - lo) * position) + " UTC",
    };
  });
}
