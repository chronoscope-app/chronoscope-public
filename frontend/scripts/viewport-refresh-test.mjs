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

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("flush immediately reads the current viewport and returns a stable outcome", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let camera = 1;
  const loaded = [];
  const queue = new ViewportRefresh(async () => {
    loaded.push(camera);
  }, assert.fail);
  assert.deepEqual(await queue.idle(), { generation: 0, outcome: undefined });
  const ticket = queue.request();
  camera = 2;
  const drained = queue.flush();
  assert.deepEqual(
    loaded,
    [2],
    "flush starts work without advancing the debounce clock",
  );
  assert.deepEqual(await ticket.done, {
    kind: "accepted",
    generation: ticket.generation,
  });
  assert.deepEqual(await drained, {
    generation: ticket.generation,
    outcome: { kind: "accepted", generation: ticket.generation },
  });
  const tail = queue.tail;
  assert.deepEqual(await queue.drain(), await queue.idle());
  assert.equal(queue.tail, tail, "quiescent drains do not manufacture work");
  t.mock.timers.tick(1000);
  assert.deepEqual(loaded, [2]);
});

test("queued replacement tickets wait for their own load and coalesce latest start-time bounds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred(),
    second = deferred();
  let camera = 1,
    active = 0,
    maxActive = 0;
  const loaded = [];
  const queue = new ViewportRefresh(async () => {
    maxActive = Math.max(maxActive, ++active);
    loaded.push(camera);
    await (loaded.length === 1 ? first.promise : second.promise);
    active--;
  }, assert.fail);
  const a = queue.request();
  t.mock.timers.tick(120);
  const b = queue.request();
  const c = queue.request();
  assert.deepEqual(await b.done, {
    kind: "superseded",
    generation: b.generation,
  });
  let cSettled = false,
    drainSettled = false;
  void c.done.then(() => {
    cSettled = true;
  });
  const drained = queue.drain().then((result) => {
    drainSettled = true;
    return result;
  });
  await flush();
  assert.equal(cSettled, false);
  assert.equal(drainSettled, false);
  camera = 9;
  first.resolve();
  await a.done;
  await flush();
  assert.deepEqual(
    loaded,
    [1, 9],
    "drain starts the pending load without another timer tick",
  );
  assert.equal(cSettled, false);
  assert.equal(drainSettled, false);
  second.resolve();
  assert.equal((await c.done).kind, "accepted");
  assert.equal((await a.done).kind, "superseded");
  assert.deepEqual(await drained, {
    generation: c.generation,
    outcome: await c.done,
  });
  assert.equal(maxActive, 1);
});

test("cancel invalidates a running callback and drain still waits for physical completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred();
  let superseded,
    calls = 0;
  const queue = new ViewportRefresh(async (outdated) => {
    calls++;
    superseded = outdated;
    if (calls === 1) await held.promise;
  }, assert.fail);
  const a = queue.request();
  t.mock.timers.tick(120);
  assert.equal(superseded(), false);
  queue.cancel();
  assert.equal(superseded(), true);
  assert.equal((await a.done).kind, "canceled");
  let settled = false;
  const idle = queue.idle().then((value) => {
    settled = true;
    return value;
  });
  await flush();
  assert.equal(settled, false);
  const b = queue.request();
  assert.equal(calls, 1, "cancel cannot permit overlap with the old worker");
  held.resolve();
  assert.equal((await b.done).kind, "accepted");
  assert.deepEqual(await idle, {
    generation: b.generation,
    outcome: await b.done,
  });
  assert.equal(calls, 2);
});

test("canceling only scheduled work drains as canceled rather than accepted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const queue = new ViewportRefresh(async () => {
    calls++;
  }, assert.fail);
  const ticket = queue.request();
  const before = queue.tail;
  queue.cancel();
  assert.notEqual(queue.tail, before);
  assert.equal((await ticket.done).kind, "canceled");
  const result = await queue.drain();
  assert.equal(result.outcome.kind, "canceled");
  assert.equal(result.outcome.generation, queue.generation);
  t.mock.timers.tick(1000);
  assert.equal(calls, 0);
});

test("drain includes requests reentered from refresh and completion reactions", async () => {
  let calls = 0,
    nested;
  const queue = new ViewportRefresh(async () => {
    if (++calls === 1) nested = queue.request();
  }, assert.fail);
  const first = queue.request();
  let final;
  void first.done.then(() => {
    final = queue.request();
  });
  const result = await queue.flush();
  assert.equal((await first.done).kind, "superseded");
  assert.equal((await nested.done).kind, "superseded");
  assert.equal((await final.done).kind, "accepted");
  assert.equal(
    calls,
    3,
    "the completion reaction requests again after the second load has started",
  );
  assert.deepEqual(result, {
    generation: final.generation,
    outcome: await final.done,
  });
});

test("failed work and a throwing error observer settle safely and do not strand later work", async () => {
  const failure = Error("refresh failed"),
    observerFailure = Error("observer failed");
  let calls = 0,
    reported;
  const queue = new ViewportRefresh(
    async () => {
      if (++calls === 1) throw failure;
    },
    (error) => {
      reported = error;
      throw observerFailure;
    },
  );
  const first = queue.request();
  const failed = await queue.flush();
  assert.equal(reported, failure);
  assert.deepEqual(await first.done, {
    kind: "failed",
    generation: first.generation,
    error: failure,
  });
  assert.deepEqual(failed, {
    generation: first.generation,
    outcome: await first.done,
  });
  const second = queue.request();
  const success = await queue.drain();
  assert.equal((await second.done).kind, "accepted");
  assert.deepEqual(success, {
    generation: second.generation,
    outcome: await second.done,
  });
  assert.equal(calls, 2);
});

test("an error observer may enqueue recovery without overlap or a lost wakeup", async () => {
  let calls = 0,
    recovery;
  const queue = new ViewportRefresh(
    async () => {
      if (++calls === 1) throw Error("retry fixture");
    },
    () => {
      recovery = queue.request();
    },
  );
  const first = queue.request();
  const result = await queue.drain();
  assert.equal((await first.done).kind, "failed");
  assert.equal((await recovery.done).kind, "accepted");
  assert.deepEqual(result, {
    generation: recovery.generation,
    outcome: await recovery.done,
  });
});

test("a canceled running load cannot become accepted or failed when it eventually finishes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred();
  const failure = Error("late failure after cancellation");
  const errors = [];
  const queue = new ViewportRefresh(
    async () => {
      await held.promise;
      throw failure;
    },
    (error) => errors.push(error),
  );
  const ticket = queue.request();
  t.mock.timers.tick(120);
  queue.cancel();
  const generation = queue.generation;
  let settled = false;
  const drained = queue.flush().then((result) => {
    settled = true;
    return result;
  });
  await flush();
  assert.equal(settled, false);
  assert.equal((await ticket.done).kind, "canceled");
  held.resolve();
  assert.deepEqual(await drained, {
    generation,
    outcome: { kind: "canceled", generation },
  });
  assert.deepEqual(
    errors,
    [failure],
    "the actual failure is still reported safely",
  );
  assert.equal((await ticket.done).kind, "canceled");
});
