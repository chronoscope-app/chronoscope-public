import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/bridge.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
function bridge({ token = "test-token", native = false, invoke } = {}) {
  const requests = [];
  const exports = {};
  const context = {
    exports,
    require: () => ({ invoke }),
    window: native ? { __TAURI_INTERNALS__: {} } : {},
    location: { hash: "", pathname: "/", search: "" },
    history: { replaceState() {} },
    sessionStorage: { getItem: () => token, setItem() {} },
    URLSearchParams,
    DOMException,
    XMLHttpRequest: class {
      headers = {};
      constructor() {
        requests.push(this);
      }
      open(method, url) {
        Object.assign(this, { method, url });
      }
      setRequestHeader(name, value) {
        this.headers[name] = value;
      }
      send(body) {
        this.body = body;
      }
      complete(status, body) {
        this.status = status;
        this.responseText = body;
        this.onload();
      }
    },
  };
  vm.runInNewContext(code, context);
  return { ...exports, requests };
}

test("browser bridge preserves authenticated command payload and awaits the complete body", async () => {
  const b = bridge();
  let settled = false;
  const result = b.call("filter", {
    filter: { start: 42 },
    expected_revision: 7,
  });
  result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  const request = b.requests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/invoke");
  assert.deepEqual(request.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  });
  assert.deepEqual(JSON.parse(request.body), {
    command: "filter",
    args: { filter: { start: 42 }, expected_revision: 7 },
  });
  request.complete(200, '{"result":{"revision":8,"name":"é"}}');
  assert.equal(JSON.stringify(await result), '{"revision":8,"name":"é"}');
});

test("browser bridge retains structured conflict and authorization errors", async () => {
  for (const [status, code, message] of [
    [400, "CONFLICT", "CONFLICT: revision changed"],
    [401, "UNAUTHORIZED", "Unauthorized"],
  ]) {
    const b = bridge();
    const result = b.call("filter", {});
    b.requests[0].complete(
      status,
      JSON.stringify({ error: { code, message } }),
    );
    await assert.rejects(
      result,
      (error) =>
        error.name === "CommandError" &&
        error.code === code &&
        error.message === message,
    );
  }
});

test("browser bridge rejects malformed JSON instead of publishing a result", async () => {
  const b = bridge();
  const result = b.call("snapshot");
  b.requests[0].complete(200, "{incomplete");
  await assert.rejects(result, (error) => error.name === "SyntaxError");
});

test("browser bridge rejects transport failure and abort", async () => {
  for (const event of ["onerror", "onabort"]) {
    const b = bridge();
    const result = b.call("snapshot");
    b.requests[0][event]();
    await assert.rejects(
      result,
      (error) =>
        error.name === (event === "onerror" ? "TypeError" : "AbortError"),
    );
  }
});

test("browser bridge refuses to send without a token", async () => {
  const b = bridge({ token: "" });
  await assert.rejects(b.call("snapshot"), /requires the local bridge token/);
  assert.equal(b.requests.length, 0);
});

test("native commands still use Tauri dispatch and preserve structured errors", async () => {
  const seen = [];
  const b = bridge({
    native: true,
    token: "",
    invoke: async (...args) => {
      seen.push(args);
      return { revision: 9 };
    },
  });
  assert.deepEqual(await b.call("snapshot"), { revision: 9 });
  assert.equal(
    JSON.stringify(seen),
    '[["dispatch",{"command":"snapshot","args":{}}]]',
  );
  assert.equal(b.requests.length, 0);
  const failing = bridge({
    native: true,
    invoke: async () => {
      throw { code: "CONFLICT", message: "changed" };
    },
  });
  await assert.rejects(
    failing.call("snapshot"),
    (error) => error.name === "CommandError" && error.code === "CONFLICT",
  );
  assert.equal(failing.requests.length, 0);
});
