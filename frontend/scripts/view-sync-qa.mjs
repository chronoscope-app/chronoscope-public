import { chromium } from "./qa-runtime.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "view-sync",
  async ({ page, api, out, pass }) => {
    const mode = async (name) => {
      await page.locator(`[data-view="${name}"]`).click();
      await page.evaluate(() => window.__chronoscope.viewModeIdle());
      const renderedFrames = await page.evaluate(() => {
        const v = window.__chronoscope.view;
        const count = v.diagnostics().performance.renderedFrames;
        v.scene.requestRender();
        return count;
      });
      // Await presentation of the restored camera instead of assuming the
      // software renderer has completed a frame within a fixed 100 ms.
      await page.waitForFunction(
        ({ name, renderedFrames }) => {
          const v = window.__chronoscope.view;
          return (
            v.mode === name &&
            v.scene.frameState.mode === v.scene.mode &&
            v.diagnostics().performance.renderedFrames > renderedFrames
          );
        },
        { name, renderedFrames },
        { polling: 100 },
      );
    };
    const state = () =>
      page.evaluate(() => {
        const c = window.__chronoscope,
          v = c.view;
        return {
          mode: v.mode,
          frame: v.navigationFrame(),
          camera: v.captureCamera(),
          filter: c.snapshot.filter,
          selection: c.snapshot.selected,
          count: c.snapshot.count,
        };
      });
    const near = (a, b, epsilon, label) =>
      assert(Math.abs(a - b) < epsilon, `${label}: ${a} vs ${b}`);
    const sameCamera = (a, b) => {
      for (const key of ["position", "direction", "up"])
        a.cesium_camera[key].forEach((v, i) => {
          // Cesium recalculates orthographic camera altitude during morphs; it does
          // not affect the flat projection. Check XY, heading and frustum exactly.
          if (
            key === "position" &&
            i === 2 &&
            a.cesium_camera.frustum_width !== undefined
          )
            return;
          near(
            v,
            b.cesium_camera[key][i],
            key === "position" ? 1e-6 : 1e-10,
            key,
          );
        });
      if (a.cesium_camera.frustum_width !== undefined)
        near(
          a.cesium_camera.frustum_width,
          b.cesium_camera.frustum_width,
          1e-5,
          "frustum width",
        );
    };
    const heading = (a, b) =>
      near(((a - b + 540) % 360) - 180, 0, 0.05, "heading");
    const sameFrame = (source, target, flat) => {
      near(source.center[0], target.center[0], 0.003, "longitude");
      near(source.center[1], target.center[1], 0.003, "latitude");
      assert(target.ground_width > 0 && Number.isFinite(target.ground_width));
      heading(source.heading, target.heading);
      near(flat ? 0 : source.tilt, target.tilt, 0.1, "tilt");
    };
    const coversFootprint = async (source) => {
      const result = await page.evaluate((footprint) => {
        const v = window.__chronoscope.view,
          C = v.camera.position.constructor;
        return {
          width: v.viewer.canvas.clientWidth,
          height: v.viewer.canvas.clientHeight,
          points: footprint.map((p) => v.project(C.fromDegrees(...p)) ?? null),
        };
      }, source.footprint);
      for (const p of result.points)
        assert(
          p &&
            p.x >= -4 &&
            p.y >= -4 &&
            p.x <= result.width + 4 &&
            p.y <= result.height + 4,
          JSON.stringify(result),
        );
    };
    assert(
      await page
        .locator("#box-select")
        .evaluate((e) => e.nextElementSibling.id === "sync-views"),
    );
    for (const sourceMode of ["space-time", "globe", "map"]) {
      await mode(sourceMode);
      await page.evaluate(
        (m) =>
          window.__chronoscope.view.lookAtGeographic(
            [-122.41, 37.78, 0],
            18000,
            47,
            m === "map" ? 0 : 35,
          ),
        sourceMode,
      );
      await page.waitForTimeout(250);
      const before = await state();
      await page.locator("#sync-views").click();
      await page.waitForFunction(
        () => !document.querySelector("#sync-views").disabled,
      );
      sameCamera((await state()).camera, before.camera);
      for (const target of ["space-time", "map", "globe"].filter(
        (m) => m !== sourceMode,
      )) {
        await mode(target);
        const after = await state();
        sameFrame(before.frame, after.frame, target === "map");
        await coversFootprint(before.frame);
        assert.deepEqual(after.filter, before.filter);
        assert.deepEqual(after.selection, before.selection);
        assert.equal(after.count, before.count);
      }
      await mode(sourceMode);
      sameCamera((await state()).camera, before.camera);
      pass(
        `${sourceMode} → other views: centre, visible bounds, heading, tilt/flatness; unchanged data/filter/selection`,
      );
    }
    await page.evaluate(() => {
      const v = window.__chronoscope.view;
      v.panPixels(100, 30);
      v.setBearing(112);
    });
    await page.waitForTimeout(250);
    const independent = await state();
    await mode("globe");
    await mode("map");
    sameCamera((await state()).camera, independent.camera);
    pass("independent adjustments survive switches without resync");
    await page.locator("#sync-views").click();
    await page.waitForFunction(
      () => !document.querySelector("#sync-views").disabled,
    );
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.call("scene_sync", { scene: c.captureScene() });
    });
    const saved = path.join(out, "synced.chronoscope");
    await api("save", { path: saved });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      const r = await c.call("demo_open", { id: "hurricanes" });
      await c.restoreScene(r.scene);
    });
    await page.evaluate(async (file) => {
      const c = window.__chronoscope;
      const r = await c.call("open", { path: file });
      await c.restoreScene(r.scene);
    }, saved);
    await mode("space-time");
    sameFrame(independent.frame, (await state()).frame, false);
    await coversFootprint(independent.frame);
    await mode("globe");
    sameFrame(independent.frame, (await state()).frame, false);
    await coversFootprint(independent.frame);
    pass(
      "save/reopen retains unvisited synced views; opening another workspace clears prior navigation",
    );
    for (const center of [
      [179.99, 40, 0],
      [18, 80, 0],
    ]) {
      await mode("globe");
      await page.evaluate(
        (center) =>
          window.__chronoscope.view.lookAtGeographic(center, 30000, 133, 20),
        center,
      );
      await page.waitForTimeout(150);
      const source = await state();
      for (const point of source.frame.footprint)
        near(point[2], 0, 1e-4, "ellipsoid footprint height");
      await page.locator("#sync-views").click();
      await page.waitForFunction(
        () => !document.querySelector("#sync-views").disabled,
      );
      await mode("map");
      await coversFootprint(source.frame);
      heading(source.frame.heading, (await state()).frame.heading);
      near((await state()).frame.tilt, 0, 0.001, "flat at world edges");
    }
    pass("dateline and high-latitude areas remain visible in rotated Map");
    await mode("globe");
    await page.evaluate(() =>
      window.__chronoscope.view.lookAtGeographic([0, 0, 0], 25000000, 0, 0),
    );
    await page.waitForTimeout(150);
    const overview = await state();
    await page.locator("#sync-views").click();
    await page.waitForFunction(
      () => !document.querySelector("#sync-views").disabled,
    );
    await mode("map");
    await coversFootprint(overview.frame);
    pass(
      "whole-Earth overview sync fits its geographic area when corner rays miss the globe",
    );
    await page.evaluate(() => {
      for (const m of ["globe", "map", "space-time"])
        document.querySelector(`[data-view="${m}"]`).click();
    });
    await page.evaluate(() => window.__chronoscope.viewModeIdle());
    assert.equal((await state()).mode, "space-time");
    pass("rapid mode switches settle on the requested view");
    await mode("map");
    await page.evaluate(() => window.__chronoscope.view.setBearing(123));
    await page.locator(".navigation-sphere").focus();
    await page.keyboard.press("Home");
    heading((await state()).frame.heading, 0);
    pass("Home on the Map compass resets a synced heading to north");
    await page.screenshot({ path: path.join(out, "globe-synced.png") });
    assert.equal(
      await page.evaluate(
        () => window.__chronoscope.view.diagnostics().renderErrorCount,
      ),
      0,
    );
  },
  { demo: true },
);
