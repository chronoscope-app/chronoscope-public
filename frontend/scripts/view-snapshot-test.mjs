import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
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
function find(predicate, tree = ast) {
  let found;
  const visit = (n) => {
    if (found) return;
    if (predicate(n)) found = n;
    else ts.forEachChild(n, visit);
  };
  visit(tree);
  assert(found, "actual source node exists");
  return found;
}
const fn = (name) =>
  find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(
    ast,
  );
const init = (name) =>
  find(
    (n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === name,
  ).initializer.getText(ast);
async function load(name) {
  return import(
    "data:text/javascript;base64," +
      Buffer.from(
        transpile(
          fs.readFileSync(
            new URL(`../src/${name}.ts`, import.meta.url),
            "utf8",
          ),
        ),
      ).toString("base64")
  );
}
const { ViewportRefresh } = await load("viewport-refresh"),
  { SceneTransitions } = await load("scene-transitions");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const display = {
  mode: "points",
  bloom: false,
  spatial_culling: false,
  cluster_pixels: 36,
  heat_radius: 20,
  heat_reference_zoom: null,
};
function model(revision = 1, render = true) {
  return {
    version: 1,
    snapshot: {
      workspace_id: "store-a:1",
      revision,
      name: "literal fixture",
      count: 3,
      visible: 3,
      selected_count: 1,
      selected: ["1"],
      filter: { selected_only: false, search: "", start: null, end: null },
      time_bounds: [0, 10],
      scene: {
        mode: "map",
        display: { ...display },
        entity_colors: {},
        measurement: {
          minimum: 0,
          maximum: 10,
          title: "Scale",
          unit: "",
          latest_per_entity: false,
        },
        globe_time: false,
        render_budget: 20000,
      },
      preferences: { basemap: "none" },
      entities: { literal: 3 },
      categories: {},
      views: [],
      groups: [],
      layers: [],
      lifecycle: {},
    },
    selected: ["1"],
    inspected: {},
    ...(render
      ? {
          render: {
            lod: false,
            rendered_count: 1,
            entities: ["literal"],
            points: [{ id: "1", lon: 1, lat: 2, time: 5, entity: 0 }],
          },
          geometries: { limited: false, features: [] },
        }
      : {}),
  };
}
function harness() {
  const requests = [],
    publications = [],
    errors = [],
    nodes = new Map(),
    initial = model().snapshot;
  const element = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        classList: { toggle() {} },
        checked: false,
        disabled: false,
        innerHTML: "",
        textContent: "",
        title: "",
      });
    return nodes.get(id);
  };
  const context = vm.createContext({
    ViewportRefresh,
    SceneTransitions,
    Promise,
    setTimeout,
    clearTimeout,
    console,
    snapshot: initial,
    tab: "inspect",
    mode: "map",
    serial: 0,
    viewportDataGeneration: 0,
    snapshotRequestSerial: 0,
    refreshWork: Promise.resolve(),
    sceneSyncWork: Promise.resolve(),
    cameraSaveWork: Promise.resolve(),
    flushSceneSync: async () => {},
    representationGoal: undefined,
    restoringScene: false,
    renderLOD: false,
    geometryLOD: false,
    renderedCount: 0,
    defaultDisplay: { ...display },
    displayOptions: { ...display },
    customEntityColors: {},
    renderBudget: 20000,
    focus: 0.5,
    displayPreserveFrame: false,
    playbackPreserveFrame: false,
    timeScrubbing: false,
    playTimer: undefined,
    overrideBounds: null,
    projectPath: null,
    preferences: {},
    terrainInfo: null,
    resources: false,
    tableWindows: { detached: false },
    gisTable: {},
    sceneTransitions: new SceneTransitions(),
    drainSceneEvents: async () => {},
    tables: {
      tableSerial: 0,
      tableOpen: false,
      page: 0,
      tableScopeKey: "",
      resetTableScroll() {},
    },
    viewsPanel: {},
    welcome: { update() {} },
    measurementLegend: { update() {} },
    entityLegend: { element: {}, content: {} },
    sidebarFields: { render: async () => {} },
    document: { activeElement: null },
    $: element,
    setEntityColors() {},
    updateNavigationControls() {},
    setDateTimeDisplay: () => false,
    filterIntent: { desired: (filter) => filter, protects: () => false },
    timeRange: { set() {} },
    time: String,
    entities() {},
    categories() {},
    histogram() {},
    layers() {},
    inspector: async () => {},
    table: async () => {},
    status() {},
    esc: String,
    mapsEnabled: () => false,
    loadRasters: async () => {},
    rebuildTerrain: async () => {},
    entityColor: () => "#123456",
    toast: (error) => errors.push(String(error)),
    decode: (packet) => packet.points,
    call: async () => {
      throw Error("unexpected direct Engine call");
    },
    editor: { acknowledgeScene() {} },
  });
  context.view = {
    resourceLimits: { maxPoints: 100000, arcVertices: 200000 },
    nativeSnapshots: true,
    ready: Promise.resolve(),
    gis: { sync: async () => {} },
    displayLayer: { active: false, packet: null },
    points: [],
    geometryFeatures: [],
    bounds: [-20, -10, 20, 10],
    lo: 0,
    hi: 10,
    globeTimeScale: 1,
    timeHeight: 2.8,
    theme: "dark",
    playback: false,
    setBasemap: async () => {},
    mapZoom: () => 4,
    visibleDataBounds: () => null,
    visibleBounds: () => null,
    navigationIdle: async () => {},
    snapshotIdle: async () => {},
    requestSnapshot: async (args, intent) => {
      requests.push({ args, intent });
      return model();
    },
    publishSnapshot: async (m, application, accept) => {
      publications.push({ model: m, application, accept });
      if (!accept()) return { kind: "stale" };
      if (application.data) {
        context.view.points = [...application.data.points];
        context.view.geometryFeatures = [...application.data.geometries];
        context.view.bounds = [...application.data.studyBounds];
        [context.view.lo, context.view.hi] = application.data.timeBounds;
      }
      return { kind: "accepted", dataChanged: !!application.data };
    },
    setData() {
      throw Error("source published outside atomic application");
    },
    setSelection() {
      throw Error("selection published outside atomic application");
    },
    setMeasurement() {
      throw Error("measurement published outside atomic application");
    },
    setDisplayOptions() {
      throw Error("display published outside atomic application");
    },
    setGlobeTime() {
      throw Error("globe-time published outside atomic application");
    },
    rebuild() {
      throw Error("rebuild published outside atomic application");
    },
  };
  const names = [
    "bounds",
    "sceneTimeBounds",
    "snapshotIntent",
    "snapshotApplication",
    "refresh",
    "runRefresh",
    "displayLevel",
    "queueRepresentation",
    "refreshViewportData",
    "runViewportData",
    "transitionIdle",
    "sceneIdle",
    "syncScene",
  ];
  vm.runInContext(
    transpile(
      names.map(fn).join("\n") +
        `\nviewportDataRefresh = ${init("viewportDataRefresh")};`,
    ),
    context,
  );
  return {
    context,
    requests,
    publications,
    errors,
    refresh: (...args) => context.refresh(...args),
    idle: () => context.sceneIdle(),
  };
}
const bounded = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(Error("test detected a readiness self-await")),
        1000,
      );
      timer.unref?.();
    }),
  ]);

