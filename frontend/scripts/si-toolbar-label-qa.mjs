import assert from "node:assert/strict";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp(
  "si-toolbar-label",
  async ({ page, api, pass, out }) => {
    assert.equal((await api("preferences")).ai_toolbar_si, false);
    assert.equal(await page.locator(".topbar #si").count(), 0);
    assert.equal(await page.locator('[data-pane-section="si"]').getAttribute("aria-label"), "AI chat");
    await page.locator("#settings").click();
    await page.locator("#pref-ai-wording").selectOption("si");
    await page.locator("[data-close]").last().click();
    assert.equal((await api("preferences")).ai_toolbar_si, false);
    assert.equal(await page.locator('[data-pane-section="si"]').getAttribute("aria-label"), "AI chat");
    await page.locator("#settings").click();
    await page.locator("#pref-ai-wording").selectOption("si");
    await page.locator("#save-preferences").click();
    await page.waitForFunction(
      () => document.querySelector('[data-pane-section="si"]')?.getAttribute("aria-label") === "SI chat",
    );
    assert.equal((await api("preferences")).ai_toolbar_si, true);
    await page.locator(':is(#inspector-chat, [data-pane-section="si"]):visible').press("Enter");
    assert.equal(await page.locator("#si-chat-heading").textContent(), "SI");
    assert.equal(
      await page.locator("#si-messages").getAttribute("aria-label"),
      "SI conversation",
    );
    assert.equal(
      await page.locator('[data-pane-section="si"]').getAttribute("aria-label"),
      "SI chat",
    );
    await page.locator("#si-settings").waitFor({state:"visible"});
    const button = await page.locator("#si-settings").boundingBox();
    const glyph = await page.locator("#si-settings svg").boundingBox();
    assert(button.width >= 36 && button.height >= 36);
    assert(glyph.width >= 20 && glyph.height >= 20);
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
      await page.locator("#ai-service-options").getAttribute("aria-label"),
      "Super Intelligence settings",
    );
    assert.match(
      await page.locator("#si-service-heading").textContent(),
      /SI service/,
    );
    await page.locator("[data-close]").last().click();

    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('[data-pane-section="si"]')?.getAttribute("aria-label") === "SI chat",
    );
    await page.locator("#settings").click();
    assert.equal(await page.locator("#pref-ai-wording").inputValue(), "si");
    await page.locator("#pref-ai-wording").selectOption("ai");
    await page.locator("#save-preferences").click();
    await page.waitForFunction(
      () => document.querySelector('[data-pane-section="si"]')?.getAttribute("aria-label") === "AI chat",
    );
    await page.locator(':is(#inspector-chat, [data-pane-section="si"]):visible').press("Enter");
    assert.equal(await page.locator("#si-chat-heading").textContent(), "AI");
    await page.locator("#si-close").click();
    await page.locator("#collapse-right-pane").click();
    await page.locator('[data-pane-section="si"]').press("Enter");
    await page.locator("#si-settings").waitFor({state:"visible"});
    pass(
      "Right-pane AI/SI labels save, survive reload and support cancellation; the toolbar has no duplicate chat entry and the enlarged chat settings button opens Settings",
    );
  },
  { demo: true },
);
