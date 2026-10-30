import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp(
  "resident-interactions",
  async ({ page, api, out, root, pass }) => {
    page.on("console", (m) => {
      if (["info", "error"].includes(m.type()))
        console.log("BROWSER", m.type(), m.text());
    });
    const records = [];
    const save = () =>
      fs.writeFileSync(
        path.join(out, "details.json"),
        JSON.stringify(records, null, 2),
      );
    const pause = async () => {
      await page.evaluate(async () => {
        const c = window.__chronoscope;
        if (c.view.playback)
          await c.liveViewRequest("view_playback", { action: "pause" });
        await c.filterIdle();
        await c.sceneIdle();
      });
    };
    const exact = async () => {
      await page.evaluate(async () => {
        await window.__chronoscope.filterIdle();
        await window.__chronoscope.sceneIdle();
      });
      const data = await api("render_data", { max_points: 100000 });
      const ids = await page.evaluate(() =>
        window.__chronoscope.view.points.map((p) => p.id),
      );
      assert.deepEqual(ids.slice().sort(), data.ids.slice().sort());
    };
    async function open(file, mode, display = {}, extra = {}) {
      await pause();
      await api("open", { path: file });
      await api("select", { ids: [] });
      const s = await api("snapshot", { compact: true }),
        [lo, hi] = s.time_bounds;
      await api("filter", { filter: { start: lo, end: lo + (hi - lo) * 0.2 } });
      const changed = await api("view_set", {
        mode,
        fit: true,
        globe_time: false,
        globe_altitude: false,
        display: {
          mode: "points",
          show_points: true,
          show_tracks: true,
          show_trails: false,
          bloom: false,
          spatial_culling: false,
          trail_gap_minutes: 0,
          ...display,
        },
        ...extra,
      });
      await page.evaluate(async (scene) => {
        const c = window.__chronoscope;
        await c.restoreScene(scene);
        await c.refresh();
        await c.sceneIdle();
      }, changed.scene);
      await page.waitForFunction(
        () => window.__chronoscope.view.residentPlaybackActive,
        { timeout: 30000 },
      );
      assert(await page.evaluate(() => !window.__chronoscope.view.playback));
      await exact();
      return s;
    }
    try {
      for (const mode of ["map", "globe", "space-time"]) {
        await open(
          path.resolve(
            root,
            "../chronoscope-vfx-local/.qa/full-app-2026-10-30/browser/full-app-vfx.chronoscope",
          ),
          mode,
        );
        await page.evaluate(async () => {
          const c = window.__chronoscope,
            v = c.view;
          window.__governorClass = v.resourceGovernor.constructor;
          v.resourceGovernor.update(
            {
              supported: true,
              total_bytes: 16 * 1024 ** 3,
              available_bytes: 128 * 1024 ** 2,
              swap_used_bytes: 0,
              sample_age_ms: 0,
            },
            0,
            performance.now(),
          );
          v.applyResourceGraphics();
          v.onRepresentationInvalidated("resource-pressure");
          await c.sceneIdle();
        });
        assert(
          !(await page.evaluate(
            () => window.__chronoscope.view.residentPlaybackActive,
          )),
        );
        await page.evaluate(async () => {
          const c = window.__chronoscope;
          await c.liveViewRequest("view_playback", { action: "play" });
          await c.sceneIdle();
        });
        assert(
          !(await page.evaluate(
            () => window.__chronoscope.view.residentPlaybackActive,
          )),
          "Play must respect the governor's existing pressure budget",
        );
        await page.evaluate(() =>
          window.__chronoscope.liveViewRequest("view_playback", {
            action: "pause",
          }),
        );
        await page.evaluate(async () => {
          const c = window.__chronoscope,
            v = c.view;
          v.resourceGovernor = new window.__governorClass();
          v.applyResourceGraphics();
          v.onRepresentationInvalidated("resource-pressure");
          await c.sceneIdle();
        });
        await page.waitForFunction(
          () => window.__chronoscope.view.residentPlaybackActive,
        );
        await exact();
        pass(
          "Governor pressure releases prepared buffers and recovery permits preparation again",
        );

        await page.evaluate(() => {
          window.__originalResident = window.__chronoscope.view.resident;
        });
        await page.evaluate(async () => {
          const c = window.__chronoscope,
            v = c.view;
          v.panPixels(25, 10);
          v.zoom(1.05);
          if (v.mode !== "map") v.setTilt(12);
          await c.sceneIdle();
        });
        assert(
          await page.evaluate(
            () =>
              window.__chronoscope.view.resident === window.__originalResident,
          ),
        );
        pass(mode + ": paused navigation retains its prepared graphics");
        if (mode !== "space-time") {
          const box = await page.locator("#time-range-window").boundingBox();
          await page.mouse.move(
            box.x + Math.min(6, box.width / 2),
            box.y + box.height / 2,
          );
          await page.mouse.down();
          for (let i = 1; i <= 18; i++) {
            await page.mouse.move(
              box.x + Math.min(6, box.width / 2),
              box.y + box.height / 2 + i * 3,
            );
            await page.waitForTimeout(20);
          }
          await page.mouse.up();
          await exact();
          assert(
            await page.evaluate(
              () =>
                window.__chronoscope.view.resident ===
                window.__originalResident,
            ),
          );
          pass(
            mode +
              ": pointer scrubbing preserves buffers and commits exact membership",
          );
        }
        const ids = (
          await api("render_data", { max_points: 100000 })
        ).ids.slice(0, 100);
        await page.evaluate(async (ids) => {
          const c = window.__chronoscope;
          await c.select(ids);
          await c.sceneIdle();
        }, ids);
        assert(
          await page.evaluate(
            () =>
              window.__chronoscope.view.resident === window.__originalResident,
          ),
        );
        const selection = await page.evaluate(
          () => window.__chronoscope.view.resident.diagnostics().selectedCount,
        );
        assert.equal(selection, 100);
        await page.evaluate(async () => {
          const c = window.__chronoscope;
          c.view.fit();
          await c.sceneIdle();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const picked = await page.evaluate(() => {
          const v = window.__chronoscope.view;
          const visible = v.resident.visiblePoints(), step = Math.max(1, Math.floor(visible.length / 300));
          for (let i=0; i<visible.length; i+=step) {
            const p=visible[i];
            const xy = v.projectEvent(p.id);
            if (
              !xy ||
              xy.x < 10 ||
              xy.y < 10 ||
              xy.x > v.host.clientWidth - 10 ||
              xy.y > v.host.clientHeight - 10
            )
              continue;
            const hit = v.pickId(xy.x, xy.y);
            if (hit?.kind === "event" && v.resident.visiblePoint(hit.id))
              return hit.id;
          }
          return null;
        });
        assert(picked, "Prepared markers must remain GPU-pickable");
        pass(
          mode +
            ": selection updates a timed GPU overlay without rebuilding the study",
        );
        await page.evaluate(async () => {
          const c = window.__chronoscope;
          for (let i = 0; i < 4; i++) {
            await c.liveViewRequest("view_playback", { action: "play" });
            await new Promise((r) => setTimeout(r, 120));
            await c.liveViewRequest("view_playback", { action: "pause" });
          }
          await c.sceneIdle();
        });
        await exact();
        const diag = await page.evaluate(() =>
          window.__chronoscope.view.diagnostics(),
        );
        assert.equal(diag.renderErrorCount, 0);
        records.push({ mode, diag });
        save();
        await page.screenshot({ path: path.join(out, mode + ".png") });
        pass(mode + ": repeated play/pause keeps exact stopped membership");
      }
      await open(
        path.join(
          root,
          "samples/animal-gps-black-rock-forest-2023-03.chronoscope",
        ),
        "map",
      );
      const id = (await api("render_data", { max_points: 100000 })).ids[0];
      await page.evaluate(() => {
        window.__originalResident = window.__chronoscope.view.resident;
      });
      await api("edit", { id, changes: { lat: 41.6, lon: -73.8 } });
      await page.evaluate(() => window.__chronoscope.refresh(false));
      await page.waitForFunction(
        () =>
          window.__chronoscope.view.resident &&
          window.__chronoscope.view.resident !== window.__originalResident,
      );
      const changed = await page.evaluate(
        (id) => window.__chronoscope.view.resident.point(id),
        id,
      );
      assert.equal(changed.lat, 41.6);
      assert.equal(changed.lon, -73.8);
      pass("Same-count coordinate edits invalidate the prepared-data cache");
      const precision = path.join(out, "precision.csv"),
        lo = 1735689600,
        span = 315360000,
        mid = lo + span / 2;
      fs.writeFileSync(
        precision,
        "entity,timestamp,latitude,longitude\n" +
          [
            [lo, 30, -85],
            [mid, 32, -80],
            [mid + 0.001, 32, -79],
            [lo + span, 35, -75],
          ]
            .map(
              ([t, lat, lon]) =>
                `Precise,${new Date(t * 1000).toISOString()},${lat},${lon}`,
            )
            .join("\n"),
      );
      const ticket = await api("import_preview", { path: precision });
      await api("import_commit", {
        import_id: ticket.import_id,
        append: false,
      });
      await api("select", { ids: [] });
      await api("filter", { filter: { start: mid, end: mid + 0.0005 } });
      const preciseScene = await api("view_set", {
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
      }, preciseScene.scene);
      await page.waitForFunction(
        () => window.__chronoscope.view.residentPlaybackActive,
      );
      const precisionHits = await page.evaluate(async () => {
        const c = window.__chronoscope,
          v = c.view;
        v.lookAtGeographic([-79.5, 32, 0], 300000, 0, 0);
        await new Promise((r) => setTimeout(r, 250));
        v.viewer.render();
        const hit = (lon) => {
          const xy = v.project(v.position(32, lon));
          return { xy, hit: !!v.scene.pick(xy, 3, 3) };
        };
        return { included: hit(-80), excluded: hit(-79) };
      });
      assert(precisionHits.included.hit, JSON.stringify(precisionHits));
      assert(!precisionHits.excluded.hit, JSON.stringify(precisionHits));
      await exact();
      records.push({ precisionHits });
      save();
      pass(
        "GPU clipping separates millisecond events inside a decade-long study",
      );
      await open(
        path.join(root, "samples/nasa-firms-south-america-2026-10.chronoscope"),
        "map",
        {
          mode: "heatmap",
          show_tracks: false,
          bloom: true,
          heat_weight: "value",
          heat_max: 300,
          heat_radius: 18,
        },
      );
      assert(
        await page.evaluate(
          () => window.__chronoscope.view.residentEffectsActive,
        ),
      );
      await page.evaluate(() =>
        window.__chronoscope.liveViewRequest("view_playback", {
          action: "play",
        }),
      );
      await page.waitForTimeout(3500);
      assert(
        await page.evaluate(
          () => window.__chronoscope.view.residentEffectsActive,
        ),
      );
      await pause();
      await exact();
      const parity = await page.evaluate(async () => {
        const c = window.__chronoscope,
          p = c.view.displayLayer.packet;
        const exact = await c.call("display_data", {
          level: p.level,
          time_bin_minutes: 0,
          partition: "all",
          weight: "value",
          max_cells: 4000,
          flat: false,
        });
        return {
          actual: p.bins,
          expected: exact.bins,
          diag: c.view.diagnostics(),
        };
      });
      assert.deepEqual(parity.actual, parity.expected);
      assert.equal(parity.diag.renderErrorCount, 0);
      assert.equal(parity.diag.effectError, "");
      records.push({ mode: "mixed-heatmap-bloom", ...parity });
      save();
      await page.screenshot({ path: path.join(out, "mixed.png") });
      pass(
        "Mixed point/heatmap/bloom playback pauses to exact weighted summary cells",
      );
      const shapes = path.join(out, "shapes.csv");
      const multipart =
        "MULTIPOLYGON (((-80 32,-79.99 32,-79.99 32.01,-80 32.01,-80 32),(-79.997 32.003,-79.997 32.007,-79.993 32.007,-79.993 32.003,-79.997 32.003)),((-79.98 32,-79.97 32,-79.97 32.01,-79.98 32.01,-79.98 32)))";
      fs.writeFileSync(
        shapes,
        "entity,timestamp,geometry_wkt\n" +
          Array.from({ length: 200 }, (_, i) => {
            const x = -80 + (i % 20) * 0.02,
              y = 32 + Math.floor(i / 20) * 0.02;
            const wkt =
              i === 0
                ? multipart
                : `POLYGON ((${x} ${y},${x + 0.01} ${y},${x + 0.01} ${y + 0.01},${x} ${y + 0.01},${x} ${y}))`;
            return `Shape ${i},2025-01-01T00:00:00Z,"${wkt}"`;
          }).join("\n"),
      );
      const polygonImport = await api("import_preview", { path: shapes });
      await api("import_commit", {
        import_id: polygonImport.import_id,
        append: false,
      });
      await api("filter", { filter: { start: null, end: null } });
      await api("select", { ids: [] });
      const polygonScene = await api("view_set", {
        mode: "map",
        fit: true,
        display: {
          mode: "points",
          show_centroids: false,
          show_points: false,
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
        c.view.viewer.render();
        window.__polygonFill = c.view.geometryFill;
      }, polygonScene.scene);
      const polygonId = (await api("render_geometries", { limit: 1000 }))
        .features[0].id;
      const styled = await page.evaluate(async (id) => {
        const c = window.__chronoscope,
          v = c.view,
          style = v.geometryStyles.get(id),
          fills = style.fills;
        const before = fills.map((f) => [
          ...v.geometryFill.getGeometryInstanceAttributes(f).color,
        ]);
        const builds = v.diagnostics().geometryReuse.builds;
        const start = performance.now();
        for (let i = 0; i < 10; i++) {
          await c.select([id]);
          await c.select([]);
        }
        const elapsed = performance.now() - start;
        await c.select([id]);
        const selected = fills.map((f) => [
          ...v.geometryFill.getGeometryInstanceAttributes(f).color,
        ]);
        await c.select([]);
        const restored = fills.map((f) => [
          ...v.geometryFill.getGeometryInstanceAttributes(f).color,
        ]);
        v.lookAtGeographic([-79.995, 32.005, 0], 2200, 0, 0);
        v.viewer.render();
        const hole = v.project(v.position(32.005, -79.995));
        return {
          before,
          selected,
          restored,
          elapsed,
          builds,
          after: v.diagnostics().geometryReuse,
          retained: v.geometryFill === window.__polygonFill,
          holeHit: !!v.scene.pick(hole, 3, 3),
        };
      }, polygonId);
      assert(styled.retained);
      assert.equal(styled.builds, styled.after.builds);
      assert.equal(styled.before.length, 2);
      assert.deepEqual(styled.restored, styled.before);
      assert(
        styled.selected.every(
          (c) => c[0] === 255 && c[1] === 210 && c[2] === 122,
        ),
      );
      assert(!styled.holeHit);
      records.push({ mode: "polygon-selection", ...styled });
      save();
      await page.screenshot({ path: path.join(out, "polygons.png") });
      pass(
        "Multipart polygon selection patches GPU colors, retains meshes and preserves holes",
      );
      await api("save", {
        path: path.join(out, "polygons.chronoscope"),
        overwrite: true,
      });
    } finally {
      save();
      await page
        .screenshot({ path: path.join(out, "last.png") })
        .catch(() => {});
    }
  },
);
