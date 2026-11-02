import assert from "node:assert/strict";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "navigation-fixes",
  async ({ page, pass }) => {
    for (const mode of ["map", "space-time", "globe"]) {
      await page.click(`[data-view="${mode}"]`);
      await page.evaluate(() => window.__chronoscope.view.fit());
      await page.waitForTimeout(1000);
      const click = await page.evaluate(() => {
        const v = window.__chronoscope.view,
          r = v.viewer.canvas.getBoundingClientRect();
        for (const p of v.renderPoints) {
          if (p.inferred) continue;
          const s = v.project(v.groundPosition(p.lat, p.lon));
          if (
            !s ||
            s.x < 40 ||
            s.y < 40 ||
            s.x > r.width - 100 ||
            s.y > r.height - 40
          )
            continue;
          for (const dx of [8, 9, 10, 11, -8, -9, -10, -11]) {
            if (v.pickId(s.x + dx, s.y)) continue;
            const ground = v.radiusGroundAt({ x: s.x + dx, y: s.y });
            if (!ground) continue;
            return { x: r.left + s.x + dx, y: r.top + s.y };
          }
        }
      });
      assert(click, mode + " has a reachable stem foot");
      await page.mouse.click(click.x, click.y, { button: "right" });
      await page.waitForSelector("#radius-query");
      await page.locator("#query-radius").fill("0.001");
      await page.locator('#radius-query [type="submit"]').click();
      await page.waitForFunction(
        () => window.__chronoscope.snapshot.selected_count > 0,
      );
      await page.waitForSelector("#radius-query", { state: "detached" });
      assert.equal(
        await page.evaluate(() => window.__chronoscope.view.handles.show),
        false,
      );
      const directions = [];
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
        const before = await page.evaluate(() => {
          const c = window.__chronoscope.view.camera;
          return {
            p: [c.positionWC.x, c.positionWC.y, c.positionWC.z],
            r: [c.rightWC.x, c.rightWC.y, c.rightWC.z],
            u: [c.upWC.x, c.upWC.y, c.upWC.z],
          };
        });
        await page.locator(".cesium-widget canvas").focus();
        await page.keyboard.press(key);
        const after = await page.evaluate(() => {
          const p = window.__chronoscope.view.camera.positionWC;
          return [p.x, p.y, p.z];
        });
        const axis = ["ArrowLeft", "ArrowRight"].includes(key)
          ? before.r
          : before.u;
        const movement = after.reduce(
          (sum, v, i) => sum + (v - before.p[i]) * axis[i],
          0,
        );
        assert(
          ["ArrowLeft", "ArrowDown"].includes(key)
            ? movement < 0
            : movement > 0,
          mode +
            " " +
            key +
            " moves viewpoint in the requested screen direction: " +
            movement,
        );
        directions.push(movement);
      }
      pass(
        mode +
          ": small-radius mouse selection, no grab spheres, and correct arrow viewpoint directions " +
          directions,
      );
    }
    await page.evaluate(() =>
      window.__chronoscope.view.onRadiusQuery(89, 0, { x: 400, y: 300 }),
    );
    await page.locator("#query-radius").fill("0.001");
    await page.locator('#radius-query [type="submit"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector("#radius-error")
        ?.textContent.includes("No located events"),
    );
    assert.equal(await page.locator("#radius-query").count(), 1);
    pass("Empty radius results keep the dialog open with actionable feedback");
  },
  { demo: true },
);
