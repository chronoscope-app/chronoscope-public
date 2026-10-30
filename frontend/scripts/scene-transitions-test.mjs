import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/scene-transitions.ts", import.meta.url),
  "utf8",
);
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
const { SceneTransitions } = await import(
  "data:text/javascript;base64," +
    Buffer.from(transpile(source)).toString("base64")
);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("direct command claims an event-first echo and late echo cannot undo a later Map commit", async () => {
  const transitions = new SceneTransitions(),
    backend = deferred(),
    entered = deferred();
  const applied = [];
  const direct = transitions.command(async (commit) => {
    entered.resolve();
    await backend.promise;
    await commit(41, async () => {
      applied.push("direct Globe");
    });
  });
  await entered.promise;
  const echo = transitions.restore(41, async () => {
    applied.push("echo Globe");
  });
  const map = transitions.enqueue(async () => {
    applied.push("Map persisted");
  });
  backend.resolve();
  await Promise.all([direct, echo, map]);
  await transitions.restore(41, async () => {
    applied.push("delayed Globe");
  });
  assert.deepEqual(applied, ["direct Globe", "Map persisted"]);
});

test("already-running external echo and direct restore at its revision share one application", async () => {
  const transitions = new SceneTransitions(),
    gate = deferred(),
    entered = deferred();
  const applied = [];
  const echo = transitions.restore(50, async () => {
    entered.resolve();
    await gate.promise;
    applied.push("external");
  });
  await entered.promise;
  const direct = transitions.restore(50, async () => {
    applied.push("direct duplicate");
  });
  assert.equal(direct, echo);
  gate.resolve();
  await Promise.all([echo, direct]);
  assert.deepEqual(applied, ["external"]);
});

test("direct-first completed restore deduplicates echo, but explicit new revision restores again", async () => {
  const transitions = new SceneTransitions(),
    applied = [];
  await transitions.command(async (commit) =>
    commit(60, async () => {
      applied.push("saved view");
    }),
  );
  await transitions.restore(60, async () => {
    applied.push("duplicate");
  });
  await transitions.restore(61, async () => {
    applied.push("same saved view, new commit");
  });
  await transitions.restore(62, async () => {
    applied.push("open new document");
  });
  await transitions.restore(63, async () => {
    applied.push("undo");
  });
  assert.deepEqual(applied, [
    "saved view",
    "same saved view, new commit",
    "open new document",
    "undo",
  ]);
});

test("failed restore is retryable and rejected commands do not poison later transitions", async () => {
  const transitions = new SceneTransitions(),
    applied = [];
  await assert.rejects(
    transitions.restore(70, async () => {
      throw Error("restore failed");
    }),
    /restore failed/,
  );
  await transitions.restore(70, async () => {
    applied.push("retry");
  });
  await assert.rejects(
    transitions.command(async () => {
      throw Error("command failed");
    }),
    /command failed/,
  );
  await transitions.enqueue(async () => {
    applied.push("Map persisted");
  });
  await transitions.restore(71, async () => {
    applied.push("external redo");
  });
  assert.deepEqual(applied, ["retry", "Map persisted", "external redo"]);
});

test("idle flushes a pending event batch and drains command work registered before its response", async () => {
  const transitions = new SceneTransitions(),
    backend = deferred(),
    entered = deferred();
  const applied = [];
  const direct = transitions.command(async (commit) => {
    entered.resolve();
    await backend.promise;
    await commit(80, async () => {
      applied.push("local restore");
    });
  });
  await entered.promise;
  let pending = true,
    finished = false;
  const idle = transitions
    .idle(async () => {
      if (pending) {
        pending = false;
        await transitions.restore(80, async () => {
          applied.push("echo");
        });
      }
    })
    .then(() => {
      finished = true;
    });
  await Promise.resolve();
  assert.equal(finished, false);
  backend.resolve();
  await Promise.all([idle, direct]);
  assert.deepEqual(applied, ["local restore"]);
});

test("idle includes a registered file-open command and work appended while draining", async () => {
  const transitions = new SceneTransitions(),
    opened = deferred(),
    applied = [];
  transitions.command(async (commit) => {
    await opened.promise;
    await commit(90, async () => {
      applied.push("opened UI");
    });
    transitions.enqueue(async () => {
      applied.push("follow-up");
    });
  });
  let finished = false;
  const idle = transitions.idle().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  opened.resolve();
  await idle;
  assert.deepEqual(applied, ["opened UI", "follow-up"]);
});

