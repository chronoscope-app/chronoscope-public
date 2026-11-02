/** Calendar-aligned UTC labels for a screen-space ruler, independent of camera/filters. */
export interface RailTick {
  time: number;
  fraction: number;
  group: string;
  label: string;
  detail: string;
  level: "year" | "month" | "date";
}
const DAY = 86400;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const pad = (n: number) => String(n).padStart(2, "0");
const date = (t: number) => new Date(t * 1000);
const month = (d: Date) => MONTHS[d.getUTCMonth()];
const day = (d: Date) => `${month(d)} ${pad(d.getUTCDate())}`;
const calendar = (year: number, month: number, day = 1) => {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  return d.getTime() / 1000;
};

export function railTicks(lo: number, hi: number, height: number) {
  const empty = { heading: "", date: "", ticks: [] as RailTick[] };
  if (
    ![lo, hi, height].every(Number.isFinite) ||
    hi < lo ||
    height < 40 ||
    Math.max(Math.abs(lo), Math.abs(hi)) > 8.64e12
  )
    return empty;
  const first = date(lo),
    last = date(hi),
    span = hi - lo;
  const year = first.getUTCFullYear(),
    endYear = last.getUTCFullYear();
  const heading = year === endYear ? String(year) : `${year}–${endYear}`;
  const dateHeading =
    span < DAY
      ? day(first) + (day(first) !== day(last) ? `–${day(last)}` : "")
      : "";
  const target = Math.max(
    span / Math.max(1, Math.min(128, Math.floor(height / 56)) - 1),
    Math.max(Math.abs(lo), Math.abs(hi)) * Number.EPSILON * 4,
    0.000001,
  );
  const durations = [
    0.000001,
    0.000002,
    0.000005,
    0.00001,
    0.00002,
    0.00005,
    0.0001,
    0.0002,
    0.0005,
    0.001,
    0.002,
    0.005,
    0.01,
    0.02,
    0.05,
    0.1,
    0.2,
    0.5,
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    900,
    1800,
    3600,
    7200,
    10800,
    21600,
    43200,
    DAY,
    2 * DAY,
    7 * DAY,
  ];
  const duration = durations.find((s) => s >= target);
  const kind = duration
    ? "duration"
    : target <= 16 * DAY
      ? "half-month"
      : target <= 184 * DAY
        ? "month"
        : "year";
  const step =
    duration ||
    (kind === "month" ? [1, 2, 3, 6].find((n) => n * 31 * DAY >= target)! : 1);
  const yearGutter = kind === "year" || (endYear > year && span >= 300 * DAY);
  // Years provide the main landmarks. Use the finest calendar month interval
  // that fits the available pixels, rather than dropping all subdivisions.
  const calendarTarget =
    span / Math.max(1, Math.min(128, Math.floor(height / 40)));
  const monthStep = [1, 2, 3, 6, 12].find(
    (n) => n * ((365.2425 * DAY) / 12) >= calendarTarget,
  );
  const yearTarget = calendarTarget / (365.2425 * DAY);
  const yearPower = 10 ** Math.floor(Math.log10(Math.max(1, yearTarget)));
  const yearStep = [1, 2, 5, 10]
    .map((n) => n * yearPower)
    .find((n) => n >= yearTarget)!;
  const candidates: { time: number; priority: number }[] = [];
  const add = (time: number, priority = 1) => {
    if (time >= lo && time <= hi && Number.isFinite(time))
      candidates.push({ time, priority });
  };
  add(lo, 3);
  add(hi, 3);
  if (span > 0) {
    if (yearGutter) {
      let y = monthStep ? year : Math.ceil(year / yearStep) * yearStep;
      let m = monthStep
        ? Math.floor(first.getUTCMonth() / monthStep) * monthStep
        : 0;
      for (let i = 0; i < 132; i++) {
        const t = calendar(y, m);
        if (t > hi) break;
        add(t, date(t).getUTCMonth() === 0 ? 2 : 1);
        if (monthStep) m += monthStep;
        else y += yearStep;
      }
    } else if (kind === "duration") {
      const start = Math.ceil(lo / step) * step;
      for (let i = 0; i < 132 && start + i * step <= hi; i++)
        add(start + i * step);
    } else {
      let y = year,
        m = first.getUTCMonth();
      if (kind === "month") m = Math.floor(m / step) * step;
      for (let i = 0; i < 132; i++) {
        const t = calendar(y, m);
        if (t > hi) break;
        add(t, 2);
        if (kind === "half-month") add(calendar(y, m, 16));
        m += kind === "month" ? step : 1;
      }
    }
    // A week/day grid must still name a month change at its real UTC boundary.
    if (!yearGutter && kind === "duration" && step >= DAY) {
      for (let i = 0; i < 132; i++) {
        const t = calendar(year, first.getUTCMonth() + i + 1);
        if (t > hi) break;
        add(t, 2);
      }
    }
  }
  const chosen: number[] = [];
  for (const candidate of candidates.sort(
    (a, b) => b.priority - a.priority || a.time - b.time,
  )) {
    if (
      chosen.every(
        (t) => (Math.abs(candidate.time - t) / (span || 1)) * height >= 40,
      )
    )
      chosen.push(candidate.time);
  }
  const seconds = !yearGutter && kind === "duration" && step < 60 && span > 0;
  const hours = !yearGutter && kind === "duration" && step >= 60 && step < DAY;
  const precision =
    seconds && step < 1
      ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
      : 0;
  let previous = "";
  let previousYear: number | undefined;
  const ticks = chosen
    .sort((a, b) => a - b)
    .map((time): RailTick => {
      const d = date(Math.floor(time));
      if (yearGutter) {
        const y = d.getUTCFullYear();
        const isYear = time === calendar(y, 0);
        const group = !isYear && previousYear !== y ? String(y) : "";
        previousYear = y;
        return {
          time,
          fraction: span ? (time - lo) / span : 0.5,
          group,
          label: isYear ? String(y) : month(d),
          detail: "",
          level: isYear ? "year" : "month",
        };
      }
      const groupKey = seconds
        ? `${d.getUTCFullYear()}/${d.getUTCMonth()}/${d.getUTCDate()}/${d.getUTCHours()}/${d.getUTCMinutes()}`
        : hours
          ? `${d.getUTCFullYear()}/${d.getUTCMonth()}/${d.getUTCDate()}`
          : `${d.getUTCFullYear()}/${d.getUTCMonth()}`;
      const group =
        groupKey === previous
          ? ""
          : seconds
            ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
            : hours
              ? day(d)
              : month(d) +
                (year !== endYear
                  ? ` ${String(d.getUTCFullYear()).slice(-2)}`
                  : "");
      previous = groupKey;
      return {
        time,
        fraction: span ? (time - lo) / span : 0.5,
        group,
        label: seconds
          ? `:${pad(d.getUTCSeconds())}`
          : hours
            ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
            : pad(d.getUTCDate()),
        detail: precision
          ? (time - Math.floor(time)).toFixed(precision).slice(1)
          : "",
        level: "date",
      };
    });
  return { heading, date: dateHeading, ticks };
}