test("actual initial refresh publishes one complete application and never aliases the offered model", async () => {
  const h = harness(),
    original = model();
  Object.freeze(original.snapshot);
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    return original;
  };
  await h.refresh();
  assert.equal(h.publications.length, 1);
  const { application, model: published } = h.publications[0];
  assert.equal(published, original);
  assert.notEqual(h.context.snapshot, original.snapshot);
  h.context.snapshot.revision = 2;
  assert.equal(original.snapshot.revision, 1);
  assert.equal(application.data.points[0].id, "1");
  assert.deepEqual([...application.selection], ["1"]);
  assert.equal(application.measurement.minimum, 0);
  assert.equal(application.display.mode, "points");
  assert.equal(application.focus, 0.5);
  assert(Object.isFrozen(application));
  assert(Object.isFrozen(application.data));
  assert(Object.isFrozen(application.data.studyBounds));
  assert.equal(h.requests[0].intent.lane, "refresh");
  assert.equal(h.requests[0].args.include_render, true);
});

test("held old inspector cannot publish after a newer full refresh has accepted", async () => {
  const h = harness(),
    held = deferred(),
    entered = deferred();
  let count = 0;
  h.context.view.requestSnapshot = async () => model(++count);
  h.context.inspector = async () => {
    if (count === 1) {
      entered.resolve();
      await held.promise;
    }
  };
  const old = h.refresh();
  await entered.promise;
  await h.refresh();
  held.resolve();
  await old;
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].model.snapshot.revision, 2);
});

