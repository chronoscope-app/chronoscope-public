import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const js = ts.transpileModule(
  fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { decode, time } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
function packet(n) {
  const bytes = Buffer.alloc(n * 32),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) {
    view.setFloat64(i * 32, -79, true);
    view.setFloat64(i * 32 + 8, 43, true);
    view.setFloat64(i * 32 + 16, -60, true);
    view.setUint32(i * 32 + 24, 0, true);
    view.setFloat32(i * 32 + 28, 1, true);
  }
  return {
    stride: 32,
    data: bytes.toString("base64"),
    ids: Array.from({ length: n }, (_, i) =>
      (9007199254740993n + BigInt(i)).toString(),
    ),
    entities: ["track"],
    rendered_count: n,
  };
}
for (const n of [0, 100, 20000, 100000]) {
  const p = packet(n),
    rows = decode(p);
  assert.equal(rows.length, n);
  if (n) {
    assert.equal(rows[0].id, "9007199254740993");
    assert.equal(rows[0].time, -60);
    assert.equal(rows[n - 1].lat, 43);
  }
}
for (const change of [
  (p) => (p.stride = 16),
  (p) => (p.ids[0] = 1),
  (p) => (p.ids[0] = "18446744073709551616"),
  (p) => (p.ids[1] = p.ids[0]),
  (p) => (p.data = p.data.slice(4)),
  (p) => (p.data = "!".repeat(p.data.length)),
  (p) => (p.rendered_count = 3),
  (p) => (p.entities = []),
  (p) => (p.inferred_ids = ["999"]),
  (p) => {
    const b = Buffer.from(p.data, "base64");
    b.writeDoubleLE(NaN, 0);
    p.data = b.toString("base64");
  },
  (p) => {
    const b = Buffer.from(p.data, "base64");
    b.writeFloatLE(Infinity, 28);
    p.data = b.toString("base64");
  },
]) {
  const p = packet(2);
  change(p);
  assert.throws(() => decode(p), /Invalid render packet/);
}
console.log(
  "Passed: 0/100/20k/100k packets, endian/negative-minute/high IDs, malformed size/base64/IDs/dictionary/inferred/GIS/value checks.",
);

for (const epoch of [
  1791879359.123456, 1791879359.000001, -0.125, -1.875, 1.125,
]) {
  const p = packet(1),
    b = Buffer.from(p.data, "base64");
  b.writeDoubleLE(epoch, 16);
  p.data = b.toString("base64");
  assert.equal(decode(p)[0].time, epoch);
}
assert.equal(time(1791879359.123456), "2026-10-13 08:15:59.123456");
assert.equal(time(-0.125), "1969-12-31 23:59:59.875");
assert.equal(time(-1.875), "1969-12-31 23:59:58.125");
assert.equal(time(NaN), "Invalid time");
console.log(
  "PASS fractional packet decoding and positive/negative UTC labels without millisecond truncation",
);

assert.equal(time(-0.0000000001), "1970-01-01 00:00:00");
// Altitude packet extension: preserve metres, datum, zero and missing separately.
{
  const original = packet(5),
    bytes = Buffer.alloc(5 * 48),
    raw = Buffer.from(original.data, "base64");
  for (let i = 0; i < 5; i++) {
    raw.copy(bytes, i * 48, i * 32, (i + 1) * 32);
    bytes.writeDoubleLE(i ? i * 1000 : NaN, i * 48 + 32);
    bytes[i * 48 + 40] = i;
  }
  bytes.writeDoubleLE(0, 48 + 32);
  const p = { ...original, stride: 48, data: bytes.toString("base64") },
    rows = decode(p);
  assert.equal(rows[0].altitude, undefined);
  assert.deepEqual(rows[1].altitude, { meters: 0, reference: "ellipsoid" });
  assert.deepEqual(rows[2].altitude, { meters: 2000, reference: "egm96" });
  assert.equal(rows[3].altitude.reference, "reported");
  assert.equal(rows[4].altitude.reference, "unspecified");
  for (const mutate of [
    (b) => (b[40] = 9),
    (b) => b.writeDoubleLE(Infinity, 80),
    (b) => (b[41] = 1),
    (b) => b.writeDoubleLE(12, 32),
  ]) {
    const bad = Buffer.from(bytes);
    mutate(bad);
    assert.throws(
      () => decode({ ...p, data: bad.toString("base64") }),
      /Invalid render packet/,
    );
  }
}
