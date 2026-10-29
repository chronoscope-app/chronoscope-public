import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const moduleUrl = (source) =>
  "data:text/javascript;base64," +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString("base64");
const profileUrl = moduleUrl(
  fs.readFileSync(new URL("../src/view-profile.ts", import.meta.url), "utf8"),
);
const { createAgentLab } = await import(
  moduleUrl(
    fs
      .readFileSync(new URL("../src/agent-lab.ts", import.meta.url), "utf8")
      .replace('"./view-profile"', JSON.stringify(profileUrl)),
  )
);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const terminal = async (lab, id) => {
  for (let i = 0; i < 20; i++) {
    const result = await lab.scenario({ action: "status", id });
    if (result.state !== "running") return result;
    await new Promise(setImmediate);
  }
  assert.fail(
    "Scenario did not terminate after its deferred operation resolved",
  );
};
const fixture = (live = async () => status) => {
  let workspace = "original";
  const lab = createAgentLab({
    view: {
      controls: new EventTarget(),
      frameTelemetry: () => [16, 1, 0, 0, 0, 0, 0],
    },
    snapshot: () => ({ workspace_id: workspace }),
    live,
    setView: async () => {},
    playback: async () => {},
    record: async () => {},
  });
  return { lab, replace: () => (workspace = "replacement") };
};
const status = {
  mode: "map",
  scene: {},
  diagnostics: { renderErrorCount: 0, terrain: {} },
  gis_layers: [],
  loading: {},
};
const step = { command: "view_set", arguments: { mode: "map" } };

test("Workspace replacement during the final telemetry await fails the active scenario", async () => {
  const gate = deferred(),
    entered = deferred();
  const { lab, replace } = fixture(() => {
    entered.resolve();
    return gate.promise;
  });
  const run = await lab.scenario({ action: "run", steps: [step] });
  assert.equal(run.state, "running");
  await entered.promise;
  replace();
  gate.resolve(status);
  const result = await terminal(lab, run.id);
  assert.equal(result.state, "failed");
  assert.match(result.error, /CONFLICT: workspace changed during scenario/);
  assert.deepEqual(result.trace, []);
  assert.equal(
    lab.profile({ action: "status", id: result.profile_id }).state,
    "complete",
  );
});

test("Cancellation during telemetry prevents completion and later steps", async () => {
  const gate = deferred(),
    entered = deferred();
  let navigation = 0;
  const { lab } = fixture((command) => {
    if (command === "view_navigate") navigation++;
    else entered.resolve();
    return gate.promise;
  });
  const run = await lab.scenario({
    action: "run",
    steps: [step, { command: "view_navigate", arguments: { action: "fit" } }],
  });
  await entered.promise;
  await lab.scenario({ action: "cancel", id: run.id });
  gate.resolve(status);
  assert.equal((await terminal(lab, run.id)).state, "cancelled");
  assert.equal(navigation, 0);
});

test("A completed scenario retains its result after workspace changes and cancellation", async () => {
  const { lab, replace } = fixture();
  const run = await lab.scenario({ action: "run", steps: [step] });
  const result = await terminal(lab, run.id);
  assert.equal(result.state, "complete");
  assert.equal(result.completed_steps, 1);
  assert.equal(result.trace.length, 1);
  replace();
  assert.deepEqual(
    await lab.scenario({ action: "cancel", id: run.id }),
    result,
  );
  assert.deepEqual(
    await lab.scenario({ action: "status", id: run.id }),
    result,
  );
});

test("A deadline expiring during final telemetry fails rather than completing", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const gate = deferred(),
    entered = deferred();
  const { lab } = fixture(() => {
    entered.resolve();
    return gate.promise;
  });
  const run = await lab.scenario({
    action: "run",
    timeout_seconds: 1,
    steps: [step],
  });
  await entered.promise;
  now = 1001;
  gate.resolve(status);
  const result = await terminal(lab, run.id);
  assert.equal(result.state, "failed");
  assert.match(result.error, /UNAVAILABLE: scenario deadline exceeded/);
  assert.deepEqual(result.trace, []);
  assert.equal(
    lab.profile({ action: "status", id: result.profile_id }).state,
    "complete",
  );
});

test("Readiness rechecks its guard after awaited status", async () => {
  const gate = deferred(),
    entered = deferred();
  const { lab } = fixture(() => {
    entered.resolve();
    return gate.promise;
  });
  let changed = false;
  const waiting = lab.wait({ stable_ms: 0 }, () => {
    if (changed) throw Error("CONFLICT: workspace changed during scenario");
  });
  await entered.promise;
  changed = true;
  gate.resolve(status);
  await assert.rejects(waiting, /CONFLICT: workspace changed/);
});

test("Readiness cannot succeed when its status response arrives after the deadline", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const gate = deferred(),
    entered = deferred();
  const { lab } = fixture(() => {
    entered.resolve();
    return gate.promise;
  });
  const waiting = lab.wait({ stable_ms: 0, timeout_ms: 100 });
  await entered.promise;
  now = 101;
  gate.resolve(status);
  await assert.rejects(
    waiting,
    /UNAVAILABLE: view did not settle before the readiness deadline/,
  );
});

const { createAgentView } = await import(
  moduleUrl(
    fs.readFileSync(new URL("../src/agent-view.ts", import.meta.url), "utf8"),
  )
);
function resetHost(recover = async () => {}) {
  let workspace = "original",
    calls = 0;
  const diagnostics = {
    recovering: false,
    effectError: "",
    globeAltitude: true,
  };
  const live = createAgentView({
    view: {
      ready: Promise.resolve(),
      diagnostics: () => ({ ...diagnostics }),
      recoverRenderer: async () => {
        calls++;
        await recover(diagnostics);
      },
      viewer: { render() {} },
      gis: { descriptors: [] },
      scene: { globe: { show: true, tilesLoaded: true } },
      displayLayer: { diagnostics: { pending: false } },
      host: { clientWidth: 800, clientHeight: 600 },
    },
    snapshot: () => ({ workspace_id: workspace, revision: 1 }),
    mode: () => "globe",
    captureScene: () => ({ globe_altitude: true }),
  });
  return {
    live,
    calls: () => calls,
    replace: () => {
      workspace = "replacement";
    },
  };
}
test("map reset rejects missing/false confirmation before touching graphics", async () => {
  const h = resetHost();
  for (const confirm of [undefined, false])
    await assert.rejects(
      h.live("view_reset", { confirm }),
      /requires confirm:true/,
    );
  assert.equal(h.calls(), 0);
});
test("map reset returns successful live state only after recovery finishes", async () => {
  const gate = deferred(),
    h = resetHost(() => gate.promise);
  let completed = false;
  const reply = h.live("view_reset", { confirm: true }).then((r) => {
    completed = true;
    return r;
  });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  gate.resolve();
  const result = await reply;
  assert.equal(result.reset, true);
  assert.equal(result.scene.globe_altitude, true);
  assert.equal(h.calls(), 1);
});
test("swallowed graphics recovery failures cannot become successful reset receipts", async () => {
  const h = resetHost(async (d) => {
    d.effectError = "fixture failure";
  });
  await assert.rejects(
    h.live("view_reset", { confirm: true }),
    /map reset failed: fixture failure/,
  );
});
test("workspace replacement during reset cannot return success for another document", async () => {
  const gate = deferred(),
    h = resetHost(() => gate.promise),
    reply = h.live("view_reset", { confirm: true });
  await new Promise(setImmediate);
  h.replace();
  gate.resolve();
  await assert.rejects(reply, /workspace changed during map reset/);
});