test("changed metadata requests full evidence at latest actual scope while preserving study bounds", async () => {
  const h = harness();
  await h.refresh();
  const study = [...h.context.view.bounds];
  h.publications.length = 0;
  h.context.view.publishSnapshot = async (m, app, accept) => {
    h.publications.push({ model: m, application: app });
    return {
      kind: app.data ? "accepted" : "needs-representation",
      dataChanged: !!app.data,
    };
  };
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    return model(2, args.include_render);
  };
  h.context.displayOptions.spatial_culling = true;
  const metadata = model(2, false);
  metadata.snapshot.scene.display.spatial_culling = true;
  let first = true;
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    if (first) {
      first = false;
      return metadata;
    }
    return model(2);
  };
  await h.refresh(false);
  h.context.view.visibleDataBounds = () => [5, 6, 7, 8];
  await bounded(h.idle());
  const request = h.requests.at(-1);
  assert.equal(request.args.include_render, true);
  assert.equal(request.intent.lane, "metadata-reconcile");
  assert.deepEqual([...request.args.bounds], [5, 6, 7, 8]);
  assert.deepEqual(
    [...h.publications.at(-1).application.data.studyBounds],
    study,
  );
  assert.equal(h.publications[0].application.data, null);
});

test("movement queued during held initial read waits for its accepted refresh then derives current bounds", async () => {
  const h = harness(),
    gate = deferred(),
    entered = deferred();
  let reads = 0;
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    if (++reads === 1) {
      entered.resolve();
      await gate.promise;
    }
    const value = model();
    value.snapshot.scene.display.spatial_culling = true;
    return value;
  };
  const initial = h.refresh();
  await entered.promise;
  h.context.displayOptions.spatial_culling = true;
  const pending = h.context.refreshViewportData([1, 1, 2, 2]);
  await Promise.resolve();
  assert.equal(reads, 1);
  h.context.view.visibleDataBounds = () => [8, 8, 9, 9];
  gate.resolve();
  await initial;
  await bounded(pending);
  assert.equal(reads, 2);
  assert.deepEqual([...h.requests.at(-1).args.bounds], [8, 8, 9, 9]);
});

test("each latest-goal caller waits its own publication and obsolete active query cannot win", async () => {
  const h = harness();
  await h.refresh();
  h.context.displayOptions.spatial_culling = true;
  const first = deferred(),
    second = deferred(),
    entered = deferred();
  let reads = 0;
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    if (++reads === 1) {
      entered.resolve();
      await first.promise;
    } else await second.promise;
    return model();
  };
  h.context.view.visibleDataBounds = () => [1, 1, 2, 2];
  const a = h.context.refreshViewportData();
  await entered.promise;
  h.context.view.visibleDataBounds = () => [3, 3, 4, 4];
  let done = false;
  const b = h.context.refreshViewportData().then(() => {
    done = true;
  });
  first.resolve();
  await a;
  await Promise.resolve();
  assert.equal(done, false);
  second.resolve();
  await bounded(b);
  assert.deepEqual([...h.requests.at(-1).args.bounds], [3, 3, 4, 4]);
  assert.equal(
    h.publications.length,
    2,
    "only initial and newest complete query publish",
  );
});

test("failed query settles failed ticket and a later force request succeeds without LOD or bounds", async () => {
  const h = harness();
  await h.refresh();
  let fail = true;
  h.context.view.requestSnapshot = async () => {
    if (fail) throw Error("UNAVAILABLE: deliberate query failure");
    return model();
  };
  const ticket = h.context.queueRepresentation("metadata-reconcile", true);
  await h.context.viewportDataRefresh.flush();
  const outcome = await ticket.done;
  assert.equal(outcome.kind, "failed");
  assert.match(String(outcome.error), /deliberate/);
  fail = false;
  const retry = h.context.queueRepresentation("metadata-reconcile", true);
  await h.context.viewportDataRefresh.flush();
  assert.equal((await retry.done).kind, "accepted");
});

