import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/camera-stability.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { cameraStabilizer } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
function camera() {
  return {
    position: { x: 0, y: 100, z: 300 },
    direction: { x: 0, y: 0.6, z: -0.8 },
    up: { x: 0, y: 0.8, z: 0.6 },
    right: { x: 1, y: 0, z: 0 },
    transform: Array.from({ length: 16 }, (_, i) => Number(i % 5 === 0)),
  };
}
test("stationary getter roundoff does not accumulate into camera movement", () => {
  const c = camera(),
    original = structuredClone(c),
    stabilize = cameraStabilizer(c);
  stabilize(1);
  for (let i = 0; i < 100; i++) {
    for (const axis of ["direction", "up", "right"])
      for (const component of ["x", "y", "z"]) c[axis][component] += 2e-15;
    stabilize(1);
    assert.deepEqual(c, original);
  }
});
test("real rotation remains the reference for subsequent stationary frames", () => {
  const c = camera(),
    stabilize = cameraStabilizer(c);
  stabilize(1);
  c.direction.x = 1e-10;
  stabilize(1);
  c.direction.x += 2e-15;
  stabilize(1);
  assert.equal(c.direction.x, 1e-10);
});
for (const change of ["position", "reference frame", "scene mode"])
  test(`a changed ${change} retains even a tiny explicit orientation change`, () => {
    const c = camera(),
      stabilize = cameraStabilizer(c);
    stabilize(1);
    c.direction.x = 2e-15;
    if (change === "position") c.position.x = 1e-15;
    if (change === "reference frame") c.transform[12] = 1e-15;
    stabilize(change === "scene mode" ? 2 : 1);
    assert.equal(c.direction.x, 2e-15);
  });
test("invalid camera coordinates are never replaced with stale valid ones", () => {
  const c = camera(),
    stabilize = cameraStabilizer(c);
  stabilize(1);
  c.direction.x = NaN;
  stabilize(1);
  assert(Number.isNaN(c.direction.x));
});
