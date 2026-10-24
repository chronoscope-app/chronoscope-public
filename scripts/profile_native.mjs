// Profile an explicitly launched, disposable WebKitGTK QA instance. Never
// enables remote inspection or changes GPU selection on a user's normal app.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const ts = require("typescript"),
  { PNG } = require("pngjs");
const { values } = parseArgs({
  options: {
    inspector: { type: "string", default: "http://127.0.0.1:9237" },
    pid: { type: "string" },
    output: { type: "string", default: ".qa/native-performance" },
    rounds: { type: "string", default: "3" },
    duration: { type: "string", default: "4000" },
    experiments: { type: "boolean", default: false },
    "position-cache": { type: "boolean", default: false },
    dataset: { type: "string", default: "hurricanes" },
    rows: { type: "string", default: "0" },
    budget: { type: "string", default: "20000" },
    mode: { type: "string", default: "space-time" },
    "build-profile": { type: "string", default: "unspecified" },
  },
});
const out = path.resolve(values.output);
fs.mkdirSync(out, { recursive: true });
const rounds = Number(values.rounds),
  duration = Number(values.duration);
const rows = Number(values.rows),
  budget = Number(values.budget);
if (
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 10 ||
  !Number.isFinite(duration) ||
  duration < 1000 ||
  duration > 30000
)
  throw Error("Use 1–10 rounds and a 1000–30000 ms sample duration");
if (
  ![20000, 100000].includes(budget) ||
  !Number.isInteger(rows) ||
  rows < 0 ||
  rows > 100000
)
  throw Error(
    "Use a supported 20000/100000 budget and 0–100000 synthetic rows",
  );
if (!["space-time", "map", "globe"].includes(values.mode))
  throw Error("Use space-time, map or globe mode");
let csv;
if (rows) {
  csv = path.join(out, "synthetic-tracks.csv");
  const data = ["entity,timestamp,latitude,longitude,category,value"];
  for (let i = 0; i < rows; i++) {
    const e = i % 100,
      t = Math.floor(i / 100),
      phase = t / 80 + e * 0.13;
    data.push(
      `T${String(e).padStart(3, "0")},${1735689600 + t * 60},${(24 + Math.floor(e / 10) * 0.8 + Math.sin(phase) * 2 + t * 0.004).toFixed(6)},${(-90 + (e % 10) * 1.2 + Math.cos(phase) * 2 + t * 0.008).toFixed(6)},C${e % 5},${40 + ((t + e) % 100)}`,
    );
  }
  fs.writeFileSync(csv, data.join("\n") + "\n");
}
const endpoint = new URL(values.inspector);
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
  throw Error("Inspection must stay on loopback");
const html = await (await fetch(endpoint)).text();
const socket = html.match(/\/socket\/\d+\/\d+\/WebPage/)?.[0];
if (!socket) throw Error("No inspectable native page");
const ws = new WebSocket(new URL(socket, endpoint).href.replace(/^http/, "ws"));
let seq = 0,
  target,
  onReady;
const ready = new Promise((resolve) => (onReady = resolve)),
  pending = new Map();
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (
    m.method === "Target.targetCreated" &&
    m.params.targetInfo.type === "page" &&
    !target
  ) {
    target = m.params.targetInfo.targetId;
    onReady();
  }
  if (m.method === "Target.dispatchMessageFromTarget") {
    const inner = JSON.parse(m.params.message),
      p = pending.get(inner.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(inner.id);
      inner.error
        ? p.reject(Error(JSON.stringify(inner.error)))
        : p.resolve(inner.result);
    }
  }
};
ws.onclose = () => {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error("Inspector closed"));
  }
  pending.clear();
};
await Promise.race([
  ready,
  new Promise((_, reject) =>
    setTimeout(
      () => reject(Error("Inspector connection timeout")),
      10000,
    ).unref(),
  ),
]);
function command(method, params = {}) {
  const id = ++seq;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`${method} timeout`));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
  });
  ws.send(
    JSON.stringify({
      id,
      method: "Target.sendMessageToTarget",
      params: {
        targetId: target,
        message: JSON.stringify({ id, method, params }),
      },
    }),
  );
  return promise;
}
async function evaluate(expression) {
  let r = await command("Runtime.evaluate", {
    expression,
    returnByValue: false,
  });
  if (r.result?.className === "Promise" || r.result?.subtype === "promise")
    r = await command("Runtime.awaitPromise", {
      promiseObjectId: r.result.objectId,
      returnByValue: true,
    });
  if (r.wasThrown) throw Error(r.result?.description || JSON.stringify(r));
  if (r.result?.type === "string") return JSON.parse(r.result.value);
  return r.result?.value ?? r;
}
const run = (fn, args) =>
  evaluate(`(${fn.toString()})(${JSON.stringify(args)})`);
