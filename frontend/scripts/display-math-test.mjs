import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../src/display-math.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { triangularBlur, heatColor, trailEdges } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
// Independent direct 2-D convolution, including rectangular bandwidth and edges.
for (const [w, h, rx, ry] of [
  [9, 7, 2, 3],
  [1, 8, 6, 2],
  [13, 1, 3, 5],
  [6, 9, 1, 1],
]) {
  const input = Float64Array.from(
      { length: w * h },
      (_, i) => ((i * 17) % 13) / 3,
    ),
    out = triangularBlur(input, w, h, rx, ry);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let expected = 0;
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          expected +=
            input[j * w + i] *
            Math.max(0, 1 - Math.abs(i - x) / (rx + 1)) *
            Math.max(0, 1 - Math.abs(j - y) / (ry + 1));
      assert.ok(
        Math.abs(out[y * w + x] - expected) < 1e-9,
        `${w}x${h} ${x},${y}: ${out[y * w + x]} vs ${expected}`,
      );
    }
}
assert.equal(heatColor(0, 1)[3], 0);
assert.ok(heatColor(2, 1)[3] > 0);
const points = Array.from({ length: 10000 }, (_, i) => ({
  id: String(i),
  entity: 0,
  time: i * 60,
  lon: i / 100000,
}));
const projection = (i) => [i, 0, 0];
assert.deepEqual(trailEdges(points, projection, new Set(), 2, 180), [
  [0, 9999],
]);
assert.deepEqual(trailEdges(points, projection, new Set(["500"]), 2, 180), [
  [0, 500],
  [500, 9999],
]);
points[200].inferred = true;
assert.deepEqual(trailEdges(points, projection, new Set(), 2, 180), [
  [0, 200],
  [200, 9999],
]);
assert.equal(trailEdges(points, projection, new Set(), 0, 180).length, 9999);
const gaps = [
  { id: "1", entity: 0, time: 0, lon: 179 },
  { id: "2", entity: 0, time: 60, lon: -179 },
  { id: "3", entity: 0, time: 86400, lon: -178 },
  { id: "4", entity: 1, time: 86460, lon: -177 },
];
assert.deepEqual(trailEdges(gaps, projection, new Set(), 2, 180), []);
console.log(
  "Display math: independent kernel oracle, bounds, protected evidence, full trails and discontinuities passed.",
);
