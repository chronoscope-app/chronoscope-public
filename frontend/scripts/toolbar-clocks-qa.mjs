import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "./qa-runtime.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, ".qa/toolbar-clocks");
fs.mkdirSync(output, { recursive: true });
const bundled = await build({
  stdin: {
    contents: 'import { installToolbarClocks } from "./src/toolbar-clocks"; installToolbarClocks(document.querySelector("#notifications"));',
    resolveDir: path.join(root, "frontend"),
  },
  bundle: true, write: false, format: "iife", loader: { ".css": "empty" },
});
const css = fs.readFileSync(path.join(root, "frontend/src/toolbar-clocks.css"), "utf8");
const html = `<meta charset="utf-8"><style>
:root{--panel:#1b1e26;--text:#f8fafc;--muted:#d0d7e2;--line:#8794a8;--shadow:0 18px 70px #0005;background:#0f1116;color:var(--text);font:12px system-ui}*{box-sizing:border-box}body{margin:0}header{display:flex;align-items:center;gap:5px;height:52px;padding:0 12px;background:var(--panel)}.toolbar-main{flex:1;min-width:0;overflow:auto;white-space:nowrap}button,select{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:7px 8px}button{cursor:pointer}.notification-trigger{flex:none} ${css}
</style><header><div class="toolbar-main">chronoscope　 Open　 Save　 Time　 Map　 Globe　 Help</div><button id="notifications" class="notification-trigger">Bell</button></header><main style="height:300px">Workspace</main><script>${bundled.outputFiles[0].text}</script>`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ timezoneId: "America/New_York", viewport: { width: 980, height: 450 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://clocks.test/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.clock.install({ time: new Date("2026-11-02T18:59:50Z") });
  await page.goto("http://clocks.test/");
  const times = page.locator(".toolbar-clock-value");
  assert.deepEqual(await times.allTextContents(), ["13:59", "18:59", "03:59"]);
  assert((await page.locator(".toolbar-clock").nth(2).getAttribute("title")).includes("Tuesday"));
  console.log("PASS local, UTC and selected zone have no seconds and correct calendar dates");
  await page.clock.fastForward(20000);
  assert.deepEqual(await times.allTextContents(), ["14:00", "19:00", "04:00"]);
  console.log("PASS all clocks roll over at the minute boundary");
  const trigger = page.getByRole("button", { name: "Choose third clock time zone" });
  await trigger.click();
  await page.locator("#toolbar-clock-zone").selectOption("Asia/Katmandu");
  assert.equal(await times.nth(2).textContent(), "00:45");
  assert.equal(await page.locator("#toolbar-clock-picker").isVisible(), false);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await page.reload();
  assert.equal(await page.locator("#toolbar-clock-zone").inputValue(), "Asia/Katmandu");
  console.log("PASS fractional offset zone and saved choice survive reload");
  await trigger.click();
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  await page.locator("main").click();
  assert.equal(await page.locator("#toolbar-clock-picker").isVisible(), false);
  console.log("PASS keyboard dismissal and outside click");
  for (const width of [980, 640, 360]) {
    await page.setViewportSize({ width, height: 450 });
    const boxes = await page.locator(".toolbar-clock, #notifications").evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(); return { left: box.left, right: box.right };
    }));
    boxes.forEach((box, i) => {
      assert(box.left >= 0 && box.right <= width);
      if (i) assert(box.left >= boxes[i - 1].right);
    });
  }
  await page.setViewportSize({ width: 980, height: 450 });
  await trigger.click();
  await page.screenshot({ path: path.join(output, "quiet-labels-picker.png") });
  assert.deepEqual(errors, []);
  console.log("PASS clocks remain before the bell without overlapping at desktop and narrow widths");
  await context.close();
} finally { await browser.close(); }