// Execute the actual main.ts mode handler, not a test copy of its policy.
function toolbar() {
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf(
    "const sceneTransitions = new SceneTransitions();",
  );
  const end = main.indexOf('on("#sync-views"', start);
  assert(start > 0 && end > start);
  const calls = [],
    buttons = ["space-time", "map", "globe"].map((mode) => ({
      dataset: { view: mode },
      classList: { toggle() {} },
      addEventListener(_, handler) {
        this.click = handler;
      },
    }));
  const context = vm.createContext({
    SceneTransitions,
    mode: "globe",
    restoringScene: true,
    snapshot: {},
    globeElevationGeneration: 0,
    terrainInfo: null,
    lastRaster: null,
    welcome: { dismiss() {} },
    document: { querySelectorAll: () => buttons },
    view: {
      resourceLimits: { maxPoints: 100000, arcVertices: 200000 },
      setMode: (mode, remember) => calls.push(["apply", mode, remember]),
      visibleDataBounds: () => null,
      bounds: [0, 0, 1, 1],
    },
    cancelViewportRefresh() {},
    cancelMap: async () => {},
    updateNavigationControls() {},
    layers() {},
    captureScene: () => ({ mode: context.mode }),
    call: async (command, args) => {
      calls.push([command, args.scene.mode]);
    },
    refresh: async () => {
      calls.push(["refresh", context.mode]);
    },
    refreshViewportData: async () => {},
    scheduleInteraction() {},
    rebuildTerrain: async () => {},
    loadRasters: async () => {},
    toast: (error) => {
      throw Error(error);
    },
  });
  // Scene RPC/receipt policy has separate actual-source tests; this harness
  // retains controlled transport for transition ordering and rejection tests.
  context.syncScene = (scene, expectedRevision) => context.call("scene_sync", {
    scene,
    ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
  });
  vm.runInContext(transpile(main.slice(start, end)), context);
  return {
    context,
    calls,
    click: (mode) =>
      buttons.find((button) => button.dataset.view === mode).click(),
    transitions: vm.runInContext("sceneTransitions", context),
    idle: () => vm.runInContext("viewModeWork", context),
  };
}

test("actual toolbar click during restore waits, then persists Map despite restoring flag", async () => {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  const restore = ui.transitions.restore(100, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  ui.click("map");
  await Promise.resolve();
  assert.deepEqual(ui.calls, []);
  gate.resolve();
  await Promise.all([restore, ui.idle()]);
  assert.equal(ui.context.mode, "map");
  assert.deepEqual(ui.calls.slice(0, 2), [
    ["apply", "map", true],
    ["scene_sync", "map"],
  ]);
});

test("rapid queued toolbar intents cancel obsolete modes before they can mutate or persist", async () => {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  const restore = ui.transitions.restore(110, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  ui.click("space-time");
  ui.click("globe");
  ui.click("map");
  gate.resolve();
  await Promise.all([restore, ui.idle()]);
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "scene_sync"),
    [["scene_sync", "map"]],
  );
  assert.equal(ui.context.mode, "map");
});

test("started toolbar command completes before newest mode and skips stale refresh", async () => {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  ui.context.call = async (command, args) => {
    ui.calls.push([command, args.scene.mode]);
    if (args.scene.mode === "space-time") {
      entered.resolve();
      await gate.promise;
    }
  };
  ui.click("space-time");
  await entered.promise;
  ui.click("globe");
  ui.click("map");
  gate.resolve();
  await ui.idle();
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "scene_sync"),
    [
      ["scene_sync", "space-time"],
      ["scene_sync", "map"],
    ],
  );
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "refresh"),
    [["refresh", "map"]],
  );
  assert.equal(ui.context.mode, "map");
});

function engineBatch(transitions, engineScene) {
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("let eventTimer:");
  const end = main.indexOf("let desktopRequests:", start);
  assert(start > 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    sceneTransitions: transitions,
    setTimeout,
    clearTimeout,
    snapshot: { revision: 999, scene: engineScene },
    filterIntent: { idle: async () => {} },
    refresh: async () => {
      calls.push("refresh");
      context.snapshot = { revision: 999, scene: engineScene };
    },
    applyRestoredScene: async (scene) => {
      calls.push(`restore ${scene.mode}`);
    },
    toast: (error) => {
      throw Error(error);
    },
  });
  vm.runInContext(transpile(main.slice(start, end)), context);
  return {
    context,
    calls,
    pending: (restoreRevision, newestRevision) =>
      vm.runInContext(
        `
      pendingRestoreRevision = ${restoreRevision}; pendingEngineRevision = ${newestRevision};
      restorePending = true; eventTimer = setTimeout(() => {}, 5000);
    `,
        context,
      ),
    idle: () => vm.runInContext("drainSceneEvents()", context),
  };
}

