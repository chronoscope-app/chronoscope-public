import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("vfx-full-app", async ({ page, api, out, root, pass }) => {
  page.on("console", (message) => {
    if (["error", "info"].includes(message.type()))
      console.log("BROWSER", message.type(), message.text());
  });
  const report = {
    scope:
      "Full Chronoscope application, imported 100k events, normal Play control and engine filters",
    samples: [],
    passed: false,
  };
  const publish = () =>
    fs.writeFileSync(
      path.join(out, "integration.json"),
      JSON.stringify(report, null, 2),
    );
  try {
    const csv = path.join(out, "regional-100k.csv");
    const rows = ["entity,timestamp,latitude,longitude,category"];
    for (let t = 0; t < 1000; t++)
      for (let e = 0; e < 100; e++)
        rows.push(
          `Track ${String(e).padStart(3, "0")},${new Date(1735689600000 + t * 1000).toISOString()},${32 + e * 0.004 + Math.sin(t / 35) * 0.025},${-80 + t * 0.0005 + Math.cos(t / 35) * 0.025},C${e % 5}`,
        );
    fs.writeFileSync(csv, rows.join("\n"));
    const preview = await api("import_preview", { path: csv, storage: "disk" });
    await api("import_commit", { import_id: preview.import_id });
    await api("filter", { filter: { start: 1735689600, end: 1735689799 } });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh();
      const changed = await c.call("view_set", {
        mode: "globe",
        fit: true,
        display: {
          mode: "points",
          spatial_culling: false,
          show_points: true,
          show_tracks: true,
          show_trails: false,
          trail_gap_minutes: 0,
          bloom: false,
        },
      });
      await c.restoreScene(changed.scene, changed.revision);
      await c.sceneIdle();
      await c.liveViewRequest("view_playback", {
        action: "configure",
        speed: 0.25,
        increment_seconds: 60,
        fade_amount: 50,
      });
    });
    await page.bringToFront();
    assert.equal(await page.locator("#open").count(), 1);
    assert.equal(await page.locator("#save").count(), 1);
    assert.equal(await page.locator("#vfx-playground").count(), 0);
    assert.match(await page.title(), /^Chronoscope \d/);
    assert.equal(
      await page.getByText("VFX Experimental", { exact: true }).count(),
      0,
    );
    const desktopConfig = JSON.parse(
      fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    assert.equal(desktopConfig.productName, "Chronoscope");
    assert.equal(desktopConfig.identifier, "org.chronoscope.desktop");
    const smoothSwitch = page.locator("#vfx-smooth-playback");
    assert(await smoothSwitch.isChecked());
    for (const enabled of [false, true]) {
      await smoothSwitch.setChecked(enabled);
      await page.reload();
      await page.waitForFunction(
        () =>
          window.__chronoscope?.snapshot?.count === 100000 &&
          !window.__chronoscope.busy,
      );
      await page.evaluate(() => window.__chronoscope.sceneIdle());
      assert.equal(await smoothSwitch.isChecked(), enabled);
    }
    await page.evaluate(() => window.__chronoscope.liveViewRequest("view_playback", {
      action: "configure", speed: 0.25, increment_seconds: 60, fade_amount: 50,
    }));
    pass(
      "Normal Chronoscope identity and Smooth playback preference survive reload",
    );
    pass(
      "Full application imports 100k real records and retains ordinary workspace controls",
    );
    const play = async () => {
      await page.locator("#play").click();
      await page.waitForFunction(() =>
        document.querySelector("#play").textContent.includes("Pause"),
      );
    };
    const pause = async () => {
      await page.locator("#play").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#play").textContent.includes("Play") &&
          !window.__chronoscope.view.playback,
      );
      await page.evaluate(() => window.__chronoscope.filterIdle());
    };
    let delayPool = true,
      poolPending = false;
    await page.route("**/api/invoke", async (route) => {
      const request = route.request().postDataJSON();
      if (
        delayPool &&
        request.command === "render_data" &&
        request.args?.playback_pool
      ) {
        poolPending = true;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      await route.continue();
    });
    for (const cancelWithCheckbox of [true, false]) {
      poolPending = false;
      await page.locator("#play").click();
      for (let i = 0; i < 100 && !poolPending; i++)
        await page.waitForTimeout(25);
      assert(
        poolPending,
        "Exercise cancellation while the pool request is pending",
      );
      if (cancelWithCheckbox)
        await page.locator("#vfx-smooth-playback").uncheck();
      else await page.locator("#play").click();
      await page.waitForTimeout(1000);
      assert(
        await page.evaluate(
          () =>
            !window.__chronoscope.view.playback &&
            !window.__chronoscope.view.residentPlaybackActive,
        ),
      );
      assert((await page.locator("#play").textContent()).includes("Play"));
      await page.locator("#vfx-smooth-playback").check();
    }
    delayPool = false;
    pass(
      "Play and Smooth playback controls cancel pending preparation without late activation",
    );
    await play();
    await page.waitForFunction(
      () => window.__chronoscope.view.residentPlaybackActive,
    );
    const startRevision = await page.evaluate(
      () => window.__chronoscope.snapshot.revision,
    );
    await page.waitForFunction(
      (revision) => window.__chronoscope.snapshot.revision >= revision + 3,
      startRevision,
    );
    assert(
      await page.evaluate(
        () => window.__chronoscope.view.residentPlaybackActive,
      ),
    );
    pass(
      "GPU clock stays active while the authoritative engine publishes changing time filters",
    );
    const point = await page.evaluate(() => {
      const v = window.__chronoscope.view;
      for (const p of v.resident.visiblePoints()) {
        const pixel = v.project(v.pos(p));
        if (
          !pixel ||
          pixel.x < 90 ||
          pixel.y < 80 ||
          pixel.x > v.host.clientWidth - 90 ||
          pixel.y > v.host.clientHeight - 80
        )
          continue;
        const hit = v.pickId(pixel.x, pixel.y);
        if (hit?.kind === "event") {
          const selected = v.resident.point(hit.id);
          const [start, end] = v.resident.diagnostics().window;
          return {
            id: hit.id,
            valid: selected.time >= start && selected.time <= end,
          };
        }
      }
      return null;
    });
    assert(point?.valid, JSON.stringify(point));
    pass("GPU picking resolves an actual visible event ID");
    await page.evaluate((id) => window.__chronoscope.select([id]), point.id);
    await page.waitForFunction(
      () => !window.__chronoscope.view.residentPlaybackActive,
    );
    assert.equal((await api("snapshot", { compact: true })).selected_count, 1);
    await pause();
    pass(
      "Selecting during accelerated playback returns coherently to the full renderer",
    );
    await api("select", { ids: [], mode: "replace" });
    await page.evaluate(() => window.__chronoscope.refresh());
    await play();
    await page.waitForFunction(
      () => window.__chronoscope.view.residentPlaybackActive,
    );
    const gpuWindow = await page.evaluate(
      () => window.__chronoscope.view.resident.diagnostics().window,
    );
    await pause();
    const stopped = await api("snapshot", { compact: true });
    assert(
      !(await page.evaluate(
        () => window.__chronoscope.view.residentPlaybackActive,
      )),
    );
    assert(
      stopped.filter.start >= gpuWindow[0] - 1 &&
        stopped.filter.end >= gpuWindow[1] - 1,
    );
    const render = await api("render_data", { max_points: 100000 });
    const visible = await api("query", { limit: 1, fields: ["id"] });
    assert.equal(render.located_count, visible.count);
    pass(
      "Pause commits the displayed window and restores exact canonical membership",
    );
    // Exercise a real sidebar filter during playback; the prepared pool must
    // never continue displaying evidence from the old non-temporal predicate.
    await play();
    await page.waitForFunction(
      () => window.__chronoscope.view.residentPlaybackActive,
    );
    await page.locator("#search").fill("Track 007");
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.filter.search === "Track 007",
    );
    assert(
      !(await page.evaluate(
        () => window.__chronoscope.view.residentPlaybackActive,
      )),
    );
    await pause();
    assert.equal(
      (
        await api("query", {
          apply_filter: false,
          filter: { search: "Track 007" },
          limit: 1,
        })
      ).count,
      1000,
    );
    pass(
      "Sidebar changes invalidate the prepared pool without losing ordinary search",
    );
    await page.locator("#search").fill("");
    await page.evaluate(() => window.__chronoscope.filterIdle());
    await page.locator('[data-view="map"]').click();
    await play();
    assert(
      await page.evaluate(
        () => window.__chronoscope.view.residentPlaybackActive,
      ),
    );
    await page.waitForTimeout(1500);
    assert.equal(
      await page.evaluate(
        () => window.__chronoscope.view.diagnostics().renderErrorCount,
      ),
      0,
    );
    await pause();
    await page.locator('[data-view="space-time"]').click();
    await page.waitForFunction(
      () => window.__chronoscope.view.mode === "space-time",
    );
    await play();
    assert(
      await page.evaluate(
        () => window.__chronoscope.view.residentPlaybackActive,
      ),
    );
    await page.waitForTimeout(1500);
    assert.equal(
      await page.evaluate(
        () => window.__chronoscope.view.diagnostics().renderErrorCount,
      ),
      0,
    );
    await pause();
    pass(
      "Map and Time use the integrated GPU playback path without renderer errors",
    );
    await page.locator('[data-view="globe"]').click();
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.call("filter", {
        filter: { start: 1735689600, end: 1735689799 },
      });
      await c.refresh();
    });
    await api("save", { path: path.join(out, "full-app-vfx.chronoscope") });
    assert.equal((await api("snapshot", { compact: true })).count, 100000);
    pass("Experimental workspace saves through the normal Chronoscope engine");
    if (process.env.CHRONOSCOPE_VFX_FUNCTIONAL_ONLY === "1") {
      report.passed = true;
      return;
    }
    // Full-app hardware A/B: engine requests, sidebar and timeline stay live.
    // Keep the real governor enabled; these are render-loop, not presentation timings.
    for (const smooth of [false, true, true, false]) {
      await page.locator("#vfx-smooth-playback").setChecked(smooth);
      await page.evaluate(async () => {
        const c = window.__chronoscope;
        await c.call("filter", {
          filter: { start: 1735689600, end: 1735689799 },
        });
        await c.refresh();
      });
      await play();
      await page.waitForTimeout(2000);
      if (smooth)
        assert(
          await page.evaluate(
            () => window.__chronoscope.view.residentPlaybackActive,
          ),
        );
      const sample = await page.evaluate(
        async ({ smooth }) => {
          const v = window.__chronoscope.view,
            frames = [],
            start = performance.now();
          let last;
          const remove = v.scene.postRender.addEventListener(() => {
            const now = performance.now();
            if (last !== undefined) frames.push(now - last);
            last = now;
          });
          await new Promise((resolve) => setTimeout(resolve, 10000));
          remove();
          frames.sort((a, b) => a - b);
          return {
            smooth,
            elapsedMs: performance.now() - start,
            frames: frames.length,
            fps: (frames.length * 1000) / frames.reduce((a, b) => a + b, 0),
            p95: frames[Math.floor(frames.length * 0.95)],
            p99: frames[Math.floor(frames.length * 0.99)],
            worst: frames.at(-1),
            over50ms: frames.filter((x) => x > 50).length,
            diagnostics: v.diagnostics(),
          };
        },
        { smooth },
      );
      report.samples.push(sample);
      publish();
      await pause();
    }
    const fast = report.samples.filter((s) => s.smooth),
      standard = report.samples.filter((s) => !s.smooth);
    report.averageFps = {
      standard: standard.reduce((a, s) => a + s.fps, 0) / standard.length,
      smooth: fast.reduce((a, s) => a + s.fps, 0) / fast.length,
    };
    assert(
      fast.every(
        (s) =>
          s.diagnostics.renderErrorCount === 0 &&
          s.diagnostics.experimentalPlayback.active,
      ),
    );
    assert(
      report.averageFps.smooth > report.averageFps.standard * 1.3,
      JSON.stringify(report.averageFps),
    );
    await page.screenshot({ path: path.join(out, "full-app.png") });
    pass(
      "Full-app hardware comparison shows a significant playback improvement without renderer errors",
    );
    report.passed = true;
  } finally {
    report.lastState = await page
      .evaluate(() => ({
        label: document.querySelector("#vfx-playback-state").textContent,
        reason: window.__chronoscope.view.residentPlaybackReason(),
        snapshot: window.__chronoscope.snapshot,
        diagnostics: window.__chronoscope.view.diagnostics(),
      }))
      .catch(() => null);
    await page
      .screenshot({ path: path.join(out, "last-state.png") })
      .catch(() => {});
    publish();
  }
});