test("outer idle includes held publication and leaf is checked only after candidate acceptance", async () => {
  const h = harness(),
    gate = deferred(),
    entered = deferred();
  let accepted = false;
  h.context.view.publishSnapshot = async () => {
    entered.resolve();
    await gate.promise;
    accepted = true;
    return { kind: "accepted", dataChanged: true };
  };
  h.context.view.snapshotIdle = async () =>
    assert(
      accepted,
      "leaf cannot be called before the pending publication completes",
    );
  const refresh = h.refresh();
  await entered.promise;
  let idle = false;
  const ready = h.idle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  gate.resolve();
  await refresh;
  await bounded(ready);
});

test("real camera-save ACK forces new evidence with no LOD/bounds and aggregate does not await itself", async () => {
  const h = harness();
  await h.refresh();
  const gate = deferred(),
    entered = deferred();
  let nextRevision = 1;
  h.context.call = async (name, args) => {
    assert.equal(name, "scene_sync");
    entered.resolve();
    await gate.promise;
    return { revision: ++nextRevision };
  };
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    return model(nextRevision);
  };
  h.context.captureScene = () => ({ mode: "map" });
  h.context.clearTimeout = () => {};
  h.context.setTimeout = () => 1;
  const start = source.indexOf("let syncTimer:"),
    end = source.indexOf("let eventTimer:", start);
  vm.runInContext(transpile(source.slice(start, end)), h.context);
  h.context.view.onSceneChange();
  const ready = h.idle();
  await entered.promise;
  gate.resolve();
  await bounded(ready);
  assert.equal(h.context.snapshot.revision, 2);
  assert.equal(h.requests.at(-1).intent.lane, "metadata-reconcile");
  assert.equal(h.publications.at(-1).model.snapshot.revision, 2);
  assert.equal(h.requests.at(-1).args.bounds, undefined);
  assert.equal(h.requests.at(-1).args.include_render, true);
});

