import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";
import GeographicLib from "geographiclib-geodesic";
export interface ScreenPoint {
  x: number;
  y: number;
}
export interface ScreenBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const cross = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export const pointInBox = (p: ScreenPoint, b: ScreenBox) =>
  p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
function intersects(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  d: ScreenPoint,
) {
  const ab1 = cross(a, b, c),
    ab2 = cross(a, b, d),
    cd1 = cross(c, d, a),
    cd2 = cross(c, d, b);
  if (
    ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) &&
    ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0))
  )
    return true;
  const on = (p: ScreenPoint, u: ScreenPoint, v: ScreenPoint) =>
    Math.abs(cross(u, v, p)) < 1e-7 &&
    p.x >= Math.min(u.x, v.x) - 1e-7 &&
    p.x <= Math.max(u.x, v.x) + 1e-7 &&
    p.y >= Math.min(u.y, v.y) - 1e-7 &&
    p.y <= Math.max(u.y, v.y) + 1e-7;
  return on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b);
}
function corners(box: ScreenBox): ScreenPoint[] {
  return [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
}
/** Intersection, not merely vertex containment: a line crossing a box remains selectable. */
export function lineIntersectsBox(
  line: (ScreenPoint | undefined)[],
  box: ScreenBox,
) {
  const c = corners(box);
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (!p) continue;
    if (pointInBox(p, box)) return true;
    const q = line[i + 1];
    if (!q) continue;
    for (let j = 0; j < 4; j++)
      if (intersects(p, q, c[j], c[(j + 1) % 4])) return true;
  }
  return false;
}
export function pointInRing(point: ScreenPoint, ring: ScreenPoint[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
/** Hole-aware polygon intersection: a selection entirely inside a hole selects nothing. */
export function polygonIntersectsBox(
  rings: (ScreenPoint | undefined)[][],
  box: ScreenBox,
) {
  if (!rings[0]?.length) return false;
  if (rings.some((r) => lineIntersectsBox(r, box))) return true;
  if (rings.some((r) => r.some((p) => !p))) return false; // Never connect Earth-occluded vertices across the screen.
  const complete = rings as ScreenPoint[][];
  return corners(box).some(
    (p) =>
      pointInRing(p, complete[0]) &&
      !complete.slice(1).some((hole) => pointInRing(p, hole)),
  );
}
export interface ArcBudget {
  remainingSegments: number;
  remainingInterpolation: number;
  interpolated: number;
  coarsened: number;
  sourceSegments: number;
}
/** Limit new rendering vertices, never drop or edit measured endpoints. Share one plan across a whole display layer. */
export function createArcBudget(
  segments: number,
  maximumInterpolation = 200000,
): ArcBudget {
  const count = Math.max(0, Math.floor(segments));
  return {
    remainingSegments: count,
    remainingInterpolation: Math.max(0, Math.floor(maximumInterpolation)),
    interpolated: 0,
    coarsened: 0,
    sourceSegments: count,
  };
}
/** WGS84 ellipsoidal arcs prevent long globe tracks cutting through the Earth. Height stays interpolated display height. */
export function geodesicPositions(
  input: Cartesian3[],
  maximumStep = 200000,
  budget: ArcBudget = createArcBudget(
    Math.max(0, input.length - 1),
    Math.max(0, 800000 - input.length),
  ),
): Cartesian3[] {
  if (input.length < 2) return input;
  const result: Cartesian3[] = [input[0]];
  for (let i = 1; i < input.length; i++) {
    const a = Cartographic.fromCartesian(input[i - 1]),
      b = Cartographic.fromCartesian(input[i]);
    // Karney's inverse algorithm converges at antipodes and across poles/date line.
    // Exactly antipodal shortest paths are non-unique; GeographicLib selects its documented canonical meridian.
    const arc = GeographicLib.Geodesic.WGS84.InverseLine(
      CesiumMath.toDegrees(a.latitude),
      CesiumMath.toDegrees(a.longitude),
      CesiumMath.toDegrees(b.latitude),
      CesiumMath.toDegrees(b.longitude),
    );
    const desired = Math.min(
      2048,
      Math.max(1, Math.ceil(arc.s13 / Math.max(1000, maximumStep))),
    );
    // Allocate fairly over the remaining source segments. A million long edges cannot request a hundred million vertices.
    const allowance = Math.floor(
      budget.remainingInterpolation / Math.max(1, budget.remainingSegments),
    );
    const steps = Math.min(desired, allowance + 1);
    const added = steps - 1;
    if (steps < desired) budget.coarsened++;
    budget.remainingInterpolation -= added;
    budget.interpolated += added;
    budget.remainingSegments = Math.max(0, budget.remainingSegments - 1);
    for (let j = 1; j < steps; j++) {
      const p = arc.Position((arc.s13 * j) / steps);
      if (
        p.lat2 === undefined ||
        p.lon2 === undefined ||
        !Number.isFinite(p.lat2) ||
        !Number.isFinite(p.lon2)
      )
        throw new Error(
          "WGS84 geodesic did not return a finite surface position",
        );
      result.push(
        Cartesian3.fromDegrees(
          p.lon2,
          p.lat2,
          a.height + ((b.height - a.height) * j) / steps,
        ),
      );
    }
    result.push(input[i]);
  }
  return result;
}

export interface HalfSpace {
  x: number;
  y: number;
  z: number;
  w: number;
}
/** Exact conservative footprint of a camera frustum intersected with a bounded projected-height prism.
 * Columbus scene axes are (height,easting,northing). This remains valid when corner rays miss the ground/horizon.
 * Every vertex is the intersection of three boundary planes; a bounded convex intersection has no other extrema.
 */
export function projectedFrustumBounds(
  frustum: readonly HalfSpace[],
  world: [number, number, number, number],
  minHeight: number,
  maxHeight: number,
): [number, number, number, number] | null {
  const [west, south, east, north] = world;
  const planes: HalfSpace[] = [
    ...frustum,
    { x: 1, y: 0, z: 0, w: -minHeight },
    { x: -1, y: 0, z: 0, w: maxHeight },
    { x: 0, y: 1, z: 0, w: -west },
    { x: 0, y: -1, z: 0, w: east },
    { x: 0, y: 0, z: 1, w: -south },
    { x: 0, y: 0, z: -1, w: north },
  ];
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  const cross = (a: HalfSpace, b: HalfSpace) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  for (let i = 0; i < planes.length - 2; i++)
    for (let j = i + 1; j < planes.length - 1; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const a = planes[i],
          b = planes[j],
          c = planes[k],
          bc = cross(b, c),
          ca = cross(c, a),
          ab = cross(a, b);
        const determinant = a.x * bc.x + a.y * bc.y + a.z * bc.z;
        if (Math.abs(determinant) < 1e-12) continue;
        const x = (-a.w * bc.x - b.w * ca.x - c.w * ab.x) / determinant,
          y = (-a.w * bc.y - b.w * ca.y - c.w * ab.y) / determinant,
          z = (-a.w * bc.z - b.w * ca.z - c.w * ab.z) / determinant;
        if (
          ![x, y, z].every(Number.isFinite) ||
          planes.some((p) => p.x * x + p.y * y + p.z * z + p.w < -0.00001)
        )
          continue;
        xMin = Math.min(xMin, y);
        xMax = Math.max(xMax, y);
        yMin = Math.min(yMin, z);
        yMax = Math.max(yMax, z);
      }
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) return null;
  return [
    Math.max(west, xMin),
    Math.max(south, yMin),
    Math.min(east, xMax),
    Math.min(north, yMax),
  ];
}
