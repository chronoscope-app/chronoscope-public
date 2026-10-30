import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("vfx-playground", async ({ page, out, pass }) => {
  const address = new URL(page.url());
  address.searchParams.set("vfx-preview", "1");
  await page.goto(address.href);
  await page.waitForFunction(
    () =>
      window.__vfxPlayground?.preview?.pointCount === 100000 &&
      !window.__vfxPlayground.changing,
  );
  const errors = () =>
    page.evaluate(
      () => window.__vfxPlayground.view.diagnostics().renderErrorCount,
    );
  assert.equal(await errors(), 0);
  pass(
    "Local playground opens 100k prepared GPU events with visible user controls",
  );
  await page.click("#vfx-play");
  assert.equal(
    await page.evaluate(() => window.__vfxPlayground.playing),
    false,
  );
  const phase = await page.evaluate(() => window.__vfxPlayground.phase);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__vfxPlayground.phase), phase);
  const slider = await page.locator("#vfx-time").boundingBox();
  await page.mouse.click(
    slider.x + slider.width * 0.5,
    slider.y + slider.height * 0.5,
  );
  await page.waitForFunction(
    () =>
      window.__vfxPlayground.phase > 0.35 &&
      window.__vfxPlayground.phase < 0.45,
  );
  pass("Pause freezes the clock; scrubbing moves the prepared time window");
  await page.selectOption("#vfx-renderer", "current");
  await page.waitForFunction(
    () => !window.__vfxPlayground.changing && !window.__vfxPlayground.preview,
  );
  await page.selectOption("#vfx-count", "10000");
  await page.waitForFunction(
    () =>
      !window.__vfxPlayground.changing &&
      window.__vfxPlayground.view.points.length === 2000,
  );
  await page.selectOption("#vfx-renderer", "gpu");
  await page.waitForFunction(
    () =>
      !window.__vfxPlayground.changing &&
      window.__vfxPlayground.preview?.pointCount === 10000,
  );
  pass(
    "Renderer comparison and event-count controls rebuild their own buffers without errors",
  );
  await page.click("#vfx-play");
  const before = await page.evaluate(() => window.__vfxPlayground.phase);
  await page.waitForFunction(
    (before) =>
      window.__vfxPlayground.playing && window.__vfxPlayground.phase > before,
    before,
  );
  await page.selectOption("#vfx-speed", "2");
  await page.click("#vfx-fit");
  await page.selectOption("#vfx-count", "100000");
  await page.waitForFunction(
    () =>
      !window.__vfxPlayground.changing &&
      window.__vfxPlayground.preview?.pointCount === 100000,
  );
  assert.equal(await errors(), 0);
  await page.screenshot({ path: path.join(out, "playground.png") });
  fs.writeFileSync(
    path.join(out, "diagnostics.json"),
    JSON.stringify(
      await page.evaluate(() => window.__vfxPlayground.view.diagnostics()),
      null,
      2,
    ),
  );
  pass("Play, speed and Fit remain usable after renderer/count changes");
});
