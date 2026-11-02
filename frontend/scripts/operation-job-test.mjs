import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/operation-job.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "job-fixture",
      setup(b) {
        b.onResolve({ filter: /^\.\/bridge$/ }, () => ({
          path: "bridge",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `export class CommandError extends Error {constructor(e){super(e.message);this.code=e.code;}}
export const call=(...args)=>globalThis.__jobFixture(...args);`,
        }));
      },
    },
  ],
});
const { runJob, isCancellation } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
function fixture(state, controller) {
  const calls = [];
  globalThis.__jobFixture = async (command) => {
    calls.push(command);
    if (command === "job_start") {
      controller?.abort();
      return { job_id: "test-job" };
    }
    if (command === "job_status") return state;
    if (command === "job_result")
      return { result: { accepted: 7, commit_receipt: { committed: true } } };
    return {};
  };
  return calls;
}
test("SQLite interruption on cancelled review is a cancellation message and releases the job", async () => {
  const calls = fixture({
    status: "cancelled",
    error: { code: "CANCELLED", message: "Workspace database: interrupted" },
  });
  await assert.rejects(runJob("import_review", {}), (error) => {
    assert.equal(error.message, "Operation cancelled");
    assert(isCancellation(error));
    return true;
  });
  assert.equal(calls.at(-1), "job_release");
  assert(!calls.includes("job_result"));
});
test("A requested cancellation never hides a genuine database failure", async () => {
  const c = new AbortController();
  const calls = fixture(
    {
      status: "failed",
      error: {
        code: "OPERATION_FAILED",
        message: "Workspace database: disk I/O error",
      },
    },
    c,
  );
  await assert.rejects(
    runJob("import_review", {}, { signal: c.signal }),
    (e) => {
      assert.equal(e.message, "Workspace database: disk I/O error");
      assert(!isCancellation(e));
      return true;
    },
  );
  assert(calls.includes("job_cancel"));
  assert.equal(calls.at(-1), "job_release");
});
test("Late cancellation preserves completed results and commit receipts", async () => {
  const c = new AbortController();
  fixture({ status: "completed" }, c);
  const result = await runJob("import_commit", {}, { signal: c.signal });
  assert.equal(result.accepted, 7);
  assert.equal(result.commit_receipt.committed, true);
});
test("Pre-aborted jobs never start and are recognized as cancellation", async () => {
  const c = new AbortController();
  c.abort();
  const calls = fixture({ status: "cancelled" });
  await assert.rejects(
    runJob("import_preview", {}, { signal: c.signal }),
    (e) => isCancellation(e),
  );
  assert.deepEqual(calls, []);
});
