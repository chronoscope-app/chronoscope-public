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
const formats = await import(typesUrl);
formats.setDateTimeDisplay({ date_format: "iso", time_format: "24h" });
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
const epoch = Date.parse("2026-10-15T13:04:05Z") / 1000;
for (const [date_format, expected] of [
  ["iso", "2026-10-15"],
  ["mdy", "10/15/2026"],
  ["mdy-short", "10/15/26"],
  ["dmy", "15/10/2026"],
  ["dmy-short", "15/10/26"],
  ["dmy-dots", "15.10.2026"],
]) {
  formats.setDateTimeDisplay({ date_format, time_format: "24h-seconds" });
  assert.equal(formats.displayDate(epoch), expected);
  assert.equal(formats.displayClock(epoch), "13:04:05");
  assert(timelineTicks(epoch, epoch + 120)[0].label.startsWith(expected));
  assert.equal(formats.time(epoch), "2026-10-15 13:04:05");
}
for (const time_format of [
  "12h",
  "12h-seconds",
  "24h",
  "24h-seconds",
  "system",
]) {
  formats.setDateTimeDisplay({ date_format: "iso", time_format });
  const display = formats.displayClock(epoch);
  assert(display.includes("04"));
  if (time_format.startsWith("24h")) assert(display.startsWith("13:04"));
  if (time_format.endsWith("seconds")) assert(display.includes(":05"));
  assert(formats.displayClock(-0.000001, true).includes(".999999"));
  assert.equal(formats.time(-0.000001), "1969-12-31 23:59:59.999999");
}
assert.equal(formats.displayTime(NaN), "Invalid time");
console.log(
  "PASS UTC timeline labels: years, months, days, intraday, year crossing, distinct ticks and invalid bounds",
);
