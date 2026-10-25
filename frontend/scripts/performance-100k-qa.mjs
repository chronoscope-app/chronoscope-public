import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Local, opt-in performance comparison. Fixed pixels, evidence and display budgets.
// Measures Chromium's actual WebGL renderer; this is not a native WebKit FPS claim.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_PERF_OUT || path.join(root, ".qa/performance-100k"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/release/chronoscope"),
  [
    "--data-dir",
    path.join(out, "profile"),
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  rows: 100000,
  synthetic: true,
  platform: process.platform,
  rustBuildProfile: process.env.CHRONOSCOPE_QA_RUST_PROFILE || "unspecified",
  started: new Date().toISOString(),
  samples: [],
  errors: [],
  publicRequests: 0,
};
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const csv = path.join(out, "tracks-100k.csv");
  assert(
    fs.statfsSync(out).bavail * fs.statfsSync(out).bsize > 2 * 1024 ** 3,
    "Need 2 GiB disk headroom",
  );
  const rows = ["entity,timestamp,latitude,longitude,category,value"];
  for (let t = 0; t < 1000; t++)
    for (let e = 0; e < 100; e++) {
      const phase = t / 80 + e * 0.13;
      rows.push(
        `T${String(e).padStart(3, "0")},${new Date(1735689600000 + t * 60000).toISOString()},${(24 + Math.floor(e / 10) * 0.8 + Math.sin(phase) * 2 + t * 0.004).toFixed(6)},${(-90 + (e % 10) * 1.2 + Math.cos(phase) * 2 + t * 0.008).toFixed(6)},C${e % 5},${40 + ((t + e) % 100)}`,
      );
    }
  fs.writeFileSync(csv, rows.join("\n") + "\n");
  const importStarted = performance.now();
  const preview = await api("import_preview", { path: csv, storage: "disk" });
  const imported = await api("import_commit", { import_id: preview.import_id });
  report.import = {
    seconds: (performance.now() - importStarted) / 1000,
    imported,
  };
  assert.equal((await api("snapshot", { compact: true })).count, 100000);
  const entity = await api("query", {
    filter: { predicates: [{ field: "entity", op: "Equals", value: "T000" }] },
    limit: 5,
    fields: ["id", "entity"],
  });
  assert.equal(entity.count, 1000);
  if (process.env.CHRONOSCOPE_PERF_PROJECT) {
    await api("save", { path: process.env.CHRONOSCOPE_PERF_PROJECT });
    report.portable_project_saved = true;
  }
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      auto_save_unsaved: false,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
      theme: "dark",
    },
  });
  await api("view_set", {
    mode: "space-time",
    display: {
      mode: "points",
      bloom: true,
      trail_gap_minutes: 0,
      show_tracks: true,
      show_trails: true,
    },
  });
  browser = await chromium.launchHardware();
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1100 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 100000 &&
      !window.__chronoscope.busy,
  );
  await page.waitForFunction(
    () => String(window.__chronoscope.view.onViewportChange).length > 30,
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.view.ready;
    c.view.onViewportChange = () => {};
    await c.refresh(true, false);
    c.view.fit();
  });
  await page.waitForTimeout(1500);
  report.renderer = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      gl = v.viewer.canvas.getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      resolutionScale: v.viewer.resolutionScale,
      points: v.points.length,
      diagnostics: v.diagnostics(),
    };
  });
  assert(
    !/SwiftShader|llvmpipe|software/i.test(report.renderer.renderer),
    "Hardware benchmark requires a hardware renderer",
  );
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  let budget = 20000;
  const measure = async (kind, round) => {
    const before = (await session.send("Performance.getMetrics")).metrics;
    const result = await page.evaluate(
      async ({ kind }) => {
        const c = window.__chronoscope,
          v = c.view,
          scene = v.viewer.scene;
        const summary = (a) => {
          a.sort((x, y) => x - y);
          const p = (q) =>
            a[Math.min(a.length - 1, Math.floor(a.length * q))] || 0;
          return {
            n: a.length,
            mean: a.reduce((n, x) => n + x, 0) / Math.max(1, a.length),
            p50: p(0.5),
            p95: p(0.95),
            p99: p(0.99),
            max: p(1),
          };
        };
        const methods = {};
        const undo = [];
        for (const [o, key, name] of [
          [v, "rebuildTrails", "tracks"],
          [v, "setDisplayOptions", "options"],
          [v, "rebuild", "rebuild"],
          [v, "setFocus", "focus"],
          [v.displayLayer, "rebuild", "display"],
        ]) {
          const original = o[key];
          methods[name] = [];
          o[key] = function (...a) {
            const t = performance.now();
            const r = original.apply(this, a);
            if (r?.then)
              return r.finally(() => methods[name].push(performance.now() - t));
            methods[name].push(performance.now() - t);
            return r;
          };
          undo.push(() => (o[key] = original));
        }
        const render = [];
        let renderStart = 0;
        const pre = scene.preRender.addEventListener(
            () => (renderStart = performance.now()),
          ),
          post = scene.postRender.addEventListener(() =>
            render.push(performance.now() - renderStart),
          );
        const playback = {
          minimumDrawn: Infinity,
          maximumDrawn: 0,
          minimumVisible: Infinity,
          maximumVisible: 0,
          focusBefore: c.captureScene().focus,
          focusAfter: c.captureScene().focus,
        };
        const started = performance.now(),
          frames = [],
          latencies = [];
        let last = started;
        try {
          if (kind === "idle") await new Promise((r) => setTimeout(r, 2000));
          else if (kind === "filter") {
            const [lo, hi] = c.snapshot.time_bounds;
            for (let i = 0; i < 6; i++) {
              const t = performance.now(),
                start = Math.round(lo + ((hi - lo) * i) / 20);
              await c.call("filter", {
                filter: { start, end: Math.round(start + (hi - lo) * 0.25) },
              });
              await c.refresh(true, false);
              latencies.push(performance.now() - t);
            }
            await c.call("filter", { filter: { start: null, end: null } });
            await c.refresh(true, false);
          } else if (kind === "refresh" || kind === "bloom-refresh") {
            for (let i = 0; i < 7; i++) {
              const t = performance.now();
              await c.refresh(true, false);
              latencies.push(performance.now() - t);
            }
          } else {
            if (kind === "playback") document.querySelector("#play").click();
            await new Promise((resolve) => {
              let i = 0;
              const frame = (now) => {
                frames.push(now - last);
                last = now;
                if (kind === "playback") {
                  const drawn = v.glyphs.length + v.arrivingPoints.length;
                  playback.minimumDrawn = Math.min(
                    playback.minimumDrawn,
                    drawn,
                  );
                  playback.maximumDrawn = Math.max(
                    playback.maximumDrawn,
                    drawn,
                  );
                  playback.minimumVisible = Math.min(
                    playback.minimumVisible,
                    c.snapshot.visible,
                  );
                  playback.maximumVisible = Math.max(
                    playback.maximumVisible,
                    c.snapshot.visible,
                  );
                  playback.focusAfter = c.captureScene().focus;
                }
                if (kind.includes("focus")) v.setFocus((i % 180) / 180);
                else if (kind !== "playback") {
                  v.camera.rotateRight(0.0015);
                  v.requestRender();
                }
                if (++i < 180) requestAnimationFrame(frame);
                else resolve();
              };
              requestAnimationFrame(frame);
            });
            if (kind === "playback") {
              document.querySelector("#play").click();
              await c.filterIdle();
              await c.call("filter", { filter: { start: null, end: null } });
              await c.refresh(true, false);
            }
          }
        } finally {
          pre();
          post();
          for (const f of undo) f();
        }
        const elapsed = performance.now() - started;
        const cadence = summary(frames.slice(1));
        return {
          elapsedMs: elapsed,
          // Exclude filter cleanup after Pause from animation cadence.
          fps: cadence.n ? 1000 / cadence.mean : null,
          frameMs: cadence,
          renderMs: summary(render),
          refreshMs: summary(latencies),
          methods: Object.fromEntries(
            Object.entries(methods).map(([k, a]) => [k, summary(a)]),
          ),
          diagnostics: v.diagnostics(),
          effects: { ...v.displayLayer.diagnostics },
          playback: kind === "playback" ? playback : null,
        };
      },
      { kind },
    );
    const after = (await session.send("Performance.getMetrics")).metrics;
    const value = (a, n) => a.find((x) => x.name === n)?.value || 0;
    result.browser = {
      taskSeconds: value(after, "TaskDuration") - value(before, "TaskDuration"),
      heapBytes: value(after, "JSHeapUsedSize"),
      nodes: value(after, "Nodes"),
    };
    result.budget = budget;
    result.kind = kind;
    result.round = round;
    report.samples.push(result);
    console.log(
      JSON.stringify({
        kind,
        round,
        budget,
        fps: result.fps,
        p95: result.frameMs.p95,
        refresh: result.refreshMs.p50,
        tracks: result.methods.tracks.n,
        display: result.methods.display.n,
      }),
    );
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
  };
  for (budget of [20000, 100000]) {
    await page.evaluate(async (budget) => {
      const c = window.__chronoscope;
      await c.call("view_set", { render_budget: budget });
      await c.refresh(true, false);
      c.view.fit();
    }, budget);
    await page.waitForTimeout(800);
    const evidence = await page.evaluate(() => {
      const c = window.__chronoscope,
        p = c.view.displayLayer.packet;
      return {
        count: c.snapshot.count,
        visible: c.snapshot.visible,
        points: c.view.points.length,
        packetCount: p.count,
        cellSum: p.bins.reduce((n, b) => n + b.count, 0),
        bins: p.bins.length,
        diagnostics: c.view.diagnostics(),
        effects: { ...c.view.displayLayer.diagnostics },
      };
    });
    assert.equal(evidence.count, 100000);
    assert.equal(evidence.visible, 100000);
    assert.equal(evidence.points, budget);
    assert.equal(evidence.packetCount, 100000);
    assert.equal(evidence.cellSum, 100000);
    assert.equal(evidence.effects.atlasLayers, 1);
    assert(!evidence.effects.error);
    (report.scenes ||= []).push({ budget, ...evidence });
    for (let round = 0; round < 3; round++)
      for (const kind of [
        "idle",
        "refresh",
        "filter",
        "focus",
        "orbit",
        "playback",
      ]) {
        if (kind === "focus" || kind === "orbit") {
          await page.evaluate(() => window.__chronoscope.view.fit());
          await page.waitForTimeout(250);
        }
        await measure(kind, round);
        if (kind === "playback") {
          const p = report.samples.at(-1).playback;
          assert.equal(p.minimumDrawn, budget);
          assert.equal(p.maximumDrawn, budget);
          assert.equal(p.minimumVisible, 100000);
          assert.equal(p.maximumVisible, 100000);
          assert.notEqual(p.focusBefore, p.focusAfter);
        }
        if (["idle", "refresh", "focus", "orbit"].includes(kind))
          assert.equal(report.samples.at(-1).diagnostics.pointCount, budget);
      }
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      c.view.fit();
      c.view.setFocus(0.5);
      // Finish the camera-dependent kernel at this exact pose, rather than
      // racing the 180ms camera debounce against screenshot capture.
      clearTimeout(c.view.displayLayer.cameraTimer);
      await c.view.displayLayer.groundEffects();
    });
    await page.waitForFunction(
      () => !window.__chronoscope.view.displayLayer.diagnostics.pending,
    );
    await page.waitForTimeout(250);
    await page
      .locator(".cesium-widget canvas")
      .first()
      .screenshot({ path: path.join(out, `bloom-${budget}.png`) });
  }
  const query = [];
  for (let i = 0; i < 15; i++) {
    const t = performance.now();
    const r = await api("query", { limit: 10, fields: ["id", "entity"] });
    assert.equal(r.count, 100000);
    query.push(performance.now() - t);
  }
  report.exactQueryMs = query;
  await session.send("HeapProfiler.collectGarbage");
  report.retainedHeapBytes = (
    await session.send("Performance.getMetrics")
  ).metrics.find((m) => m.name === "JSHeapUsedSize").value;
  if (process.platform === "darwin")
    report.rustProcess = execFileSync(
      "/bin/ps",
      ["-o", "rss=,%cpu=", "-p", String(server.pid)],
      { encoding: "utf8" },
    ).trim();
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.equal(report.publicRequests, 0);
  assert(report.samples.every((s) => s.diagnostics.renderErrorCount === 0));
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
  fs.rmSync(tokenFile, { force: true });
}