const classicSource = fs.readFileSync(
    new URL("../src/view.ts", import.meta.url),
    "utf8",
  ),
  classicAst = ts.createSourceFile(
    "view.ts",
    classicSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
const classicMethod = (name) =>
  find(
    (n) => ts.isMethodDeclaration(n) && n.name.getText(classicAst) === name,
    classicAst,
  ).getText(classicAst);
test("classic wrapper preserves data/effects/selection order and uses original Engine request", async () => {
  const calls = [],
    context = vm.createContext({
      call: async (name, args) => {
        calls.push(name);
        return args;
      },
    });
  vm.runInContext(
    transpile(
      `class Actual { ${classicMethod("requestSnapshot")} ${classicMethod("publishSnapshot")} }; actual = Actual.prototype;`,
    ),
    context,
  );
  const owner = {
    ready: Promise.resolve(),
    disposed: false,
    setMeasurement: () => calls.push("measurement"),
    setDisplayOptions: () => calls.push("display"),
    setGlobeTime: () => calls.push("globe"),
    setGlobeAltitude: () => calls.push("altitude"),
    setTheme: () => calls.push("theme"),
    rebuild: () => calls.push("rebuild"),
    setData: async () => {
      calls.push("data");
      return true;
    },
    setFocus: () => calls.push("focus"),
    displayLayer: { updating: false, set: async () => calls.push("effects") },
    rebuildTrails: () => calls.push("trails"),
    setSelection: () => calls.push("selection"),
  };
  const m = model(),
    h = harness(),
    data = {
      points: [],
      names: [],
      studyBounds: [0, 0, 1, 1],
      timeBounds: [0, 10],
      geometries: [],
    };
  const app = h.context.snapshotApplication(m, data);
  const result = await context.actual.publishSnapshot.call(
    owner,
    m,
    app,
    () => true,
  );
  assert.equal(result.kind, "accepted");
  assert.deepEqual(calls, [
    "measurement",
    "display",
    "globe",
    "altitude",
    "theme",
    "data",
    "focus",
    "effects",
    "trails",
    "selection",
  ]);
  const args = { version: 1, generation: "literal" };
  assert.equal(await context.actual.requestSnapshot(args, {}), args);
  assert.equal(calls.at(-1), "view_snapshot_v1");
});

test("a current stale publication queues replacement evidence instead of silently becoming ready", async () => {
  const h = harness();
  let attempts = 0;
  h.context.view.publishSnapshot = async (m, app) => {
    h.publications.push({ model: m, application: app });
    return ++attempts === 1
      ? { kind: "stale" }
      : { kind: "accepted", dataChanged: true };
  };
  await h.refresh();
  assert.equal(attempts, 1);
  await bounded(h.idle());
  assert.equal(attempts, 2);
  assert.equal(h.requests.at(-1).intent.lane, "metadata-reconcile");
});

test("actual scope is read after navigation settles, not from the queued rectangle", async () => {
  const h = harness();
  await h.refresh();
  h.context.displayOptions.spatial_culling = true;
  const entered = deferred(),
    gate = deferred();
  h.context.view.navigationIdle = async () => {
    entered.resolve();
    await gate.promise;
  };
  h.context.view.visibleDataBounds = () => [1, 1, 2, 2];
  const work = h.context.refreshViewportData([0, 0, 1, 1]);
  await entered.promise;
  h.context.view.visibleDataBounds = () => [8, 8, 9, 9];
  gate.resolve();
  await bounded(work);
  assert.deepEqual([...h.requests.at(-1).args.bounds], [8, 8, 9, 9]);
});

test("unchanged metadata can finish without a geometry query and retains the current effect packet", async () => {
  const h = harness();
  await h.refresh();
  const packet = { marker: "accepted-original-display-packet" };
  h.context.view.displayLayer.packet = packet;
  h.context.view.requestSnapshot = async (args, intent) => {
    h.requests.push({ args, intent });
    return model(1, false);
  };
  const before = h.requests.length;
  await h.refresh(false);
  await bounded(h.idle());
  assert.equal(h.requests.length, before + 1);
  assert.equal(h.publications.at(-1).application.data, null);
  assert.equal(h.publications.at(-1).application.displayPacket, packet);
});

test("outer readiness follows a replacement queued while the leaf reports unavailable", async () => {
  const h = harness();
  await h.refresh();
  let checks = 0;
  h.context.view.snapshotIdle = async () => {
    if (++checks === 1) {
      h.context.queueRepresentation("metadata-reconcile", true);
      throw Error("UNAVAILABLE: superseded leaf");
    }
  };
  await bounded(h.idle());
  assert.equal(checks, 2);
  assert.equal(h.requests.at(-1).intent.lane, "metadata-reconcile");
});

test("a stable unaccepted leaf remains unavailable, rather than returning false readiness", async () => {
  const h = harness();
  await h.refresh();
  h.context.view.snapshotIdle = async () => {
    throw Error("UNAVAILABLE: no accepted current representation");
  };
  await assert.rejects(bounded(h.idle()), /no accepted current representation/);
});

test("superseded native request Abort preserves the original silent generation-drop behavior and latest readiness", async () => {
  const h = harness(),
    oldGate = deferred(),
    oldEntered = deferred(),
    newGate = deferred(),
    newEntered = deferred();
  let reads = 0;
  h.context.view.requestSnapshot = async () => {
    if (++reads === 1) {
      oldEntered.resolve();
      return oldGate.promise;
    }
    newEntered.resolve();
    await newGate.promise;
    return model(2);
  };
  const old = h.refresh().then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );
  await oldEntered.promise;
  const newest = h.refresh();
  await newEntered.promise;
  let ready = false;
  const idle = h.idle().then(() => {
    ready = true;
  });
  const abort = Error("Snapshot intention was superseded");
  abort.name = "AbortError";
  oldGate.reject(abort);
  const previous = await old;
  await Promise.resolve();
  assert.equal(
    ready,
    false,
    "obsolete completion cannot make latest work ready",
  );
  newGate.resolve();
  await newest;
  await bounded(idle);
  assert.equal(
    previous.ok,
    true,
    "only a proven obsolete Abort must resolve like the original generation guard",
  );
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].model.snapshot.revision, 2);
});

test("stable current request Abort remains rejected and unavailable", async () => {
  const h = harness();
  const abort = Error("Snapshot transport disposed");
  abort.name = "AbortError";
  h.context.view.requestSnapshot = async () => {
    throw abort;
  };
  h.context.view.snapshotIdle = async () => {
    throw Error("UNAVAILABLE: no accepted current representation");
  };
  await assert.rejects(h.refresh(), (error) => error === abort);
  assert.equal(h.publications.length, 0);
  await assert.rejects(bounded(h.idle()), /no accepted current representation/);
});

