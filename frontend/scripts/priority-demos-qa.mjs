import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { withLocalApp } from "./local-browser.mjs";
const reportPath = new URL(
  "../../docs/validation/priority-demos-2026-10-26/capture-report.json",
  import.meta.url,
);
const requested = process.env.CHRONOSCOPE_DEMO_IDS?.split(",");
const receipt =
  requested && fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath)).filter(
        (row) => !requested.includes(row.id),
      )
    : [];
for (const [id, count] of [
  ["earthquakes", 8500],
  ["fire-detections", 50713],
  ["electricity-access", 5746],
].filter(([id]) => !requested || requested.includes(id))) {
  await withLocalApp(
    `priority-${id}`,
    async ({ page, api, out, root, pass }) => {
      await page.setViewportSize({ width: 1920, height: 1200 });
      await page.locator("#help").click();
      await page.locator("#demo-datasets").click();
      await page.locator("[data-demo-id]").first().waitFor();
      assert.equal(await page.locator("[data-demo-id]").count(), 13);
      await page.locator(`[data-demo-preview="${id}"]`).first().click();
      await page.waitForFunction(
        (n) =>
          window.__chronoscope?.snapshot?.count === n &&
          !window.__chronoscope.busy,
        count,
        { polling: 100, timeout: 120000 },
      );
      await page.waitForFunction(
        () => !window.__chronoscope.view.displayLayer.updating,
        null,
        { polling: 100 },
      );
      let s = await api("snapshot", { compact: true });
      assert.equal(s.count, count);
      assert.equal(s.scene.display.show_tracks, false);
      assert.equal(s.scene.display.show_trails, false);
      assert.equal((await api("workspace_status")).source, null);
      pass(`${id}: real picker, source count and line-free display`);
      if (id === "electricity-access") {
        assert.equal(s.visible, 169);
        assert.equal(s.scene.measurement.maximum, 100);
        assert.equal(s.scene.measurement.latest_per_entity, true);
        await page.locator(".measurement-legend").waitFor({ state: "visible" });
        const geometry = await api("render_geometries", {
          limit: 1000,
          max_vertices: 200000,
        });
        assert.equal(geometry.count, 169);
        assert.equal(geometry.limited, false);
        assert(
          geometry.features.every(
            (f) => f.value === null || typeof f.value === "number",
          ),
        );
        const restored = await page.evaluate(async () => {
          const c = window.__chronoscope;
          const r = await c.call("restore_view", { index: 1 });
          await c.restoreScene(r.scene);
          return c.snapshot.visible;
        });
        assert.equal(restored, 169);
        pass(
          "electricity: all 169 countries, exact polygon values, fixed percentage legend and saved year filter",
        );
      } else if (id === "fire-detections") {
        const rendered = await page.waitForFunction(() => {
          const d = window.__chronoscope.view.displayLayer;
          return !d.updating && !d.diagnostics.pending && d.diagnostics.atlasLayers === 1 && d.diagnostics.heatPeak > 0 && d.diagnostics.heatCeiling === 300 ? { ...d.diagnostics } : false;
        }, null, { polling: 100, timeout: 60000 });
        const effect = await rendered.jsonValue();
        assert.equal(effect.error, "");
        assert.equal(effect.heatCeiling, 300);
        assert.equal(s.scene.display.heat_weight, "value");
        const display = await api("display_data", { level: 5 });
        assert.equal(display.count, count);
        pass(
          "fires: heat includes every source detection and uses numeric FRP weights",
        );
      } else {
        await page.locator(".measurement-legend").waitFor({ state: "visible" });
      }
      await page.waitForTimeout(1500);
      const diag = await page.evaluate(() => ({
        ...window.__chronoscope.view.diagnostics(),
        geometryLimited: window.__chronoscope.view.geometryLimited,
      }));
      assert.equal(diag.trackPolylines, 0);
      assert.equal(diag.stemSegments, 0);
      assert.equal(diag.geometryLimited, false);
      const dest = path.join(root, "docs/validation/priority-demos-2026-10-26");
      fs.mkdirSync(dest, { recursive: true });
      const hero = path.join(dest, `${id}-hero.png`);
      if (id === "fire-detections") await page.waitForFunction(() => {
        const d = window.__chronoscope.view.displayLayer;
        return !d.updating && !d.diagnostics.pending && d.diagnostics.atlasLayers === 1 && d.diagnostics.heatCeiling === 300;
      }, null, { polling: 100, timeout: 60000 });
      await page.screenshot({ path: hero });
      s = await api("snapshot", { compact: true });
      receipt.push({
        id,
        count,
        visible: s.visible,
        scene: s.scene,
        filter: s.filter,
        diagnostics: diag,
        screenshot: path.relative(root, hero),
        browser: "Chromium / SwiftShader WebGL2",
        publicRequests: 0,
      });
      fs.writeFileSync(
        path.join(dest, "capture-report.json"),
        JSON.stringify(receipt, null, 2) + "\n",
      );
      if (id === "electricity-access") {
        await page.evaluate(async () => {
          const c = window.__chronoscope;
          const r = await c.call("restore_view", { index: 2 });
          await c.restoreScene(r.scene);
        });
        const earlier = await api("snapshot", { compact: true });
        assert(earlier.filter.start < s.filter.start);
        assert.deepEqual(earlier.scene.measurement, s.scene.measurement);
        await page.locator(".measurement-legend").waitFor({ state: "visible" });
        await page.waitForTimeout(1200);
        await page.screenshot({
          path: path.join(dest, "electricity-access-1990.png"),
        });
        // Measurement controls reject an inverted scale before writing a scene.
        await page.evaluate(() => document.body.classList.remove("fullscreen"));
        await page
          .getByRole("button", { name: "Expand right pane", exact: true })
          .click();
        await page.locator('[data-tab="views"]').click();
        await page.locator('[data-views-action="measurement"]').click();
        await page.locator("#measurement-minimum").fill("100");
        await page.locator("#measurement-maximum").fill("0");
        await page.locator('#measurement-form button[type="submit"]').click();
        assert.match(
          await page.locator("#measurement-error").innerText(),
          /greater/,
        );
        assert.deepEqual(
          (await api("snapshot", { compact: true })).scene.measurement,
          s.scene.measurement,
        );
        pass(
          "electricity: 1990 comparison preserves scale; invalid user scale cannot change the scene",
        );
      }
    },
  );
}
