import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp(
  "vfx-coverage-v2",
  async ({ page, api, out, root, pass }) => {
    const details = [];
    const save = () =>
      fs.writeFileSync(
        path.join(out, "coverage.json"),
        JSON.stringify({ details }, null, 2),
      );
    page.on("console", (m) => {
      if (["error", "info"].includes(m.type()))
        console.log("BROWSER", m.type(), m.text());
    });
    const pause = async () => {
      await page.evaluate(async () => {
        const c = window.__chronoscope;
        await c.liveViewRequest("view_playback", { action: "pause" });
        await c.filterIdle();
        await c.sceneIdle();
      });
    };
    async function open(name, options, terrain = false) {
      await pause();
      await api("open", {
        path: path.join(root, "samples", name + ".chronoscope"),
      });
      await api("select", { ids: [] });
      await api("preferences", {
        preferences: {
          terrain_builtin: terrain,
          terrain_path: null,
          terrain_vertical_datum: "egm96",
          auto_save_unsaved: false,
        },
      });
      const changed = await api("view_set", {
        mode: "globe",
        fit: true,
        globe_time: false,
        globe_altitude: false,
        display: {
          mode: "points",
          spatial_culling: false,
          show_points: true,
          show_tracks: true,
          show_trails: false,
          bloom: false,
          trail_gap_minutes: 2,
          point_scale: 1,
        },
        ...options,
      });
      const snap = await api("snapshot", { compact: true });
      const [lo, hi] = snap.time_bounds;
      await api("filter", { filter: { start: lo, end: lo + (hi - lo) * 0.2 } });
      await page.evaluate(async (scene) => {
        const c = window.__chronoscope;
        await c.restoreScene(scene);
        await c.sceneIdle();
      }, changed.scene);
      await page.evaluate(async () => {
        const c = window.__chronoscope,
          [lo, hi] = c.snapshot.time_bounds;
        const choices = [0.001, 1, 60, 3600, 86400, 604800].flatMap((i) =>
          [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => [s, i]),
        );
        choices.sort(
          (a, b) =>
            Math.abs(Math.log((a[0] * a[1]) / ((hi - lo) / 100))) -
            Math.abs(Math.log((b[0] * b[1]) / ((hi - lo) / 100))),
        );
        await c.liveViewRequest("view_playback", {
          action: "configure",
          speed: choices[0][0],
          increment_seconds: choices[0][1],
          fade_amount: 50,
        });
      });
      return snap;
    }
    const play = async () => {
      await page.evaluate(() =>
        window.__chronoscope.liveViewRequest("view_playback", {
          action: "play",
        }),
      );
      await page.waitForFunction(
        () => window.__chronoscope.view.smoothPlaybackActive,
      );
    };
    try {
      for (const entry of [
        {
          name: "flights-philippines-week-2026",
          key: "flights-altitude",
          options: { globe_altitude: true },
        },
        {
          name: "starlink-128-predicted-orbits-2024",
          key: "orbits-altitude",
          options: { globe_altitude: true },
        },
        {
          name: "starlink-128-predicted-orbits-2024",
          key: "orbits-map",
          options: { mode: "map" },
        },
        {
          name: "animal-gps-black-rock-forest-2023-03",
          key: "terrain",
          options: {},
          terrain: true,
        },
        {
          name: "animal-gps-black-rock-forest-2023-03",
          key: "terrain-time-stems",
          terrain: true,
          options: {
            mode: "space-time",
            display: {
              mode: "points",
              spatial_culling: false,
              show_points: true,
              show_tracks: true,
              show_trails: true,
              bloom: false,
              trail_gap_minutes: 180,
              point_scale: 1,
            },
          },
        },
      ]) {
        await open(entry.name, entry.options, entry.terrain);
        await play();
        await page.waitForTimeout(2000);
        const state = await page.evaluate(() => {
          const v = window.__chronoscope.view;
          return {
            diag: v.diagnostics(),
            points: v.resident.pointCount,
            terrain: !!v.terrain,
          };
        });
        assert.equal(state.diag.renderErrorCount, 0);
        assert(state.diag.experimentalPlayback.active);
        assert(
          state.diag.experimentalPlayback.resident.curvedTracks?.batches === 1,
        );
        if (entry.key.startsWith("orbits"))
          assert(
            state.diag.experimentalPlayback.resident.curvedTracks.dateLineCuts >
              0,
          );
        if (entry.terrain)
          assert(state.diag.experimentalPlayback.terrainSamples > 0);
        if (entry.options.globe_altitude) {
          const heightCheck = await page.evaluate(async () => {
            const v = window.__chronoscope.view;
            const p = v.resident.visiblePoints()[0];
            // The canonical position function and prepared marker must use the same
            // measured altitude/geoid reference, rather than surface or display time.
            const a = v.pos(p),
              b = v.resident.pointPosition(p.id);
            return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          });
          assert(heightCheck < 1e-6, heightCheck);
        }
        const identity = await page.evaluate(
          () => window.__chronoscope.snapshot.revision,
        );
        await page.waitForFunction(
          (revision) => window.__chronoscope.snapshot.revision > revision + 2,
          identity,
        );
        assert(
          await page.evaluate(
            () => window.__chronoscope.view.smoothPlaybackActive,
          ),
        );
        await page.evaluate(() =>
          window.__chronoscope.liveViewRequest("view_navigate", {
            action: "zoom",
            factor: 1.05,
          }),
        );
        await page.waitForTimeout(1000);
        assert(
          await page.evaluate(
            () => window.__chronoscope.view.smoothPlaybackActive,
          ),
          "Navigation must retain prepared playback",
        );
        await page.screenshot({ path: path.join(out, entry.key + ".png") });
        details.push({ key: entry.key, ...state });
        save();
        await pause();
        const exact = await api("render_data", { max_points: 100000 });
        const ids = await page.evaluate(() =>
          window.__chronoscope.view.points.map((p) => p.id),
        );
        assert.deepEqual([...ids].sort(), [...exact.ids].sort());
        pass(
          entry.key +
            ": prepared playback, changing filters, navigation and exact pause membership",
        );
      }
      // Many timed vertices, with no points to conceal an incorrect line
      // window. Real GPU picking obeys the material's fragment discard.
      await pause();
      const timingFile = path.join(out, "timed-line.csv");
      fs.writeFileSync(
        timingFile,
        "entity,timestamp,latitude,longitude,altitude\n" +
          Array.from(
            { length: 1024 },
            (_, i) =>
              `Timed,${new Date(1735689600000 + i * 1000).toISOString()},5,${30 + (i / 1023) * 10},100`,
          ).join("\n"),
      );
      const preview = await api("import_preview", { path: timingFile });
      await api("import_commit", {
        import_id: preview.import_id,
        append: false,
      });
      await api("preferences", {
        preferences: { terrain_builtin: false, terrain_path: null },
      });
      const timingScene = await api("view_set", {
        mode: "map",
        fit: true,
        globe_altitude: true,
        display: {
          mode: "points",
          show_points: false,
          show_tracks: true,
          show_trails: false,
          spatial_culling: false,
          bloom: false,
          track_opacity: 1,
          trail_gap_minutes: 0,
        },
      });
      await api("filter", { filter: { start: 1735689600, end: 1735689800 } });
      await page.evaluate(async (scene) => {
        const c = window.__chronoscope;
        await c.restoreScene(scene);
        await c.sceneIdle();
      }, timingScene.scene);
      await play();
      const clipping = await page.evaluate(async () => {
        const v = window.__chronoscope.view,
          r = v.resident,
          original = r.setWindow.bind(r);
        r.setWindow = () => original(1735689700, 1735689900);
        r.setWindow();
        v.lookAtGeographic([35, 5, 0], 2000000, 0, 0);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const hit = (index) => {
          const p = {
            lat: 5,
            lon: 30 + (index / 1023) * 10,
            time: 1735689600 + index,
          };
          const xy = v.project(v.pos(p));
          return {
            xy,
            onScreen:
              !!xy &&
              xy.x > 3 &&
              xy.x < v.scene.canvas.clientWidth - 3 &&
              xy.y > 3 &&
              xy.y < v.scene.canvas.clientHeight - 3,
            hit: xy ? !!v.scene.pick({ x: xy.x, y: xy.y }, 3, 3) : false,
          };
        };
        return { early: hit(50), inside: hit(200), late: hit(800) };
      });
      assert(
        Object.values(clipping).every((p) => p.onScreen),
        JSON.stringify(clipping),
      );
      assert(clipping.inside.hit, JSON.stringify(clipping));
      assert(!clipping.early.hit, JSON.stringify(clipping));
      assert(!clipping.late.hit, JSON.stringify(clipping));
      details.push({ key: "GPU-track-time-clipping", clipping });
      save();
      pass("Batched tracks clip to the exact GPU time window");
      await pause();
      await open("nasa-firms-south-america-2026-10", {
        mode: "map",
        display: {
          mode: "heatmap",
          spatial_culling: false,
          show_points: false,
          show_tracks: false,
          show_trails: false,
          bloom: false,
          heat_weight: "value",
          heat_max: 300,
          heat_radius: 18,
        },
      });
      // The direct-canvas texture must retain the standard PNG atlas's pixels.
      const images = await page.evaluate(async () => {
        const v = window.__chronoscope.view,
          layer = v.displayLayer;
        const captures = [];
        for (const optimized of [false, true]) {
          layer.setOptimizedPlayback(optimized);
          await layer.rebuild();
          await new Promise((r) => setTimeout(r, 1000));
          captures.push(await v.screenshot());
        }
        layer.setOptimizedPlayback(false);
        return captures;
      });
      const a = PNG.sync.read(Buffer.from(images[0].split(",")[1], "base64")),
        b = PNG.sync.read(Buffer.from(images[1].split(",")[1], "base64"));
      assert.equal(a.width, b.width);
      assert.equal(a.height, b.height);
      let changed = 0;
      for (let i = 0; i < a.data.length; i += 4)
        if (
          Math.max(
            ...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b.data[i + c])),
          ) > 3
        )
          changed++;
      const changedFraction = changed / (a.width * a.height);
      assert(changedFraction < 0.01, changedFraction);
      pass("Direct-canvas heatmap retains standard rendered pixels");
      await play();
      await page.waitForTimeout(2000);
      const first = await page.evaluate(() => ({
        ...window.__chronoscope.view.displayLayer.diagnostics,
      }));
      await page.waitForTimeout(3000);
      const heat = await page.evaluate(() => ({
        diag: window.__chronoscope.view.diagnostics(),
        layer: { ...window.__chronoscope.view.displayLayer.diagnostics },
      }));
      assert.equal(heat.diag.experimentalPlayback.kind, "heatmap");
      assert.equal(heat.diag.renderErrorCount, 0);
      assert(heat.layer.groundEffectBuilds > first.groundEffectBuilds);
      assert.equal(heat.layer.workerStarts, first.workerStarts);
      await page.screenshot({ path: path.join(out, "heatmap.png") });
      await pause();
      const parity = await page.evaluate(async () => {
        const c = window.__chronoscope,
          packet = c.view.displayLayer.packet;
        const exact = await c.call("display_data", {
          level: packet.level,
          time_bin_minutes: 0,
          partition: "all",
          weight: "value",
          max_cells: 4000,
          flat: false,
          expected_revision: c.snapshot.revision,
        });
        return { actual: packet.bins, expected: exact.bins };
      });
      assert.deepEqual(parity.actual, parity.expected);
      details.push({ key: "heatmap", heat, changedFraction });
      save();
      pass(
        "Heatmap reuses its worker during playback and retains exact weighted cells on pause",
      );
      assert(
        await page.evaluate(() => {
          const v = window.__chronoscope.view,
            previous = v.measurement;
          try {
            v.measurement = {
              title: "Measured",
              unit: "m",
              minimum: 0,
              maximum: 100,
              latest_per_entity: true,
            };
            return !v.canSmoothHeatmap() && !!v.residentPlaybackReason();
          } finally {
            v.measurement = previous;
          }
        }),
      );
      pass("Measurement scenes retain the full standard renderer");
      await open(
        "nasa-firms-south-america-2026-10",
        {
          mode: "globe",
          display: {
            mode: "heatmap",
            spatial_culling: false,
            show_points: false,
            show_tracks: false,
            show_trails: false,
            bloom: false,
            heat_weight: "value",
            heat_max: 300,
            heat_radius: 18,
          },
        },
        true,
      );
      await play();
      await page.waitForTimeout(2500);
      const draped = await page.evaluate(() =>
        window.__chronoscope.view.diagnostics(),
      );
      assert.equal(draped.experimentalPlayback.kind, "heatmap");
      assert(draped.terrain.terrainActive);
      assert.equal(draped.renderErrorCount, 0);
      assert.equal(draped.effectError, "");
      await page.screenshot({ path: path.join(out, "terrain-heatmap.png") });
      details.push({ key: "terrain-heatmap", diag: draped });
      save();
      await pause();
      pass("Direct-canvas heatmap also drapes over Balanced terrain in Globe");
    } finally {
      details.push({
        final: await page
          .evaluate(() => ({
            label: document.querySelector("#vfx-playback-state").textContent,
            diag: window.__chronoscope.view.diagnostics(),
          }))
          .catch(() => null),
      });
      save();
      await page
        .screenshot({ path: path.join(out, "last-state.png") })
        .catch(() => {});
    }
  },
);
