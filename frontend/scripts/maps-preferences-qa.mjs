import assert from "node:assert/strict";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "maps-preferences",
  async ({ page, api, out, pass }) => {
    const before = await api("preferences");
    await page.locator("#maps").click();
    await page.locator('#preferences-tab-maps[aria-selected="true"]').waitFor();
    assert.equal(
      await page.locator("#modal-title").textContent(),
      "Preferences",
    );
    assert.equal(await page.locator("#apply-basemap").count(), 0);
    await page.locator(".map-advanced summary").click();
    for (const [button, content] of [
      ["custom-map-server", "#wmts-server"],
      ["custom-map-layers", "#map-stack-list"],
      ["basemap-cache", "#cache-concurrency"],
    ]) {
      for (const close of ["x", "cancel", "escape"]) {
        await page.locator(`#${button}`).click();
        await page.locator(content).waitFor({ state: "visible" });
        if (close === "x")
          await page.locator(".modal .modal-head [data-close]").click();
        else if (close === "cancel")
          await page.locator(".modal footer [data-close]").click();
        else await page.keyboard.press("Escape");
        await page
          .locator('#preferences-tab-maps[aria-selected="true"]')
          .waitFor();
        assert.equal(
          await page.locator(".map-advanced").evaluate((e) => e.open),
          true,
        );
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          button,
        );
      }
    }
    pass(
      "Maps opens as a Preferences section; X, Cancel/Close and Escape return all three Advanced dialogs to that section with Advanced open and focus restored",
    );
    await page.locator("#preferences-tab-general").click();
    await page.locator("#pref-ai-wording").selectOption("si");
    await page.locator("#preferences-tab-maps").click();
    await page.locator("#map-quick-pick").selectOption("streets");
    await page.locator("#basemap-cache").click();
    await page.locator(".modal footer [data-close]").click();
    await page.locator('#preferences-tab-maps[aria-selected="true"]').waitFor();
    assert.equal(await page.locator("#streets-enabled").isChecked(), true);
    await page.locator("#preferences-tab-general").click();
    assert.equal(await page.locator("#pref-ai-wording").inputValue(), "si");
    await page.locator("#preferences-tab-maps").click();
    await page.screenshot({ path: path.join(out, "maps-in-preferences.png") });
    await page
      .locator("#save-preferences")
      .locator("..")
      .locator("[data-close]")
      .click();
    assert.equal(
      (await api("preferences")).ai_toolbar_si,
      before.ai_toolbar_si,
    );
    assert.equal((await api("preferences")).basemap, before.basemap);
    pass(
      "General and Maps drafts survive subdialog cancellation; closing Preferences discards both without applying Streets",
    );
    await page.locator("#settings").click();
    await page.locator("#preferences-tab-maps").click();
    await page.locator("#basemap-cache").click();
    await page.locator("#cache-concurrency").fill("3");
    await page.locator("#cache-save").click();
    await page.locator('#preferences-tab-maps[aria-selected="true"]').waitFor();
    assert.equal((await api("wmts_access")).settings.concurrency, 3);
    await page.locator("#save-preferences").click();
    await page.locator(".preferences-dialog").waitFor({ state: "detached" });
    assert.equal((await api("preferences")).basemap, "none");
    pass(
      "Maps is also accessible from Preferences; saving Advanced cache settings returns there and saved preferences retain the configured map state",
    );
  },
  { demo: true },
);
