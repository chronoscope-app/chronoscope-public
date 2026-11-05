import assert from "node:assert/strict";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
import { revealDemo } from "./demo-picker.mjs";
await withLocalApp(
  "demo-picker",
  async ({ page, api, out, pass }) => {
    const demos = (await api("demo_catalog")).demos;
    assert.deepEqual(
      demos.filter((demo) => demo.id.startsWith("hurricanes")).map((demo) => demo.id),
      ["hurricanes"],
    );
    const count = demos.reduce((n, demo) => n + demo.previews.length, 0);
    await page.click("#help");
    await page.click("#demo-datasets");
    await page.locator("[data-demo-id]").first().waitFor();
    assert.deepEqual(
      await page
        .locator("[data-demo-id]")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.demoId),
        ),
      demos.map((demo) => demo.id),
    );
    assert.equal(
      await page.locator("#demo-next,#demo-previous,.demo-pagination").count(),
      0,
    );
    await page.locator(".demo-scroll").press("End");
    await page.waitForFunction(() => {
      const scroller = document.querySelector(".demo-scroll");
      return scroller.scrollTop > 0;
    });
    const last = await revealDemo(page, demos.at(-1).id);
    assert.equal(await last.isVisible(), true);
    pass(
      "Complete catalog is available by continuous scrolling, without page controls; final demo is reachable by keyboard",
    );
    for (const theme of ["dark", "light"]) {
      await page.keyboard.press("Escape");
      if (
        (await page.evaluate(() => document.documentElement.dataset.theme)) !==
        theme
      )
        await page.click("#theme");
      await page.click("#help");
      await page.click("#demo-datasets");
      await page.locator("[data-demo-id]").first().waitFor();
      for (const image of await page.locator(".demo-preview img").all())
        await image.evaluate((image) => image.decode());
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(
            '.demo-preview-image[data-preview-ready="true"]',
          ).length === n,
        count,
      );
      for (const [width, height] of [
        [1400, 950],
        [820, 650],
        [420, 850],
      ]) {
        await page.setViewportSize({ width, height });
        await page
          .locator(".demo-scroll")
          .evaluate((scroller) => (scroller.scrollTop = 0));
        const layout = await page
          .locator(".demo-picker")
          .evaluate((dialog) => ({
            overflow: dialog.scrollWidth > dialog.clientWidth,
            fitBounds: { viewport: dialog.querySelector(".demo-scroll").getBoundingClientRect().toJSON(), cards: [...dialog.querySelectorAll(".demo-card")].slice(0,2).map(card => ({box:card.getBoundingClientRect().toJSON(), title:card.querySelector("h3").getBoundingClientRect().height, views:card.querySelector(".demo-previews").getBoundingClientRect().height, details:card.querySelector("details").getBoundingClientRect().height})) },
            twoRowsFit: dialog.querySelectorAll(".demo-card")[1].getBoundingClientRect().bottom <= dialog.querySelector(".demo-scroll").getBoundingClientRect().bottom + 1,
            rows: [...dialog.querySelectorAll(".demo-previews")].every(
              (views) => {
                const buttons = [...views.querySelectorAll("button")];
                return (
                  buttons.length === 2 &&
                  buttons[1].getBoundingClientRect().left >
                    buttons[0].getBoundingClientRect().left
                );
              },
            ),
            previews: [...dialog.querySelectorAll(".demo-preview")].map(
              (button) => {
                const image = button
                    .querySelector("img")
                    .getBoundingClientRect(),
                  frame = button
                    .querySelector(".demo-preview-image")
                    .getBoundingClientRect(),
                  caption = button
                    .querySelector(".demo-preview-label")
                    .getBoundingClientRect();
                return {
                  below: caption.top >= frame.bottom - 0.5,
                  cropped:
                    image.width > frame.width * 1.05 && image.left < frame.left,
                  width: frame.width,
                };
              },
            ),
            closed: [...dialog.querySelectorAll("details")].every(
              (details) => !details.open,
            ),
            scrollable:
              dialog.querySelector(".demo-scroll").scrollHeight >
              dialog.querySelector(".demo-scroll").clientHeight,
          }));
        assert.equal(layout.overflow, false);
        assert.equal(layout.twoRowsFit, true, `${theme}: two complete demo rows at ${width}×${height}: ${JSON.stringify(layout.fitBounds)}`);
        assert.equal(layout.closed, true);
        assert.equal(layout.scrollable, true);
        assert(
          layout.previews.every((preview) => preview.below && preview.cropped),
        );
        if (width > 520) assert.equal(layout.rows, true);
        if (width === 1400)
          assert(layout.previews.every((preview) => preview.width > 300));
        await page.screenshot({
          path: path.join(out, `scrolling-rows-${theme}-${width}.png`),
        });
      }
      pass(
        `${theme}: two complete rows fit at three window sizes; cropped previews and continuous scrolling retained`,
      );
      await page.setViewportSize({ width: 1400, height: 950 });
    }
    const demo = demos.find((demo) => demo.id === "local-wildlife");
    const target = await revealDemo(page, demo.id);
    const card = target.locator(
      "xpath=ancestor::section[contains(@class,'demo-card')]",
    );
    await card.locator("summary").click();
    assert.equal(await card.locator(".demo-source").isVisible(), true);
    assert((await card.textContent()).includes(demo.description));
    assert((await card.textContent()).includes(demo.license));
    const requests = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/invoke") || !request.postData()) return;
      const body = request.postDataJSON();
      if (["demo_open", "restore_view"].includes(body.command))
        requests.push(body);
    });
    await page
      .locator(`[data-demo-preview="${demo.id}"]`)
      .nth(1)
      .locator(".demo-preview-label")
      .click();
    if (await page.locator("#unsaved-discard").isVisible())
      await page.click("#unsaved-discard");
    await page.waitForFunction(
      () =>
        window.__chronoscope?.snapshot?.count === 3439 &&
        !window.__chronoscope.busy,
    );
    assert(
      requests.some(
        (request) =>
          request.command === "demo_open" && request.args.id === demo.id,
      ),
    );
    assert(
      requests.some(
        (request) =>
          request.command === "restore_view" &&
          request.args.index === demo.previews[1].view_index,
      ),
    );
    pass(
      "Collapsed information retains full descriptions and credits; preview caption opens the correct dataset and saved view",
    );
  },
  { demo: true },
);
