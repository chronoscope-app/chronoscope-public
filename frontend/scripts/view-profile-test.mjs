import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(
  fs.readFileSync(new URL("../src/view-profile.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { ViewProfiles } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const listeners = new Set();
let now = 0,
  interval = 16;
const profiles = new ViewProfiles(
  (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => [interval, 2, 0, 1, 3, 0, 0],
  () => now,
  () => 1700000000000 + now,
);
const first = profiles.request({ action: "start" }),
  second = profiles.request({ action: "start" });
assert.equal(listeners.size, 2);
assert.throws(() => profiles.request({ action: "start" }), /RESOURCE_LIMIT/);
for (let i = 0; i < 6000; i++) {
  interval = i === 3000 ? 500 : 16;
  now += interval;
  for (const listener of [...listeners]) listener();
}
const done = profiles.request({ action: "status", id: first.id });
assert.equal(done.state, "complete");
assert.equal(done.samples.length, 6000);
assert.equal(done.summary.truncated, true);
assert.equal(done.summary.gaps_over_250_ms, 1);
assert.equal(
  done.samples[3000][1],
  500,
  "Long gaps must not be hidden as idle",
);
assert.equal(listeners.size, 0);
assert.equal(done.samples[0][0], 16);
assert.equal(done.columns.length, done.samples[0].length);
assert.equal(
  profiles.request({ action: "stop", id: first.id }).summary.reason,
  "sample_limit",
);
done.samples[0][0] = 99999;
assert.equal(
  profiles.request({ action: "status", id: first.id }).samples[0][0],
  16,
  "Replies cannot mutate retained traces",
);
for (let i = 0; i < 8; i++) {
  const p = profiles.request({ action: "start" });
  profiles.request({ action: "stop", id: p.id });
}
assert.throws(
  () => profiles.request({ action: "status", id: second.id }),
  /NOT_FOUND/,
);
assert.equal(listeners.size, 0);
console.log(
  "PASS performance trace timestamps, caps, concurrency, detached replies and listener cleanup",
);
