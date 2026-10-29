// Track styling performance, visible correctness and bounded cache lifecycle.
// Software-renderer timings are not native GPU FPS claims.
import {
  chromium,
  spawn,
  localServerUrl,
  createApi,
  qaPaths,
} from "./qa-runtime.mjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(qaPaths.data, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    qaPaths.data,
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
const baseline = process.env.CHRONOSCOPE_TRACK_BASELINE === "1";
const visualOnly = process.env.CHRONOSCOPE_TRACK_VISUAL_ONLY === "1";
const report = {
  passed: false,
  baseline,
  visualOnly,
  checks: [],
  errors: [],
  samples: [],
  publicRequests: 0,
};
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      auto_save_unsaved: false,
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
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
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.ready;
    // A separate real renderer keeps application refreshes from replacing the
    // synthetic fixture while preserving the production Cesium/shader code.
    c.view.viewer.useDefaultRenderLoop = false;
    const host = document.createElement("div");
    host.id = "renderer-reuse-scene";
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
    });
    document.body.append(host);
    const v = new c.view.constructor(host, () => {});
    // Exercise the Mac-native position-sharing path in the isolated fixture.
    v.trackPositionSharingEnabled = true;
    window.__reuseView = v;
    await v.ready;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    v.setPlayback(false);
    v.setSelection([]);
    v.setMode("space-time");
    v.setTheme("dark");
    v.setDisplayOptions({
      ...v.display,
      mode: "points",
      bloom: false,
      show_points: true,
      show_centroids: true,
      show_tracks: true,
      show_trails: true,
      trail_gap_minutes: 0,
    });
    await v.displayLayer.set(null, v.display);
    v.viewer.useDefaultRenderLoop = false;
    window.__reuseRender = () => {
      v.viewer.resize();
      v.requestRender();
      v.scene.render();
    };
  });
  report.renderer = await page.evaluate(() => {
    const gl = window.__reuseView.viewer.canvas.getContext("webgl2");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  await page.evaluate(() => {
    const v = window.__reuseView;
    v.scene.globe.show = false; // Stable isolated buffer/pixel measurements.
    const gl = v.viewer.canvas.getContext("webgl2");
    const live = new Map(),
      bindings = new Map();
    const bind = gl.bindBuffer,
      allocate = gl.bufferData,
      update = gl.bufferSubData,
      release = gl.deleteBuffer;
    window.__trackProbe = { bytes: 0, live };
    const bytes = (value) =>
      typeof value === "number" ? value : value?.byteLength || 0;
    gl.bindBuffer = function (target, buffer) {
      bindings.set(target, buffer);
      return bind.call(this, target, buffer);
    };
    gl.bufferData = function (...args) {
      const size = bytes(args[1]);
      live.set(bindings.get(args[0]), size);
      window.__trackProbe.bytes += size;
      return allocate.apply(this, args);
    };
    gl.bufferSubData = function (...args) {
      window.__trackProbe.bytes += bytes(args[2]);
      return update.apply(this, args);
    };
    gl.deleteBuffer = function (buffer) {
      live.delete(buffer);
      return release.call(this, buffer);
    };
    window.__trackBuffers = () => ({
      count: live.size,
      bytes: [...live.values()].reduce((a, b) => a + b, 0),
    });
    window.__trackFixture = async (count, mode = "space-time", offset = 0) => {
      v.setPlayback(false);
      v.timeHeight = 2.8;
      v.setSelection([]);
      v.setMode(mode);
      v.scene.globe.show = false;
      v.setGlobeTime(mode === "globe");
      v.setDisplayOptions({
        ...v.display,
        mode: "points",
        bloom: false,
        show_points: true,
        show_tracks: true,
        show_trails: true,
        track_opacity: 0.25,
        trail_opacity: 0.25,
        trail_pixels: 2,
        trail_gap_minutes: 0,
      });
      const epoch = 1735689600 + offset;
      const points = Array.from({ length: count }, (_, i) => ({
        id: String(9007199254740993n + BigInt(i)),
        entity: i % 100,
        time: epoch + Math.floor(i / 100) * 60,
        lat: 30 + (i % 10) * 0.12 + Math.sin(i / 100) * 0.01 + offset / 1e7,
        lon: -80 + Math.floor((i % 100) / 10) * 0.12 + Math.cos(i / 100) * 0.01,
        value: i % 101,
        inferred: i % 1000 === 0,
        centroid: false,
      }));
      await v.setData(
        points,
        Array.from({ length: 100 }, (_, i) => `T${i}`),
        [-80.1, 29.9 + offset / 1e7, -78.7, 31.3 + offset / 1e7],
        [epoch, epoch + (count / 100) * 60],
      );
      v.fit();
      for (let i = 0; i < 5; i++) window.__reuseRender();
      v.rebuildTrails();
      window.__reuseRender();
    };
    window.__trackSignature = () =>
      JSON.stringify(
        Array.from({ length: v.trails.length }, (_, i) => v.trails.get(i))
          .filter((line) => line.show)
          .map((line) => ({
            width: line.width,
            color: line.material.uniforms.color,
            positions: line.positions.map((p) => [p.x, p.y, p.z]),
          })),
      );
    window.__trackFresh = () => {
      v.trailRenderKey = "";
      v.rebuildTrails();
      window.__reuseRender();
    };
    window.__trackImage = () => {
      window.__reuseRender();
      return v.viewer.canvas.toDataURL();
    };
  });
  if (!visualOnly) {
    // Multiple paired samples measure scripting separately from actual buffer submission.
    for (const count of [10000, 100000]) {
      await page.evaluate((count) => window.__trackFixture(count), count);
      for (let sample = 0; sample < 3; sample++) {
        const result = await page.evaluate(
          ({ count, baseline }) => {
            const v = window.__reuseView,
              original = v.trails.get(0),
              probe = window.__trackProbe;
            const before = v.diagnostics().resourceReuse;
            probe.bytes = 0;
            const started = performance.now();
            for (let i = 0; i < 12; i++)
              v.setDisplayOptions({
                ...v.display,
                track_opacity: 0.15 + i * 0.03,
                trail_opacity: 0.2 + i * 0.02,
              });
            const cpuMs = performance.now() - started;
            window.__reuseRender();
            if (
              !baseline &&
              (v.trails.get(0) !== original ||
                before.trailGeometryBuilds !==
                  v.diagnostics().resourceReuse.trailGeometryBuilds)
            )
              throw Error("Opacity rebuilt track geometry");
            const opacityBytes = probe.bytes;
            probe.bytes = 0;
            const toggleStarted = performance.now();
            for (let i = 0; i < 12; i++)
              v.setDisplayOptions({
                ...v.display,
                show_tracks: i % 2 === 1,
                show_trails: i % 2 === 1,
              });
            const toggleCpuMs = performance.now() - toggleStarted;
            window.__reuseRender();
            if (!baseline && v.trails.get(0) !== original)
              throw Error("Warm visibility toggles rebuilt tracks");
            return {
              count,
              cpuMs,
              toggleCpuMs,
              opacityBytes,
              toggleBytes: probe.bytes,
              buffers: window.__trackBuffers(),
            };
          },
          { count, baseline },
        );
        report.samples.push(result);
      }
      console.log("PASS", count, "track opacity/toggle measurements");
    }
    report.visibilityMemory = [];
    for (const [label, tracks, trails] of [
      ["both", true, true],
      ["tracks-only", true, false],
      ["off", false, false],
      ["restored", true, true],
    ]) {
      report.visibilityMemory.push(
        await page.evaluate(
          ({ label, tracks, trails }) => {
            const v = window.__reuseView;
            v.setDisplayOptions({
              ...v.display,
              show_tracks: tracks,
              show_trails: trails,
            });
            window.__reuseRender();
            const lines = Array.from({ length: v.trails.length }, (_, i) =>
              v.trails.get(i),
            );
            return {
              label,
              buffers: window.__trackBuffers(),
              allocatedPolylines: lines.length,
              cachedVertices: lines.reduce(
                (n, line) => n + line.positions.length,
                0,
              ),
              visiblePolylines: lines.filter((line) => line.show).length,
            };
          },
          { label, tracks, trails },
        ),
      );
    }
    if (!baseline) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      const beforeHeap = await cdp.send("Runtime.getHeapUsage");
      const memory = await page.evaluate(() => {
        const v = window.__reuseView,
          before = window.__trackBuffers(),
          refs = Array.from({ length: v.trails.length }, (_, i) =>
            v.trails.get(i),
          );
        for (let i = 0; i < 100; i++) {
          v.setDisplayOptions({
            ...v.display,
            show_tracks: false,
            show_trails: false,
          });
          window.__reuseRender();
          v.setDisplayOptions({
            ...v.display,
            show_tracks: true,
            show_trails: true,
          });
          window.__reuseRender();
        }
        window.__reuseRender();
        if (refs.some((line, i) => line !== v.trails.get(i)))
          throw Error("Toggle cycles replaced cached polylines");
        const after = window.__trackBuffers();
        if (after.bytes > before.bytes || after.count > before.count)
          throw Error("WebGL buffers grew after warm toggles");
        return { before, after, cycles: 100, diagnostics: v.diagnostics() };
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const afterHeap = await cdp.send("Runtime.getHeapUsage");
      if (afterHeap.usedSize - beforeHeap.usedSize > 2 * 1024 * 1024)
        throw Error("Toggle cycles retained more than 2 MiB extra JS heap");
      report.memory = {
        ...memory,
        heapBefore: beforeHeap.usedSize,
        heapAfter: afterHeap.usedSize,
      };
      await page.evaluate(async () => {
        const v = window.__reuseView;
        window.__oldTrackPoint = new WeakRef(v.points[10]);
        v.setDisplayOptions({
          ...v.display,
          show_tracks: false,
          show_trails: false,
        });
        v.zoom(1.2);
        v.rebuildTrails();
        if (v.trails.length !== 0)
          throw Error("Hidden stale geometry was retained after camera change");
        window.__reuseRender();
        window.__releasedTrackBuffers = window.__trackBuffers();
        await window.__trackFixture(400, "space-time", 10000);
      });
      await cdp.send("HeapProfiler.collectGarbage");
      report.releasedBuffers = await page.evaluate(
        () => window.__releasedTrackBuffers,
      );
      if (report.releasedBuffers.bytes >= memory.after.bytes)
        throw Error(
          "Hidden invalidation failed to release retained GPU buffers",
        );
      if (
        await page.evaluate(() => window.__oldTrackPoint.deref() !== undefined)
      )
        throw Error("Replaced dataset remains retained by track cache");
      report.checks.push(
        "100 hide/show cycles keep GPU buffers and JS heap bounded; replaced data is collectible",
      );
      // User-visible stale-geometry checks: camera, time window, selection, terrain and gaps.
      for (const action of [
        "hidden-camera",
        "hidden-data",
        "selection",
        "height",
        "terrain",
        "gaps",
      ]) {
        await page.evaluate(async (action) => {
          const v = window.__reuseView;
          if (action === "hidden-camera") {
            v.setDisplayOptions({
              ...v.display,
              show_tracks: false,
              show_trails: false,
            });
            v.zoom(1.3);
            v.rebuildTrails();
            v.setDisplayOptions({
              ...v.display,
              show_tracks: true,
              show_trails: true,
            });
          }
          if (action === "hidden-data") {
            v.setDisplayOptions({
              ...v.display,
              show_tracks: false,
              show_trails: false,
            });
            await v.setData(
              v.points.map((p) => ({
                ...p,
                time: p.time + 600,
                lat: p.lat + 0.001,
              })),
              v.names,
              [...v.bounds],
              [v.lo + 600, v.hi + 600],
            );
            if (v.trails.length !== 0)
              throw Error("Hidden time-window change retained stale tracks");
            v.setDisplayOptions({
              ...v.display,
              show_tracks: true,
              show_trails: true,
            });
          }
          if (action === "selection") {
            v.setSelection([v.points[40].id]);
            v.rebuildTrails();
            v.setDisplayOptions({ ...v.display, track_opacity: 0.55 });
          }
          if (action === "height") {
            v.timeHeight *= 1.3;
            v.rebuild(true);
            v.setDisplayOptions({ ...v.display, trail_opacity: 0.4 });
          }
          if (action === "terrain") {
            v.setTerrainDatum("ellipsoid");
            await v.setTerrain({
              bounds: [-80.1, 29.9, -78.7, 31.3],
              width: 3,
              height: 3,
              elevations: [100, 120, 140, 110, 130, 150, 120, 140, 160],
              minimum: 100,
              maximum: 160,
              covered: 9,
              tiles: 1,
            });
          }
          if (action === "gaps")
            v.setDisplayOptions({ ...v.display, trail_gap_minutes: 0.5 });
          window.__reuseRender();
          const actual = window.__trackSignature();
          window.__trackFresh();
          if (actual !== window.__trackSignature())
            throw Error(action + " differs from a fresh geometry rebuild");
          if (v.diagnostics().renderErrorCount)
            throw Error("WebGL error after " + action);
        }, action);
        report.checks.push(action + " matches fresh track geometry");
      }
      // Globe detail budgets must remain exact when visible stream count changes.
      report.globeBudget = await page.evaluate(async () => {
        const v = window.__reuseView;
        await v.setTerrain(null);
        v.setSelection([]);
        v.setMode("globe");
        v.setGlobeTime(false);
        v.setDisplayOptions({
          ...v.display,
          trail_pixels: 0,
          trail_gap_minutes: 0,
          show_tracks: true,
          show_trails: true,
        });
        const points = Array.from({ length: 6000 }, (_, i) => ({
          id: `long-${i}`,
          entity: 0,
          time: 1735689600 + i,
          lat: 20,
          lon: i % 2 ? 40 : -40,
          value: 0,
        }));
        await v.setData(
          points,
          ["Long arcs"],
          [-45, 19, 45, 21],
          [1735689600, 1735695600],
        );
        v.fit();
        v.rebuildTrails();
        const before = v.diagnostics();
        if (before.geodesicRendering.trails.coarsened === 0)
          throw Error("Long-arc fixture must exercise interpolation budget");
        v.setDisplayOptions({ ...v.display, show_trails: false });
        const actual = window.__trackSignature();
        v.trailRenderKey = "";
        v.rebuildTrails();
        if (actual !== window.__trackSignature())
          throw Error("Visibility changed globe curve detail");
        const after = v.diagnostics();
        if (
          after.allocatedTrackVertices > 400000 ||
          after.resourceReuse.trailGlobeStreamRebuilds <=
            before.resourceReuse.trailGlobeStreamRebuilds
        )
          throw Error("Globe budget fallback failed");
        return {
          beforeVertices: before.allocatedTrackVertices,
          afterVertices: after.allocatedTrackVertices,
          fallbacks: after.resourceReuse.trailGlobeStreamRebuilds,
        };
      });
      report.checks.push(
        "Long globe arcs preserve curve detail and the vertex budget when a layer is hidden",
      );
    }
  }
  // Exact baseline/candidate image pairs exercise every visibility combination.
  for (const mode of ["space-time", "map", "globe"]) {
    await page.evaluate(async (mode) => {
      await window.__reuseView.setTerrain(null);
      await window.__trackFixture(400, mode);
    }, mode);
    for (const [label, tracks, trails, opacity] of [
      ["both", true, true, 0.25],
      ["dim", true, true, 0.07],
      ["tracks", true, false, 0.45],
      ["ground", false, true, 0.45],
      ["off", false, false, 0.25],
      ["restore", true, true, 0.25],
    ]) {
      const image = await page.evaluate(
        ({ tracks, trails, opacity }) => {
          const v = window.__reuseView;
          v.setDisplayOptions({
            ...v.display,
            show_tracks: tracks,
            show_trails: trails,
            track_opacity: opacity,
            trail_opacity: opacity,
          });
          window.__reuseRender();
          if (!tracks && !trails && v.diagnostics().trackPolylines !== 0)
            throw Error("Hidden tracks still reported drawn");
          return window.__trackImage();
        },
        { tracks, trails, opacity },
      );
      fs.writeFileSync(
        path.join(qaPaths.screenshots, `${mode}-${label}.png`),
        Buffer.from(image.split(",")[1], "base64"),
      );
    }
    for (const lazy of ["tracks", "trails"]) {
      const image = await page.evaluate((lazy) => {
        const v = window.__reuseView;
        v.setDisplayOptions({
          ...v.display,
          show_tracks: lazy !== "tracks",
          show_trails: lazy !== "trails",
        });
        window.__trackFresh();
        v.setDisplayOptions({
          ...v.display,
          show_tracks: true,
          show_trails: true,
        });
        return window.__trackImage();
      }, lazy);
      fs.writeFileSync(
        path.join(qaPaths.screenshots, `${mode}-lazy-${lazy}.png`),
        Buffer.from(image.split(",")[1], "base64"),
      );
    }
    report.checks.push(
      mode + " opacity/visibility renders without stale or hidden tracks",
    );
  }
  if (!visualOnly) {
    // Exercise the real Views-panel input path with bloom visible, including
    // coalesced drag previews and the final persisted value.
    await api("view_set", {
      mode: "space-time",
      display: {
        mode: "points",
        bloom: true,
        show_points: true,
        show_tracks: true,
        show_trails: true,
        track_opacity: 0.25,
        trail_opacity: 0.25,
        trail_gap_minutes: 0,
      },
    });
    assert.equal(
      await page.evaluate(
        () => window.__reuseView.diagnostics().renderErrorCount,
      ),
      0,
    );
    // Start this interaction from a fresh page so prior stress-fixture GC and
    // buffers cannot bias the user's slider timings.
    await page.reload();
    await page.waitForFunction(() => window.__chronoscope?.ready);
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.ready;
      c.view.onViewportChange = () => {};
      c.view.onSceneChange = () => {};
      await c.refresh(true, false);
      await c.restoreScene(c.snapshot.scene);
      c.view.viewer.useDefaultRenderLoop = true;
      c.view.fit();
    });
    await page.click('[data-tab="views"]');
    await page.waitForFunction(() => {
      const layer = window.__chronoscope.view.displayLayer;
      return layer.diagnostics.atlasLayers === 1 && !layer.diagnostics.pending;
    });
    await page.waitForTimeout(600);
    report.ui = await page.evaluate(async (baseline) => {
      const v = window.__chronoscope.view,
        layer = v.displayLayer;
      const input = document.querySelector('input[data-amount="tracks"]');
      const atlas = layer.atlas,
        generation = layer.generation,
        times = [];
      input.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
      );
      for (const value of [15, 65, 25]) {
        const start = performance.now();
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        times.push(performance.now() - start);
        if (
          v.display.track_opacity !== value / 100 ||
          input.getAttribute("aria-valuetext") !== `${value}%`
        )
          throw Error("Visible track slider lost a drag update");
      }
      const atlasPreserved = atlas === layer.atlas,
        effectRestarts = layer.generation - generation;
      if (
        !baseline &&
        (!atlasPreserved || effectRestarts !== 0 || layer.diagnostics.pending)
      )
        throw Error("Track slider restarted or replaced visible bloom");
      input.dispatchEvent(new Event("change", { bubbles: true }));
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
      );
      return {
        dragPreviewMs: times,
        atlasPreserved,
        effectRestarts,
        events: v.points.length,
      };
    }, baseline);
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.scene.display.track_opacity === 0.25,
    );
    await page.screenshot({
      path: path.join(qaPaths.screenshots, "user-track-controls.png"),
    });
    report.checks.push(
      baseline
        ? "Actual slider previews apply; baseline effect restarts are recorded"
        : "Actual track slider applies every drag preview and retains bloom without a restart",
    );
  }
  assert.deepEqual(report.errors, []);
  assert.equal(
    await page.evaluate(
      () =>
        (window.__reuseView || window.__chronoscope.view).diagnostics()
          .renderErrorCount,
    ),
    0,
  );
  report.passed = true;
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.writeFileSync(
    path.join(qaPaths.out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
