/** Keep the legacy 1x midpoint, with an explicit zero for Off. */
export function globeElevationScale(value: number): number {
  if (value <= 0) return 0;
  const v = Math.min(100, Math.max(1, value));
  return Math.pow(20, (v - 50) / (v <= 50 ? 49 : 50));
}
export function globeElevationSlider(enabled: boolean, scale: number): number {
  if (!enabled) return 0;
  const value = 50 + ((scale <= 1 ? 49 : 50) * Math.log(scale)) / Math.log(20);
  return Math.max(1, Math.min(100, Math.round(value)));
}
