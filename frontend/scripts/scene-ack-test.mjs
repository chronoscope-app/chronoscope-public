import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const controllerSource = fs.readFileSync(
  new URL("../src/editor-controller.ts", import.meta.url),
  "utf8",
);
const { EditorController } = await import(
  "data:text/javascript;base64," +
    Buffer.from(transpile(controllerSource)).toString("base64")
);
const source = fs.readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "main.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
function node(predicate) {
  let found;
  const visit = (entry) => {
    if (found) return;
    if (predicate(entry)) found = entry;
    else ts.forEachChild(entry, visit);
  };
  visit(ast);
  assert(found, "actual main handler exists");
  return found;
}
const sync = node(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "syncScene",
).getText(ast);
const sceneChange = node(
  (n) =>
    ts.isBinaryExpression(n) && n.left.getText(ast) === "view.onSceneChange",
).right.getText(ast);
const timerStart = source.indexOf("let syncTimer:");
const timerEnd = source.indexOf("let eventTimer:", timerStart);
const timerSource = source.slice(timerStart, timerEnd);
const apply = node(
  (n) => ts.isCaseClause(n) && n.expression.getText(ast) === '"apply-edit"',
).getText(ast);
const workspace = "store-a:7";
const fence = (revision = 23, extra = {}) => ({
  workspace,
  revision,
  ...extra,
});
const receipt = (before = 23, after = before + 1, extra = {}) => ({
  revision: after,
  commit_receipt: {
    kind: "workspace",
    committed: true,
    store_id: "store-a",
    revision_before: String(before),
    revision_after: String(after),
    ...extra,
  },
});
function editorAt(revision = 23, id = "19") {
  const editor = new EditorController();
  editor.open(
    { workspace, id, revision, originalWkt: "LINESTRING(12 0,14 2)" },
    {
      entity: "line-zm",
      time: "2026-01-01",
      lat: "",
      lon: "",
      wkt: "LINESTRING(12 0,14 2)",
      category: "",
      label: "",
      related: "",
      note: "",
      tags: "",
    },
  );
  return editor;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function host(editor = editorAt(), call = async () => receipt()) {
  const snapshot = { workspace_id: workspace, revision: 23, scene: {} },
    toasts = [];
  let scheduled;
  const context = vm.createContext({
    snapshot,
    editor,
    call,
    view: {},
    restoringScene: false,
    sceneSyncGeneration: 0,
    cancelSceneSync() {
      context.sceneSyncGeneration++;
    },
    setTimeout(work) {
      scheduled = work;
      return 1;
    },
    sceneIdle: async () => {},
    transitionIdle: async () => {},
    cameraSaveWork: Promise.resolve(),
    flushSceneSync: async () => {},
    clearTimeout() {},
    captureScene: () => ({ mode: "map" }),
    toast: (...value) => toasts.push(value),
    refresh: async () => {},
  });
  vm.runInContext(
    transpile(
      `let sceneSyncWork = Promise.resolve(); ${sync}; ${timerSource}; async function applyEdit() { switch("apply-edit") { ${apply} } }`,
    ),
    context,
  );
  return { context, snapshot, editor, toasts, timer: () => scheduled() };
}

test("actual scene ACK then actual Apply accepts revision24 while preserving original null coordinates/WKT", async () => {
  const editor = editorAt();
  editor.change("entity", "__proto__");
  let backend = 23,
    edited;
  const h = host(editor, async (name, args) => {
    if (name === "scene_sync") {
      assert.equal(args.expected_revision, backend);
      assert.equal(args.expected_workspace, workspace);
      return receipt(backend++);
    }
    if (name === "time_parse") return { epoch: 1767225600 };
    assert.equal(name, "edit");
    assert.equal(
      args.expected_revision,
      backend,
      "optimistic guard remains active",
    );
    assert.equal(args.expected_workspace, workspace);
    edited = args;
    backend++;
    return { revision: backend };
  });
  h.context.view.onSceneChange();
  await h.timer();
  assert.equal(h.snapshot.revision, 24);
  assert.equal(editor.target.revision, 24);
  await vm.runInContext("applyEdit()", h.context);
  assert.equal(backend, 25);
  assert.equal(edited.id, "19");
  assert.equal(edited.changes.entity, "__proto__");
  assert.equal(edited.changes.lat, null);
  assert.equal(edited.changes.lon, null);
  assert(!Object.hasOwn(edited.changes, "geometry_wkt"));
  assert.equal(
    h.toasts.at(-1)[0],
    "Event updated; original source fields preserved",
  );
});

test("ACK advances matching cached targets and preserves dirty fields, WKT and older target conflicts", () => {
  const editor = editorAt();
  editor.change("entity", "__proto__");
  editor.open(
    { workspace, id: "old", revision: 22, originalWkt: "POINT EMPTY" },
    { note: "older" },
  );
  assert.equal(editor.acknowledgeScene(fence(), workspace, receipt()), true);
  assert.equal(
    editor.target.revision,
    22,
    "unknown intervening revision is not rebased",
  );
  const values = editor.open(
    { workspace, id: "19", revision: 24, originalWkt: "LINESTRING(12 0,14 2)" },
    { entity: "line-zm" },
  );
  assert.equal(values.entity, "__proto__");
  assert.equal(editor.target.originalWkt, "LINESTRING(12 0,14 2)");
  assert.equal(
    editor.acknowledgeScene(fence(), workspace, receipt()),
    false,
    "receipt replay cannot advance twice",
  );
});

test("in-flight submitted edit keeps23 and genuinely conflicts even when live draft receives scene ACK24", async () => {
  const editor = editorAt(),
    entered = deferred(),
    release = deferred();
  editor.change("entity", "__proto__");
  const saving = editor.submit(
    async () => {
      entered.resolve();
      await release.promise;
    },
    async ({ target }) => {
      assert.equal(target.revision, 23);
      throw Error("CONFLICT: expected revision23, current24");
    },
  );
  await entered.promise;
  assert(editor.acknowledgeScene(fence(), workspace, receipt()));
  assert.equal(editor.target.revision, 24);
  release.resolve();
  await assert.rejects(saving, /CONFLICT/);
  let submitted;
  await editor.submit(
    async () => {},
    async (value) => {
      submitted = value;
    },
  );
  assert.equal(submitted.values.entity, "__proto__");
  assert.equal(submitted.target.revision, 24);
});

test("malformed, dry-run, unknown, wrong-store, unsafe and nonadjacent receipts cannot rebase drafts", () => {
  const checks = [
    null,
    {},
    { ...receipt(), dry_run: true },
    { ...receipt(), executed: false },
    receipt(23, 24, { committed: false }),
    receipt(23, 24, { kind: "external_file" }),
    receipt(23, 24, { store_id: "store-b" }),
    receipt(23, 25),
    receipt(22, 23),
    receipt(24, 25),
    receipt(23, 24, { revision_before: "023" }),
    receipt(23, 24, { revision_after: "24.0" }),
    receipt(23, 24, { revision_after: "18446744073709551616" }),
    { ...receipt(), revision: 25 },
    { ...receipt(), revision: "24" },
    receipt(23, 24, {
      revision_before: "9007199254740992",
      revision_after: "9007199254740993",
    }),
  ];
  for (const value of checks) {
    const editor = editorAt();
    assert.equal(
      editor.acknowledgeScene(fence(), workspace, value),
      false,
      JSON.stringify(value),
    );
    assert.equal(editor.target.revision, 23);
  }
  const editor = editorAt();
  assert.equal(editor.acknowledgeScene(fence(), "store-a:8", receipt()), false);
  assert.equal(
    editor.acknowledgeScene(
      fence(23, { workspace: "store-a:07" }),
      "store-a:07",
      receipt(),
    ),
    false,
  );
  assert.equal(
    editor.acknowledgeScene(
      fence(23, { expectedRevision: 22 }),
      workspace,
      receipt(),
    ),
    false,
  );
  assert.equal(
    editor.acknowledgeScene(fence(9007199254740992), workspace, receipt()),
    false,
  );
});

test("parallel local scene requests complete/ACK serially without rebasing across an unknown data mutation", async () => {
  const entered = deferred(),
    release = deferred(),
    outputs = [],
    calls = [];
  let backend = 23;
  const h = host(editorAt(), async (_, args) => {
    calls.push(args);
    if (calls.length === 1) {
      entered.resolve();
      await release.promise;
    }
    const value = receipt(backend++);
    outputs.push(value);
    return value;
  });
  const first = h.context.syncScene({ mode: "map" });
  await entered.promise;
  const second = h.context.syncScene({ mode: "globe" });
  await Promise.resolve();
  assert.equal(
    calls.length,
    1,
    "later response cannot overtake an active local RPC",
  );
  release.resolve();
  assert.equal(await first, outputs[0]);
  assert.equal(await second, outputs[1]);
  assert.equal(h.editor.target.revision, 25);
  assert.equal(calls.length, 2);
  assert(!Object.hasOwn(calls[0], "expected_revision"));
  assert(!Object.hasOwn(calls[1], "expected_revision"));
  backend++;
  await h.context.syncScene({ mode: "map" });
  assert.equal(
    h.editor.target.revision,
    25,
    "unknown data revision between known local scene commits still conflicts",
  );
});

test("shared queue recovers after rejection and preserves explicit revision/workspace guards", async () => {
  let count = 0;
  const calls = [];
  const h = host(editorAt(), async (_, args) => {
    calls.push(args);
    if (++count === 1) throw Error("CONFLICT");
    return receipt();
  });
  await assert.rejects(h.context.syncScene({ mode: "map" }, 22), /CONFLICT/);
  assert.equal(h.editor.target.revision, 23);
  const next = await h.context.syncScene({ mode: "map" }, 23);
  assert.equal(next.revision, 24);
  assert.equal(h.editor.target.revision, 24);
  assert.equal(calls[0].expected_revision, 22);
  assert.equal(calls[1].expected_revision, 23);
});

test("queued scenes retain original document fence and delayed ACK cannot retarget a new document", async () => {
  const entered = deferred(),
    release = deferred(),
    calls = [];
  const h = host(editorAt(), async (_, args) => {
    calls.push(args);
    if (calls.length === 1) {
      entered.resolve();
      await release.promise;
      return receipt();
    }
    throw Error("CONFLICT: workspace changed");
  });
  const first = h.context.syncScene({ mode: "map" });
  await entered.promise;
  const oldQueued = h.context.syncScene({ mode: "globe" });
  h.snapshot.workspace_id = "store-a:8";
  h.editor.open(
    { workspace: "store-a:8", id: "19", revision: 23, originalWkt: "" },
    { entity: "new" },
  );
  const rejected = Promise.all([
    assert.rejects(first, /workspace changed/),
    assert.rejects(oldQueued, /workspace changed/),
  ]);
  release.resolve();
  await rejected;
  assert.equal(
    calls.length,
    1,
    "queued old-document scene never reaches the Engine",
  );
  assert.equal(calls[0].expected_workspace, workspace);
  assert.equal(h.editor.target.workspace, "store-a:8");
  assert.equal(h.editor.target.revision, 23);
});

test("all main scene commits use the shared helper; agent receives that helper", () => {
  let direct = 0,
    shared = 0;
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      if (
        n.expression.getText(ast) === "call" &&
        n.arguments[0]?.getText(ast) === '"scene_sync"'
      )
        direct++;
      if (n.expression.getText(ast) === "syncScene") shared++;
    }
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.equal(direct, 1, "only shared wrapper issues the scene RPC");
  assert.equal(shared, 11);
  const agent = fs.readFileSync(
    new URL("../src/agent-view.ts", import.meta.url),
    "utf8",
  );
  assert.match(agent, /host\.syncScene\(\s*scene,\s*host\.snapshot\(\)\.revision,\s*originWorkspace,?\s*\)/);
  assert(!agent.includes('call("scene_sync"'));
});