test("actual event batch deduplicates a delayed restore but still refreshes newer coalesced changes", async () => {
  const transitions = new SceneTransitions();
  await transitions.command(async (commit) => commit(120, async () => {}));
  const batch = engineBatch(transitions, { mode: "map" });
  batch.pending(120, 121);
  await batch.idle();
  assert.deepEqual(batch.calls, ["refresh"]);
  batch.pending(122, 122);
  await batch.idle();
  assert.deepEqual(batch.calls, ["refresh", "refresh", "restore map"]);
});

test("actual readiness drain follows GUI work appended during an earlier event reconciliation", async () => {
  const transitions = new SceneTransitions(),
    gate = deferred(),
    entered = deferred();
  const batch = engineBatch(transitions, { mode: "globe" });
  batch.context.filterIntent.idle = async () => {
    entered.resolve();
    await gate.promise;
  };
  batch.pending(130, 130);
  const idle = batch.idle();
  await entered.promise;
  vm.runInContext(
    "guiSync = guiSync.then(() => { snapshot.followup = true; });",
    batch.context,
  );
  gate.resolve();
  await idle;
  assert.equal(batch.context.snapshot.followup, true);
});

test("actual WorkspaceFiles host keeps open command and opened callback ahead of a subsequent Map click", async () => {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("let fileSceneCommit:");
  const end = main.indexOf("const welcome =", start);
  assert(start > 0 && end > start);
  Object.assign(ui.context, {
    WorkspaceFiles: class {
      constructor(host) {
        this.host = host;
      }
    },
    guardUnsaved: async () => true,
    openGisFile: async () => {},
    task: async (_, work) => work(),
    restoreScene: () => {
      throw Error("must use the command's inline commit");
    },
    applyRestoredScene: async (scene) => {
      ui.context.mode = scene.mode;
      ui.calls.push(["opened", scene.mode]);
    },
    welcome: { dismiss() {}, remember() {} },
  });
  vm.runInContext(transpile(main.slice(start, end)), ui.context);
  const host = vm.runInContext("workspaceFiles.host", ui.context);
  const opening = host.task("Opening workspace", async () => {
    entered.resolve();
    await gate.promise;
    await host.opened("replacement.chronoscope", {
      revision: 140,
      scene: { mode: "globe" },
    });
  });
  await entered.promise;
  ui.click("map");
  assert.deepEqual(ui.calls, []);
  gate.resolve();
  await Promise.all([opening, ui.idle()]);
  assert.equal(ui.context.projectPath, "replacement.chronoscope");
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "opened" || name === "scene_sync"),
    [
      ["opened", "globe"],
      ["scene_sync", "map"],
    ],
  );
  assert.equal(ui.context.mode, "map");
});

test("actual event handler drops applied echoes before canceling new navigation but accepts unread external restores", async () => {
  const transitions = new SceneTransitions();
  await transitions.command(async (commit) => commit(150, async () => {}));
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("const restoresScene = [");
  const end = main.indexOf(
    "eventTimer = setTimeout(flushChanges, 180);",
    start,
  );
  assert(start > 0 && end > start);
  const calls = [],
    syncTimer = {};
  const context = vm.createContext({
    sceneTransitions: transitions,
    snapshot: { revision: 999 },
    syncTimer,
    eventTimer: undefined,
    pendingEngineRevision: 0,
    pendingRestoreRevision: undefined,
    restorePending: false,
    themePending: false,
    terrainPending: false,
    fitTerrainPending: false,
    terrainLoadGeneration: 0,
    capabilities: {},
    cancelMap: async () => {
      calls.push("cancelMap");
    },
    clearTimeout: (timer) => {
      calls.push(timer === syncTimer ? "cancelSync" : "cancelBatch");
    },
    setTimeout: (_, delay) => {
      calls.push(["batch", delay]);
      return {};
    },
    flushChanges() {},
    cancelSceneSync: () => {
      calls.push("cancelSync");
    },
  });
  const handler = vm.runInContext(
    transpile(
      `(event: any) => { ${main.slice(start, end)} eventTimer = setTimeout(flushChanges, 180); }`,
    ),
    context,
  );
  handler({ command: "open", revision: 150 });
  assert.deepEqual(calls, []);
  assert.equal(context.pendingRestoreRevision, undefined);
  // Reading revision999 is not proof that an external revision151 UI restore
  // ran. Only the transition coordinator's completed application can dedupe it.
  handler({ command: "restore_view", revision: 151 });
  assert.equal(context.restorePending, true);
  assert.equal(context.pendingRestoreRevision, 151);
  assert(calls.includes("cancelSync"));
  handler({ command: "open", revision: 152 });
  assert.equal(context.pendingRestoreRevision, 152);
  assert(calls.includes("cancelMap"));
});

