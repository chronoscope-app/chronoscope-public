import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real engine/browser check: a normal new session has no generated observations.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/empty-workspace");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    path.join(out, "profile"),
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
const report = { passed: false, checks: [], errors: [] };
let browser;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const first = await api("snapshot", { compact: true });
  assert.equal(first.count, 0);
  assert.equal(first.visible, 0);
  assert.equal(first.selected_count, 0);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (r) =>
    /^https?:/.test(r.request().url()) &&
    !r
      .request()
      .url()
      .startsWith(url + "/")
      ? r.abort()
      : r.continue(),
  );
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 0 && !window.__chronoscope.busy,
  );
  for (const mode of ["map", "globe", "space-time"]) {
    await page.locator(`[data-view="${mode}"]`).click();
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    const s = await page.evaluate(() => ({
      count: window.__chronoscope.snapshot.count,
      points: window.__chronoscope.view.points.length,
      errors: window.__chronoscope.view.diagnostics().renderErrorCount,
    }));
    assert.deepEqual(s, { count: 0, points: 0, errors: 0 });
    report.checks.push({ name: "Empty " + mode, passed: true });
  }
  assert.equal(await page.locator("#entities [data-entity]").count(), 0);
  assert.equal(await page.locator("#layer-list .data-layer").count(), 0);
  await page.screenshot({ path: path.join(out, "empty-workspace.png") });
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy,
  );
  assert.equal((await api("snapshot", { compact: true })).visible, 3568);
  report.checks.push({
    name: "Hurricanes load into an empty workspace",
    passed: true,
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log("PASS empty startup in four views and hurricane loading");
} catch (e) {
  report.errors.push(String(e));
  throw e;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
  fs.rmSync(tokenFile, { force: true });
}
