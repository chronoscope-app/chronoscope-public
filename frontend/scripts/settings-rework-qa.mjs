import assert from "node:assert/strict";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "settings-rework",
  async ({ page, api, pass, out }) => {
    await page.locator("#collapse-right-pane").click();
    for (const id of ["charts", "patterns"]) {
      const b = page.locator(`[data-pane-section="${id}"]`);
      assert.equal(await b.getAttribute("aria-disabled"), "true");
      assert.match(await b.getAttribute("data-tooltip"), /In development/);
      await b.click({ force: true });
      assert.equal(await b.getAttribute("aria-expanded"), "false");
    }
    pass("Charts and Patterns icons are visibly disabled and do not open");
    await page.locator('[data-pane-section="si"]').click();
    await page.locator("#si-settings").click();
    await page.waitForSelector("#preferences-panel-ai:not([hidden]) #si-url");
    assert.equal(await page.locator(".preferences-dialog").count(), 1);
    assert.equal(await page.locator(".si-settings-dialog").count(), 0);
    await page.locator("#preferences-tab-general").click();
    await page.locator("#preferences-tab-ai").click();
    assert(await page.locator("#si-model").isVisible());
    pass("Chat settings gear opens AI category in shared Settings");
    await page.locator("#preferences-tab-maps").click();
    const options = await page
      .locator("#map-quick-pick option")
      .allTextContents();
    assert(options.length >= 6);
    assert(options.some((x) => x.includes("Streets")));
    assert.equal(await page.locator("#streets-enabled").isVisible(), false);
    await page.locator("#map-quick-pick").selectOption("streets");
    await page.screenshot({path: `${out}/maps-settings.png`});
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.abort(),
    );
    await page.locator("#save-preferences").click();
    await page.waitForSelector(".preferences-dialog", { state: "detached" });
    assert.equal((await api("preferences")).basemap, "streets");
    pass("Maps groups Streets and built-in services in a working quick picker");
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.call("preferences", { preferences: { basemap: "none" } });
      await c.refresh();
    });
    await page.locator("#toggle-table").click();
    await page.locator("[data-table-layer-source]").first().click();

    await page.waitForSelector("#table-body [data-event]");
    const widths = await page
      .locator("colgroup col")
      .evaluateAll((cols) => cols.map((c) => parseFloat(c.style.width)));
    assert(widths.some((w) => w < 150));
    assert(widths.every((w) => w <= 300));
    const handle = page.locator("[data-column-resize]").first(),
      box = await handle.boundingBox();
    const before = widths[0];
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2);
    await page.mouse.up();
    const after = await page
      .locator("colgroup col")
      .first()
      .evaluate((c) => parseFloat(c.style.width));
    assert(after >= before + 70);
    await handle.dblclick();
    const fit = await page
      .locator("colgroup col")
      .first()
      .evaluate((c) => parseFloat(c.style.width));
    assert(fit < after);
    pass("Table columns fit content, resize by mouse and double-click to fit");
  },
  { demo: true },
);
