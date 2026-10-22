/** A geographic ground window, fitted inside a protected screen rectangle.
 * All positions are Cesium Columbus world metres: (height,easting,northing).
 * This changes the map's visible extent, never the projection or Event values.
 */
export function spaceTimePadding(width: number, height: number) {
  return {
    left: Math.min(56, Math.max(28, width * 0.04)),
    right: Math.min(40, Math.max(24, width * 0.03)),
    top: Math.max(56, height * 0.1),
    bottom: Math.max(48, height * 0.07),
  };
}

export function groundWindow(
  matrix: readonly number[],
  center: readonly [number, number],
  height: number,
  size: readonly [number, number],
  world: readonly [number, number, number, number],
): [number, number, number, number] | null {
  const [width, viewportHeight] = size;
  if (
    matrix.length !== 16 ||
    ![...matrix, ...center, height, ...size, ...world].every(Number.isFinite) ||
    width < 240 ||
    viewportHeight < 180 ||
    world[0] >= world[2] ||
    world[1] >= world[3]
  )
    return null;
  const padding = spaceTimePadding(width, viewportHeight);
  const left = (2 * padding.left) / width - 1;
  const right = 1 - (2 * padding.right) / width;
  const bottom = (2 * padding.bottom) / viewportHeight - 1;
  const top = 1 - (2 * padding.top) / viewportHeight;
  // Each plane is A*easting + B*northing + C >= 0. Fit the entire
  // rectangle, not just its center; perspective and every bearing are honored.
  const row = (i: number) => [
    matrix[4 + i],
    matrix[8 + i],
    matrix[i] * height + matrix[12 + i],
  ];
  const x = row(0),
    y = row(1),
    z = row(2),
    w = row(3);
  const combine = (a: number[], b: number[], factor: number) =>
    a.map((v, i) => v - factor * b[i]);
  const planes = [
    combine(x, w, left),
    combine(
      w.map((v) => v * right),
      x,
      1,
    ),
    combine(y, w, bottom),
    combine(
      w.map((v) => v * top),
      y,
      1,
    ),
    w,
    combine(w, z, -1), // near plane
    combine(w, z, 1), // far plane
    [1, 0, -world[0]],
    [-1, 0, world[2]],
    [0, 1, -world[1]],
    [0, -1, world[3]],
  ];
  let anchor = center;
  const distancesFrom = (point: readonly [number, number]) =>
    planes.map(([a, b, c]) => a * point[0] + b * point[1] + c);
  let distances = distancesFrom(anchor);
  if (distances.some((d) => d <= 0)) {
    // At a pole/date-line edge the inset center can lie outside the world.
    // Find an interior anchor in the visible geographic polygon instead of
    // retaining a stale map window from an earlier camera position.
    let polygon: [number, number][] = [
      [world[0], world[1]],
      [world[2], world[1]],
      [world[2], world[3]],
      [world[0], world[3]],
    ];
    for (const [a, b, c] of planes.slice(0, 7)) {
      const clipped: [number, number][] = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i],
          q = polygon[(i + 1) % polygon.length];
        const dp = a * p[0] + b * p[1] + c;
        const dq = a * q[0] + b * q[1] + c;
        if (dp >= 0) clipped.push(p);
        if (dp >= 0 !== dq >= 0) {
          const t = dp / (dp - dq);
          clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
      }
      polygon = clipped;
      if (polygon.length < 3) return null;
    }
    anchor = [
      polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length,
      polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length,
    ];
    distances = distancesFrom(anchor);
    if (distances.some((d) => d <= 0)) return null;
  }
  const extent = (aspect: number) =>
    Math.min(
      ...planes.map(
        ([a, b], i) =>
          distances[i] / Math.max(1e-30, Math.abs(a) * aspect + Math.abs(b)),
      ),
    );
  const area = (logAspect: number) => {
    const aspect = Math.exp(logAspect),
      half = extent(aspect);
    return Math.log(aspect) + 2 * Math.log(half);
  };
  // Log area is the minimum of concave functions of log aspect. A short
  // bounded search therefore finds the largest centered geographic rectangle
  // without a discrete aspect-ratio jump while rotating.
  let a = Math.log(1 / 64),
    b = Math.log(64);
  for (let i = 0; i < 36; i++) {
    const p = a + (b - a) / 3,
      q = b - (b - a) / 3;
    if (area(p) < area(q)) a = p;
    else b = q;
  }
  const aspect = Math.exp((a + b) / 2),
    half = extent(aspect) * 0.98;
  if (!Number.isFinite(half) || half <= 0) return null;
  return [
    anchor[0] - half * aspect,
    anchor[1] - half,
    anchor[0] + half * aspect,
    anchor[1] + half,
  ];
}
