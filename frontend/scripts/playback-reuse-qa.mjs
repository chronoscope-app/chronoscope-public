// Real production renderer, local bridge, controlled playback clock. Timings
// cover packet installation and explicit renders, not physical-GPU/native FPS.
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
import { PNG } from "pngjs";
const root = path.resolve(import.meta.dirname, "../..");
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(qaPaths.data, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const baseline = process.env.CHRONOSCOPE_PLAYBACK_BASELINE === "1";
const visualOnly = process.env.CHRONOSCOPE_PLAYBACK_VISUAL_ONLY === "1";
const loadOnly = process.env.CHRONOSCOPE_PLAYBACK_LOAD_ONLY === "1";
const tracksPaired = process.env.CHRONOSCOPE_PLAYBACK_TRACKS_PAIRED === "1";
const pairedTrailPixels = Number(
  process.env.CHRONOSCOPE_PLAYBACK_TRAIL_PIXELS ?? 0,
);
assert(
  Number.isFinite(pairedTrailPixels) &&
    pairedTrailPixels >= 0 &&
    pairedTrailPixels <= 20,
);
const paired = process.env.CHRONOSCOPE_PLAYBACK_PAIRED === "1" || tracksPaired;
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
const report = {
  passed: false,
  baseline,
  visualOnly,
  loadOnly,
  paired,
  tracksPaired,
  pairedTrailPixels,
  checks: [],
  errors: [],
  samples: [],
};
let browser;
try {
  const url = await localServerUrl(server),
    api = createApi(url, token);
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
      date_format: "iso",
      time_format: "24h",
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
  });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    return /^https?:/.test(u) && !u.startsWith(url + "/")
      ? route.abort()
      : route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  report.defaultPositionSharing = await page.evaluate(
    () =>
      window.__chronoscope.view.diagnostics().resourceReuse
        .trackPositionSharingEnabled,
  );
  assert.equal(
    report.defaultPositionSharing,
    false,
    "Browser must retain canonical position conversion by default",
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.ready;
    c.view.viewer.useDefaultRenderLoop = false;
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
    });
    document.body.append(host);
    const v = (window.__playbackView = new c.view.constructor(host, () => {}));
    // Exercise the Mac-native position-sharing path in this isolated Chrome fixture.
    v.trackPositionSharingEnabled = true;
    await v.ready;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    v.viewer.useDefaultRenderLoop = false;
    // Both builds see identical 90 ms logical packet intervals, regardless of
    // CPU speed. Wall-clock measurements use the original monotonic clock.
    window.__realNow = performance.now.bind(performance);
    window.__packetClock = 10000;
    performance.now = () => window.__packetClock;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf(() => callback(window.__packetClock));
    window.__renderPlayback = () => {
      v.viewer.resize();
      v.requestRender();
      v.scene.render();
    };
    window.__playbackFixture = async (
      count,
      mode,
      tracks = false,
      fade = true,
    ) => {
      v.setPlayback(false);
      v.setPlaybackFade(fade);
      v.setMode(mode);
      v.scene.globe.show = false;
      v.setTheme("dark");
      v.setSelection([]);
      v.setDisplayOptions({
        ...v.display,
        mode: "points",
        bloom: false,
        show_points: true,
        show_centroids: true,
        show_tracks: tracks,
        show_trails: tracks,
        trail_pixels: 0,
        trail_gap_minutes: 0,
        track_opacity: 0.25,
        trail_opacity: 0.25,
      });
      await v.displayLayer.set(null, v.display);
      const epoch = 1735689600,
        delta = Math.max(2, Math.floor(count / 200));
      const pool = Array.from({ length: count + delta * 12 }, (_, i) => ({
        id: String(9007199254740993n + BigInt(i)),
        entity: i % 100,
        time: epoch + i * 6,
        lat: 30 + (i % 20) * 0.04 + Math.sin(i / 100) * 0.002,
        lon:
          -80 + Math.floor((i % 400) / 20) * 0.04 + Math.cos(i / 100) * 0.002,
        value: i % 101,
        inferred: i % 97 === 0,
        centroid: i % 997 === 0,
      }));
      const bounds = [-80.1, 29.9, -79.1, 30.9];
      const names = Array.from({ length: 100 }, (_, i) => `Entity ${i}`);
      window.__playbackData = { count, delta, epoch, pool, bounds, names };
      const started = window.__realNow();
      await v.setData(pool.slice(0, count), names, bounds, [
        epoch,
        epoch + count * 6,
      ]);
      const installed = window.__realNow();
      v.fit();
      window.__renderPlayback();
      window.__renderPlayback();
      window.__lastPlaybackLoad = {
        installMs: installed - started,
        installFitAndTwoRendersMs: window.__realNow() - started,
      };
      v.setPlayback(true);
    };
    window.__playbackStep = async (offset, custom) => {
      const d = window.__playbackData;
      window.__packetClock += 90;
      await v.setData(
        custom || d.pool.slice(offset, offset + d.count),
        d.names,
        d.bounds,
        [d.epoch + offset * 6, d.epoch + (offset + d.count) * 6],
      );
      cancelAnimationFrame(v.fadeFrame);
      v.fadeFrame = 0;
    };
  });
  report.renderer = await page.evaluate(() => {
    const gl = window.__playbackView.viewer.canvas.getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  });
  report.browserVersion = browser.version();
  report.fixtureGraphics = await page.evaluate(() => {
    const v = window.__playbackView;
    return {
      ...v.diagnostics().graphics,
      viewport: [v.host.clientWidth, v.host.clientHeight],
    };
  });
  if (loadOnly) {
    report.loads = [];
    for (const mode of ["map", "space-time"]) {
      const trials = [];
      for (let i = 0; i < 3; i++) {
        trials.push(
          await page.evaluate(async (mode) => {
            // Empty the packet first so this always installs a full dataset.
            const v = window.__playbackView;
            v.setPlayback(false);
            await v.setData([], [], undefined, [0, 1]);
            await window.__playbackFixture(100000, mode);
            return window.__lastPlaybackLoad;
          }, mode),
        );
      }
      report.loads.push({ count: 100000, mode, trials });
    }
  }
  if (paired) {
    report.pairedSamples = [];
    if (tracksPaired) {
      // Axis-label antialiasing can drift by one channel value even between
      // identical canonical rebuilds. Isolate the trail/stem evidence here;
      // native traces and the ordinary visual suites keep the labels enabled.
      await page.evaluate(() => {
        window.__playbackView.axisLabels.show = false;
      });
      report.pairedVisualScope =
        "Trails/stems/markers; axis labels hidden in both variants";
    }
    for (const count of [10000, 100000])
      for (const mode of ["map", "space-time"]) {
        const trials = [];
        for (let pair = 0; pair < 3; pair++)
          for (const fresh of pair % 2 ? [true, false] : [false, true]) {
            trials.push(
              await page.evaluate(
                async ({
                  count,
                  mode,
                  fresh,
                  tracksPaired,
                  pairedTrailPixels,
                }) => {
                  const v = window.__playbackView,
                    plan = v.playbackMarkerPlan,
                    positionSharing = v.trackPositionSharingEnabled;
                  if (tracksPaired) v.trackPositionSharingEnabled = !fresh;
                  await window.__playbackFixture(count, mode, tracksPaired);
                  if (tracksPaired)
                    v.setDisplayOptions({
                      ...v.display,
                      trail_pixels: pairedTrailPixels,
                    });
                  if (fresh) {
                    if (tracksPaired) v.trackPositionSharingEnabled = false;
                    else v.playbackMarkerPlan = () => "order";
                  }
                  const installsMs = [],
                    packetAndRenderMs = [];
                  const reusesBefore =
                    v.diagnostics().resourceReuse.trackPositionReuses;
                  try {
                    for (let step = 1; step <= 6; step++) {
                      const start = window.__realNow();
                      await window.__playbackStep(
                        step * window.__playbackData.delta,
                      );
                      installsMs.push(window.__realNow() - start);
                      window.__renderPlayback();
                      packetAndRenderMs.push(window.__realNow() - start);
                      if (tracksPaired) {
                        for (const batch of v.trailBatches) {
                          if (!batch.line.show) continue;
                          if (
                            batch.line.positions.length !== batch.points.length
                          )
                            throw Error("Changed trail endpoint count");
                          batch.points.forEach((p, i) => {
                            const expected =
                                batch.kind === "tracks"
                                  ? v.pos(p)
                                  : v.groundPosition(p.lat, p.lon),
                              actual = batch.line.positions[i];
                            if (
                              actual.x !== expected.x ||
                              actual.y !== expected.y ||
                              actual.z !== expected.z
                            )
                              throw Error(
                                "Trail coordinate differs from canonical projection",
                              );
                          });
                        }
                      }
                    }
                  } finally {
                    v.playbackMarkerPlan = plan;
                    v.trackPositionSharingEnabled = positionSharing;
                  }
                  const trackPositionReuses =
                    v.diagnostics().resourceReuse.trackPositionReuses -
                    reusesBefore;
                  if (
                    tracksPaired &&
                    (fresh
                      ? trackPositionReuses !== 0
                      : trackPositionReuses <= 0)
                  )
                    throw Error(
                      "Paired position-sharing control was not exercised",
                    );
                  return {
                    fresh,
                    installsMs,
                    packetAndRenderMs,
                    trackPositionReuses,
                  };
                },
                { count, mode, fresh, tracksPaired, pairedTrailPixels },
              ),
            );
            if (tracksPaired && pair === 0 && !fresh) {
              // Compare the same settled frame. Separate playback histories
              // can leave different arrival/departure cohorts at capture time.
              await page.evaluate(async () => {
                const v = window.__playbackView;
                v.setPlayback(false);
                v.rebuild(true);
                for (let frame = 0; frame < 4; frame++) {
                  await new Promise(requestAnimationFrame);
                  window.__renderPlayback();
                }
              });
              await page.screenshot({
                path: path.join(
                  qaPaths.screenshots,
                  `${count}-${mode}-shared.png`,
                ),
              });
              await page.evaluate(async () => {
                const v = window.__playbackView,
                  positionSharing = v.trackPositionSharingEnabled;
                v.trackPositionSharingEnabled = false;
                try {
                  v.rebuild(true);
                  for (let frame = 0; frame < 4; frame++) {
                    await new Promise(requestAnimationFrame);
                    window.__renderPlayback();
                  }
                } finally {
                  v.trackPositionSharingEnabled = positionSharing;
                }
              });
              await page.screenshot({
                path: path.join(
                  qaPaths.screenshots,
                  `${count}-${mode}-canonical.png`,
                ),
              });
              const a = PNG.sync.read(
                  fs.readFileSync(
                    path.join(
                      qaPaths.screenshots,
                      `${count}-${mode}-shared.png`,
                    ),
                  ),
                ),
                b = PNG.sync.read(
                  fs.readFileSync(
                    path.join(
                      qaPaths.screenshots,
                      `${count}-${mode}-canonical.png`,
                    ),
                  ),
                );
              assert.equal(a.width, b.width);
              assert.equal(a.height, b.height);
              if (!a.data.equals(b.data)) {
                await page.evaluate(() => {
                  const v = window.__playbackView,
                    positionSharing = v.trackPositionSharingEnabled;
                  v.trackPositionSharingEnabled = false;
                  try {
                    v.rebuild(true);
                    window.__renderPlayback();
                    window.__renderPlayback();
                  } finally {
                    v.trackPositionSharingEnabled = positionSharing;
                  }
                });
                const bytes = await page.screenshot({
                  path: path.join(
                    qaPaths.screenshots,
                    `${count}-${mode}-canonical-repeat.png`,
                  ),
                });
                const repeat = PNG.sync.read(bytes);
                report.pixelControl = {
                  count,
                  mode,
                  canonicalRepeatEqual: b.data.equals(repeat.data),
                };
              }
              assert(
                a.data.equals(b.data),
                `Canonical and shared trail/stem pixels differ: ${count} ${mode}`,
              );
            }
          }
        if (tracksPaired) {
          report.checks.push(
            `Exact canonical coordinates across 36 packets and settled trail/stem pixels: ${count} ${mode}`,
          );
        }
        report.pairedSamples.push({
          count,
          mode,
          tracks: tracksPaired,
          trials,
        });
      }
  }
  if (!visualOnly && !loadOnly && !paired) {
    for (const count of [10000, 100000])
      for (const mode of ["map", "space-time"]) {
        const samples = [];
        for (let trial = 0; trial < 3; trial++) {
          samples.push(
            await page.evaluate(
              async ({ count, mode, baseline }) => {
                await window.__playbackFixture(count, mode);
                const v = window.__playbackView,
                  d = window.__playbackData;
                const survivorId = d.pool[Math.floor(count / 2)].id,
                  survivor = v.glyphById.get(survivorId);
                const before = v.diagnostics().resourceReuse;
                const gl = v.viewer.canvas.getContext("webgl2"),
                  data = gl.bufferData,
                  sub = gl.bufferSubData;
                let bufferBytes = 0,
                  bufferCalls = 0;
                const size = (d) =>
                  typeof d === "number" ? d : d?.byteLength || 0;
                gl.bufferData = function (...args) {
                  bufferBytes += size(args[1]);
                  bufferCalls++;
                  return data.apply(this, args);
                };
                gl.bufferSubData = function (...args) {
                  bufferBytes += size(args[2]);
                  bufferCalls++;
                  return sub.apply(this, args);
                };
                const installs = [],
                  rendered = [];
                try {
                  for (let step = 1; step <= 6; step++) {
                    const start = window.__realNow();
                    await window.__playbackStep(step * d.delta);
                    const installed = window.__realNow();
                    window.__renderPlayback();
                    installs.push(installed - start);
                    rendered.push(window.__realNow() - start);
                  }
                } finally {
                  gl.bufferData = data;
                  gl.bufferSubData = sub;
                }
                const after = v.diagnostics().resourceReuse;
                const retained = v.glyphById.get(survivorId) === survivor;
                if (!baseline && !retained)
                  throw Error("Overlapping marker was recreated");
                if (
                  !baseline &&
                  after.playbackMarkerPatches - before.playbackMarkerPatches !==
                    6
                )
                  throw Error(
                    "Forward time-ordered packets missed incremental path",
                  );
                return {
                  installsMs: installs,
                  packetAndRenderMs: rendered,
                  bufferBytes,
                  bufferCalls,
                  survivorRetained: retained,
                  countersBefore: before,
                  countersAfter: after,
                  allocatedMarkerSlots: v.diagnostics().allocatedMarkerSlots,
                };
              },
              { count, mode, baseline },
            ),
          );
        }
        report.samples.push({
          count,
          mode,
          changedPerPacket: count / 200,
          tracks: false,
          trials: samples,
        });
        console.log("PASS playback measurement", count, mode);
      }
    // Include the unchanged trail/axis costs in a representative total. This is
    // intentionally separate from the marker-only comparison above.
    report.withTracks = await page.evaluate(async () => {
      await window.__playbackFixture(100000, "space-time", true);
      const d = window.__playbackData,
        installs = [],
        rendered = [];
      for (let i = 1; i <= 3; i++) {
        const start = window.__realNow();
        await window.__playbackStep(i * d.delta);
        installs.push(window.__realNow() - start);
        window.__renderPlayback();
        rendered.push(window.__realNow() - start);
      }
      return {
        count: 100000,
        installsMs: installs,
        packetAndRenderMs: rendered,
      };
    });
    if (!baseline) {
      const cdp = await page.context().newCDPSession(page);
      await page.evaluate(async () => {
        const gl = window.__playbackView.viewer.canvas.getContext("webgl2");
        const create = gl.createBuffer,
          remove = gl.deleteBuffer,
          data = gl.bufferData;
        const buffers = new Map();
        gl.createBuffer = function (...args) {
          const buffer = create.apply(this, args);
          buffers.set(buffer, 0);
          return buffer;
        };
        gl.deleteBuffer = function (buffer) {
          buffers.delete(buffer);
          return remove.call(this, buffer);
        };
        gl.bufferData = function (target, source, ...rest) {
          const parameter =
            target === gl.ARRAY_BUFFER
              ? gl.ARRAY_BUFFER_BINDING
              : target === gl.ELEMENT_ARRAY_BUFFER
                ? gl.ELEMENT_ARRAY_BUFFER_BINDING
                : target === gl.COPY_WRITE_BUFFER
                  ? gl.COPY_WRITE_BUFFER_BINDING
                  : null;
          if (parameter !== null)
            buffers.set(
              gl.getParameter(parameter),
              typeof source === "number" ? source : source?.byteLength || 0,
            );
          return data.call(this, target, source, ...rest);
        };
        window.__markerBufferFootprint = () => ({
          buffers: buffers.size,
          bytes: [...buffers.values()].reduce((a, b) => a + b, 0),
        });
        window.__restoreMarkerBufferTracking = () => {
          gl.createBuffer = create;
          gl.deleteBuffer = remove;
          gl.bufferData = data;
        };
        await window.__playbackFixture(2000, "map", false, false);
        window.__oldPlaybackPoint = new WeakRef(window.__playbackData.pool[0]);
        window.__playbackData.pool[0] = { ...window.__playbackData.pool[0] };
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const beforeHeap = await cdp.send("Runtime.getHeapUsage");
      report.memory = await page.evaluate(async () => {
        const v = window.__playbackView,
          d = window.__playbackData;
        const before = v.diagnostics().resourceReuse,
          observed = [],
          footprints = [];
        for (let step = 1; step <= 150; step++) {
          const points = Array.from({ length: 2000 }, (_, j) => {
            const i = step * 40 + j;
            return {
              ...d.pool[i % d.pool.length],
              id: String(9007199255740993n + BigInt(i)),
              time: d.epoch + i * 6,
            };
          });
          await window.__playbackStep(0, points);
          window.__renderPlayback();
          const diag = v.diagnostics();
          observed.push(diag.allocatedMarkerSlots);
          footprints.push(window.__markerBufferFootprint());
          if (diag.allocatedMarkerSlots > 6096)
            throw Error("Unbounded retained marker slots");
        }
        d.pool = []; // The renderer must not retain the replaced source object.
        const after = v.diagnostics().resourceReuse;
        if (after.playbackMarkerCompactions <= before.playbackMarkerCompactions)
          throw Error("No bounded compaction exercised");
        v.setPlayback(false);
        window.__renderPlayback();
        if (v.diagnostics().allocatedMarkerSlots !== 2000)
          throw Error("Pause did not release dormant slots");
        const peakBufferBytes = Math.max(...footprints.map((f) => f.bytes));
        if (peakBufferBytes > 8 * 1024 * 1024)
          throw Error("Unexpected GPU buffer growth for a 2000-event window");
        window.__restoreMarkerBufferTracking();
        return {
          cycles: 150,
          maxSlots: Math.max(...observed),
          pausedSlots: v.diagnostics().allocatedMarkerSlots,
          peakTrackedBufferBytes: peakBufferBytes,
          peakTrackedBufferObjects: Math.max(
            ...footprints.map((f) => f.buffers),
          ),
          pausedBufferFootprint: window.__markerBufferFootprint(),
          compactions:
            after.playbackMarkerCompactions - before.playbackMarkerCompactions,
        };
      });
      await cdp.send("HeapProfiler.collectGarbage");
      const afterHeap = await cdp.send("Runtime.getHeapUsage");
      report.memory.retainedHeapDeltaBytes =
        afterHeap.usedSize - beforeHeap.usedSize;
      assert(
        report.memory.retainedHeapDeltaBytes < 8 * 1024 * 1024,
        "Unexpected post-compaction heap growth",
      );
      assert(
        await page.evaluate(() => !window.__oldPlaybackPoint.deref()),
        "Replaced source point retained",
      );
      report.checks.push(
        "150 rendered windows stay within slot budget, compact, release old source, and consolidate on pause",
      );
      await cdp.detach();
    }
  }
  for (const mode of loadOnly || paired ? [] : ["space-time", "map", "globe"]) {
    await page.evaluate((mode) => window.__playbackFixture(400, mode), mode);
    await page.evaluate(() => {
      const v = window.__playbackView,
        d = window.__playbackData;
      // Coincident, differently colored events make order/pick changes visible.
      d.pool[120] = { ...d.pool[119], id: d.pool[120].id, entity: 23 };
    });
    for (const state of [
      "forward",
      "mid-fade",
      "mature",
      "reverse",
      "reordered",
      "paused",
      "fade-off",
    ]) {
      const evidence = await page.evaluate(
        async ({ state, baseline }) => {
          const v = window.__playbackView,
            d = window.__playbackData;
          const orderFallbacks =
            v.diagnostics().resourceReuse.playbackMarkerOrderFallbacks;
          if (state === "forward") {
            v.setSelection([d.pool[100].id]);
            await window.__playbackStep(2);
          } else if (state === "mid-fade" || state === "mature") {
            window.__packetClock += state === "mid-fade" ? 90 : 800;
            v.advanceFades();
            await new Promise(requestAnimationFrame);
            cancelAnimationFrame(v.fadeFrame);
            v.fadeFrame = 0;
          } else if (state === "reverse") await window.__playbackStep(0);
          else if (state === "reordered") {
            const reverse = d.pool.slice(0, 400).reverse();
            await window.__playbackStep(0, reverse);
          } else if (state === "paused") v.setPlayback(false);
          else {
            v.setPlaybackFade(false);
            v.setPlayback(true);
            await window.__playbackStep(2);
          }
          // Advance axes/labels consistently before capture; imagery is disabled.
          window.__renderPlayback();
          if (
            !baseline &&
            state === "reordered" &&
            v.diagnostics().resourceReuse.playbackMarkerOrderFallbacks <=
              orderFallbacks
          )
            throw Error("Reordered records did not use the canonical fallback");
          await new Promise(requestAnimationFrame);
          window.__renderPlayback();
          const live = v.renderPoints;
          if (v.glyphById.size !== live.length)
            throw Error("Missing or lingering live marker");
          for (const p of live) {
            const glyph = v.glyphById.get(p.id),
              expected = v.pos(p);
            const error = Math.hypot(
              glyph.position.x - expected.x,
              glyph.position.y - expected.y,
              glyph.position.z - expected.z,
            );
            if (error > 1e-7 || glyph.id?.id !== p.id)
              throw Error("Wrong marker position or pick identity");
          }
          if (state === "mid-fade") {
            const incoming = v.glyphById.get(d.pool[400].id);
            if (Math.abs(incoming.color.alpha - 0.5) > 0.005)
              throw Error(
                `Arrival fade jumped or restarted: ${incoming.color.alpha}, now ${performance.now()}, start ${v.incomingAt.get(d.pool[400].id)}`,
              );
          }
          if (state === "mature" && (v.outgoing.length || v.fadeTrails.length))
            throw Error("Expired afterimage remained");
          if (state === "forward" || state === "fade-off") {
            for (const p of d.pool.slice(0, 2)) {
              const pixel = v.project(v.pos(p));
              if (
                pixel &&
                v.scene.drillPick(pixel).some((hit) => hit.id?.id === p.id)
              )
                throw Error("Departed/afterimage marker remained pickable");
            }
          }
          const target = d.pool[120],
            pixel = v.project(v.pos(target));
          const picked =
            pixel &&
            v.scene
              .drillPick(pixel)
              .map((hit) => hit.id?.id)
              .filter(Boolean);
          return {
            state,
            live: live.length,
            picked,
            afterimages: v.outgoing.length,
            diagnostic: v.diagnostics().resourceReuse,
          };
        },
        { state, baseline },
      );
      report.checks.push({ mode, ...evidence });
      await page.screenshot({
        path: path.join(qaPaths.screenshots, `${mode}-${state}.png`),
      });
    }
  }
  // Field/shape edits, centroid visibility, shrink-to-empty and recovery must
  // remain correct when they invalidate resident slots or rendering semantics.
  if (!baseline && !loadOnly && !paired)
    report.invalidation = await page.evaluate(async () => {
      await window.__playbackFixture(400, "space-time");
      const v = window.__playbackView,
        d = window.__playbackData;
      v.setPlaybackFade(false);
      v.setPlayback(true);
      const steady = v.glyphById.get(d.pool[100].id);
      const beforeSteady = v.diagnostics().resourceReuse;
      await v.setData(v.points.slice(), d.names, d.bounds, [
        d.epoch + 1,
        d.epoch + 2401,
      ]);
      if (
        v.glyphById.get(d.pool[100].id) !== steady ||
        v.diagnostics().resourceReuse.markerCollectionReuses !==
          beforeSteady.markerCollectionReuses + 1 ||
        v.diagnostics().resourceReuse.playbackMarkerPatches !==
          beforeSteady.playbackMarkerPatches
      )
        throw Error(
          "Time-only opaque playback lost its existing resident fast path",
        );
      v.setPlaybackFade(true);
      v.setPlayback(true);
      v.setSelection([d.pool[0].id]);
      await window.__playbackStep(2);
      if (v.selections.length)
        throw Error("Departed selected event left a stale highlight");
      await window.__playbackStep(0);
      if (
        v.selections.length !== 1 ||
        v.selections.get(0).id?.id !== d.pool[0].id
      )
        throw Error("Reentered selected event lost its highlight or identity");
      const next = d.pool.slice(2, 402).map((p) => ({ ...p }));
      next[10].lat += 0.1;
      next[10].time += 30;
      next[10].inferred = !next[10].inferred;
      await window.__playbackStep(2, next);
      const checkPositions = () => {
        for (const p of v.renderPoints) {
          const glyph = v.glyphById.get(p.id),
            expected = v.pos(p);
          if (
            !glyph ||
            glyph.id?.id !== p.id ||
            "pixelSize" in glyph === !!p.inferred ||
            Math.hypot(
              glyph.position.x - expected.x,
              glyph.position.y - expected.y,
              glyph.position.z - expected.z,
            ) > 1e-7
          )
            throw Error(
              "Edited/recovered glyph has stale coordinates, shape, or identity",
            );
        }
      };
      checkPositions();
      v.setDisplayOptions({ ...v.display, show_centroids: false });
      window.__renderPlayback();
      if (v.renderPoints.some((p) => p.centroid))
        throw Error("Hidden centroid remained in renderer");
      checkPositions();
      v.setPlayback(false);
      await v.recoverRenderer(true);
      v.viewer.useDefaultRenderLoop = false;
      v.scene.globe.show = false;
      window.__renderPlayback();
      checkPositions();
      v.setPlayback(true);
      await window.__playbackStep(0, []);
      window.__renderPlayback();
      if (v.glyphById.size || v.diagnostics().allocatedMarkerSlots)
        throw Error("Empty window retained glyphs");
      return {
        contextRecoveries: v.diagnostics().contextRecoveries,
        emptySlots: v.diagnostics().allocatedMarkerSlots,
      };
    });
  assert.deepEqual(report.errors, []);
  assert.equal(
    await page.evaluate(
      () => window.__playbackView.diagnostics().renderErrorCount,
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
