import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  PerspectiveFrustum,
  OrthographicOffCenterFrustum,
} from "cesium";
const code = ts
  .transpileModule(
    fs.readFileSync(
      new URL("../src/cesium-geometry.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  )
  .outputText.replace(
    'from "cesium"',
    `from ${JSON.stringify(import.meta.resolve("cesium"))}`,
  )
  .replace(
    'from "geographiclib-geodesic"',
    `from ${JSON.stringify(import.meta.resolve("geographiclib-geodesic"))}`,
  );
const {
  lineIntersectsBox,
  polygonIntersectsBox,
  geodesicPositions,
  projectedFrustumBounds,
  createArcBudget,
} = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const box = { left: 4, right: 6, top: 4, bottom: 6 };
const ring = (a) => a.map(([x, y]) => ({ x, y }));
const outer = ring([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
]);
const hole = ring([
  [3, 3],
  [7, 3],
  [7, 7],
  [3, 7],
  [3, 3],
]);
assert(
  lineIntersectsBox(
    ring([
      [0, 5],
      [10, 5],
    ]),
    box,
  ),
  "Crossing line selects even when neither endpoint lies inside",
);
assert(
  !lineIntersectsBox(
    ring([
      [0, 3],
      [10, 3],
    ]),
    box,
  ),
);
assert(
  lineIntersectsBox(
    ring([
      [0, 4],
      [10, 4],
    ]),
    box,
  ),
  "Boundary touches count",
);
assert(polygonIntersectsBox([outer], box), "Polygon containing box intersects");
assert(
  !polygonIntersectsBox([outer, hole], box),
  "A box entirely inside a polygon hole does not select the polygon",
);
assert(
  polygonIntersectsBox([outer, hole], { left: 2, right: 4, top: 4, bottom: 6 }),
  "Crossing a hole boundary selects real polygon surface",
);
assert(
  !polygonIntersectsBox([[undefined, ...outer.slice(1)]], box),
  "Occluded polygon fragments never fabricate an enclosing polygon",
);
const start = Cartesian3.fromDegrees(-75, 40, 100),
  end = Cartesian3.fromDegrees(20, 40, 300);
const curve = geodesicPositions([start, end], 4e6);
assert.equal(curve.length, 3);
const middle = Cartographic.fromCartesian(curve[1]);
// Independent reference: GeographicLib/Karney WGS84 inverse+half-distance from 40N75W to40N20E.
assert(
  Math.abs(CesiumMath.toDegrees(middle.latitude) - 51.19988187881148) < 1e-8,
);
assert(Math.abs(CesiumMath.toDegrees(middle.longitude) + 27.5) < 1e-8);
assert(Math.abs(middle.height - 200) < 1e-6);
assert.equal(curve[0], start);
assert.equal(curve.at(-1), end);
const dateline = geodesicPositions(
  [Cartesian3.fromDegrees(170, 0), Cartesian3.fromDegrees(-170, 0)],
  1.2e6,
);
assert.equal(dateline.length, 3);
assert(
  Math.abs(
    Math.abs(
      CesiumMath.toDegrees(Cartographic.fromCartesian(dateline[1]).longitude),
    ) - 180,
  ) < 1e-9,
);
console.log(
  "Cesium geometry: hole-aware box selection, occlusion boundaries, independent WGS84 geodesic references and date-line arcs passed",
);

// Independent Python GeographicLib reference fixtures; the JS engine must converge for every path.
for (const reference of [
  { from: [0, 0], to: [180, 0], lat: 90, lon: 180 },
  {
    from: [20, 10],
    to: [199.9999, -10.001],
    lat: -80.09775371303454,
    lon: 20.055772775343957,
  },
  { from: [0, 89], to: [180, 89], lat: 90, lon: 180 },
  { from: [-45, -89], to: [135, -89], lat: -90, lon: 135 },
]) {
  const a = Cartesian3.fromDegrees(...reference.from, 100),
    b = Cartesian3.fromDegrees(...reference.to, 300);
  const positions = geodesicPositions(
    [a, b],
    reference.lat === 90 || reference.lat === -90
      ? Math.abs(reference.from[1]) === 89
        ? 200000
        : 10100000
      : 10100000,
  );
  assert.equal(positions.length, 3, JSON.stringify(reference));
  const m = Cartographic.fromCartesian(positions[1]);
  assert(
    Math.abs(CesiumMath.toDegrees(m.latitude) - reference.lat) < 1e-7,
    JSON.stringify(reference),
  );
  if (Math.abs(reference.lat) < 89.9999)
    assert(Math.abs(CesiumMath.toDegrees(m.longitude) - reference.lon) < 1e-7);
  assert(
    Math.abs(m.height - 200) < 1e-5,
    JSON.stringify({ reference, height: m.height }),
  );
  assert(positions.every((p) => [p.x, p.y, p.z].every(Number.isFinite)));
}
console.log(
  "Karney geodesics: exact/near antipodes, both poles, date line and interpolated display elevation passed",
);

const extent = [-1e7, -1e7, 1e7, 1e7];
const frustum = new PerspectiveFrustum({
  fov: Math.PI / 3,
  aspectRatio: 16 / 9,
  near: 1,
  far: 5e7,
});
const down = Math.SQRT1_2;
const direction = new Cartesian3(-down, 0, down),
  up = new Cartesian3(down, 0, down);
const boundsAt = (scale, heightLow = 0, heightHigh = 0) =>
  projectedFrustumBounds(
    frustum.computeCullingVolume(
      new Cartesian3(2000 * scale, 0, -2000 * scale),
      direction,
      up,
    ).planes,
    extent,
    heightLow,
    heightHigh,
  );
const farBounds = boundsAt(1),
  nearBounds = boundsAt(0.5);
assert(farBounds && nearBounds);
const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
assert(
  Math.abs(area(nearBounds) / area(farBounds) - 0.25) < 1e-10,
  "Columbus geographic viewport contracts with native zoom, rather than reverting to the full data cage",
);
assert(
  farBounds[0] > -10000 &&
    farBounds[2] < 10000 &&
    farBounds[1] > -10000 &&
    farBounds[3] < 10000,
);
// Independent analytic ray-plane intersection at the four viewport corners.
const camera = new Cartesian3(2000, 0, -2000),
  right = new Cartesian3(0, 1, 0),
  halfY = Math.tan(frustum.fovy / 2),
  halfX = halfY * frustum.aspectRatio;
const corners = [];
for (const x of [-1, 1])
  for (const y of [-1, 1]) {
    const ray = new Cartesian3(
      direction.x + up.x * y * halfY + right.x * x * halfX,
      direction.y + up.y * y * halfY + right.y * x * halfX,
      direction.z + up.z * y * halfY + right.z * x * halfX,
    );
    const t = -camera.x / ray.x;
    corners.push([camera.y + t * ray.y, camera.z + t * ray.z]);
  }
const analytic = [
  Math.min(...corners.map((p) => p[0])),
  Math.min(...corners.map((p) => p[1])),
  Math.max(...corners.map((p) => p[0])),
  Math.max(...corners.map((p) => p[1])),
];
for (let i = 0; i < 4; i++) assert(Math.abs(farBounds[i] - analytic[i]) < 1e-6);
// Horizon case: upper corner rays point into the sky. Plane clipping must retain a finite conservative world-bounded footprint.
const lowPitch = (10 * Math.PI) / 180,
  skyDirection = new Cartesian3(-Math.sin(lowPitch), 0, Math.cos(lowPitch)),
  skyUp = new Cartesian3(Math.cos(lowPitch), 0, Math.sin(lowPitch));
const horizon = projectedFrustumBounds(
  frustum.computeCullingVolume(new Cartesian3(1000, 0, 0), skyDirection, skyUp)
    .planes,
  extent,
  0,
  100,
);
assert(horizon && horizon.every(Number.isFinite));
assert(horizon[3] <= extent[3] && horizon[3] > 1e6);
// A camera looking away from the ground still sees elevated time records; full-prism culling must include them.
const aboveDirection = new Cartesian3(1, 0, 0),
  aboveUp = new Cartesian3(0, 0, 1);
const skyPlanes = frustum.computeCullingVolume(
  new Cartesian3(1000, 0, 0),
  aboveDirection,
  aboveUp,
).planes;
assert.equal(projectedFrustumBounds(skyPlanes, extent, 0, 0), null);
const timeVolume = projectedFrustumBounds(skyPlanes, extent, 0, 2000);
assert(timeVolume && timeVolume[0] < 0 && timeVolume[2] > 0);
console.log(
  "Columbus frustum: analytic corner-ray agreement, zoom-contracted bounds, horizon clipping and elevated time-prism visibility passed",
);

// Native 2D terrain rendering may have no ellipsoid rectangle; its frustum footprint and zoom remain authoritative.
const orthographic = new OrthographicOffCenterFrustum({
  left: -2000,
  right: 2000,
  top: 1000,
  bottom: -1000,
  near: 1,
  far: 5e7,
});
const orthoPose = new Cartesian3(1.2e7, -9e6, 4e6),
  orthoDirection = new Cartesian3(-1, 0, 0),
  orthoUp = new Cartesian3(0, 0, 1);
const mapFootprint = projectedFrustumBounds(
  orthographic.computeCullingVolume(orthoPose, orthoDirection, orthoUp).planes,
  [-2e7, -1e7, 2e7, 1e7],
  -100,
  2000,
);
assert(mapFootprint);
for (const [actual, expected] of mapFootprint.map((value, i) => [
  value,
  [-9002000, 3999000, -8998000, 4001000][i],
]))
  assert(Math.abs(actual - expected) < 1e-6);
const zoomFromWidth = (width) =>
  Math.log2((2 * Math.PI * 6378137 * 1200) / (256 * width));
const zoomBefore = zoomFromWidth(orthographic.right - orthographic.left);
orthographic.left /= 2;
orthographic.right /= 2;
orthographic.top /= 2;
orthographic.bottom /= 2;
assert(
  Math.abs(
    zoomFromWidth(orthographic.right - orthographic.left) - zoomBefore - 1,
  ) < 1e-12,
  "Halving 2D frustum width increases the actual map zoom by exactly one",
);
const mapNear = projectedFrustumBounds(
  orthographic.computeCullingVolume(orthoPose, orthoDirection, orthoUp).planes,
  [-2e7, -1e7, 2e7, 1e7],
  -100,
  2000,
);
assert(mapNear && Math.abs(area(mapNear) / area(mapFootprint) - 0.25) < 1e-10);
console.log(
  "2D terrain frustum: geographic footprint, width-based zoom and independent one-level zoom contract passed",
);
// Adversarial long routes: share a bounded interpolation plan across layers, preserving every original source endpoint.
const a = Cartesian3.fromDegrees(0, 0),
  b = Cartesian3.fromDegrees(179.999, 0);
const longPath = Array.from({ length: 5001 }, (_, i) => (i % 2 ? a : b)),
  budget = createArcBudget(10000, 15000);
const route1 = geodesicPositions(longPath, 200000, budget),
  route2 = geodesicPositions(longPath, 200000, budget);
assert.equal(budget.remainingSegments, 0);
assert(budget.coarsened > 0);
assert(budget.interpolated <= 15000);
assert(route1.length + route2.length <= longPath.length * 2 + 15000);
for (const route of [route1, route2]) {
  const endpoints = route.filter((p) => p === a || p === b);
  assert.deepEqual(endpoints, longPath);
}
console.log(
  `Global arc budget: 10000 near-antipodal source segments bounded to ${route1.length + route2.length} rendering vertices; every source endpoint preserved, ${budget.coarsened} curves explicitly coarsened`,
);