test("actual workspace Save settles a prior restore and queued Map before capturing its scene", async () => {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  const controller = fs.readFileSync(
    new URL("../src/workspace-controller.ts", import.meta.url),
    "utf8",
  );
  const { WorkspaceController } = await import(
    "data:text/javascript;base64," +
      Buffer.from(transpile(controller)).toString("base64")
  );
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("const workspace = new WorkspaceController({");
  const end = main.indexOf("const input =", start);
  assert(start > 0 && end > start);
  Object.assign(ui.context, {
    WorkspaceController,
    projectPath: "study.chronoscope",
    editor: { idle: async () => {} },
    filterIntent: { flush: async () => {} },
    viewsPanel: { idle: async () => {} },
    sceneIdle: () => ui.transitions.idle(),
    task: async (_, work) => work(),
    confirmUnsaved: async () => false,
    welcome: { dismiss() {}, remember() {} },
    toast: (message, error) => {
      if (error) throw Error(message);
    },
  });
  ui.context.snapshot.workspace_id = "same-store:2";
  vm.runInContext(transpile(main.slice(start, end)), ui.context);
  const workspace = vm.runInContext("workspace", ui.context);
  const restoring = ui.transitions.restore(160, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  ui.click("map");
  let finished = false;
  const saving = workspace.save().then((result) => {
    finished = true;
    return result;
  });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  assert.equal(
    ui.calls.some(([name]) => name === "save"),
    false,
  );
  gate.resolve();
  assert.equal(await saving, true);
  await restoring;
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "save" || name === "scene_sync"),
    [
      ["scene_sync", "map"],
      ["save", "map"],
    ],
  );
});

for (const kind of ["view_navigate", "capture-map", "capture-app", "capture-si"]) {
  test(`actual attached ${kind} waits for prior restore and queued Map outside the transition queue`, async () => {
    const ui = toolbar(),
      gate = deferred(),
      entered = deferred();
    const main = fs.readFileSync(
      new URL("../src/main.ts", import.meta.url),
      "utf8",
    );
    const start = main.indexOf(
      "if (eventTimer) flushChanges();",
      main.indexOf("let desktopRequests:"),
    );
    const end = main.indexOf('if (event.command === "preferences")', start);
    assert(start > 0 && end > start);
    // This fragment is the actual attached-request consumer, including its
    // filter/readiness barrier, expiry check, navigation/capture and response.
    const body = main.slice(start, end).replace(/\}\s*$/, "");
    const responses = [],
      consumed = [];
    Object.assign(ui.context, {
      desktopRequests: Promise.resolve(),
      eventTimer: undefined,
      filterIntent: { flush: async () => {} },
      guiSync: Promise.resolve(),
      sceneIdle: () => ui.transitions.idle(),
      tab: "views",
      syncTimer: undefined,
      clearTimeout() {},
      cancelSceneSync() {},
      liveViewRequest: async () => {
        consumed.push(ui.context.mode);
        return { mode: ui.context.mode };
      },
      captureAppWindow: async () => {
        consumed.push(ui.context.mode);
        return `data:app/${ui.context.mode}`;
      },
    });
    const captureScopes = [];
    ui.context.view.captureConsistent = async (capture, identity) => {
      captureScopes.push(identity());
      return capture();
    };
    ui.context.view.requestRender = () => {};
    ui.context.view.screenshot = async () => {
      consumed.push(ui.context.mode);
      return `data:map/${ui.context.mode}`;
    };
    const call = ui.context.call;
    ui.context.call = async (name, args) => {
      if (name === "view_response") responses.push(args);
      else return call(name, args);
    };
    const handler = vm.runInContext(
      transpile(`(event: any) => { ${body} }`),
      ui.context,
    );
    const restoring = ui.transitions.restore(170, async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    ui.click("map");
    handler({
      kind: kind.startsWith("capture") ? "capture" : kind,
      request_id: kind,
      expires_at_ms: Date.now() + 5000,
      arguments: {
        target: kind === "capture-map" ? "map" : "app",
        window: kind === "capture-si" ? "si-chat" : "main",
      },
    });
    await new Promise(setImmediate);
    assert.deepEqual(consumed, []);
    gate.resolve();
    await Promise.all([
      restoring,
      vm.runInContext("desktopRequests", ui.context),
    ]);
    assert.deepEqual(consumed, ["map"]);
    assert.equal(captureScopes.length, kind === "capture-app" ? 1 : 0,
      "only main whole-app capture uses the shared renderer coherence hook");
    if (captureScopes.length) assert.equal(captureScopes[0].revision, ui.context.snapshot.revision);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].error, undefined);
    if (kind === "view_navigate") assert.equal(responses[0].result.mode, "map");
    else
      assert.equal(
        responses[0].data_url,
        `data:${kind === "capture-map" ? "map" : "app"}/map`,
      );
  });
}

