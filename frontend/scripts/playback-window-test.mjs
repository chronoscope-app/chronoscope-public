import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/playback-window.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { PlaybackWindow } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const fade = new PlaybackWindow(0.1, true);
assert.deepEqual(fade.advance(0.2, 0.4, true), [0.2, 0.4]);
assert.deepEqual(fade.advance(0.3, 0.5, false), [0.3, 0.5]);
assert.deepEqual(fade.advance(0.4, 0.6, false), [0.3, 0.6]);
assert.deepEqual(fade.advance(0.1, 0.3, false), [0.1, 0.3]); // new loop clears accumulated history
assert.deepEqual(fade.advance(0.2, 0.4, true), [0.2, 0.4]);
assert.deepEqual(fade.advance(0.3, 0.5, false), [0.3, 0.5]);
const keep = new PlaybackWindow(0.1, false);
assert.deepEqual(keep.advance(0.2, 0.4, false), [0.1, 0.4]);
assert.deepEqual(keep.advance(0.4, 0.6, false), [0.1, 0.6]);
const full = new PlaybackWindow(0, false);
assert.deepEqual(full.advance(0, 1, false), [0, 1]);
console.log(
  "PASS moving and cumulative playback windows, live toggles, wrap reset and full-range playback",
);

const elevation = ts.transpileModule(
  fs.readFileSync(new URL("../src/time-elevation.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { globeElevationScale: scale, globeElevationSlider: slider } =
  await import(
    "data:text/javascript;base64," + Buffer.from(elevation).toString("base64")
  );
assert.equal(scale(0), 0);
assert.equal(scale(1), 0.05);
assert.equal(scale(50), 1);
assert.equal(scale(100), 20);
assert.equal(slider(false, 20), 0);
assert.equal(slider(true, 1), 50);
for (let i = 1; i <= 100; i++) {
  assert.equal(slider(true, scale(i)), i);
  if (i > 1) assert(scale(i) > scale(i - 1));
}
console.log(
  "PASS globe elevation Off, 0.05x/1x/20x anchors, monotonic height and all 100 slider roundtrips",
);

const { fadeAmount, departureDuration, recentHistorySpan } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
assert.equal(fadeAmount(false), 0);
assert.equal(fadeAmount(true), 50);
assert.equal(departureDuration(50), 800);
assert.equal(departureDuration(100), 120);
assert(departureDuration(1) > 4000);
const observations = [10, 10, 8, 3, 9, 9, 5].map((time) => ({ time }));
assert.equal(recentHistorySpan(observations), 2);
assert.equal(recentHistorySpan([{ time: 10 }, { time: 10 }, { time: 8 }]), 4);
assert.equal(recentHistorySpan([]), 0);
assert.equal(recentHistorySpan([{ time: 10 }], [{ time: 8 }, { time: 9 }]), 2);
assert.equal(recentHistorySpan([{ time: NaN }, { time: 5 }]), 0);
let previousWidth = Infinity,
  previousDuration = Infinity;
for (let amount = 1; amount <= 100; amount++) {
  const history = new PlaybackWindow(0.2, amount);
  const [start, end] = history.advance(0.2, 0.6, amount, 0.02, 0.4);
  assert(end - start <= previousWidth + 1e-12);
  assert(departureDuration(amount) <= previousDuration);
  previousWidth = end - start;
  previousDuration = departureDuration(amount);
}
const short = new PlaybackWindow(0.2, 100);
const [recentStart, recentEnd] = short.advance(0.2, 0.6, 100, 0.02, 0.4);
assert(Math.abs(recentStart - 0.58) < 1e-12 && recentEnd === 0.6);
const concurrent = Array.from({ length: 61 }, (_, i) => i / 100).flatMap(
  (time) => [
    { entity: "A", time },
    { entity: "B", time },
  ],
);
const retained = concurrent.filter(
  (p) => p.time >= recentStart && p.time <= recentEnd,
);
assert(retained.length <= 6 && retained.length >= 4);
assert.equal(new Set(retained.map((p) => p.entity)).size, 2);
const long = new PlaybackWindow(0.4, 10);
const expanded = long.advance(0.4, 0.6, 10, 0.02, 0.2);
assert(expanded[0] === 0.4 && expanded[1] === 0.6);
const lingered = long.advance(0.8, 1, 10, 0.02, 0.2);
assert(lingered[0] === 0.4 && lingered[1] === 1);
assert.equal(long.advance(0.81, 1.01, 0, 0.02, 0.2)[0], 0.4);
const sweep = new PlaybackWindow(0, 100);
const narrowed = sweep.advance(0, 0.45, 100, 0.02, 1);
assert(Math.abs(narrowed[0] - 0.43) < 1e-12 && narrowed[1] === 0.45);
console.log(
  "PASS fade strength shortens history/lifetime monotonically, preserves concurrent entities and supports full-range sweeps and live Off",
);