const report = {
  started: new Date().toISOString(),
  platform: process.platform,
  runtime: "native Tauri / WebKitGTK / Cesium WebGL2",
  rustProfile: values["build-profile"],
  samples: [],
  pixels: [],
  pixelComparisons: [],
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  clockTicksPerSecond: Number(
    execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
  ),
  limitations: [
    "Frame cadence is not GPU elapsed time or physical presentation timing; the Rust build profile is recorded separately.",
    "Offline map and fixed display settings; public tile-server latency is excluded.",
  ],
};
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
function processes() {
  if (!values.pid) return [];
  const parents = new Map();
  for (const name of fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
    try {
      parents.set(
        Number(name),
        Number(
          fs
            .readFileSync(`/proc/${name}/status`, "utf8")
            .match(/^PPid:\s+(\d+)/m)[1],
        ),
      );
    } catch {}
  }
  const ids = new Set([Number(values.pid)]);
  for (let size = -1; size !== ids.size;) {
    size = ids.size;
    for (const [pid, parent] of parents) if (ids.has(parent)) ids.add(pid);
  }
  return [...ids];
}
function processStats() {
  return processes().flatMap((pid) => {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const stat = fs
        .readFileSync(`/proc/${pid}/stat`, "utf8")
        .split(") ")[1]
        .split(" ");
      const devices = [],
        seen = new Set();
      for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
        try {
          const device = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
          if (!device.startsWith("/dev/dri/") || seen.has(device)) continue;
          seen.add(device);
          const info = fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8");
          devices.push({
            device,
            driver: info.match(/^drm-driver:\s+(\S+)/m)?.[1],
            pci: info.match(/^drm-pdev:\s+(\S+)/m)?.[1],
            graphicsNs: Number(
              info.match(/^drm-engine-(?:gfx|render):\s+(\d+)/m)?.[1] || 0,
            ),
          });
        } catch {}
      }
      return [
        {
          pid,
          name: status.match(/^Name:\s+(.+)/m)[1],
          cpuTicks: Number(stat[11]) + Number(stat[12]),
          rssBytes: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024,
          devices,
        },
      ];
    } catch {
      return [];
    }
  });
}
async function sample(options) {
  const before = processStats();
  const result = await run(
    async ({ kind, duration }) => {
      const c = window.__chronoscope,
        v = c.view,
        scene = v.scene;
      const summary = (a) => {
        a.sort((x, y) => x - y);
        return {
          n: a.length,
          mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null,
          p50: a[Math.floor(a.length * 0.5)] ?? null,
          p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] ?? null,
        };
      };
      const methods = {},
        restore = [];
      for (const key of [
        "updateAxes",
        "rebuildTrails",
        "setFocus",
        "rebuild",
        "updateSpaceTimeFloor",
      ]) {
        const original = v[key];
        methods[key] = [];
        v[key] = function (...args) {
          const start = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            methods[key].push(performance.now() - start);
          }
        };
        restore.push(() => (v[key] = original));
      }
      const frame = [],
        render = [],
        actions = [];
      let previous,
        renderStart,
        lastPhase = 0;
      const pre = scene.preRender.addEventListener(
        () => (renderStart = performance.now()),
      );
      const post = scene.postRender.addEventListener(() =>
        render.push(performance.now() - renderStart),
      );
      const started = performance.now(),
        initial = v.diagnostics().performance.renderedFrames;
      try {
        if (kind === "idle") await new Promise((r) => setTimeout(r, duration));
        else if (kind === "refresh" || kind === "tracks") {
          for (let i = 0; i < 8; i++) {
            const t = performance.now();
            if (kind === "refresh") await c.refresh(true, false);
            else {
              v.camera.moveRight(0.01);
              v.rebuildTrails();
            }
            actions.push(performance.now() - t);
          }
        } else
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(Error("Animation callbacks stalled")),
              duration + 10000,
            );
            const tick = (now) => {
              if (previous !== undefined) frame.push(now - previous);
              previous = now;
              const phase = Math.min(1, (now - started) / duration);
              if (kind === "focus") v.setFocus(phase);
              else if (v.mode === "map")
                v.panPixels((phase - lastPhase) * 45, 0);
              else v.orbitPixels((phase - lastPhase) * 45, 0);
              lastPhase = phase;
              if (phase < 1) requestAnimationFrame(tick);
              else {
                clearTimeout(timeout);
                resolve();
              }
            };
            requestAnimationFrame(tick);
          });
        const cadence = summary(frame);
        return {
          elapsedMs: performance.now() - started,
          frames: v.diagnostics().performance.renderedFrames - initial,
          fps: cadence.mean ? 1000 / cadence.mean : null,
          frameMs: cadence,
          renderCpuMs: summary(render),
          actionMs: summary(actions),
          methods: Object.fromEntries(
            Object.entries(methods).map(([k, a]) => [k, summary(a)]),
          ),
          diagnostics: v.diagnostics(),
          count: c.snapshot.count,
          points: v.points.length,
        };
      } finally {
        pre();
        post();
        restore.forEach((f) => f());
      }
    },
    { kind: options.kind, duration },
  );
  const after = processStats();
  result.processes = after.map((p) => ({
    ...p,
    cpuTicksDelta:
      p.cpuTicks -
      (before.find((b) => b.pid === p.pid)?.cpuTicks ?? p.cpuTicks),
    devices: p.devices.map((d) => ({
      ...d,
      graphicsNsDelta:
        d.graphicsNs -
        (before
          .find((b) => b.pid === p.pid)
          ?.devices.find((b) => b.device === d.device)?.graphicsNs ??
          d.graphicsNs),
    })),
  }));
  report.samples.push({ ...options, ...result });
  save();
  console.log(
    JSON.stringify({
      ...options,
      frames: result.frames,
      fps: result.fps,
      p95: result.frameMs.p95,
      actionP50: result.actionMs.p50,
    }),
  );
  if (
    result.diagnostics.renderErrorCount ||
    result.diagnostics.lastRenderError ||
    result.diagnostics.effectError
  )
    throw Error("Native render error");
  if (
    result.count !== report.setup.count ||
    result.points !== report.setup.points
  )
    throw Error(
      "A benchmark sample changed the data or displayed marker budget",
    );
}
try {
  await command("Inspector.enable");
  await command("Inspector.initialized");
  report.setup = await run(
    async ({ dataset, csv, budget, mode, rows }) => {
      const c = window.__chronoscope;
      await c.ready;
      if (!window.__TAURI_INTERNALS__) throw Error("Requires the native app");
      window.__qaStopStability?.();
      window.__qaStopStability = undefined;
      await c.call("wmts_access", { settings: { offline: true } });
      let importMs;
      if (csv) {
        const start = performance.now();
        const preview = await c.call("import_preview", {
          path: csv,
          storage: "disk",
        });
        await c.call("import_commit", { import_id: preview.import_id });
        importMs = performance.now() - start;
      } else if (dataset !== "current")
        await c.call("demo_open", { id: dataset });
      const p = await c.call("preferences");
      p.basemap = "none";
      p.map.enabled = false;
      p.map_layers = [];
      p.auto_save_unsaved = false;
      await c.call("preferences", { preferences: p });
      await c.call("view_set", {
        mode,
        render_budget: budget,
        display: {
          mode: "points",
          bloom: false,
          show_tracks: true,
          show_trails: true,
          trail_gap_minutes: 0,
          spatial_culling: false,
        },
      });
      await c.refresh(true, false);
      await new Promise((r) => setTimeout(r, 2000));
      await c.viewModeIdle();
      const deadline = performance.now() + 60000;
      while (
        c.busy ||
        !c.view.points.length ||
        (rows && c.snapshot.count !== rows)
      ) {
        if (performance.now() > deadline)
          throw Error("The native render packet did not settle");
        await new Promise((r) => setTimeout(r, 100));
      }
      if (rows && c.view.points.length !== Math.min(rows, budget))
        throw Error(
          "The synthetic workload did not retain the requested marker budget",
        );
      window.__qaCallbacks ||= {
        viewport: c.view.onViewportChange,
        scene: c.view.onSceneChange,
      };
      c.view.onViewportChange = () => {};
      c.view.onSceneChange = () => {};
      c.view.fit();
      await new Promise((r) => setTimeout(r, 1000));
      window.__qaPose = c.view.captureCamera();
      const gl = c.view.viewer.canvas.getContext("webgl2"),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      let callbacks = 0;
      requestAnimationFrame(() => callbacks++);
      await new Promise((r) => setTimeout(r, 500));
      if (!callbacks)
        throw Error("Native animation callbacks stalled; do not report FPS");
      return {
        count: c.snapshot.count,
        points: c.view.points.length,
        importMs,
        viewport: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        resolutionScale: c.view.viewer.resolutionScale,
        mode: c.view.mode,
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        rawWebGLRenderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    },
    { dataset: values.dataset, csv, budget, mode: values.mode, rows },
  );
  report.processes = processStats();
  save();
  const source = ts
    .transpileModule(
      fs.readFileSync(
        path.join(root, "frontend/src/camera-stability.ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(/export /g, "");
  report.stabilizerSha256 = createHash("sha256").update(source).digest("hex");
  for (let round = 0; round < rounds; round++) {
    const candidates = values["position-cache"]
      ? ["baseline", "stabilized", "stabilized-cached"]
      : ["baseline", "stabilized"];
    const variants = values.experiments
      ? candidates
          .slice(round % candidates.length)
          .concat(candidates.slice(0, round % candidates.length))
      : ["current"];
    for (const variant of variants) {
      await evaluate(
        `(async()=>{const v=window.__chronoscope.view;window.__qaStopStability?.();window.__qaStopStability=undefined;window.__qaRestorePos?.();window.__qaRestorePos=undefined;v.restoreCamera(window.__qaPose);v.setFocus(.45);${variant.startsWith("stabilized") ? `const create=(()=>{${source};return cameraStabilizer;})();const stabilize=create(v.camera);window.__qaStopStability=v.scene.preUpdate.addEventListener(()=>stabilize(v.scene.mode));` : ""}${variant.endsWith("-cached") ? `const original=v.pos;let generation=-1,cache=new WeakMap();v.pos=function(point){if(generation!==this.generation){generation=this.generation;cache=new WeakMap();}let position=cache.get(point);if(!position){position=original.call(this,point);cache.set(point,position);}return position;};window.__qaRestorePos=()=>v.pos=original;` : ""}v.rebuild();v.updateAxes();v.requestRender();await new Promise(r=>setTimeout(r,1000));return true;})()`,
      );
      const image = await run(() => {
        const v = window.__chronoscope.view;
        v.requestRender();
        v.viewer.render();
        const canvas = document.createElement("canvas");
        canvas.width = v.viewer.canvas.width;
        canvas.height = v.viewer.canvas.height;
        canvas.getContext("2d").drawImage(v.viewer.canvas, 0, 0);
        return JSON.stringify(canvas.toDataURL("image/png"));
      });
      const png = Buffer.from(image.split(",")[1], "base64"),
        pixels = PNG.sync.read(png);
      const filename = `${round}-${variant}.png`;
      fs.writeFileSync(path.join(out, filename), png);
      report.pixels.push({
        round,
        variant,
        filename,
        sha256: createHash("sha256").update(pixels.data).digest("hex"),
      });
      save();
      const matched = report.pixels.filter((p) => p.round === round);
      if (values.experiments && matched.length > 1) {
        const reference = PNG.sync.read(
          fs.readFileSync(path.join(out, matched[0].filename)),
        );
        let changedPixels = 0,
          maxChannelDelta = 0;
        if (
          reference.width !== pixels.width ||
          reference.height !== pixels.height
        )
          throw Error("The matched image dimensions differ");
        for (let i = 0; i < pixels.data.length; i += 4) {
          let changed = false;
          for (let j = 0; j < 4; j++) {
            const delta = Math.abs(pixels.data[i + j] - reference.data[i + j]);
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            changed ||= delta !== 0;
          }
          if (changed) changedPixels++;
        }
        // Stabilizing a floating-point camera basis can move antialiasing by
        // one 8-bit level. Keep that explicit, bounded and in the raw report;
        // larger changes or geometry loss must fail the experiment.
        const comparison = {
          round,
          reference: matched[0].variant,
          variant,
          changedPixels,
          changedFraction: changedPixels / (pixels.width * pixels.height),
          maxChannelDelta,
          exact: matched[0].sha256 === report.pixels.at(-1).sha256,
        };
        report.pixelComparisons.push(comparison);
        save();
        if (maxChannelDelta > 1 || comparison.changedFraction > 0.001)
          throw Error(
            "The matched map images exceed the recorded pixel tolerance",
          );
      }
      for (const kind of ["idle", "refresh", "tracks", "focus", "orbit"])
        await sample({ round, variant, kind });
    }
  }
  report.passed = true;
} finally {
  try {
    await run(() => {
      const v = window.__chronoscope.view;
      window.__qaStopStability?.();
      window.__qaRestorePos?.();
      window.__qaStopStability = window.__qaRestorePos = undefined;
      if (window.__qaCallbacks) {
        v.onViewportChange = window.__qaCallbacks.viewport;
        v.onSceneChange = window.__qaCallbacks.scene;
        delete window.__qaCallbacks;
      }
      return true;
    });
  } catch (error) {
    report.cleanupError = String(error);
  }
  report.finished = new Date().toISOString();
  save();
  ws.close();
}
