import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { Cartesian3, Cartesian4, Matrix4, PerspectiveFrustum } from "cesium";
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/space-time-frame.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { groundWindow, spaceTimePadding } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const world = [-20037508, -10018754, 20037508, 10018754];
let checks = 0;
function camera(size, heading, tilt, range, target = [0, 0], height = 0) {
  const h = (heading * Math.PI) / 180,
    t = (tilt * Math.PI) / 180;
  const direction = new Cartesian3(
    -Math.cos(t),
    Math.sin(h) * Math.sin(t),
    Math.cos(h) * Math.sin(t),
  );
  const position = Cartesian3.subtract(
    new Cartesian3(height, ...target),
    Cartesian3.multiplyByScalar(direction, range, new Cartesian3()),
    new Cartesian3(),
  );
  const right = new Cartesian3(0, Math.cos(h), -Math.sin(h));
  const up = Cartesian3.cross(right, direction, new Cartesian3());
  const view = Matrix4.computeView(
    position,
    direction,
    up,
    right,
    new Matrix4(),
  );
  const frustum = new PerspectiveFrustum({
    fov: Math.PI / 3,
    aspectRatio: size[0] / size[1],
    near: 0.1,
    far: 1e9,
  });
  const matrix = Matrix4.multiply(
    frustum.projectionMatrix,
    view,
    new Matrix4(),
  );
  const p = spaceTimePadding(...size),
    screen = [
      (p.left + size[0] - p.right) / 2,
      (p.top + size[1] - p.bottom) / 2,
    ];
  const inverse = Matrix4.inverse(matrix, new Matrix4());
  const unproject = (z) => {
    const v = Matrix4.multiplyByVector(
      inverse,
      new Cartesian4(
        (screen[0] * 2) / size[0] - 1,
        1 - (screen[1] * 2) / size[1],
        z,
        1,
      ),
      new Cartesian4(),
    );
    return new Cartesian3(v.x / v.w, v.y / v.w, v.z / v.w);
  };
  const a = unproject(-1),
    b = unproject(0.5),
    u = (height - a.x) / (b.x - a.x);
  const center = [a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u];
  const bounds = groundWindow(
    Matrix4.toArray(matrix),
    center,
    height,
    size,
    world,
  );
  assert(bounds, JSON.stringify({ size, heading, tilt, range, target }));
  const corners = [
    [0, 1],
    [2, 1],
    [2, 3],
    [0, 3],
  ].map(([x, y]) => {
    const q = Matrix4.multiplyByVector(
      matrix,
      new Cartesian4(height, bounds[x], bounds[y], 1),
      new Cartesian4(),
    );
    assert(q.w > 0);
    return [(size[0] * (q.x / q.w + 1)) / 2, (size[1] * (1 - q.y / q.w)) / 2];
  });
  for (const [x, y] of corners) {
    assert(
      x >= p.left - 1e-4 &&
        x <= size[0] - p.right + 1e-4 &&
        y >= p.top - 1e-4 &&
        y <= size[1] - p.bottom + 1e-4,
      JSON.stringify({ x, y, p, size }),
    );
    checks++;
  }
  assert(
    bounds[0] >= world[0] &&
      bounds[1] >= world[1] &&
      bounds[2] <= world[2] &&
      bounds[3] <= world[3],
  );
  return { corners, bounds };
}
for (const size of [
  [1370, 943],
  [900, 650],
  [500, 420],
])
  for (const heading of [0, 30, 90, 145, 215, 315])
    for (const tilt of [0, 1, 30, 48, 70, 85]) {
      const a = camera(size, heading, tilt, 5000),
        b = camera(size, heading, tilt, 40000);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++)
          assert(
            Math.abs(a.corners[i][j] - b.corners[i][j]) < 0.01,
            "Zoom must preserve floor screen footprint",
          );
      assert(
        Math.abs(
          (b.bounds[2] - b.bounds[0]) / (a.bounds[2] - a.bounds[0]) - 8,
        ) < 0.001,
        "Zoom changes real geographic extent",
      );
      checks++;
    }
// The default oblique view should use the sides and rear of the viewport,
// rather than leaving most of its upper half outside the geographic floor.
for (const size of [
  [1238, 897],
  [986, 897],
  [650, 700],
]) {
  const { corners } = camera(size, 0, 48, 5000);
  const xs = corners.map(([x]) => x),
    ys = corners.map(([, y]) => y);
  assert(Math.min(...xs) <= size[0] * 0.065, "Floor reaches the left side");
  assert(Math.max(...xs) >= size[0] * 0.935, "Floor reaches the right side");
  assert(Math.min(...ys) <= size[1] / 3, "Floor extends into the rear space");
  checks++;
}
for (const target of [
  [19000000, 9000000],
  [-19000000, -9000000],
  [20500000, 0],
  [0, 10500000],
])
  camera([1200, 800], 45, 45, 1500000, target, 1500);
assert.equal(groundWindow([], [0, 0], 0, [1200, 800], world), null);
assert.equal(
  groundWindow(Array(16).fill(NaN), [0, 0], 0, [1200, 800], world),
  null,
);
console.log(
  `PASS ${checks} space-time floor checks: screen margins, geographic zoom, headings, tilts, terrain plane, world limits and invalid inputs`,
);
