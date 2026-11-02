/** Resolve a click beside a displayed stem to its actual geographic foot. */
export function nearestGroundLocation<
  T extends { lat: number; lon: number; inferred?: boolean },
>(
  points: Iterable<T>,
  project: (point: T) => { x: number; y: number } | undefined,
  x: number,
  y: number,
  tolerance = 12,
): T | undefined {
  let nearest: T | undefined;
  let best = tolerance * tolerance;
  for (const point of points) {
    if (
      point.inferred ||
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lon)
    )
      continue;
    const screen = project(point);
    if (!screen) continue;
    const distance = (screen.x - x) ** 2 + (screen.y - y) ** 2;
    if (distance < best) {
      best = distance;
      nearest = point;
    }
  }
  return nearest;
}
