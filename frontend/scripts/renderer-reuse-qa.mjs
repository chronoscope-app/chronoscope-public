// Local WebGL resource/behavior regression, plus bounded CPU measurements.
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
const baseline = process.env.CHRONOSCOPE_REUSE_BASELINE === "1";
const report = {
  passed: false,
  baseline,
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
  for (const count of [10000, 100000]) {
    const result = await page.evaluate(
      async ({ count, baseline }) => {
        const v = window.__reuseView;
        const check = (ok, message) => {
          if (!ok) throw Error(message);
        };
        const epoch = 1735689600;
        const points = Array.from({ length: count }, (_, i) => ({
          id: String(9007199254740993n + BigInt(i)),
          entity: i % 100,
          time: epoch + Math.floor(i / 100) * 60,
          lat: 30 + (i % 10) * 0.12 + Math.sin(i / 100) * 0.01,
          lon:
            -80 + Math.floor((i % 100) / 10) * 0.12 + Math.cos(i / 100) * 0.01,
          value: i % 101,
          inferred: i % 1000 === 0,
          centroid: i % 997 === 0,
        }));
        const bounds = [-80.1, 29.9, -78.7, 31.3];
        const times = [epoch, epoch + (count / 100) * 60];
        await v.setData(
          points,
          Array.from({ length: 100 }, (_, i) => `T${i}`),
          bounds,
          times,
        );
        v.fit();
        window.__reuseRender();
        v.rebuildTrails();
        window.__reuseRender();
        const original = v.glyphById.get(points[1].id),
          stems = v.stemsPrimitive;
        const counts = v.diagnostics();
        const sorted = v.trailOrder;
        const gl = v.viewer.canvas.getContext("webgl2");
        const bufferData = gl.bufferData,
          bufferSubData = gl.bufferSubData;
        let selectionUploadBytes = 0;
        const bytes = (data) =>
          typeof data === "number" ? data : data?.byteLength || 0;
        gl.bufferData = function (...args) {
          selectionUploadBytes += bytes(args[1]);
          return bufferData.apply(this, args);
        };
        gl.bufferSubData = function (...args) {
          selectionUploadBytes += bytes(args[2]);
          return bufferSubData.apply(this, args);
        };
        const start = performance.now();
        for (let i = 1; i <= 8; i++) v.setSelection([points[i].id]);
        const selectionMs = performance.now() - start;
        window.__reuseRender();
        gl.bufferData = bufferData;
        gl.bufferSubData = bufferSubData;
        if (!baseline)
          check(
            selectionUploadBytes < 1000000,
            "selection must not reupload event/stem buffers",
          );
        check(
          v.selections.length === 1 &&
            v.selections.get(0).id.id === points[8].id,
          "exact high-u64 selection",
        );
        if (!baseline)
          check(
            v.stemsPrimitive === stems,
            "selection must retain stem GPU geometry",
          );
        v.setSelection([points[5].id, points[2].id, points[1].id]);
        check(
          [0, 1, 2].map((i) => v.selections.get(i).id.id).join(",") ===
            [points[1].id, points[2].id, points[5].id].join(","),
          "selection overlays retain canonical packet order",
        );
        const options = { ...v.display };
        const startedStyle = performance.now();
        v.setDisplayOptions({ ...options, trail_opacity: 0.13 });
        if (!baseline) {
          check(
            v.stemsPrimitive === stems,
            "opacity must retain stem geometry",
          );
          check(
            Math.abs(
              v.stemMaterial.uniforms.color.alpha -
                Math.floor(0.15 * 0.13 * 256) / 255,
            ) < 1e-12,
            "uniform opacity",
          );
        }
        v.setDisplayOptions({ ...options, show_trails: false });
        check(
          v.diagnostics().stemSegments === 0,
          "hidden stems have zero drawn segments",
        );
        v.setDisplayOptions(options);
        if (!baseline)
          check(
            v.stemsPrimitive === stems,
            "hide/show must retain stem geometry",
          );
        const styleMs = performance.now() - startedStyle;
        v.camera.moveRight(2);
        v.rebuildTrails();
        if (!baseline)
          check(
            v.trailOrder === sorted &&
              v.diagnostics().resourceReuse.trailSorts ===
                counts.resourceReuse.trailSorts,
            "camera/selection/style must reuse track order",
          );
        v.setDisplayOptions({
          ...options,
          point_scale: options.point_scale * 1.25,
        });
        if (!baseline)
          check(
            v.glyphById.get(points[1].id) === original,
            "point sizing must patch existing glyphs",
          );
        check(
          v.glyphById.get(points[1].id).pixelSize ===
            8 * options.point_scale * 1.25,
          "new point size",
        );
        v.setDisplayOptions(options);
        v.setTheme("light");
        if (!baseline)
          check(
            v.glyphById.get(points[1].id) === original,
            "theme must patch existing glyphs",
          );
        v.setTheme("dark");
        // A time-height change must update every retained position and stem.
        const z = v.glyphById.get(points[1].id).position.z,
          priorStem = v.stemsPrimitive;
        v.timeHeight *= 1.1;
        v.rebuild(true);
        check(
          v.glyphById.get(points[1].id).position.z !== z &&
            v.stemsPrimitive !== priorStem,
          "time height invalidates positions and stems",
        );
        v.timeHeight /= 1.1;
        v.rebuild(true);
        // Summary picking updates both old and new evidence, including deselection.
        const savedDescriptor = Object.getOwnPropertyDescriptor(
          v.displayLayer,
          "replacesEvents",
        );
        Object.defineProperty(v.displayLayer, "replacesEvents", {
          configurable: true,
          value: true,
        });
        v.setSelection([points[1].id]);
        check(
          v.glyphById.get(points[1].id).show &&
            !v.glyphById.get(points[2].id).show,
          "summary selected reserve",
        );
        v.setSelection([points[2].id]);
        check(
          !v.glyphById.get(points[1].id).show &&
            v.glyphById.get(points[2].id).show,
          "summary selection delta",
        );
        v.setSelection([]);
        check(
          !v.glyphById.get(points[2].id).show &&
            v.glyphById.get(points[0].id).show,
          "summary deselection retains inferred points",
        );
        if (savedDescriptor)
          Object.defineProperty(
            v.displayLayer,
            "replacesEvents",
            savedDescriptor,
          );
        else delete v.displayLayer.replacesEvents;
        v.setSelection([]);
        check(
          v.glyphById.get(points[2].id).show,
          "leaving summary restores normal visibility",
        );
        // Data order and glyph shape changes must take the canonical rebuild path.
        const reversed = [...points].reverse();
        await v.setData(reversed, v.names, bounds, times);
        check(
          v.glyphById.get(points[1].id) !== original,
          "reordered evidence rebuilds canonical order",
        );
        const reshaped = reversed.map((p, i) =>
          i === 1 ? { ...p, inferred: !p.inferred } : p,
        );
        await v.setData(reshaped, v.names, bounds, times);
        check(
          "image" in v.glyphById.get(reshaped[1].id),
          "shape changes rebuild glyph type",
        );
        await v.setData(points, v.names, bounds, times);
        v.fit();
        window.__reuseRender();
        const d = v.diagnostics();
        check(
          d.pointCount + d.triangleCount === count &&
            d.stemSegments === count - Math.ceil(count / 1000),
          "all fixture points and stems remain drawn",
        );
        check(d.renderErrorCount === 0, "no WebGL errors");
        return {
          count,
          selectionMs,
          selectionUploadBytes,
          styleMs,
          diagnostics: d,
        };
      },
      { count, baseline },
    );
    report.samples.push(result);
    console.log(
      "PASS",
      count,
      "selection/style/camera/data resource checks",
      JSON.stringify({
        selectionMs: result.selectionMs,
        styleMs: result.styleMs,
      }),
    );
  }
  // Small fixed scene supports exact baseline/candidate canvas comparison in all views.
  for (const mode of ["space-time", "map", "globe"]) {
    await page.evaluate(async (mode) => {
      const v = window.__reuseView;
      v.setMode(mode);
      if (mode === "globe") v.setGlobeTime(true);
      await v.setData(
        v.points.slice(0, 400),
        v.names,
        [...v.bounds],
        [v.lo, v.hi],
      );
      v.fit();
      window.__reuseRender();
    }, mode);
    await page.waitForTimeout(250);
    await page.evaluate((mode) => {
      const v = window.__reuseView;
      if (
        v.mode !== mode ||
        v.points.length !== 400 ||
        v.points[0].id !== "9007199254740993"
      )
        throw Error(
          "fixture was overwritten before canvas capture: " +
            JSON.stringify({
              mode: v.mode,
              count: v.points.length,
              id: v.points[0]?.id,
            }),
        );
      window.__reuseRender();
    }, mode);
    await page
      .locator("#renderer-reuse-scene .cesium-widget canvas")
      .screenshot({ path: path.join(qaPaths.screenshots, `${mode}.png`) });
    report.checks.push(
      `${mode} renders retained glyphs and stems without errors`,
    );
  }
  const errors = await page.evaluate(
    () => window.__reuseView.diagnostics().renderErrorCount,
  );
  assert.equal(errors, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.writeFileSync(
    path.join(qaPaths.out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
