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
