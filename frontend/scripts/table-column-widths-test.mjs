import assert from "node:assert/strict";
import {
  captureColumnWidths,
  restoreColumnWidths,
  columnPixelOffset,
  columnWindowOffset,
} from "../src/table-columns.ts";
const host = {};
restoreColumnWidths(host, [60, 240, 80]);
assert.equal(columnPixelOffset(host, 3), 380);
assert.equal(columnPixelOffset(host, 5), 580);
assert.deepEqual(captureColumnWidths(host), [60, 240, 80]);
// A wide resized leading column must not skip a virtual window prematurely.
restoreColumnWidths(host, [1200, ...Array(63).fill(60)]);
assert.equal(columnWindowOffset(1190, 100, 64, 0, host), 0);
assert(columnWindowOffset(3500, 500, 64, 0, host) > 0);
const saved = captureColumnWidths(host);
restoreColumnWidths(host);
assert.equal(columnPixelOffset(host, 2), 200);
restoreColumnWidths(host, saved);
assert.equal(columnPixelOffset(host, 2), 1260);
restoreColumnWidths(host, [NaN, 2000, 1]);
assert.deepEqual(captureColumnWidths(host), [0, 1200, 56]);
console.log(
  "Variable column offsets preserve virtualization, manual sizing and per-tab restore.",
);
