import { time as utcTime } from "./types";
/** Newest at ground level; oldest at the top. Source timestamps stay unchanged. */
export function timeElevationFraction(epoch: number, lo: number, hi: number) {
  if (hi <= lo) return 0;
  return 1 - Math.max(0, Math.min(1, (epoch - lo) / (hi - lo)));
}

/** UTC time ticks clipped in homogeneous camera coordinates (CSS-pixel sizing). */
type Clip = readonly [number, number, number, number];
export function timeAxisTicks(
  lo: number,
  hi: number,
  start: Clip,
  end: Clip,
  width: number,
  height: number,
) {
  if (
    ![lo, hi, ...start, ...end, width, height].every(Number.isFinite) ||
    hi < lo ||
    width <= 0 ||
    height <= 0
  )
    return [];
  // Clip before dividing by w: axes crossing the camera/near plane must not
  // generate infinite pixel spans, timestamps, or unbounded tick loops.
  let lower = 0,
    upper = 1;
  const planes = ([x, y, z, w]: Clip) => [
    w + x,
    w - x,
    w + y,
    w - y,
    w + z,
    w - z,
    w - 1e-9,
  ];
  const a = planes(start),
    b = planes(end);
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 0 && b[i] < 0) return [];
    if (a[i] < 0) lower = Math.max(lower, a[i] / (a[i] - b[i]));
    if (b[i] < 0) upper = Math.min(upper, a[i] / (a[i] - b[i]));
  }
  if (lower > upper) return [];
  const pixel = (fraction: number) => {
    const w = start[3] + (end[3] - start[3]) * fraction;
    return [
      (((start[0] + (end[0] - start[0]) * fraction) / w) * width) / 2,
      (((start[1] + (end[1] - start[1]) * fraction) / w) * height) / 2,
    ];
  };
  const p = pixel(lower),
    q = pixel(upper);
  const pixels = Math.max(1, Math.hypot(q[0] - p[0], q[1] - p[1]));
  const span = hi - lo,
    visibleSpan = span * (upper - lower);
  const secondsPerTick = Math.max(
    (visibleSpan * 65) / pixels,
    Math.max(Math.abs(lo), Math.abs(hi)) * Number.EPSILON * 2,
  );
  const steps = [
    0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002,
    0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
    15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200,
    86400, 172800, 604800, 1209600, 2592000, 7776000, 15552000, 31536000,
  ];
  const step =
    steps.find((s) => s >= secondsPerTick) ||
    Math.ceil(secondsPerTick / 31536000) * 31536000;
  const fullPixels = pixels / Math.max(1e-9, upper - lower);
  const detailed = step < 60 || (fullPixels > height * 1.4 && step < 86400);
  const first = lo + lower * span,
    last = lo + upper * span;
  const times = span === 0 ? [lo] : [];
  for (
    let t = Math.ceil(first / step) * step;
    t <= last && times.length < 32;
    t += step
  )
    times.push(t);
  // Retain a useful date even for short windows between aligned UTC ticks.
  if (!times.length) times.push(first);
  let previous = "";
  return times.flatMap((time) => {
    const date = new Date(time * 1000);
    if (!Number.isFinite(date.getTime())) return [];
    const day = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")}, ${date.getUTCFullYear()}`;
    const text = detailed
      ? `${day}\n${step < 60 ? utcTime(time).split(" ")[1] : `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`} UTC`
      : day;
    if (text === previous) return [];
    previous = text;
    return [{ time, text }];
  });
}
