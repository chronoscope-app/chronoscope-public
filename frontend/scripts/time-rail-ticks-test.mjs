import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/time-rail-ticks.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { railTicks } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const epoch = (s) => Date.parse(s + "Z") / 1000;
function scale(a, b, h = 800) {
  return railTicks(epoch(a), epoch(b), h);
}

test("month gutter names months once and aligns half-month marks to calendar dates", () => {
  const s = scale("2018-08-01", "2018-10-01", 400);
  assert.equal(s.heading, "2018");
  assert.deepEqual(
    s.ticks.map((t) => [t.group, t.label]),
    [
      ["AUG", "01"],
      ["", "16"],
      ["SEP", "01"],
      ["", "16"],
      ["OCT", "01"],
    ],
  );
  assert.equal(s.ticks[2].time, epoch("2018-09-01"));
  assert.notEqual(s.ticks[2].fraction, 0.5); // August has 31 days.
});
test("partial months, leap day and year transitions retain unambiguous UTC context", () => {
  const s = scale("2024-02-20", "2024-03-10");
  assert(
    s.ticks.some((t) => t.group === "MAR" && t.time === epoch("2024-03-01")),
  );
  assert.equal(s.ticks[0].label, "20");
  assert.equal(s.ticks.at(-1).label, "10");
  const years = scale("2023-12-15", "2024-02-15");
  assert.equal(years.heading, "2023–2024");
  assert(years.ticks.some((t) => t.group === "JAN 24"));
});
test("intraday and subsecond rulers have distinct bounded labels", () => {
  const hours = scale("2024-08-01T10:00:00", "2024-08-01T16:00:00");
  assert.equal(hours.date, "AUG 01");
  assert(hours.ticks.every((t) => /^\d\d:\d\d$/.test(t.label)));
  const a = epoch("2024-08-01T10:00:00");
  const tiny = railTicks(a + 0.12, a + 0.121, 700);
  assert(
    new Set(tiny.ticks.map((t) => t.label + t.detail)).size ===
      tiny.ticks.length,
  );
  assert(tiny.ticks.every((t) => t.detail.startsWith(".")));
});
test("long studies use annual landmarks and add calendar months as the rail grows", () => {
  const lo = epoch("2016-08-16"),
    hi = epoch("2025-11-01");
  const compact = railTicks(lo, hi, 650);
  assert(compact.ticks.filter((t) => t.level === "year").length >= 7);
  assert(compact.ticks.some((t) => t.label === "2020"));
  const tall = railTicks(lo, hi, 1100);
  assert(tall.ticks.length > compact.ticks.length);
  assert(tall.ticks.some((t) => t.level === "month" && t.label === "JUL"));
  for (const t of tall.ticks.filter((t) => t.level === "year")) {
    assert.equal(t.time, epoch(`${t.label}-01-01`));
  }
  const fiveYears = scale("2021-08-16", "2025-11-01", 650);
  assert(fiveYears.ticks.some((t) => t.level === "year" && t.label === "2023"));
  assert(fiveYears.ticks.some((t) => t.level === "month" && t.label === "JUL"));
});
test("available height increases date detail instead of imposing an eight-label cap", () => {
  const small = scale("2018-08-01", "2018-10-01", 400);
  const large = scale("2018-08-01", "2018-10-01", 1000);
  assert(large.ticks.length > 8);
  assert(large.ticks.length > small.ticks.length);
  assert.equal(large.heading, small.heading);
});
test("label placement stays bounded and separated over very short, long and resized studies", () => {
  for (const [lo, hi] of [
    [0, 0],
    [0, 1],
    [epoch("1900-01-01"), epoch("2100-01-01")],
    [epoch("2023-01-01"), epoch("2025-12-31")],
  ]) {
    for (const height of [40, 100, 300, 800, 2000]) {
      const s = railTicks(lo, hi, height);
      assert(
        s.ticks.length > 0 &&
          s.ticks.length <= Math.min(132, Math.floor(height / 40) + 1),
      );
      s.ticks.forEach((t, i) => {
        assert(t.fraction >= 0 && t.fraction <= 1);
        if (i)
          assert((t.fraction - s.ticks[i - 1].fraction) * height >= 39.999);
      });
    }
  }
  for (const args of [
    [NaN, 0, 100],
    [1, 0, 100],
    [0, Infinity, 100],
    [0, 1, 0],
  ])
    assert.deepEqual(railTicks(...args).ticks, []);
});