function originalMainNode(predicate, within) {
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
  let found;
  const visit = (node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(within ? originalMainNode(within).node : ast);
  assert(found, "actual main consumer must exist");
  return { node: found, text: found.getText(ast) };
}

function originalAction(variable, property) {
  const { node } = originalMainNode(
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText() === variable,
  );
  const object = ts.isObjectLiteralExpression(node.initializer)
    ? node.initializer
    : node.initializer.arguments.find(ts.isObjectLiteralExpression);
  const action = object.properties.find(
    (entry) => entry.name?.getText() === property,
  );
  assert(action && ts.isPropertyAssignment(action));
  return action.initializer.getText();
}

function originalHandler(selector, event = "click") {
  const { node } = originalMainNode(
    (node) =>
      ts.isCallExpression(node) &&
      ((node.expression.getText() === "on" &&
        node.arguments[0]?.text === selector) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "addEventListener" &&
          node.expression.expression.getText() === `$("${selector}")` &&
          node.arguments[0]?.text === event)),
  );
  return node.arguments[1].getText();
}

async function blockedConsumer(prepare, { queueMap = true } = {}) {
  const ui = toolbar(),
    gate = deferred(),
    entered = deferred();
  Object.assign(ui.context, {
    sceneIdle: () => ui.transitions.idle(),
    filterIntent: { flush: async () => {} },
    closeModal() {},
    toast(message, error) {
      if (error) throw Error(message);
    },
    input: () => "Current view",
    snapshot: {
      workspace_id: "same-store:2",
      revision: 1,
      scene: { mode: "globe" },
    },
  });
  const consume = prepare(ui);
  const restoring = ui.transitions.restore(180, async () => {
    entered.resolve();
    await gate.promise;
    if (!queueMap) ui.context.mode = "map";
  });
  await entered.promise;
  if (queueMap) ui.click("map");
  let completed = false;
  const consuming = Promise.resolve(consume()).then(() => {
    completed = true;
  });
  await new Promise(setImmediate);
  assert.equal(completed, false, "consumer must wait for prior restoration");
  assert.deepEqual(
    ui.calls,
    [],
    "no intermediate pose may be read or persisted",
  );
  gate.resolve();
  await Promise.all([restoring, consuming]);
  return ui;
}

test("actual Sync views waits for a restore even without a new toolbar promise", async () => {
  const ui = await blockedConsumer(
    (ui) => {
      ui.context.$ = () => ({ disabled: false });
      ui.context.view.syncViews = () => {
        ui.calls.push(["sync", ui.context.mode]);
      };
      const handler = vm.runInContext(
        transpile(`(${originalHandler("#sync-views")})`),
        ui.context,
      );
      return () => handler({});
    },
    { queueMap: false },
  );
  assert.deepEqual(ui.calls.slice(0, 2), [
    ["sync", "map"],
    ["scene_sync", "map"],
  ]);
});