test("actual classic agent navigation uses the shared ACK and retains its original result/snapshot update", async () => {
  const h = host(),
    scene = { mode: "map" };
  const agent = fs.readFileSync(
    new URL("../src/agent-view.ts", import.meta.url),
    "utf8",
  );
  h.context.navigator = {};
  h.context.agentHost = {
    view: {
      ready: Promise.resolve(),
      diagnostics: () => ({}),
      requestRender() {},
      viewer: { render() {} },
      setBearing() {},
      gis: { descriptors: [] },
      host: { clientWidth: 320, clientHeight: 240 },
      scene: { globe: { show: true, tilesLoaded: true } },
      displayLayer: { diagnostics: {} },
    },
    snapshot: () => h.snapshot,
    captureScene: () => scene,
    mode: () => "map",
    syncScene: h.context.syncScene,
  };
  vm.runInContext(
    transpile(agent).replace("export function", "function"),
    h.context,
  );
  const result = await vm.runInContext(
    'createAgentView(agentHost)("view_navigate", {action:"north_up"})',
    h.context,
  );
  assert.equal(result.revision, 24);
  assert.equal(result.scene, scene);
  assert.equal(h.snapshot.scene, scene);
  assert.equal(h.editor.target.revision, 24);
});

test("actual agent cannot apply an old scene ACK to a reopened same-store workspace", async () => {
  const entered = deferred(),
    release = deferred();
  const h = host(editorAt(), async () => {
    entered.resolve();
    await release.promise;
    return receipt();
  });
  const oldScene = { mode: "map" },
    newScene = { mode: "globe" };
  h.context.navigator = {};
  h.context.agentHost = {
    view: {
      ready: Promise.resolve(),
      diagnostics: () => ({}),
      requestRender() {},
      viewer: { render() {} },
      setBearing() {},
      gis: { descriptors: [] },
      host: { clientWidth: 320, clientHeight: 240 },
      scene: { globe: { show: true, tilesLoaded: true } },
      displayLayer: { diagnostics: {} },
    },
    snapshot: () => h.snapshot,
    captureScene: () => oldScene,
    mode: () => "map",
    syncScene: h.context.syncScene,
  };
  const source = fs.readFileSync(
    new URL("../src/agent-view.ts", import.meta.url),
    "utf8",
  );
  vm.runInContext(
    transpile(source).replace("export function", "function"),
    h.context,
  );
  const navigation = vm.runInContext(
    'createAgentView(agentHost)("view_navigate", {action:"north_up"})',
    h.context,
  );
  const rejected = assert.rejects(
    navigation,
    /workspace changed before scene acknowledgement/,
  );
  await entered.promise;
  Object.assign(h.snapshot, {
    workspace_id: "store-a:8",
    revision: 1,
    scene: newScene,
  });
  h.editor.open(
    { workspace: "store-a:8", id: "19", revision: 1, originalWkt: "" },
    { entity: "new document" },
  );
  release.resolve();
  await rejected;
  assert.equal(h.snapshot.revision, 1);
  assert.equal(h.snapshot.scene, newScene);
  assert.equal(h.editor.target.workspace, "store-a:8");
  assert.equal(h.editor.target.revision, 1);
});

