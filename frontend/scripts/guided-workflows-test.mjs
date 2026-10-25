import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
async function load(name) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "bridge-stub",
        setup(b) {
          b.onResolve({ filter: /^\.\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: "export const call = () => { throw Error('UI only'); };",
          }));
        },
      },
    ],
    external: ["@tauri-apps/api/*", "@tauri-apps/plugin-dialog"],
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}
const { analysisPlan } = await load("guided-analysis-model");
const { tableTargetRank } = await load("table-selection");
const draft = {
  task: "profile",
  scope: "visible",
  fields: ["entity", "time"],
  source: null,
  method: "iqr",
  threshold: 1.5,
};
test("guided plans retain exact field names and explicit scope, without changing source records", () => {
  assert.deepEqual(
    analysisPlan({
      ...draft,
      task: "duplicates",
      scope: "selected",
      fields: ["attribute:original ID", "time", "time"],
    }),
    {
      capability: "duplicates",
      scope: "selected",
      parameters: { fields: ["attribute:original ID", "time"] },
      output_limit: 10000,
    },
  );
  assert.deepEqual(
    analysisPlan({ ...draft, task: "trajectories", fields: [] }).parameters,
    {},
  );
  assert.equal(
    analysisPlan({
      ...draft,
      task: "outliers",
      fields: ["value"],
      threshold: 3,
    }).parameters.threshold,
    3,
  );
});
test("empty/over-budget field lists and nonfinite outlier thresholds fail before submitting", () => {
  assert.throws(() => analysisPlan({ ...draft, fields: [] }), /Choose/);
  assert.throws(
    () =>
      analysisPlan({
        ...draft,
        task: "duplicates",
        fields: Array.from({ length: 9 }, (_, i) => `field${i}`),
      }),
    /Choose/,
  );
  assert.throws(
    () =>
      analysisPlan({
        ...draft,
        task: "outliers",
        fields: ["value"],
        threshold: NaN,
      }),
    /threshold/,
  );
});
test("table navigation clamps boundaries and retains page and modifier semantics", () => {
  assert.equal(tableTargetRank("ArrowUp", 0, 100, 12, false), 0);
  assert.equal(tableTargetRank("ArrowDown", 99, 100, 12, false), 99);
  assert.equal(tableTargetRank("PageDown", 10, 100, 12, false), 22);
  assert.equal(tableTargetRank("PageUp", 10, 100, 0, false), 9);
  assert.equal(tableTargetRank("ArrowDown", 10, 100, 12, true), 99);
  assert.equal(tableTargetRank("Home", 10, 100, 12, false), 0);
});
