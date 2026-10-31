import { withLocalApp } from "./local-browser.mjs";
import assert from "node:assert/strict";
await withLocalApp("idf-demo-retired", async ({ page, api, pass }) => {
  assert(!(await api("demo_catalog")).demos.some(d => d.id === "idf-uav"));
  await page.locator("#help").click();
  await page.locator("#demo-datasets").click();
  assert.equal(await page.locator('[data-demo-preview="idf-uav"]').count(),0);
  pass("Retired aligned UAV demo is absent from catalog and gallery");
});
