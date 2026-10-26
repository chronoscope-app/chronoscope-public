import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../src/time-axis.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const typesJs = ts.transpileModule(
  fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const typesUrl =
  "data:text/javascript;base64," + Buffer.from(typesJs).toString("base64");
const formats = await import(typesUrl);
formats.setDateTimeDisplay({ date_format: "iso", time_format: "24h" });
const { timeAxisTicks, timeElevationFraction } = await import(
  "data:text/javascript;base64," +
    Buffer.from(source.replace('"./types"', JSON.stringify(typesUrl))).toString(
      "base64",
    )
);
const lo = Date.parse("2026-10-15T23:00:00Z") / 1000,
  hi = lo + 7200;
const overview = timeAxisTicks(
  lo,
  hi,
  [0, -0.5, 0, 1],
  [0, 0.5, 0, 1],
  1200,
  800,
);
assert(overview.length >= 2);
assert(
  overview.every((t) => /^2026-10-(15|16)$/.test(t.text)),
  "Overview shows UTC dates without timestamps",
);
assert.equal(
  new Set(overview.map((t) => t.text)).size,
  overview.length,
  "Same-day date labels are deduplicated",
);
const detail = timeAxisTicks(lo, hi, [0, -4, 0, 1], [0, 4, 0, 1], 1200, 800);
assert(detail.length > 2 && detail.length <= 32);
assert(detail.every((t) => /\n\d{2}:\d{2} UTC$/.test(t.text)));
assert(detail.every((t) => t.time >= lo && t.time <= hi && t.time % 60 === 0));
assert.deepEqual(
  timeAxisTicks(lo, hi, [2, 0, 0, 1], [3, 1, 0, 1], 1200, 800),
  [],
);
assert.deepEqual(
  timeAxisTicks(lo, hi, [0, 0, 0, -1], [0, 0, 0, -2], 1200, 800),
  [],
);
assert.deepEqual(
  timeAxisTicks(lo, hi, [NaN, 0, 0, 1], [0, 1, 0, 1], 1200, 800),
  [],
);
const crossing = timeAxisTicks(
  lo,
  hi,
  [0, -2, -2, -1],
  [0, 0.5, 0, 1],
  1200,
  800,
);
assert(
  crossing.length > 0 &&
    crossing.length <= 32 &&
    crossing.every(
      (t) => Number.isFinite(t.time) && t.time >= lo + (hi - lo) * 0.75,
    ),
);
assert.equal(
  timeAxisTicks(lo, lo, [0, 0, 0, 1], [0, 0, 0, 1], 1200, 800).length,
  1,
);
console.log(
  "Time axis: compact UTC overview dates, detail on zoom, deduplication, bounded near-plane clipping and empty/single-instant ranges passed.",
);

const years = timeAxisTicks(
  Date.parse("2021-01-01T00:00Z") / 1000,
  Date.parse("2026-01-01T00:00Z") / 1000,
  [0, -0.5, 0, 1],
  [0, 0.5, 0, 1],
  1200,
  800,
);
assert(years.length > 1 && years.every((t) => !t.text.includes(":")));

assert.equal(
  timeElevationFraction(lo, lo, hi),
  1,
  "Oldest event is at the top",
);
assert.equal(
  timeElevationFraction(hi, lo, hi),
  0,
  "Newest event is on the ground",
);
assert.equal(timeElevationFraction(lo - 60, lo, hi), 1);
assert.equal(timeElevationFraction(hi + 60, lo, hi), 0);
assert.equal(
  timeElevationFraction(lo, lo, lo),
  0,
  "Single-time data stays at ground level",
);
const reversed = timeAxisTicks(
  lo,
  hi,
  [0, 0.5, 0, 1],
  [0, -0.5, 0, 1],
  1200,
  800,
);
assert(
  reversed.length >= 2,
  "Reversed elevation still produces visible chronological UTC labels",
);

const short = timeAxisTicks(
  lo,
  lo + 0.01,
  [0, -0.8, 0, 1],
  [0, 0.8, 0, 1],
  1200,
  800,
);
assert(short.length > 1);
assert(new Set(short.map((t) => t.text)).size === short.length);
assert(
  short.some((t) => /:\d\d\./.test(t.text)),
  "subsecond ticks show fractions",
);
console.log("PASS distinct subsecond time-axis ticks");
