import { withLocalApp } from "./local-browser.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

await withLocalApp("idf-demo", async ({ page, api, out, pass }) => {
  page.setDefaultTimeout(180000);
  const catalog = (await api("demo_catalog")).demos;
  assert.equal(catalog.length, 15);
  assert.equal(catalog.at(-1).id, "starlink-orbits");
  assert(!catalog.some((d) => /CMU|KABR/.test(d.name)));
  await page.locator("#help").click();
  await page.locator("#demo-datasets").click();
  const previews = page.locator('[data-demo-preview="idf-uav"]');
  await previews.first().waitFor();
  assert.equal(await previews.count(), 3);
  for (let i = 0; i < 3; i++) {
    await previews
      .nth(i)
      .locator("img")
      .evaluate(async (image) => {
        await image.decode();
        if (image.naturalWidth !== 480 || image.naturalHeight !== 300)
          throw Error("Missing IDF preview");
      });
  }
  await previews.first().click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 399331 &&
      !window.__chronoscope.busy,
    null,
    { polling: 200 },
  );
  await page.evaluate(() => window.__chronoscope.sceneIdle());
  pass(
    "Picker lists IDF with three working previews; rejected UAV candidates are absent",
  );
  for (const index of [0, 1, 2, 3, 4, 0]) {
    const restored = await api("restore_view", { index });
    await page.evaluate(async (scene) => {
      const c = window.__chronoscope;
      await c.restoreScene(scene);
      await c.refresh();
      await c.sceneIdle();
    }, restored.scene);
    const snapshot = await api("snapshot", { compact: true });
    assert.equal(snapshot.count, 399331);
    assert.equal(
      snapshot.visible,
      index === 3 ? 243662 : index === 4 ? 155669 : 399331,
    );
    const diagnostics = await page.evaluate(() =>
      window.__chronoscope.view.diagnostics(),
    );
    assert.equal(diagnostics.renderErrorCount, 0);
    assert.equal(diagnostics.globeTime, index === 1);
    assert.equal(diagnostics.globeAltitude, ![1, 2].includes(index));
    assert.equal(diagnostics.stemSegments, 0);
    assert(
      diagnostics.trackPolylines > (index === 3 ? 95 : index === 4 ? 115 : 215),
    );
    await page
      .locator("#scene")
      .screenshot({ path: path.join(out, `idf-view-${index}.png`) });
    fs.writeFileSync(
      path.join(out, `idf-view-${index}.json`),
      JSON.stringify({ snapshot, diagnostics }, null, 2),
    );
    pass(
      `Saved view ${index}: complete counts, physical/time semantics and working tracks`,
    );
  }
});
