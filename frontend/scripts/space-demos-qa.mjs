import { withLocalApp } from "./local-browser.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

await withLocalApp("space-demos", async ({ page, api, out, pass }) => {
  page.setDefaultTimeout(90000);
  const catalog = (await api("demo_catalog")).demos;
  assert.equal(catalog.length, 15);
  assert(
    !catalog.some((d) =>
      ["rocket-altitude", "falcon9-launches", "covid"].includes(d.id),
    ),
  );
  assert.equal(catalog.at(-1).id, "starlink-orbits");
  for (const [id, count] of [["starlink-orbits", 46208]]) {
    for (let index = 0; index < 2; index++) {
      await page.locator("#help").click();
      await page.locator("#demo-datasets").click();
      await page.locator("[data-demo-id]").first().waitFor();
      assert.equal(await page.locator("[data-demo-id]").count(), 15);
      assert.equal(
        await page.locator('[data-demo-id="rocket-altitude"]').count(),
        0,
      );
      const previews = page.locator(`[data-demo-preview="${id}"]`);
      assert.equal(await previews.count(), 2);
      await previews
        .nth(index)
        .locator("img")
        .evaluate(async (image) => {
          await image.decode();
          if (image.naturalWidth !== 480 || image.naturalHeight !== 300)
            throw Error("Missing demo thumbnail");
        });
      const previousWorkspace = await page.evaluate(
        () => window.__chronoscope.snapshot.workspace_id,
      );
      await previews.nth(index).click();
      await page.waitForFunction(
        ({ n, previous }) =>
          window.__chronoscope.snapshot.workspace_id !== previous &&
          window.__chronoscope.snapshot.count === n &&
          !window.__chronoscope.busy,
        { n: count, previous: previousWorkspace },
        { polling: 100 },
      );
      // The picker opens the default scene before restoring the clicked preview.
      // Wait for that second transition, rather than observing its first frame.
      await page.waitForFunction(
        ({ time, points }) => {
          const c = window.__chronoscope;
          const d = c.view.diagnostics();
          return !c.busy && d.globeTime === time && d.pointCount === points;
        },
        { time: index === 1, points: index === 0 ? 11648 : count },
        { polling: 100 },
      );
      await page.evaluate(() => window.__chronoscope.sceneIdle());
      const status = await page.evaluate(() =>
        window.__chronoscope.liveViewRequest("view_status"),
      );
      assert.equal(status.diagnostics.renderErrorCount, 0);
      const snapshot = await api("snapshot", {
        compact: false,
        include_statistics: false,
      });
      assert.equal(snapshot.count, count);
      if (index === 0) {
        const exported = await api("export", {
          path: path.join(out, `${id}.csv`),
        });
        const credit = JSON.parse(
          fs.readFileSync(exported.attribution, "utf8"),
        );
        assert(credit[0].license.includes("CC BY"));
      }
      if (id === "starlink-orbits") {
        assert.equal(Object.keys(snapshot.entities).length, 128);
        assert.equal(
          status.diagnostics.pointCount,
          index === 0 ? 11648 : count,
        );
        assert.equal(status.diagnostics.globeAltitude, index === 0);
        assert.equal(status.diagnostics.globeTime, index === 1);
        assert.equal(status.diagnostics.stemSegments, 0);
        assert(status.diagnostics.trailOutputEdges > 0);
        assert.equal(
          status.diagnostics.altitude.known,
          index === 0 ? 11648 : count,
        );
      } else {
        assert.equal(Object.keys(snapshot.categories).length, 3);
        assert.equal(status.scene.globe_time, index === 0);
        assert.equal(status.scene.globe_altitude, false);
        assert.equal(status.diagnostics.stemSegments, 0);
        assert.equal(snapshot.scene.display.show_trails, false);
      }
      await page.screenshot({ path: path.join(out, `${id}-${index}.png`) });
      pass(
        `${id}: preview ${index} opens exact scene, count and source semantics`,
      );
    }
  }
  const before = await api("snapshot", { compact: true });
  await assert.rejects(api("demo_open", { id: "rocket-altitude" }));
  assert.equal((await api("snapshot", { compact: true })).count, before.count);
  pass(
    "Retired rocket demo is absent from picker/API and cannot replace the workspace",
  );
});
