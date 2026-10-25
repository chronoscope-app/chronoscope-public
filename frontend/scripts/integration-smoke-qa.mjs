import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

// One small user journey. Detailed edge cases belong to the feature owners.
await withLocalApp("integration-smoke", async ({ page, api, out, pass }) => {
  await page.locator("#welcome-empty").click();
  const source = path.join(out, "smoke.csv");
  fs.writeFileSync(
    source,
    "entity,timestamp,latitude,longitude,value\nA,2026-01-01T12:00:00Z,40,-70,2\nA,2026-01-02T12:00:00Z,40.01,-70.01,4\nB,2026-01-03T12:00:00Z,40.02,-70.02,6\n",
  );
  page.once("dialog", (dialog) => dialog.accept(source));
  await page.locator("#open").click();
  await page.locator("#import-next").click();
  await page.locator("#review-import").click();
  await page.locator("#commit-import").click();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 3 && !window.__chronoscope.busy,
  );
  pass("Small CSV enters through the real staged Open/import workflow");
  for (const mode of ["map", "globe", "space-time"]) {
    await page.locator(`[data-view="${mode}"]`).click();
    await page.evaluate(() => window.__chronoscope.viewModeIdle());
    const state = await page.evaluate(() => ({
      count: window.__chronoscope.snapshot.count,
      points: window.__chronoscope.view.points.length,
      errors: window.__chronoscope.view.diagnostics().renderErrorCount,
    }));
    assert.deepEqual(state, { count: 3, points: 3, errors: 0 });
  }
  pass("The imported records render across all three views");
  await api("select", { ids: ["1", "2"] });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  assert.deepEqual((await api("snapshot")).selected.sort(), ["1", "2"]);
  const saved = path.join(out, "smoke.chronoscope");
  page.once("dialog", (dialog) => dialog.accept(saved));
  await page.locator("#save").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  assert(fs.existsSync(saved));
  page.once("dialog", (dialog) => dialog.accept(saved));
  await page.locator("#open").click();
  await page.waitForFunction(() => !window.__chronoscope.busy);
  const restored = await api("snapshot");
  assert.equal(restored.count, 3);
  assert.deepEqual(restored.selected.sort(), ["1", "2"]);
  pass("Save/Open retain the imported records and exact selection");
});
