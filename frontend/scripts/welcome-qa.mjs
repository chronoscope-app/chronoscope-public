import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real local Rust + Chromium workflows. No model, hosted runner or public map requests.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/welcome"),
);
fs.mkdirSync(out, { recursive: true });
const data =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-welcome-"));
fs.mkdirSync(data, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(data, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    path.join(data, "profile"),
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = { passed: false, checks: [], publicRequests: [], errors: [] };
let browser, page, mapFixture;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      auto_save_unsaved: true,
    },
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  console.log("Local browser connected");
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(url))
      report.publicRequests.push(r.url());
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await page.locator("#welcome").waitFor({ state: "visible" });
  assert.equal(await page.locator(".workspace").getAttribute("inert"), "");
  assert.equal(await page.locator("[data-recent]").count(), 0);
  await page.locator("#welcome-help").click();
  await page.locator('.modal-backdrop [role="dialog"]').waitFor();
  await page.keyboard.press("Shift+Tab");
  assert(
    await page.evaluate(
      () => !!document.activeElement.closest('[role="dialog"]'),
    ),
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "welcome-help",
  );
  await page.locator("#welcome-demo").click();
  await page.locator("[data-demo-id]").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "welcome-demo",
  );
  report.checks.push(
    "Empty welcome offers real demos/help; dialog Tab is contained and Escape returns focus",
  );
  const source = path.join(data, "welcome.csv");
  fs.writeFileSync(
    source,
    "entity,time,lat,lon\nA,2026-10-24T12:00:00Z,40,-70\n",
  );
  page.once("dialog", (d) => d.accept(source));
  await page.locator("#welcome-open").click();
  await page.locator("#review-import").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#welcome").isVisible(), true);
  assert.equal((await api("snapshot")).count, 0);
  report.checks.push(
    "Cancelling Open/import preserves the empty welcome and publishes no Events",
  );
  for (const [width, theme] of [
    [1440, "light"],
    [820, "dark"],
    [420, "light"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    if (
      (await page.evaluate(() => document.documentElement.dataset.theme)) !==
      theme
    )
      await page.locator("#theme").click();
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    await page.waitForTimeout(250);
    assert(
      await page
        .locator("#welcome")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.screenshot({
      path: path.join(out, `welcome-${width}-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const valid = path.join(
    root,
    "samples/atlantic-hurricanes-2016-2025.chronoscope",
  );
  const missing = path.join(data, "missing.chronoscope");
  await page.evaluate(
    ({ valid, missing }) =>
      localStorage.setItem(
        "chronoscope-recent-workspaces-v1",
        JSON.stringify([
          {
            path: missing,
            name: "Unavailable study",
            count: 10,
            updated: Date.now(),
          },
          {
            path: valid,
            name: "Atlantic hurricanes",
            count: 3568,
            updated: Date.now(),
          },
        ]),
      ),
    { valid, missing },
  );
  await page.reload();
  await page.locator('[data-recent="0"]').waitFor();
  await page.locator('[data-recent="0"]').click();
  await page.locator(".toast.error").waitFor();
  assert.equal(await page.locator("#welcome").isVisible(), true);
  // This deliberately exercised missing-file error is not an uncaught page error.
  await page.locator('[data-recent="1"]').click();
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.count === 3568,
  );
  assert.equal(await page.locator("#welcome").isVisible(), false);
  const saved = path.join(data, "My saved study.chronoscope");
  page.once("dialog", (d) => d.accept(saved));
  await page.evaluate(() => window.__chronoscope.saveWorkspace(true));
  assert(fs.existsSync(saved));
  const recent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("chronoscope-recent-workspaces-v1")),
  );
  assert.equal(recent[0].path, saved);
  assert.equal(recent[0].count, 3568);
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot?.count === 3568,
  );
  assert.equal(await page.locator("#welcome").isVisible(), false);
  report.checks.push(
    "Real recent workspaces open; missing files retain welcome; successful saves persist exact paths/counts through reload",
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.publicRequests, []);
  report.passed = true;
  console.log("PASS", report.checks);
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
}
