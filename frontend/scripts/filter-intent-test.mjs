import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(
  new URL("../src/filter-intent.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { FilterIntent } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => (resolve = r)),
    resolve: () => resolve(),
  };
};
for (let burst = 0; burst < 30; burst++) {
  let state = { filter: { start: 0, end: 100, search: "" }, revision: 1 },
    writes = [],
    blocked = deferred(),
    entered = deferred(),
    refreshes = 0;
  const c = new FilterIntent(
    async () => structuredClone(state),
    async (filter, revision) => {
      writes.push(filter.start);
      if (writes.length === 1) {
        entered.resolve();
        await blocked.promise;
      }
      assert.equal(revision, state.revision);
      state = { filter, revision: revision + 1 };
    },
    async () => {
      refreshes++;
    },
  );
  const first = c.enqueue({ start: 20 });
  await entered.promise;
  let finished = false;
  const second = c.enqueue({ start: 40 });
  assert.equal(second, first);
  const third = c.enqueue({ start: 60 });
  third.then(() => (finished = true));
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(c.protects("start"), true);
  assert.equal(c.desired({ start: 0 }).start, 60);
  blocked.resolve();
  await c.idle();
  assert.deepEqual(writes, [20, 60]);
  assert.equal(state.filter.start, 60);
  assert.equal(refreshes, 1);
  assert.equal(finished, true);
}
{
  let state = { filter: { start: 0, search: "" }, revision: 1 },
    conflict = true;
  const c = new FilterIntent(
    async () => structuredClone(state),
    async (filter, revision) => {
      if (conflict) {
        conflict = false;
        state = { filter: { start: 0, search: "external" }, revision: 2 };
        throw Error("CONFLICT: external mutation");
      }
      assert.equal(revision, 2);
      state = { filter, revision: 3 };
    },
    async () => {},
  );
  await c.enqueue({ start: 40 });
  assert.deepEqual(state.filter, { start: 40, search: "external" });
}
{
  let fail = true,
    state = { filter: { start: 0 }, revision: 1 };
  const c = new FilterIntent(
    async () => state,
    async (filter) => {
      if (fail) throw Error("fixture error");
      state = { filter, revision: 2 };
    },
    async () => {},
  );
  await assert.rejects(c.enqueue({ start: 40 }), /fixture error/);
  assert.equal(c.protects("start"), false);
  await assert.rejects(c.idle(), /fixture error/);
  fail = false;
  await c.enqueue({ start: 60 });
  assert.equal(state.filter.start, 60);
}
{
  let state = { filter: { start: 0, search: "" }, revision: 1 };
  const c = new FilterIntent(
    async () => state,
    async (filter) => {
      state = { filter, revision: 2 };
    },
    async () => {},
  );
  const a = c.enqueue({ start: 20 }, 10000),
    b = c.enqueue({ search: "captured input" }, 10000);
  assert.equal(a, b);
  assert.equal(c.protects("start"), true);
  await c.flush();
  assert.deepEqual(state.filter, { start: 20, search: "captured input" });
}
// A continuous scrub publishes intermediate frames while keeping pending writes bounded.
{
  let state = { filter: { start: 0, search: "" }, revision: 1 },
    writes = [],
    frames = [];
  const entered = deferred(),
    unblock = deferred(),
    secondEntered = deferred(),
    unblockSecond = deferred(),
    firstFrame = deferred();
  const c = new FilterIntent(
    async () => structuredClone(state),
    async (filter, revision) => {
      writes.push(filter.start);
      if (writes.length === 1) {
        entered.resolve();
        await unblock.promise;
      }
      if (writes.length === 2) {
        secondEntered.resolve();
        await unblockSecond.promise;
      }
      state = { filter, revision: revision + 1 };
    },
    async () => {
      frames.push(state.filter.start);
      firstFrame.resolve();
    },
  );
  const work = c.enqueue({ start: 20 }, 0, true);
  await entered.promise;
  c.enqueue({ start: 40 });
  c.enqueue({ start: 60 });
  unblock.resolve();
  await Promise.race([
    firstFrame.promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(Error("Scrub did not publish an intermediate frame")),
        1000,
      ),
    ),
  ]);
  await secondEntered.promise;
  assert.deepEqual(frames, [20]);
  c.enqueue({ start: 80 });
  unblockSecond.resolve();
  await work;
  assert.deepEqual(writes, [20, 60, 80]);
  assert.deepEqual(frames, [20, 60, 80]);
}
console.log(
  "Passed: 30 deterministic range bursts, joined drains, external CAS rebasing, failed-write retry and captured debounced deltas.",
);
