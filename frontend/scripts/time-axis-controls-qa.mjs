import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "time-axis-controls",
  async ({ page, api, out, pass }) => {
    await page.evaluate(async () => {
      await window.__chronoscope.ready;
      await window.__chronoscope.sceneIdle();
    });
    await page.waitForFunction(
      () => window.__chronoscope.view.axisHandle?.length === 1,
    );
    const inspect = () =>
      page.evaluate(() => {
        const a = window.__chronoscope,
          v = a.view;
        v.viewer.render();
        return {
          size: [v.host.clientWidth, v.host.clientHeight],
          top: v.project(v.axisHandle.get(0).position),
          bottom: v.project(v.axes.get(0).positions[1]),
          focus:
            v.focusLines.show && v.focusLines.length
              ? v.project(v.focusLines.get(0).positions[0])
              : null,
          labels: Array.from({ length: v.axisLabels.length }, (_, i) => {
            const label = v.axisLabels.get(i),
              pos = label.computeScreenSpacePosition(v.scene);
            return {
              text: label.text,
              box: label.constructor.getScreenSpaceBoundingBox(label, pos),
            };
          }),
          camera: v.captureCamera(),
          anchor: v.timeAxisAnchor,
          shown: v.showGrabHandles,
          handles: v.diagnostics().orbitHandles,
          axisHandle: v.diagnostics().axisGrabHandle,
          errors: v.diagnostics().renderErrorCount,
        };
      });
    const fits = (s) => {
      assert(s.labels.length > 0);
      if (s.focus && s.top && s.bottom) {
        const dx = s.bottom.x - s.top.x,
          dy = s.bottom.y - s.top.y;
        const distance =
          Math.abs(dx * (s.focus.y - s.top.y) - dy * (s.focus.x - s.top.x)) /
          Math.max(1, Math.hypot(dx, dy));
        assert(
          distance < 0.5,
          `Playback tick detached from axis by ${distance}px`,
        );
      }
      for (const { text, box: r } of s.labels) {
        assert(
          r.x >= 1 &&
            r.y >= 1 &&
            r.x + r.width <= s.size[0] - 1 &&
            r.y + r.height <= s.size[1] - 1,
          JSON.stringify({ text, r, size: s.size }),
        );
      }
      assert(
        s.top &&
          s.top.x >= 10 &&
          s.top.x < s.size[0] - 10 &&
          s.top.y >= 10 &&
          s.top.y < s.size[1] - 10,
        JSON.stringify(s),
      );
      assert.equal(s.errors, 0);
    };
    let original = await inspect();
    fits(original);
    assert(original.top.x >= 120);
    const first = (await api("events", { limit: 1 })).events[0];
    await api("select", { ids: [first.id] });
    await page.evaluate(async () => {
      await window.__chronoscope.refresh(false, false);
      await window.__chronoscope.sceneIdle();
    });
    original = await inspect();
    const canvas = await page.locator("#scene canvas").first().boundingBox();
    await page.mouse.move(canvas.x + original.top.x, canvas.y + original.top.y);
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + original.top.x + 120,
      canvas.y + original.top.y + 60,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.evaluate(() => window.__chronoscope.sceneIdle());
    const moved = await inspect();
    fits(moved);
    assert(moved.top.x - original.top.x > 100);
    assert(moved.top.y - original.top.y > 40);
    assert(moved.anchor);
    for (const key of ["position", "direction", "up"]) {
      const before = original.camera.cesium_camera[key],
        after = moved.camera.cesium_camera[key];
      assert(
        before.every(
          (v, i) =>
            Math.abs(v - after[i]) < (key === "position" ? 1e-5 : 1e-10),
        ),
        `${key} changed during axis drag`,
      );
    }
    assert.equal((await api("snapshot", { compact: true })).selected_count, 1);
    pass(
      "Top sphere moves only the axis; labels stay inside the canvas and camera/selection are unchanged",
    );
    await page.screenshot({ path: path.join(out, "axis-moved.png") });
    for (const [bearing, tilt, zoom] of [
      [55, 48, 1],
      [120, 70, 2],
      [0, 0, 0.5],
    ]) {
      await page.evaluate(
        ([b, t, z]) => {
          const v = window.__chronoscope.view;
          v.setBearing(b);
          v.setTilt(t);
          v.zoom(z);
        },
        [bearing, tilt, zoom],
      );
      await page.waitForTimeout(500);
      fits(await inspect());
    }
    await page.setViewportSize({ width: 1000, height: 650 });
    await page.waitForTimeout(500);
    fits(await inspect());
    await page.locator('[data-tab="views"]').click();
    await page.locator("#display-grab-handles").uncheck();
    await page.evaluate(() => window.__chronoscope.sceneIdle());
    let hidden = await inspect();
    assert.equal(hidden.handles, 0);
    assert.equal(hidden.axisHandle, 0);
    assert(hidden.labels.length > 0);
    assert.equal(
      await page.evaluate(() => {
        const v = window.__chronoscope.view,
          p = v.project(v.axisHandle.get(0).position);
        return !!v.orbitAt(p.x, p.y);
      }),
      false,
    );
    await page.screenshot({ path: path.join(out, "grab-spheres-hidden.png") });
    assert.equal(
      (await api("snapshot", { compact: true })).scene.show_grab_handles,
      false,
    );
    await page.reload();
    await page.waitForFunction(
      () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
    );
    await page.evaluate(async () => {
      await window.__chronoscope.ready;
      await window.__chronoscope.sceneIdle();
    });
    hidden = await inspect();
    assert.equal(hidden.shown, false);
    assert.equal(hidden.axisHandle, 0);
    assert(hidden.anchor);
    await page.locator('[data-tab="views"]').click();
    assert.equal(
      await page.locator("#display-grab-handles").isChecked(),
      false,
    );
    await page.locator("#display-grab-handles").check();
    await page.evaluate(() => window.__chronoscope.sceneIdle());
    assert.equal((await inspect()).axisHandle, 1);
    pass(
      "Axis labels stay in bounds through rotation, zoom and resize; hiding grab spheres removes picking and persists with the axis position",
    );
    fs.writeFileSync(
      path.join(out, "scene.json"),
      JSON.stringify({ original, moved, hidden }, null, 2),
    );
  },
  { demo: true },
);
