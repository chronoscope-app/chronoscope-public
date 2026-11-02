import assert from "node:assert/strict";
import { nearestGroundLocation } from "../src/radius-center.ts";
const actual = { lat: 14.5, lon: 121, time: 100 };
const inferred = { lat: 15, lon: 120, inferred: true };
assert.equal(
  nearestGroundLocation(
    [actual, inferred],
    (p) => (p.inferred ? { x: 100, y: 100 } : { x: 103, y: 102 }),
    100,
    100,
  ),
  actual,
);
assert.equal(
  nearestGroundLocation([actual], () => ({ x: 114, y: 100 }), 100, 100),
  undefined,
);
assert.equal(
  nearestGroundLocation([actual], () => undefined, 100, 100),
  undefined,
);
console.log(
  "Radius anchors use nearby real geographic stem feet, exclude inferred positions, and leave empty ground unsnapped.",
);
