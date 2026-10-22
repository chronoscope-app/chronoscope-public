import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({
  stdin: {
    contents:
      'export { defaultChart } from "./charts-panel"; export { chartTitle } from "./chart-guidance";',
    resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  external: ["./chart-renderer"],
  plugins: [
    {
      name: "unused-bridge",
      setup(build) {
        build.onResolve({ filter: /^\.\/bridge$/ }, () => ({
          path: "bridge",
          namespace: "test",
        }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents:
            'export function call() { throw Error("Unexpected bridge call"); }',
        }));
      },
    },
  ],
});
const { defaultChart, chartTitle } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const config = {
  ...defaultChart,
  kind: "period",
  period_a: [0, 2],
  period_b: [2, 4],
};
// Portable JSON restores value-equal arrays as distinct objects.
const preset = JSON.parse(JSON.stringify({ name: "Before and after", config }));
assert.equal(chartTitle(config, [preset]), "Before and after");
assert.notEqual(
  chartTitle({ ...config, period_b: [2, 5] }, [preset]),
  preset.name,
);
assert.equal(
  chartTitle({ ...config, title: "Custom title" }, [preset]),
  "Custom title",
);
console.log(
  "PASS saved custom-period titles compare window values after JSON round trips",
);
