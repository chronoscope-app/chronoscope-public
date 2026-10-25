import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real toolbar interactions against the Rust bridge; all resources stay local.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/toolbar-dialogs");
fs.mkdirSync(dir, { recursive: true });
const profile = fs.mkdtempSync(path.join(dir, "profile-"));
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(profile, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    profile,
    "--demo-data",
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
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
let browser;
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
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 950 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  const layouts = [];
  const measure = async (name, selector) => {
    const dialog = page.locator(selector);
    await dialog.waitFor({ state: "visible" });
    const rect = await dialog.boundingBox();
    const viewport = page.viewportSize();
    assert(Math.abs(rect.y - 64) < 1, `${name}: top ${rect.y}`);
    assert(
      Math.abs(rect.x + rect.width / 2 - viewport.width / 2) < 1,
      `${name}: not horizontally centered`,
    );
    assert(
      rect.y + rect.height <= viewport.height - 15,
      `${name}: below viewport`,
    );
    layouts.push({ name, viewport, ...rect });
    return dialog;
  };
  const close = async () => {
    await page.locator(".modal-backdrop [data-close]").first().click();
    await page.locator(".modal-backdrop").waitFor({ state: "detached" });
  };
  assert.deepEqual(
    await page
      .locator("[data-view]")
      .evaluateAll((buttons) => buttons.map((b) => b.dataset.view)),
    ["space-time", "map", "globe"],
  );
  for (const [key, mode] of [
    ["1", "space-time"],
    ["2", "map"],
    ["3", "globe"],
  ]) {
    await page.locator("canvas").first().focus();
    await page.keyboard.press("Alt+" + key);
    await page.waitForFunction(
      (mode) =>
        window.__chronoscope.view.mode === mode && !window.__chronoscope.busy,
      mode,
    );
  }
  pass("Calendar is absent; Alt+1/2/3 select the three remaining views");
  for (const viewport of [
    { width: 1600, height: 975 },
    { width: 1000, height: 650 },
    { width: 820, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [name, trigger] of [
      ["Aggregate", "#aggregate-events"],
      ["Map", "#maps"],
      ["Terrain", "#terrain"],
      ["Help", "#help"],
      ["Preferences", "#settings"],
    ]) {
      await page.locator(trigger).click();
      const dialog = await measure(name, ".modal");
      await dialog.locator("[data-close]").last().scrollIntoViewIfNeeded();
      await measure(name + " scrolled", ".modal");
      await close();
    }
    await page.locator("#maps").click();
    await page.locator(".map-advanced summary").click();
    await measure("Map expanded", ".modal");
    await page.locator("#custom-map-server").click();
    await page
      .locator(".modal h2")
      .filter({ hasText: "Map servers" })
      .waitFor();
    await measure("Map servers", ".modal");
    await close();
    for (const [name, action] of [
      ["User guide", "#user-guide"],
      ["About", "#about-app"],
      ["Shortcuts", "#keyboard-guide"],
    ]) {
      await page.locator("#help").click();
      await page.locator(action).click();
      await measure(name, ".modal");
      await close();
    }
    await page.locator("#analytics-results").click();
    await measure("Analysis results", "#analytics-dialog");
    await page.screenshot({
      path: path.join(dir, `results-${viewport.width}.png`),
    });
    await page.getByRole("button", { name: "Close analysis results" }).click();
    await page.locator("#si").click();
    await page.locator("#si-settings").click();
    await measure("SI settings", ".si-settings-dialog");
    await page.screenshot({
      path: path.join(dir, `si-settings-${viewport.width}.png`),
    });
    await close();
    await page.locator("#si-close").click();
    if (
      await page
        .locator(".workspace")
        .evaluate((e) => e.classList.contains("inspector-collapsed"))
    )
      await page
        .getByRole("button", { name: "Expand right pane", exact: true })
        .click();
    await page.locator('[data-tab="charts"]').click();
    await page
      .getByRole("button", { name: "Field roles…", exact: true })
      .click();
    await measure("Field roles", ".field-roles-dialog");
    await page
      .getByRole("button", { name: "Close field roles", exact: true })
      .click();
    await page.locator('[data-tab="views"]').click();
    await page.locator("#aggregate-events").click();
    await page.screenshot({
      path: path.join(dir, `aggregate-${viewport.width}.png`),
    });
    await close();
    pass(
      `${viewport.width}×${viewport.height}: all dialogs share their top anchor, stay centered and fit the viewport`,
    );
  }
  fs.writeFileSync(
    path.join(dir, "layouts.json"),
    JSON.stringify(layouts, null, 2),
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