for (const [variable, action] of [
  ["chartsPanel", "changed"],
  ["siHooks", "before"],
  ["siHooks", "after"],
  ["siHooks", "capture"],
]) {
  test(`actual ${variable}.${action} consumes completed scene transitions outside the queue`, async () => {
    const ui = await blockedConsumer((ui) => {
      ui.context.view.screenshot = async () => {
        ui.calls.push(["screenshot", ui.context.mode]);
        return "data:image/png;base64,";
      };
      ui.context.Image = class {
        width = 10;
        height = 10;
        set src(_) {
          queueMicrotask(() => this.onload());
        }
      };
      ui.context.document.createElement = () => ({
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => "captured",
      });
      ui.context.restoreScene = async () => {
        ui.calls.push(["restore", ui.context.mode]);
      };
      const work = vm.runInContext(
        transpile(`(${originalAction(variable, action)})`),
        ui.context,
      );
      return () => work();
    });
    assert(ui.calls.every(([, mode]) => mode === "map"));
  });
}

for (const consumer of ["display", "measurement"]) {
  test(`actual ${consumer} write captures the mode after restoration and queued intent`, async () => {
    const ui = await blockedConsumer((ui) => {
      ui.context.viewsPanel = { liveOptions: undefined };
      ui.context.displayOptions = { mode: "points", bloom: false };
      ui.context.view.setDisplayOptions = () => {};
      let work;
      if (consumer === "display") {
        vm.runInContext(
          transpile(
            originalMainNode(
              (node) =>
                ts.isFunctionDeclaration(node) &&
                node.name?.text === "applyDisplay",
            ).text,
          ),
          ui.context,
        );
        work = vm.runInContext("applyDisplay", ui.context);
      } else {
        const save = originalMainNode(
          (node) =>
            ts.isVariableDeclaration(node) && node.name.getText() === "save",
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "measurementSettings",
        ).node;
        work = vm.runInContext(
          transpile(`(${save.initializer.getText()})`),
          ui.context,
        );
      }
      return () =>
        work(consumer === "display" ? { mode: "points", bloom: false } : null);
    });
    assert.equal(
      ui.calls.filter(([name]) => name === "scene_sync").at(-1)[1],
      "map",
    );
  });
}

test("actual Saved views creation waits before taking its named camera snapshot", async () => {
  const ui = await blockedConsumer((ui) => {
    ui.context.button = { id: "save-view", dataset: {} };
    ui.context.savedViews = () => {};
    const work = originalMainNode(
      (node) =>
        ts.isArrowFunction(node) &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
        ),
      (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "savedViews",
    ).text;
    const action = vm.runInContext(transpile(`(${work})`), ui.context);
    return () => action();
  });
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "save_view"),
    [["save_view", "map"]],
  );
});

test("actual entity color write preserves the post-restore camera when saving its color intent", async () => {
  const completed = deferred();
  const ui = await blockedConsumer((ui) => {
    ui.context.customEntityColors = {};
    ui.context.setEntityColors = () => {};
    ui.context.view.rebuild = () => {};
    const refresh = ui.context.refresh;
    ui.context.refresh = async (...args) => {
      await refresh(...args);
      if (ui.context.customEntityColors.Current) completed.resolve();
    };
    const handler = vm.runInContext(
      transpile(`(${originalHandler("#entities", "change")})`),
      ui.context,
    );
    return () => {
      handler({
        target: { dataset: { entityColor: "Current" }, value: "#123456" },
      });
      return completed.promise;
    };
  });
  assert.equal(ui.context.customEntityColors.Current, "#123456");
  assert.equal(
    ui.calls.filter(([name]) => name === "scene_sync").at(-1)[1],
    "map",
  );
});

