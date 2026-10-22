import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
async function load(name) {
  const source = fs.readFileSync(
    new URL(`../src/${name}.ts`, import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );
}
const { EditorController } = await load("editor-controller");
const { WorkspaceController } = await load("workspace-controller");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const target = (workspace = "A", id = "1", revision = 1) => ({
  workspace,
  id,
  revision,
  originalWkt: "",
});

{
  const editor = new EditorController(),
    entered = deferred(),
    parsed = deferred();
  editor.open(target(), {
    note: "saved",
    time: "instant",
    category: "original",
  });
  editor.change("note", "submitted");
  let received;
  const saving = editor.submit(
    async () => {
      entered.resolve();
      await parsed.promise;
      return 123.456;
    },
    async (submission, time) => {
      received = { ...submission, time };
    },
  );
  await entered.promise;
  const values = editor.open(target("A", "1", 2), {
    note: "saved",
    time: "instant",
    category: "updated",
  });
  assert.equal(values.note, "submitted", "refresh must retain the dirty note");
  assert.equal(
    values.category,
    "updated",
    "untouched fields should receive backend refreshes",
  );
  editor.open(target("A", "2", 2), { note: "other record" });
  parsed.resolve();
  await saving;
  assert.equal(
    received.target.id,
    "1",
    "selection changes must not retarget an in-flight edit",
  );
  assert.equal(received.target.revision, 1);
  assert.equal(received.values.note, "submitted");
  assert.equal(received.time, 123.456);
}
{
  const editor = new EditorController(),
    entered = deferred(),
    parsed = deferred();
  editor.open(target(), { note: "saved" });
  editor.change("note", "submitted");
  let writes = 0;
  const saving = editor.submit(
    async () => {
      entered.resolve();
      await parsed.promise;
    },
    async () => {
      writes++;
    },
  );
  await entered.promise;
  editor.open(target("B"), { note: "different workspace" });
  parsed.resolve();
  await assert.rejects(saving, /workspace changed/);
  assert.equal(writes, 0);
}
{
  const editor = new EditorController(),
    entered = deferred(),
    commit = deferred();
  editor.open(target(), { note: "saved" });
  editor.change("note", "first draft");
  const saving = editor.submit(
    async () => 0,
    async () => {
      entered.resolve();
      await commit.promise;
    },
  );
  await entered.promise;
  editor.change("note", "newer draft");
  commit.resolve();
  await saving;
  assert.equal(
    editor.open(target(), { note: "first draft" }).note,
    "newer draft",
  );
  await assert.rejects(
    editor.submit(
      async () => 0,
      async () => {
        throw Error("write failed");
      },
    ),
    /write failed/,
  );
  assert.equal(
    editor.open(target(), { note: "first draft" }).note,
    "newer draft",
  );
}
{
  let path = null,
    writes = [],
    choices = 0,
    autosaves = 0,
    closes = 0,
    dirty = true;
  const editorWork = deferred(),
    order = [];
  const workspace = new WorkspaceController({
    settle: async () => {
      await editorWork.promise;
      order.push("settled");
    },
    status: async () => ({ dirty, auto_save_unsaved: true }),
    autosave: async () => {
      autosaves++;
      order.push("autosaved");
    },
    source: () => path,
    identity: () => "A",
    chooseSavePath: async () => {
      choices++;
      return "study";
    },
    persist: async (value) => {
      writes.push(value);
    },
    saved: (value) => {
      path = value;
      dirty = false;
    },
    confirmUnsaved: async () => {
      throw Error("automatic save must not prompt");
    },
  });
  const a = workspace.save(),
    b = workspace.save();
  assert.equal(a, b, "concurrent Save requests should join one operation");
  assert.deepEqual(writes, []);
  editorWork.resolve();
  await a;
  assert.equal(choices, 1);
  assert.deepEqual(writes, ["study.chronoscope"]);
  dirty = true;
  const autoA = workspace.autosave(),
    autoB = workspace.autosave();
  assert.equal(autoA, autoB);
  await autoA;
  assert.equal(autosaves, 1);
  const closeA = workspace.close(async () => {
    closes++;
    order.push("closed");
  });
  const closeB = workspace.close(async () => {
    closes++;
  });
  assert.equal(closeA, closeB);
  await closeA;
  assert.equal(closes, 1);
  assert.equal(order.at(-2), "autosaved");
  assert.equal(order.at(-1), "closed");
}
{
  let fail = true,
    exits = 0;
  const workspace = new WorkspaceController({
    settle: async () => {},
    status: async () => ({ dirty: true, auto_save_unsaved: true }),
    autosave: async () => {
      if (fail) throw Error("disk full");
    },
    source: () => null,
    identity: () => "A",
    chooseSavePath: async () => null,
    persist: async () => {},
    saved: () => {},
    confirmUnsaved: async () => false,
  });
  await assert.rejects(
    workspace.close(async () => {
      exits++;
    }),
    /disk full/,
  );
  assert.equal(exits, 0);
  fail = false;
  await workspace.close(async () => {
    exits++;
  });
  assert.equal(exits, 1);
  assert.equal(
    await workspace.save(),
    false,
    "cancelled Save As must not report success",
  );
}
{
  let document = "A",
    writes = 0;
  const picker = deferred(),
    entered = deferred();
  const workspace = new WorkspaceController({
    settle: async () => {},
    status: async () => ({ dirty: false, auto_save_unsaved: true }),
    autosave: async () => {},
    source: () => null,
    identity: () => document,
    chooseSavePath: async () => {
      entered.resolve();
      return picker.promise;
    },
    persist: async () => {
      writes++;
    },
    saved: () => {},
    confirmUnsaved: async () => false,
  });
  const save = workspace.save();
  await entered.promise;
  document = "B";
  picker.resolve("study.chronoscope");
  await assert.rejects(save, /workspace changed/);
  assert.equal(writes, 0);
}
console.log(
  "PASS editor draft refresh, captured submissions, workspace isolation, save/close joins and failed-save retries",
);