test("a superseded ordinary query failure retains classic error propagation", async () => {
  const h = harness(),
    gate = deferred(),
    entered = deferred();
  let reads = 0;
  h.context.view.requestSnapshot = async () => {
    if (++reads === 1) {
      entered.resolve();
      return gate.promise;
    }
    return model(2);
  };
  const previous = h.refresh().then(
    () => undefined,
    (error) => error,
  );
  await entered.promise;
  await h.refresh();
  const failure = Error("OPERATION_FAILED: original Engine failure");
  gate.reject(failure);
  assert.equal(await previous, failure);
  assert.equal(h.publications.length, 1);
  await bounded(h.idle());
});

test("actual Globe slider persists its frozen desired values after an old canonical application during the prerequisite", async () => {
  const h = harness(),
    entered = deferred(),
    gate = deferred(),
    writes = [];
  let aggregate = 0;
  h.context.mode = "globe";
  h.context.globeElevationWork = Promise.resolve();
  h.context.globeElevationGeneration = 0;
  h.context.input = () => "2";
  h.context.globeElevationScale = (value) => value;
  h.context.view.setGlobeTime = (enabled, scale) => {
    h.context.view.globeTime = enabled;
    h.context.view.globeTimeScale = scale;
  };
  h.context.captureScene = () => ({
    mode: "globe",
    globe_time: h.context.view.globeTime,
    globe_time_scale: h.context.view.globeTimeScale,
  });
  const prerequisite = async () => {
    entered.resolve();
    await gate.promise;
  };
  h.context.transitionIdle = prerequisite;
  h.context.sceneIdle = async () => {
    aggregate++;
    await prerequisite();
  };
  h.context.syncScene = async (scene, _, workspace) => {
    writes.push({ scene, workspace });
    return { revision: 2 };
  };
  h.context.refresh = async () => {};
  h.context.refreshViewportData = async () => {};
  const handler = find(
    (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === '$("#globe-time-height").addEventListener',
  ).arguments[1].getText(ast);
  vm.runInContext(transpile(`globeInput = ${handler};`), h.context);
  h.context.globeInput();
  await entered.promise;
  const old = model();
  old.snapshot.scene.globe_time = false;
  old.snapshot.scene.globe_time_scale = 1;
  const application = h.context.snapshotApplication(old, null);
  h.context.view.setGlobeTime(
    application.globeTime,
    application.globeTimeScale,
  );
  gate.resolve();
  await bounded(h.context.globeElevationWork);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].scene.globe_time, true);
  assert.equal(writes[0].scene.globe_time_scale, 2);
  assert.equal(writes[0].workspace, "store-a:1");
  assert.equal(
    aggregate,
    0,
    "unpersisted intent must not await aggregate reconciliation",
  );
  assert.equal(
    application.globeTimeScale,
    1,
    "old publication uses its canonical scale, not mutable user intent",
  );
});

test("Globe input retains originating workspace and genuine persistence conflicts remain errors", async () => {
  for (const replace of [false, true]) {
    const h = harness(),
      entered = deferred(),
      gate = deferred();
    let writes = 0;
    h.context.mode = "globe";
    h.context.globeElevationWork = Promise.resolve();
    h.context.globeElevationGeneration = 0;
    h.context.input = () => "2";
    h.context.globeElevationScale = (value) => value;
    h.context.view.setGlobeTime = () => {};
    h.context.captureScene = () => ({ mode: "globe" });
    h.context.transitionIdle = async () => {
      entered.resolve();
      await gate.promise;
    };
    h.context.syncScene = async (_scene, _revision, workspace) => {
      writes++;
      assert.equal(workspace, "store-a:1");
      throw Error("CONFLICT: real persistence conflict");
    };
    const handler = find(
      (n) =>
        ts.isCallExpression(n) &&
        n.expression.getText(ast) ===
          '$("#globe-time-height").addEventListener',
    ).arguments[1].getText(ast);
    vm.runInContext(transpile(`globeInput = ${handler};`), h.context);
    h.context.globeInput();
    await entered.promise;
    if (replace) h.context.snapshot.workspace_id = "store-a:2";
    gate.resolve();
    await bounded(h.context.globeElevationWork);
    assert.equal(writes, replace ? 0 : 1);
    assert.equal(h.errors.length, replace ? 0 : 1);
    if (!replace) assert.match(h.errors[0], /real persistence conflict/);
  }
});
