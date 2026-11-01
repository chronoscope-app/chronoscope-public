import assert from "node:assert/strict";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "si-toolbar-label",
  async ({ page, api, pass, out }) => {
    assert.equal((await api("preferences")).ai_toolbar_si, false);
    assert.equal(await page.locator("#si").textContent(), "AI");
    assert.match(
      await page.locator("#si").getAttribute("data-tooltip"),
      /Preferences → General/,
    );
    await page.locator("#settings").click();
    await page.locator("#pref-ai-wording").selectOption("si");
    await page.locator("[data-close]").last().click();
    assert.equal((await api("preferences")).ai_toolbar_si, false);
    assert.equal(await page.locator("#si").textContent(), "AI");
    await page.locator("#settings").click();
    await page.locator("#pref-ai-wording").selectOption("si");
    await page.locator("#save-preferences").click();
    await page.waitForFunction(
      () => document.querySelector("#si").textContent === "SI",
    );
    assert.equal((await api("preferences")).ai_toolbar_si, true);
    await page.locator("#si").click();
    assert.equal(await page.locator("#si-chat-heading").textContent(), "SI");
    assert.equal(
      await page.locator("#si-messages").getAttribute("aria-label"),
      "SI conversation",
    );
    assert.equal(
      await page.locator('[data-pane-section="si"]').getAttribute("aria-label"),
      "SI chat",
    );
    await page.screenshot({ path: `${out}/si-chat.png` });
    assert.match(
      await page.locator("#si-settings").getAttribute("data-tooltip"),
      /^SI settings/,
    );
    assert.equal(
      await page
        .locator('[data-pane-section="si"]')
        .getAttribute("aria-description"),
      "SI chat",
    );
    await page.locator("#si-settings").click();
    assert.equal(
      await page.locator(".si-settings-dialog").getAttribute("aria-label"),
      "Super Intelligence settings",
    );
    assert.match(
      await page.locator("#si-service-heading").textContent(),
      /SI service/,
    );
    await page.locator("[data-close]").last().click();

    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#si")?.textContent === "SI",
    );
    await page.locator("#settings").click();
    assert.equal(await page.locator("#pref-ai-wording").inputValue(), "si");
    await page.locator("#pref-ai-wording").selectOption("ai");
    await page.locator("#save-preferences").click();
    await page.waitForFunction(
      () => document.querySelector("#si").textContent === "AI",
    );
    await page.locator("#si").click();
    assert.equal(await page.locator("#si-chat-heading").textContent(), "AI");
    pass(
      "AI/SI label saves, survives reload, supports cancellation and returns to AI; tooltip names the setting",
    );
  },
  { demo: true },
);