test("actual classic navigation captures its document before readiness and rejects a replacement without a scene RPC", async () => {
  const h = host(), entered = deferred(), gate = deferred(); let writes = 0;
  const agent = fs.readFileSync(new URL("../src/agent-view.ts", import.meta.url), "utf8");
  h.context.navigator = {};
  h.context.agentHost = { view: { ready: gate.promise }, snapshot: () => h.snapshot,
    syncScene: async () => { writes++; } };
  vm.runInContext(transpile(agent).replace("export function", "function"), h.context);
  const request = vm.runInContext('createAgentView(agentHost)("view_navigate", {action:"north_up"})', h.context);
  h.snapshot.workspace_id = "store-a:8"; h.snapshot.revision = 1; const scene = { mode: "globe", marker: "new-document" }; h.snapshot.scene = scene;
  gate.resolve(); await assert.rejects(request, /CONFLICT: workspace changed before navigation/);
  assert.equal(writes, 0); assert.equal(h.snapshot.revision, 1); assert.equal(h.snapshot.scene, scene);
});

test("actual classic GIS-fit navigation retains original workspace through later awaited GIS work", async () => {
  const h = host(), entered = deferred(), gate = deferred(); let writes = 0;
  const agent = fs.readFileSync(new URL("../src/agent-view.ts", import.meta.url), "utf8");
  h.context.navigator = {};
  h.context.agentHost = { view: { ready: Promise.resolve(), diagnostics: () => ({}), requestRender() {}, viewer: { render() {} },
      gis: { descriptors: [{ id: "layer", enabled: true }], sync: async () => { entered.resolve(); await gate.promise; }, loaded: new Map([["layer", {}]]) } },
    snapshot: () => h.snapshot, mode: () => "map", captureScene: () => ({ mode: "map" }), fitGisLayer: async () => {},
    syncScene: async (...args) => { writes++; assert.equal(args[2], workspace); return h.context.syncScene(...args); } };
  vm.runInContext(transpile(agent).replace("export function", "function"), h.context);
  const request = vm.runInContext('createAgentView(agentHost)("view_navigate", {action:"fit_layer",layer_id:"layer"})', h.context); await entered.promise;
  h.snapshot.workspace_id = "store-a:8"; h.snapshot.revision = 1; const scene = { mode: "globe", marker: "new-document" }; h.snapshot.scene = scene;
  gate.resolve(); await assert.rejects(request, /CONFLICT: workspace changed before scene synchronization/);
  assert.equal(writes, 1); assert.equal(h.snapshot.revision, 1); assert.equal(h.snapshot.scene, scene);
});
