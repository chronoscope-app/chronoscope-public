import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source = (name) =>
  fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
test("Streets credit has all required linked providers on live and export paths", () => {
  for (const file of ["streets.ts", "main.ts"]) {
    const text = source(file);
    for (const url of [
      "https://openfreemap.org/",
      "https://www.openmaptiles.org/",
      "https://www.openstreetmap.org/copyright",
    ])
      assert.ok(text.includes(url), `${file}: ${url}`);
  }
  assert.ok(source("main.ts").includes("view.mapCredits = unique.map"));
  assert.ok(source("view.ts").includes("...this.mapCredits"));
});
test("About and help share package version rather than stale 0.15.0", () => {
  const text = source("main.ts");
  assert.match(text, /version as appVersion/);
  assert.ok(text.includes("Chronoscope ${appVersion}"));
  assert.ok(text.includes("version ${appVersion}"));
  assert.ok(!text.includes("0.15.0"));
});
