import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  fs.readFileSync(new URL("../src/base64-bytes.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { base64Bytes } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64");
const native = Uint8Array.fromBase64;
function withDecoder(value, run) {
  Object.defineProperty(Uint8Array, "fromBase64", {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(Uint8Array, "fromBase64", descriptor);
    else delete Uint8Array.fromBase64;
  }
}
const values = [
  Buffer.alloc(0),
  Buffer.from([0, 1, 127, 128, 254, 255]),
  Buffer.from("métres · 日本語 · 😀", "utf8"),
  Buffer.from(
    Array.from({ length: 1024 * 1024 }, (_, i) => (i * 37 + 11) % 256),
  ),
];
test("native base64 decoding preserves empty, binary, Unicode and large payloads", () => {
  assert.equal(typeof native, "function");
  let calls = 0;
  withDecoder(
    function (data) {
      calls++;
      return native.call(Uint8Array, data);
    },
    () => {
      for (const expected of values) {
        const got = base64Bytes(expected.toString("base64"));
        assert.deepEqual(Buffer.from(got), expected);
        assert.equal(got.byteOffset, 0);
        assert.equal(got.buffer.byteLength, expected.length);
      }
    },
  );
  assert.equal(calls, values.length);
});
test("older WebViews copy bytes directly and preserve JSON and text payloads", () => {
  withDecoder(undefined, () => {
    for (const expected of values)
      assert.deepEqual(
        Buffer.from(base64Bytes(expected.toString("base64"))),
        expected,
      );
    const expected = { name: "Cebu → Manila", height: 0 };
    const encoded = Buffer.from(JSON.stringify(expected)).toString("base64");
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(base64Bytes(encoded))),
      expected,
    );
  });
});
test("native and fallback decoders reject malformed bridge payloads", () => {
  for (const decode of [native, undefined])
    withDecoder(decode, () => {
      for (const data of ["@bad", "A", "YQ==="])
        assert.throws(() => base64Bytes(data));
    });
});
