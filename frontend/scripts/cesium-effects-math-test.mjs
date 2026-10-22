import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const transpile = (file) =>
  ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const mathUrl =
  "data:text/javascript;base64," +
  Buffer.from(transpile("../src/display-math.ts")).toString("base64");
const source = transpile("../src/cesium-effects-math.ts").replace(
  '"./display-math"',
  JSON.stringify(mathUrl),
);
const { splatGround, renderGroundEffects, bloomExposure } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const point = { x: 0.503, y: 0.487, count: 17, weight: 3.25 };
const sum = (array) => Array.from(array).reduce((a, b) => a + b, 0);
assert.ok(
  Math.abs(sum(splatGround([point], 64, 64, "count")) - 17) < 1e-10,
  "bilinear deposition preserves exact event count",
);
assert.ok(
  Math.abs(sum(splatGround([point], 64, 64, "weight")) - 3.25) < 1e-10,
  "nonnegative value weights remain independent of counts",
);
assert.equal(sum(splatGround([{ ...point, count: -1 }], 64, 64, "count")), 0);
const defaults = {
  width: 64,
  height: 64,
  points: [point],
  heat: true,
  heatRadius: 4,
  heatRadiusY: 7,
  heatMaximum: null,
  bloom: false,
  bloomRadius: 8,
  bloomRadiusY: 5,
  bloomStrength: 1.3,
  bloomThreshold: 0.1,
};
const first = renderGroundEffects(defaults),
  double = renderGroundEffects({ ...defaults, points: [point, point] });
assert.ok(
  Math.abs(double.peak - first.peak * 2) < 1e-9,
  "time-window counts accumulate linearly before color mapping",
);
assert.equal(
  renderGroundEffects({ ...defaults, heatMaximum: 42 }).ceiling,
  42,
  "fixed comparison maximum survives view changes",
);
assert.equal(
  first.image[3],
  0,
  "ground away from finite-support kernels remains transparent",
);
const off = renderGroundEffects({ ...defaults, heat: false, bloom: false });
assert.equal(sum(off.image), 0, "disabled effects never modify the base map");
const noEvents = renderGroundEffects({ ...defaults, points: [], bloom: true });
assert.equal(
  sum(noEvents.image),
  0,
  "bright imagery cannot generate bloom without events",
);
const bloom = renderGroundEffects({ ...defaults, heat: false, bloom: true });
const threshold = renderGroundEffects({
  ...defaults,
  heat: false,
  bloom: true,
  bloomThreshold: 1,
});
const alpha = (image) => sum(Array.from(image).filter((_, i) => i % 4 === 3));
assert.ok(alpha(bloom.image) > 0, "event footprints create ground glow");
assert.ok(
  alpha(threshold.image) < alpha(bloom.image),
  "bright-pass threshold controls isolated event emission",
);
const combined = renderGroundEffects({ ...defaults, bloom: true });
assert.ok(
  alpha(combined.image) >= alpha(first.image),
  "heat map and bloom can combine without dropping the heat layer",
);
for (const value of combined.image) assert.ok(Number.isFinite(value));
console.log(
  "Cesium ground effects: count conservation, weights, UTC-window accumulation, transparency, isolated bloom, threshold, and combined heat/bloom passed.",
);

// Independent sort oracle verifies exact exposure, including duplicate-heavy and
// adversarial pivot inputs; the original emission must remain unchanged.
const oracle = (a) => {
  const sorted = Array.from(a)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.9)] || 1;
};
let seed = 9173;
const random = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
for (const n of [0, 1, 2, 3, 10, 127, 1024, 262144]) {
  for (const kind of [
    "random",
    "duplicates",
    "ascending",
    "descending",
    "organ-pipe",
    "zero",
  ]) {
    const input = Float64Array.from({ length: n }, (_, i) =>
      kind === "random"
        ? random() * 100
        : kind === "duplicates"
          ? i % 7
          : kind === "ascending"
            ? i
            : kind === "descending"
              ? n - i
              : kind === "organ-pipe"
                ? Math.min(i, n - i)
                : 0,
    );
    const before = input.slice();
    assert.equal(bloomExposure(input), oracle(input), `${kind} ${n}`);
    assert.deepEqual(input, before);
  }
}
assert.equal(
  bloomExposure(new Float64Array([NaN, -1, 0, Infinity, 1])),
  Infinity,
);
const oldSource = source.replace(
  "exposure = request.bloomExposure ?? bloomExposure(emission);",
  `const nonzero = Array.from(emission).filter(x => x > 0).sort((a,b) => a-b); exposure = request.bloomExposure ?? (nonzero[Math.floor(nonzero.length*.9)] || 1);`,
);
assert.notEqual(
  oldSource,
  source,
  "oracle must replace the optimized exposure call",
);
const { renderGroundEffects: oldRender } = await import(
  "data:text/javascript;base64," + Buffer.from(oldSource).toString("base64")
);
const dense = Array.from({ length: 4000 }, () => ({
  x: random(),
  y: random(),
  count: 1 + Math.floor(random() * 99),
  weight: random() * 100,
}));
for (const options of [
  { ...defaults, bloom: true },
  {
    ...defaults,
    width: 512,
    height: 512,
    points: dense,
    heat: false,
    bloom: true,
    bloomRadius: 32,
    bloomRadiusY: 19,
  },
  {
    ...defaults,
    width: 512,
    height: 512,
    points: dense,
    heat: true,
    bloom: true,
    bloomRadius: 60,
    bloomThreshold: 1,
  },
  {
    ...defaults,
    width: 512,
    height: 512,
    points: dense,
    heat: true,
    bloom: false,
  },
])
  assert.deepEqual(
    renderGroundEffects(options),
    oldRender(options),
    "all raster bytes and heat metrics must match the sort oracle",
  );
console.log(
  "Exact bloom percentile and byte-identical 512px bloom/heat oracle checks passed.",
);
// A playback interval keeps its exposure, so a changing event count cannot
// re-normalize each new day into a separate brightness pulse.
const automatic = renderGroundEffects({
  ...defaults,
  heat: false,
  bloom: true,
});
const doubledFixed = renderGroundEffects({
  ...defaults,
  heat: false,
  bloom: true,
  points: [point, point],
  bloomExposure: automatic.exposure,
});
assert.equal(doubledFixed.exposure, automatic.exposure);
assert(
  doubledFixed.image.some((v, i) => i % 4 === 3 && v > automatic.image[i]),
);
console.log("PASS fixed playback exposure preserves changes in event energy");
