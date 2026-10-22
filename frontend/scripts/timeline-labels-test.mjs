import ts from "typescript";
import fs from "node:fs";
import assert from "node:assert/strict";
const source = fs.readFileSync(
  new URL("../src/timeline-labels.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
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
const { timelineTicks } = await import(
  "data:text/javascript;base64," +
    Buffer.from(js.replace('"./types"', JSON.stringify(typesUrl))).toString(
      "base64",
    )
);
const ticks = (a, b) =>
  timelineTicks(Date.parse(a) / 1000, Date.parse(b) / 1000);
assert.deepEqual(
  ticks("2016-01-07T00:00:00Z", "2025-11-01T06:00:00Z").map((t) => t.label),
  ["2016", "2018", "2020", "2023", "2025"],
);
const months = ticks("2024-11-01T00:00:00Z", "2025-06-01T00:00:00Z");
assert(months.every((t) => /202[45]/.test(t.label)));
const crossing = ticks("2024-12-31T23:00:00Z", "2025-01-01T01:00:00Z");
assert(
  crossing[0].label.includes("2024") && crossing[4].label.includes("2025"),
);
assert(crossing[2].label.includes("00:00"));
for (const [a, b] of [
  ["2024-11-01", "2025-02-01"],
  ["2020-01-01", "2023-12-31"],
  ["2025-01-01", "2025-01-03"],
]) {
  const result = ticks(a + "T00:00:00Z", b + "T00:00:00Z");
  assert.equal(
    new Set(result.map((t) => t.label)).size,
    5,
    `${a} to ${b} must have distinct ticks`,
  );
  assert(result.every((t) => t.full.endsWith(" UTC")));
}
assert.deepEqual(timelineTicks(NaN, 1), []);
assert.deepEqual(timelineTicks(2, 1), []);
console.log(
  "PASS UTC timeline labels: years, months, days, intraday, year crossing, distinct ticks and invalid bounds",
);
