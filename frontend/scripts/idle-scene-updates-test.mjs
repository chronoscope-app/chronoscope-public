import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/idle-scene-updates.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { idleSceneUpdates } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
function setup() {
  let now = 0,
    id = 0,
    busy = false;
  const timers = new Map(),
    rates = [];
  const clock = {
    now: () => now,
    schedule: (run, delay) => {
      timers.set(++id, { run, at: now + delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  };
  const update = idleSceneUpdates(
    (rate) => rates.push(rate),
    () => busy,
    clock,
  );
  return {
    update,
    timers,
    rates,
    setBusy: (value) => {
      busy = value;
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > end) break;
        now = entry[1].at;
        timers.delete(entry[0]);
        entry[1].run();
      }
      now = end;
    },
  };
}
test("quiet scenes reduce update cadence; input wakes synchronously", () => {
  const s = setup();
  s.advance(999);
  assert.deepEqual(s.rates, []);
  s.advance(1);
  assert.deepEqual(s.rates, [10]);
  s.update.wake();
  assert.deepEqual(s.rates, [10, undefined]);
  s.advance(1000);
  assert.deepEqual(s.rates, [10, undefined, 10]);
});
test("continuous input postpones idle without scheduling a timer per event", () => {
  const s = setup();
  for (let i = 0; i < 150; i++) {
    s.advance(16);
    s.update.wake();
    assert.equal(s.timers.size, 1);
  }
  assert.deepEqual(s.rates, []);
  s.advance(2000);
  assert.deepEqual(s.rates, [10]);
});
test("playback, held interaction and pending loads keep full updates until settled", () => {
  const s = setup();
  s.setBusy(true);
  s.advance(5000);
  assert.deepEqual(s.rates, []);
  s.setBusy(false);
  s.advance(1000);
  assert.deepEqual(s.rates, [10]);
});
test("disposal cancels pending work and cannot restart an old viewer", () => {
  const s = setup();
  s.update.dispose();
  s.advance(5000);
  s.update.wake();
  assert.deepEqual(s.rates, []);
  assert.equal(s.timers.size, 0);
});
