import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real toolbar interactions against the Rust bridge; all resources stay local.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/presentation-ui");
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
  assert.equal(
    await page.locator('[data-view="space-time"]').innerText(),
    "Time",
  );
  assert.equal(await page.locator('[data-view="map"]').innerText(), "Map");
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(root, "frontend/package.json"), "utf8"),
  ).version;
  assert.equal(await page.title(), `Chronoscope ${packageVersion}`);
  await page.locator("#help").click();
  await page.locator("#about-app").click();
  assert((await page.locator(".modal").innerText()).includes(packageVersion));
  await page.keyboard.press("Escape");
  await page.locator("#help").click();
  await page.locator("#user-guide").click();
  assert(
    (await page.locator(".modal").innerText()).includes(
      `version ${packageVersion}`,
    ),
  );
  await page.keyboard.press("Escape");
  pass("Actual title, About and user guide show the packaged version");
  const contrast = async (selector, background) =>
    page
      .locator(selector)
      .first()
      .evaluate((el, bg) => {
        const rgb = (s) =>
          s
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
        const lum = (s) =>
          rgb(s).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = lum(getComputedStyle(el).color),
          b = lum(getComputedStyle(el.closest(bg)).backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, background);
  for (const theme of ["dark", "light"]) {
    if (
      (await page.evaluate(() => document.documentElement.dataset.theme)) !==
      theme
    )
      await page.locator("#theme").click();
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    await page.locator("#help").click();
    await page.locator("#demo-datasets").click();
    await page.locator(".demo-picker").waitFor();
    assert.equal(await page.locator("[data-demo-id]").count(), 6);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".demo-preview img")].length === 12 &&
        [...document.querySelectorAll(".demo-preview img")].every(
          (i) => i.complete && i.naturalWidth === 480,
        ),
    );
    assert.equal(await page.locator('[data-demo-mode="map"]').count(), 6);
    assert.equal(
      await page.locator('[data-demo-mode="space-time"]').count(),
      6,
    );
    for (const selector of [".demo-title", ".demo-description", ".demo-action"])
      assert(
        (await contrast(selector, ".demo-card")) >= 4.5,
        `${theme}: ${selector} contrast`,
      );
    await page.locator(".demo-card summary").first().click();
    assert.equal(await page.locator(".demo-source").first().isVisible(), true);
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(dir, `demos-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await page.locator("#new-analysis").click();
    await page.locator("#analysis-form").waitFor();
    for (const task of ["profile", "duplicates", "outliers", "trajectories"]) {
      await page.check(`input[name=task][value=${task}]`);
      const left = await page.locator(".analysis-tasks").boundingBox(),
        right = await page.locator(".analysis-detail").boundingBox();
      assert(
        left.x + left.width < right.x,
        "Suggested analyses stay left of their details",
      );
      assert(
        (await page.locator("#analysis-output").textContent()).startsWith(
          "Output",
        ),
      );
    }
    await page.check('input[name=task][value="outliers"]');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(dir, `analysis-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    pass(
      `${theme}: demo text/action contrast, sources, analysis master/detail and task-specific options`,
    );
  }
  for (const width of [820, 420]) {
    await page.setViewportSize({ width, height: 850 });
    await page.locator("#new-analysis").click();
    await page.locator("#analysis-form").waitFor();
    assert(
      await page
        .locator("#guided-analysis")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.screenshot({
      path: path.join(dir, `analysis-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1400, height: 950 });
  for (const [id, mode, count] of [
    ["noaa-ais", "map", 8473],
    ["local-wildlife", "space-time", 3439],
  ]) {
    await page.locator("#help").click();
    await page.locator("#demo-datasets").click();
    await page
      .locator(`[data-demo-preview="${id}"][data-demo-mode="${mode}"]`)
      .click();
    try {
      await page.locator("#unsaved-discard").waitFor({ timeout: 2000 });
      await page.locator("#unsaved-discard").click();
    } catch (e) {
      if (e.name !== "TimeoutError") throw e;
    }
    await page.waitForFunction(
      ({ mode, count }) =>
        window.__chronoscope.snapshot.count === count &&
        window.__chronoscope.view.mode === mode &&
        !window.__chronoscope.busy,
      { mode, count },
    );
  }
  pass("Time and Map hero thumbnails open the corresponding real saved views");
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
}
