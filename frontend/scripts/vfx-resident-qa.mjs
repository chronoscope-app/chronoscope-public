import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("vfx-resident-local", async ({ page, out, pass }) => {
  page.on("console", (message) => {
    if (message.type() === "error") console.log("BROWSER", message.text());
  });
  await page.bringToFront();
  await page.evaluate(async () => {
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
    });
    document.body.append(host);
    const v = (window.__vfxView = new window.__chronoscope.view.constructor(
      host,
      () => {},
    ));
    await v.ready;
    clearTimeout(v.resourceTimer);
    v.resourceGovernor.level = 0;
    v.applyResourceGraphics();
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    v.setMode("globe");
    v.setPlaybackFade(false);
    v.setDisplayOptions({
      ...v.display,
      mode: "points",
      show_points: true,
      show_tracks: true,
      show_trails: false,
      trail_pixels: 0,
      trail_gap_minutes: 0,
      bloom: false,
    });
    v.scene.globe.show = false;
    const epoch = 1735689600;
    window.__vfxPool = Array.from({ length: 100000 }, (_, i) => ({
      id: String(i + 1),
      entity: i % 100,
      time: epoch + Math.floor(i / 100),
      lat: 32 + (i % 100) * 0.004 + Math.sin(i / 100 / 35) * 0.025,
      lon: -80 + Math.floor(i / 100) * 0.0005 + Math.cos(i / 100 / 35) * 0.025,
      value: i % 100,
    }));
    window.__vfxNames = Array.from({ length: 100 }, (_, i) => `Track ${i}`);
    await v.setData(
      window.__vfxPool.slice(0, 20000),
      window.__vfxNames,
      [-80.1, 31.9, -79.3, 32.5],
      [epoch, epoch + 999],
    );
    v.fit();
    v.requestRender();
  });
  await page.waitForTimeout(2000);
  const report = {
    passed: false,
    control_playback_reuse_enabled: true,
    method:
      "Local Windows hardware Chrome renderer-only A/B; real render loop. Same 100k source points, 20% moving time window, points plus tracks. Baseline installs a 20k packet at up to 10 Hz with production playback reuse enabled; resident preview advances GPU window every frame. No engine query/import cost measured.",
    limitations: [
      "Governor held at full in both variants to isolate renderer cost.",
      "Prototype uses 1px straight GL_LINES and shader-clipped endpoints; conventional tracks use wider polylines. Not visual parity.",
      "No picking, selection, inferred glyphs, durations, terrain, date-line, bloom, fade-history parity or engine-filter synchronization. Regional Globe only.",
      "CPU prepared synchronously once; background-worker/chunk prefetch remains future work. Render-loop timings are not physical presentation/GPU execution latency.",
    ],
    cases: [],
  };
  const smoke = process.env.CHRONOSCOPE_VFX_SMOKE === "1";
  for (let repeat = 0; repeat < (smoke ? 1 : 3); repeat++)
    for (const resident of repeat % 2 ? [true, false] : [false, true]) {
      const result = await page.evaluate(
        async ({ resident, repeat, duration }) => {
          let stage = "prepare";
          try {
            const v = window.__vfxView,
              pool = window.__vfxPool,
              epoch = pool[0].time;
            v.setPlayback(false);
            v.glyphs.show = true;
            v.trails.show = true;
            await v.setData(
              pool.slice(0, 20000),
              window.__vfxNames,
              [-80.1, 31.9, -79.3, 32.5],
              [epoch, epoch + 999],
            );
            v.viewer.targetFrameRate = undefined;
            let preview;
            if (resident) {
              stage = "construct resident";
              try {
                preview = v.createResidentPlayback(pool);
              } catch (error) {
                throw new Error(String(error?.message || error));
              }
              v.glyphs.show = false;
              v.trails.show = false;
              if (v.stemsPrimitive) v.stemsPrimitive.show = false;
            }
            // Exercise the production playback patch/reuse plan in the control.
            // Pausing is only the reset fence between trials, not the measured mode.
            v.setPlayback(true);
            // Warm shader compilation and uploads outside the measured interval.
            if (preview) preview.setWindow(epoch, epoch + 199);
            stage = "warm";
            v.requestRender();
            await new Promise((resolve) => setTimeout(resolve, 1500));
            let pixelChanges;
            if (preview) {
              stage = "pixel test";
              const capture = () =>
                new Promise((resolve) => {
                  const remove = v.scene.postRender.addEventListener(() => {
                    remove();
                    const gl = v.viewer.canvas.getContext("webgl2"),
                      pixels = new Uint8Array(
                        gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
                      );
                    gl.readPixels(
                      0,
                      0,
                      gl.drawingBufferWidth,
                      gl.drawingBufferHeight,
                      gl.RGBA,
                      gl.UNSIGNED_BYTE,
                      pixels,
                    );
                    resolve(pixels);
                  });
                  v.requestRender();
                });
              preview.setWindow(epoch + 2000, epoch + 3000);
              const empty = await capture();
              preview.setWindow(epoch, epoch + 999);
              const full = await capture();
              pixelChanges = full.reduce(
                (n, value, i) => n + Number(value !== empty[i]),
                0,
              );
              if (pixelChanges < 100)
                throw Error(
                  "Resident GPU window did not change rendered pixels",
                );
            }
            const reuseBefore = v.diagnostics().resourceReuse;
            const intervals = [],
              submit = [],
              focus = [],
              start = performance.now();
            stage = "measure";
            let last = 0,
              lastPacket = -Infinity,
              frames = 0,
              packetUpdates = 0,
              maxPacketMs = 0,
              pending;
            const remove = v.scene.postRender.addEventListener(() => {
              const now = performance.now();
              if (last) intervals.push(now - last);
              last = now;
              frames++;
              submit.push(v.lastRenderCpuMs);
            });
            await new Promise((resolve) => {
              const frame = (now) => {
                const elapsed = now - start;
                const phase = ((elapsed / 1000) * 12) % 700;
                if (preview)
                  preview.setWindow(epoch + phase, epoch + phase + 199);
                else if (!pending && now - lastPacket >= 100) {
                  lastPacket = now;
                  const begin = performance.now(),
                    offset = Math.floor(phase) * 100;
                  pending = Promise.resolve(
                    v.setData(
                      pool.slice(offset, offset + 20000),
                      window.__vfxNames,
                      [-80.1, 31.9, -79.3, 32.5],
                      [epoch, epoch + 999],
                    ),
                  ).finally(() => {
                    maxPacketMs = Math.max(
                      maxPacketMs,
                      performance.now() - begin,
                    );
                    pending = undefined;
                  });
                  packetUpdates++;
                }
                v.requestRender();
                focus.push(
                  document.hasFocus() && document.visibilityState === "visible",
                );
                if (elapsed < duration) requestAnimationFrame(frame);
                else resolve();
              };
              requestAnimationFrame(frame);
            });
            await pending;
            const elapsed = performance.now() - start;
            remove();
            const sorted = [...intervals].sort((a, b) => a - b),
              p = (q) =>
                sorted[
                  Math.min(sorted.length - 1, Math.floor(sorted.length * q))
                ];
            const result = {
              resident,
              repeat: repeat + 1,
              elapsed_ms: elapsed,
              frames,
              fps: (frames / elapsed) * 1000,
              frame_p95_ms: p(0.95),
              frame_p99_ms: p(0.99),
              frame_max_ms: Math.max(...intervals),
              gaps_over_50_ms: intervals.filter((x) => x > 50).length,
              valid_focus: focus.every(Boolean),
              packetUpdates,
              maxPacketMs,
              renderErrors: v.diagnostics().renderErrorCount,
        governorProfile: v.diagnostics().resourceGovernor.profile,
              graphics: v.diagnostics().graphics,
              prototype: preview?.diagnostics(),
              pixelChanges,
              playbackMarkerPatches:
                v.diagnostics().resourceReuse.playbackMarkerPatches -
                reuseBefore.playbackMarkerPatches,
              markerBuilds:
                v.diagnostics().resourceReuse.markerCollectionBuilds -
                reuseBefore.markerCollectionBuilds,
            };
            if (preview) preview.destroy();
            return result;
          } catch (error) {
            return {
              error: String(error?.message || error),
              stage,
              stack: String(error?.stack || ""),
            };
          }
        },
        { resident, repeat, duration: smoke ? 1000 : 15000 },
      );
      assert(!result.error, JSON.stringify(result));
      assert.equal(result.valid_focus, true);
      assert.equal(result.renderErrors, 0);
    assert.equal(result.governorProfile, "full");
      report.cases.push(result);
      fs.writeFileSync(
        path.join(out, "measurements.json"),
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(result));
    }
  report.passed = true;
  fs.writeFileSync(
    path.join(out, "measurements.json"),
    JSON.stringify(report, null, 2),
  );
  pass(
    `${report.cases.length} controlled real-clock renderer trials completed without focus loss or render errors`,
  );
});