function sceneTimer(ui) {
  const main = fs.readFileSync(
    new URL("../src/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("let syncTimer:");
  const end = main.indexOf("let eventTimer:", start);
  assert(start > 0 && end > start);
  const callbacks = [];
  Object.assign(ui.context, {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 600);
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimeout() {},
    restoringScene: false,
    transitionIdle: () => ui.context.sceneIdle(),
    cameraSaveWork: Promise.resolve(),
    flushSceneSync: async () => {},
  });
  vm.runInContext(transpile(main.slice(start, end)), ui.context);
  return callbacks;
}

test("actual scene-sync timer waits for queued mode intent and can be canceled after firing", async () => {
  let callbacks, pending, timerWork;
  const ui = await blockedConsumer((ui) => {
    callbacks = sceneTimer(ui);
    const call = ui.context.call;
    ui.context.call = async (...args) => {
      await call(...args);
      return { revision: 2 };
    };
    return async () => {
      ui.context.view.onSceneChange();
      timerWork = callbacks[0]();
      pending = true;
      await timerWork;
    };
  });
  assert(pending);
  assert.equal(
    ui.calls.filter(([name]) => name === "scene_sync").at(-1)[1],
    "map",
  );
  const retry = toolbar(),
    gate = deferred(),
    entered = deferred();
  retry.context.sceneIdle = async () => {
    entered.resolve();
    await gate.promise;
  };
  const canceled = sceneTimer(retry);
  retry.context.view.onSceneChange();
  const work = canceled[0]();
  await entered.promise;
  vm.runInContext("cancelSceneSync()", retry.context);
  gate.resolve();
  await work;
  assert.deepEqual(retry.calls, []);
});

test("restore-generated scene changes never join their own coordinator turn", async () => {
  const ui = toolbar();
  let drains = 0;
  ui.context.sceneIdle = async () => {
    drains++;
    throw Error("recursive scene drain");
  };
  const callbacks = sceneTimer(ui);
  await ui.transitions.command(async (commit) =>
    commit(190, async () => {
      ui.context.restoringScene = true;
      ui.context.view.onSceneChange();
      ui.context.restoringScene = false;
    }),
  );
  assert.equal(drains, 0);
  assert.deepEqual(callbacks, []);
});

for (const action of ["save-view", "undo", "redo"]) {
  test(`actual inspector ${action} joins scene transitions before capturing or restoring state`, async () => {
    const ui = await blockedConsumer((ui) => {
      vm.runInContext(
        transpile(
          originalMainNode(
            (node) =>
              ts.isFunctionDeclaration(node) &&
              node.name?.text === "restoreCommand",
          ).text,
        ),
        ui.context,
      );
      ui.context.applyRestoredScene = async (scene) => {
        ui.context.mode = scene.mode;
        ui.calls.push(["restored", scene.mode]);
      };
      const call = ui.context.call;
      ui.context.call = async (command, args) => {
        if (command === "undo" || command === "redo")
          return { revision: 200, scene: { mode: "map" } };
        return call(command, args);
      };
      const handler = vm.runInContext(
        transpile(`(${originalHandler("#inspector-content")})`),
        ui.context,
      );
      return () =>
        handler({ target: { closest: () => ({ id: action, dataset: {} }) } });
    });
    assert.equal(ui.context.mode, "map");
    assert.deepEqual(
      ui.calls.filter(([name]) => name === "save_view" || name === "restored"),
      [[action === "save-view" ? "save_view" : "restored", "map"]],
    );
  });
}

test("actual agent scenario view change drains only after its own command leaves the transition turn", async () => {
  const ui = await blockedConsumer((ui) => {
    vm.runInContext(
      transpile(
        originalMainNode(
          (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "restoreCommand",
        ).text,
      ),
      ui.context,
    );
    ui.context.applyRestoredScene = async (scene) => {
      ui.context.mode = scene.mode;
    };
    const call = ui.context.call;
    ui.context.call = async (command, args) =>
      command === "view_set"
        ? { revision: 210, scene: { mode: "map" } }
        : call(command, args);
    const work = vm.runInContext(
      transpile(`(${originalAction("agentLab", "setView")})`),
      ui.context,
    );
    return () => work({ mode: "map" });
  });
  assert.equal(ui.context.mode, "map");
});

test("actual restore callback graph keeps chart/display/camera notifications out of its own readiness drain", async () => {
  const ui = toolbar();
  let drains = 0;
  ui.context.sceneIdle = async () => {
    drains++;
    throw Error("restore awaited itself");
  };
  const callbacks = sceneTimer(ui);
  const chartSource = fs.readFileSync(
    new URL("../src/charts-panel.ts", import.meta.url),
    "utf8",
  );
  const chartAst = ts.createSourceFile(
    "charts-panel.ts",
    chartSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const chartClass = chartAst.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "ChartsPanel",
  );
  const restore = chartClass.members.find(
    (node) => ts.isMethodDeclaration(node) && node.name.getText() === "restore",
  );
  const restoreChart = vm.runInContext(
    transpile(`({ ${restore.getText(chartAst)} }).restore`),
    ui.context,
  );
  const chartsPanel = {
    rolesEditor: { close() {} },
    actions: { changed: ui.context.sceneIdle },
  };
  chartsPanel.restore = restoreChart.bind(chartsPanel);
  const emit = () => ui.context.view.onSceneChange();
  Object.assign(ui.context.view, {
    setTerrain: async () => {},
    setDisplayOptions: emit,
    restoreViewStates: emit,
    playbackFadeAmount: 50,
    setPlaybackFade: emit,
    setGlobeTimeScale: emit,
    setGlobeTime: emit,
    setGlobeAltitude: emit,
    clearRasters() {},
    restoreCamera: () => {
      emit();
      return false;
    },
    restoreCurrentView: () => {
      emit();
      return true;
    },
    resize: emit,
    setMode: (mode) => {
      ui.calls.push(["apply", mode]);
      emit();
    },
  });
  Object.assign(ui.context, {
    call: async () => null,
    terrainLoadGeneration: 0,
    defaultChart: {},
    defaultDisplay: {},
    chartsPanel,
    tables: { beginRestore() {} },
    gisTable: { close() {}, open() {} },
    $: () => ({
      checked: false,
      setAttribute() {},
      classList: { toggle() {} },
    }),
    setEntityColors() {},
    setWorkspaceExpanded() {},
    patternsPanel: { reset() {} },
    editor: { deactivate() {} },
    mapsEnabled: () => false,
    theme() {},
    updateTimeFocus: emit,
  });
  vm.runInContext(
    transpile(
      ["updatePlaybackFadeControl", "applyRestoredScene"].map((name) =>
        originalMainNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).text,
      ).join("\n"),
    ),
    ui.context,
  );
  const apply = vm.runInContext("applyRestoredScene", ui.context);
  await ui.transitions.command(async (commit) =>
    commit(220, () =>
      apply({ mode: "map", chart: { title: "Restored chart" } }),
    ),
  );
  assert.equal(chartsPanel.config.title, "Restored chart");
  assert.equal(ui.context.mode, "map");
  assert.equal(drains, 0);
  assert.deepEqual(callbacks, []);
});

test("actual Globe height persistence waits for navigation and rejects its now-superseded mode intent", async () => {
  const ui = await blockedConsumer((ui) => {
    Object.assign(ui.context, {
      restoringScene: false,
      globeElevationWork: Promise.resolve(),
      input: () => "2",
      globeElevationScale: (value) => value,
      transitionIdle: () => ui.context.sceneIdle(),
    });
    ui.context.view.setGlobeTime = () => {};
    ui.context.view.setGlobeAltitude = () => {};
    const handler = vm.runInContext(
      transpile(`(${originalHandler("#globe-time-height", "input")})`),
      ui.context,
    );
    return () => {
      handler({});
      return vm.runInContext("globeElevationWork", ui.context);
    };
  });
  assert.deepEqual(
    ui.calls.filter(([name]) => name === "scene_sync"),
    [["scene_sync", "map"]],
  );
});

function classicCaptureMethod() {
  const text = fs.readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("view.ts", text, ts.ScriptTarget.Latest, true);
  let method;
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "captureConsistent") method = node;
    else ts.forEachChild(node, visit);
  };
  visit(ast);
  assert(method, "the maintained classic view must expose the shared capture method");
  const context = vm.createContext({});
  vm.runInContext(transpile(`class ClassicCapture { ${method.getText(ast)} }; globalThis.capture = ClassicCapture.prototype.captureConsistent;`), context);
  return context.capture;
}

test("actual classic app capture remains available after a failed graphics context and never waits on unresolved GPU readiness", async () => {
  const capture = classicCaptureMethod();
  let renders = 0, snapshots = 0;
  const owner = { ready: new Promise(() => {}), requestRender() { renders++; throw Error("lost classic context"); } };
  const image = await capture.call(owner, async () => { snapshots++; return "actual-ui-png"; }, () => { throw Error("classic must not impose native source identity"); });
  assert.equal(image, "actual-ui-png");
  assert.equal(renders, 1);
  assert.equal(snapshots, 1);
});

test("actual classic app capture preserves the original internal snapshot failure", async () => {
  const capture = classicCaptureMethod(), error = Error("WebView snapshot failed");
  await assert.rejects(capture.call({ requestRender() {} }, async () => { throw error; }, () => ({revision:1})), actual => actual === error);
});
