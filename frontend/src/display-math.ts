/** O(pixels) compact separable triangular kernel; zero extension at raster edges. */
export function triangularBlur(
  input: Float64Array,
  width: number,
  height: number,
  radius: number,
  radiusY: number = radius,
): Float64Array {
  const pass = (
    source: Float64Array,
    w: number,
    h: number,
    vertical: boolean,
    radius: number,
  ) => {
    const r = Math.max(1, Math.floor(radius));
    const target = new Float64Array(source.length),
      p = new Float64Array(w + 1),
      q = new Float64Array(w + 1);
    for (let line = 0; line < h; line++) {
      p.fill(0);
      q.fill(0);
      for (let x = 0; x < w; x++) {
        const v = source[vertical ? x * width + line : line * width + x];
        p[x + 1] = p[x] + v;
        q[x + 1] = q[x] + v * x;
      }
      for (let x = 0; x < w; x++) {
        const a = Math.max(0, x - r),
          b = x + 1,
          c = Math.min(w, x + r + 1);
        const left =
          (1 - x / (r + 1)) * (p[b] - p[a]) + (q[b] - q[a]) / (r + 1);
        const right =
          (1 + x / (r + 1)) * (p[c] - p[b]) - (q[c] - q[b]) / (r + 1);
        target[vertical ? x * width + line : line * width + x] = Math.max(
          0,
          left + right,
        );
      }
    }
    return target;
  };
  return pass(
    pass(input, width, height, false, radius),
    height,
    width,
    true,
    radiusY,
  );
}
export function heatColor(
  value: number,
  max: number,
): [number, number, number, number] {
  if (value <= 0 || max <= 0) return [0, 0, 0, 0];
  const t = Math.min(1, value / max),
    stops = [
      [35, 53, 150],
      [27, 150, 170],
      [92, 205, 100],
      [255, 220, 55],
      [244, 65, 48],
      [255, 245, 220],
    ];
  const at = t * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(at)),
    f = at - i;
  return [0, 1, 2]
    .map((c) => Math.round(stops[i][c] * (1 - f) + stops[i + 1][c] * f))
    .concat(Math.round(210 * Math.min(1, t * 3))) as [
    number,
    number,
    number,
    number,
  ];
}
export interface TrailPoint {
  id: string;
  entity: number;
  time: number;
  lon: number;
  inferred?: boolean;
}
/** Iterative Douglas–Peucker in displayed pixels, with protected evidence/gaps. */
export function trailEdges(
  points: TrailPoint[],
  project: (i: number) => [number, number, number],
  selected: Set<string>,
  tolerance: number,
  gapMinutes: number,
): [number, number][] {
  const edges: [number, number][] = [],
    coordinates = points.map((_, i) => project(i));
  const split = (a: number, b: number) => {
    const keep = new Set<number>([a, b]);
    for (let i = a + 1; i < b; i++)
      if (selected.has(points[i].id) || points[i].inferred) keep.add(i);
    const anchors = [...keep].sort((x, y) => x - y),
      stack = anchors.slice(1).map((b, i) => [anchors[i], b]);
    let work = 0,
      visits = 0;
    while (stack.length) {
      const [first, last] = stack.pop()!;
      if (last - first < 2) continue;
      if (++work > (b - a + 1) * 16) {
        for (let i = first; i <= last; i++) keep.add(i);
        continue;
      }
      const [ax, ay, az] = coordinates[first],
        [bx, by, bz] = coordinates[last];
      if (az < -1 || az > 1 || bz < -1 || bz > 1 || tolerance === 0) {
        for (let i = first; i <= last; i++) keep.add(i);
        continue;
      }
      const dx = bx - ax,
        dy = by - ay,
        length = dx * dx + dy * dy;
      let distance = tolerance * tolerance,
        index = -1;
      for (let i = first + 1; i < last; i++) {
        if (++visits > (b - a + 1) * 64) {
          for (let j = first; j <= last; j++) keep.add(j);
          index = -1;
          break;
        }
        const [x, y, z] = coordinates[i];
        if (z < -1 || z > 1) {
          index = i;
          break;
        }
        const t = length
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
          : 0;
        const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
        if (d > distance) {
          distance = d;
          index = i;
        }
      }
      if (index >= 0) {
        keep.add(index);
        stack.push([first, index], [index, last]);
      }
    }
    const indices = [...keep].sort((x, y) => x - y);
    for (let i = 1; i < indices.length; i++)
      edges.push([indices[i - 1], indices[i]]);
  };
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (
      !b ||
      a.entity !== b.entity ||
      b.time < a.time ||
      (gapMinutes > 0 && b.time - a.time > gapMinutes * 60) ||
      Math.abs(a.lon - b.lon) > 180
    ) {
      if (i - start > 1) split(start, i - 1);
      start = i;
    }
  }
  return edges;
}
