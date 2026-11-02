import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
async function load(file) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${file}.ts`, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "drop-fixtures",
        setup(b) {
          b.onResolve(
            { filter: /^(\.\/bridge|\.\/types|@tauri-apps\/api\/webview)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "./bridge"
                ? `export const native=true;
export class CommandError extends Error { constructor(value) { super(value?.message || String(value)); } }
let result;
export const call=async(command,args)=>{
 if(command==='file_probe' && args.metadata_only) return {kind:'data',format:null,allowed:true,bytes:0,requires_confirmation:false,limit_bytes:2147483648};
 if(command==='job_start'){result=await globalThis.__dropTest.call(args.command,args.arguments);return {job_id:'test-job'};}
 if(command==='job_status') return {status:'completed'};
 if(command==='job_result') return {result};
 if(command==='job_release'||command==='job_cancel') return {};
 return globalThis.__dropTest.call(command,args);
};`
                : args.path === "./types"
                  ? "export const escape=s=>s;"
                  : "export const getCurrentWebview=()=>({onDragDropEvent:async handler=>{globalThis.__dropTest.handler=handler;return ()=>globalThis.__dropTest.unlistened++;}});",
          }));
        },
      },
    ],
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}
const { DroppedFiles } = await load("dropped-files");
function fixture() {
  let workspace = "A",
    available = true;
  const shown = [],
    opened = [],
    displayed = [],
    notices = [],
    workspaces = [];
  const importer = {
    showFile(navigation, body) {
      shown.push({ navigation, body });
      return { querySelectorAll: () => [], querySelector: () => null };
    },
    async open(path, delimiter, layer, append, navigation) {
      opened.push({ path, delimiter, append, navigation });
    },
    dismiss() {},
  };
  globalThis.__dropTest = {
    call: async (_, { path }) =>
      path.endsWith(".glb")
        ? { kind: "gis", format: "glb" }
        : path.endsWith(".geojson")
          ? { kind: "gis", format: "geojson" }
          : path.endsWith(".chronoscope")
            ? { kind: "workspace" }
            : { kind: "data" },
  };
  const queue = new DroppedFiles({
    importer,
    workspace: () => workspace,
    available: () => available,
    settle: async () => {},
    pause() {},
    openWorkspace: async (path) => workspaces.push(path),
    display: async (...args) => displayed.push(args),
    notice: (text) => notices.push(text),
  });
  return {
    queue,
    shown,
    opened,
    displayed,
    notices,
    workspaces,
    setWorkspace: (value) => (workspace = value),
    block: () => (available = false),
  };
}
test("drop batches default to append, deduplicate paths and never reopen a completed file for import", async () => {
  const f = fixture();
  await f.queue.open(["a.csv", "b.csv", "a.csv"]);
  assert.equal(f.opened[0].append, true);
  assert.equal(f.opened[0].navigation.items().length, 2);
  await f.opened[0].navigation.imported("A");
  assert.equal(f.opened[1].path, "b.csv");
  await f.opened[1].navigation.imported("A");
  await f.shown.at(-1).navigation.navigate(0);
  assert.match(f.shown.at(-1).body, /Imported/);
  assert.equal(f.opened.length, 2);
});
test("display-only sources load directly; dual-purpose files retain an explicit choice", async () => {
  const f = fixture();
  await f.queue.open(["box.glb", "events.geojson", "later.csv"]);
  assert.deepEqual(f.displayed, [["box.glb", "glb"]]);
  const n = f.shown.at(-1).navigation;
  assert.equal(n.index, 1);
  assert.equal(typeof n.display, "function");
  await n.display();
  assert.deepEqual(f.displayed[1], ["events.geojson", "geojson"]);
  assert.equal(f.opened[0].path, "later.csv");
  await f.opened[0].navigation.navigate(1);
  assert.equal(
    f.shown.at(-1).navigation.display,
    undefined,
    "Completed GIS pages cannot add a duplicate reference layer",
  );
});
test("busy dialogs and oversized drops are refused without processing paths", async () => {
  const f = fixture();
  f.block();
  await f.queue.open(["a.csv"]);
  assert.equal(f.opened.length, 0);
  assert.match(f.notices[0], /Finish or close/);
  const g = fixture();
  await g.queue.open(Array.from({ length: 257 }, (_, i) => `${i}.csv`));
  assert.equal(g.opened.length, 0);
  assert.match(g.notices[0], /256/);
});
test("workspace drops use the ordinary open guard, while mixed batches cannot switch projects", async () => {
  const f = fixture();
  await f.queue.open(["a.chronoscope"]);
  assert.deepEqual(f.workspaces, ["a.chronoscope"], JSON.stringify(f.notices));
  const g = fixture();
  await g.queue.open(["a.chronoscope", "b.csv"]);
  assert.deepEqual(g.workspaces, []);
  assert.match(g.shown.at(-1).body, /open separately/);
});
test("stale classification from a closed batch cannot affect a newer batch", async () => {
  const f = fixture();
  let resolve;
  globalThis.__dropTest.call = () => new Promise((r) => (resolve = r));
  const old = f.queue.open(["old.glb"]);
  await new Promise((r) => setImmediate(r));
  f.shown.at(-1).navigation.closed();
  globalThis.__dropTest.call = async () => ({ kind: "data" });
  await f.queue.open(["new.csv"]);
  resolve({ kind: "gis", format: "glb" });
  await old;
  assert.deepEqual(f.displayed, []);
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].path, "new.csv");
});
test("workspace changes invalidate pending drops before they can import or display", async () => {
  const f = fixture();
  globalThis.__dropTest.call = async () => {
    f.setWorkspace("B");
    return { kind: "data" };
  };
  await f.queue.open(["a.csv"]);
  assert.equal(f.opened.length, 0);
  assert.match(f.notices[0], /workspace changed/);
});
test("native file-drop events show feedback, pass all paths once, and dispose their listener", async () => {
  const document = new EventTarget(),
    window = new EventTarget();
  let hint;
  document.createElement = () =>
    (hint = {
      hidden: false,
      setAttribute() {},
      remove() {
        this.removed = true;
      },
    });
  document.body = { append() {} };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.__dropTest = { unlistened: 0 };
  try {
    const { installFileDrops } = await load("file-drop");
    const received = [];
    await installFileDrops(
      async (paths) => received.push(paths),
      (message) => assert.fail(message),
    );
    const handler = globalThis.__dropTest.handler;
    handler({ payload: { type: "enter", paths: ["a.csv", "b.kml"] } });
    assert.equal(hint.hidden, false);
    handler({ payload: { type: "drop", paths: ["a.csv", "b.kml"] } });
    assert.equal(hint.hidden, true);
    assert.deepEqual(received, [["a.csv", "b.kml"]]);
    window.dispatchEvent(new Event("pagehide"));
    assert.equal(globalThis.__dropTest.unlistened, 1);
    assert.equal(hint.removed, true);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("a successful import follows its returned workspace identity but never an unrelated one", async () => {
  const f = fixture();
  await f.queue.open(["a.csv", "b.csv"]);
  f.setWorkspace("imported-store");
  await f.opened[0].navigation.imported("imported-store");
  assert.equal(f.opened[1].path, "b.csv");
  f.setWorkspace("unrelated-workspace");
  await f.opened[1].navigation.imported("another-import-store");
  assert.match(f.notices.at(-1), /workspace changed/);
  assert.equal(f.opened.length, 2);
});
