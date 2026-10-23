import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/viewport-refresh.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { ViewportRefresh } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("continuous camera input publishes intermediate and final viewports", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let camera = 0;
  const loaded = [];
  const queue = new ViewportRefresh(async () => {
    loaded.push(camera);
  }, assert.fail);
  for (camera = 1; camera <= 60; camera++) {
    queue.request();
    t.mock.timers.tick(20);
    await flush();
  }
  assert(loaded.length >= 8, "loads must not wait until the drag ends");
  camera = 100;
  queue.request();
  t.mock.timers.tick(120);
  await flush();
  assert.equal(loaded.at(-1), 100);
  queue.cancel();
});

test("slow loads finish without overlap and coalesce motion to the latest viewport", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let camera = 1,
    finish,
    superseded;
  const loaded = [];
  const queue = new ViewportRefresh(async (outdated) => {
    superseded = outdated;
    loaded.push(camera);
    await new Promise((resolve) => {
      finish = resolve;
    });
  }, assert.fail);
  queue.request();
  t.mock.timers.tick(120);
  assert.equal(superseded(), false);
  for (camera = 2; camera <= 20; camera++) {
    queue.request();
    t.mock.timers.tick(40);
    await flush();
  }
  assert.deepEqual(loaded, [1]);
  assert.equal(superseded(), true, "a tile page can yield after publishing");
  finish();
  await flush();
  t.mock.timers.tick(120);
  assert.deepEqual(loaded, [1, 21]);
  assert.equal(superseded(), false);
  queue.cancel();
  finish();
  await flush();
  t.mock.timers.tick(1000);
  assert.equal(loaded.length, 2);
});

test("cancellation drops queued work and errors do not strand later requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const errors = [];
  const queue = new ViewportRefresh(
    async () => {
      if (++calls === 1) throw Error("fixture failure");
    },
    (error) => errors.push(error.message),
  );
  queue.request();
  queue.cancel();
  t.mock.timers.tick(1000);
  assert.equal(calls, 0);
  queue.request();
  t.mock.timers.tick(120);
  await flush();
  assert.deepEqual(errors, ["fixture failure"]);
  queue.request();
  t.mock.timers.tick(120);
  await flush();
  assert.equal(calls, 2);
});
