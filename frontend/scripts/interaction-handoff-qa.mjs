import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp(
  "interaction-handoffs",
  async ({ page, api, root, out, pass }) => {
    const report = { passed: false, pixelChecks: [], soak: null };
    const save = () =>
      fs.writeFileSync(
        path.join(out, "handoffs.json"),
        JSON.stringify(report, null, 2),
      );
    try {
      await api("open", {
        path: path.resolve(
          root,
          "../chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope",
        ),
      });
      await api("select", { ids: [] });
      const s = await api("snapshot", { compact: true }),
        [lo, hi] = s.time_bounds;
      await api("filter", { filter: { start: lo, end: lo + (hi - lo) * 0.2 } });
      const state = await api("view_set", {
        mode: "map",
        fit: true,
        display: {
          mode: "points",
          show_points: true,
          show_tracks: false,
          show_trails: false,
          bloom: false,
          spatial_culling: false,
        },
      });
      await page.evaluate(async (scene) => {
        const c = window.__chronoscope;
        await c.restoreScene(scene);
        await c.refresh();
        await c.sceneIdle();
      }, state.scene);
      await page.waitForFunction(
        () => window.__chronoscope.view.residentPlaybackActive,
      );
      await page.waitForTimeout(1500);
      const blank = await page.evaluate(async () => {
        const v = window.__chronoscope.view,
          objects = [
            v.glyphs,
            v.triangles,
            v.arrivingPoints,
            v.arrivingTriangles,
            v.selections,
            v.fading,
            ...v.resident.primitives,
          ];
        const visibility = objects.map((x) => x.show);
        objects.forEach((x) => (x.show = false));
        try {
          return await v.screenshot();
        } finally {
          objects.forEach((x, i) => (x.show = visibility[i]));
          v.requestRender();
        }
      });
      const background = PNG.sync.read(
        Buffer.from(blank.split(",")[1], "base64"),
      );
      for (let i = 0; i < 12; i++) {
        const enabled = i % 2 === 1;
        await page.locator("#vfx-smooth-playback").setChecked(enabled);
        await page.evaluate(() => window.__chronoscope.sceneIdle());
        await page.waitForFunction(
          (enabled) =>
            window.__chronoscope.view.residentPlaybackActive === enabled,
          enabled,
        );
        const shot = await page.evaluate(() =>
          window.__chronoscope.view.screenshot(),
        );
        const image = PNG.sync.read(Buffer.from(shot.split(",")[1], "base64"));
        assert.equal(image.width, background.width);
        assert.equal(image.height, background.height);
        let visible = 0;
        for (let p = 0; p < image.data.length; p += 4)
          if (
            Math.max(
              ...[0, 1, 2].map((k) =>
                Math.abs(image.data[p + k] - background.data[p + k]),
              ),
            ) > 20
          )
            visible++;
        report.pixelChecks.push({ enabled, visible });
        save();
        assert(visible > 1000, "Event pixels disappeared during handoff");
      }
      pass("Twelve standard/prepared handoffs retain visible event pixels");
      report.soak = await page.evaluate(async () => {
        const c = window.__chronoscope,
          v = c.view;
        await c.liveViewRequest("view_playback", {
          action: "configure",
          speed: 0.25,
          increment_seconds: 60,
          fade_amount: 50,
        });
        await c.liveViewRequest("view_playback", { action: "play" });
        const start = performance.now();
        let frames = 0,
          missingBuffers = 0,
          maxInterval = 0,
          last,
          animation = 0,
          selectionWrites = 0,
          previousPan = [0, 0],
          previousZoom = 0;
        const remove = v.scene.postRender.addEventListener(() => {
          const now = performance.now();
          if (last) maxInterval = Math.max(maxInterval, now - last);
          last = now;
          frames++;
          if (
            c.snapshot.visible &&
            v.resident &&
            !v.resident.primitives.some((p) => p.show && p._va?.length)
          )
            missingBuffers++;
        });
        const move = (now) => {
          const p = (((now - start) / 1000) * Math.PI * 2) / 10,
            pan = [70 * Math.sin(p), 30 * Math.sin(p * 0.5)],
            zoom = 0.1 * Math.sin(p);
          v.panPixels(pan[0] - previousPan[0], pan[1] - previousPan[1]);
          v.zoom(Math.exp(zoom - previousZoom));
          previousPan = pan;
          previousZoom = zoom;
          animation = requestAnimationFrame(move);
        };
        animation = requestAnimationFrame(move);
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const points = v.resident.visiblePoints();
          await c.select(i % 2 ? [] : points.slice(0, 25).map((p) => p.id));
          selectionWrites++;
        }
        cancelAnimationFrame(animation);
        remove();
        await c.liveViewRequest("view_playback", { action: "pause" });
        await c.filterIdle();
        await c.sceneIdle();
        const exact = await c.call("render_data", { max_points: 100000 });
        return {
          elapsedMs: performance.now() - start,
          frames,
          missingBuffers,
          maxInterval,
          selectionWrites,
          actual: v.points.map((p) => p.id),
          expected: exact.ids,
          diag: v.diagnostics(),
        };
      });
      assert.equal(report.soak.missingBuffers, 0);
      assert.equal(report.soak.diag.renderErrorCount, 0);
      assert.deepEqual(
        report.soak.actual.slice().sort(),
        report.soak.expected.slice().sort(),
      );
      report.soak.actualCount = report.soak.actual.length;
      delete report.soak.actual;
      delete report.soak.expected;
      pass(
        "One-minute playback/navigation/selection soak retains buffers and exact pause membership",
      );
      await page.screenshot({ path: path.join(out, "soak.png") });
      report.passed = true;
      save();
    } finally {
      save();
    }
  },
);
