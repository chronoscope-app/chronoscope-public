// Real offline demos, UI picker, attribute tables, saved views and playback.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/real-demos");
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
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error(log || "startup timeout")),
      20000,
    );
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    server.on("error", reject);
  });
  const api = async (command, args = {}) => {
    const r = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await r.json();
    assert(r.ok, JSON.stringify(body));
    return body.result;
  };
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
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
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
  page.setDefaultTimeout(30000);
  const idle = () => page.waitForFunction(() => !window.__chronoscope.busy);
  const check = (name, evidence = {}) => {
    report.checks.push({ name, evidence });
    console.log("PASS", name);
  };
  for (const [id, count, entities] of [
    ["noaa-ais", 8473, 10],
    ["animal-gps", 15697, 3],
    ["local-wildlife", 3439, 3],
    ["stork-migration", 6090, 3],
    ["elephant-seals", 15501, 3],
  ]) {
    await page.locator("#help").click();
    await page.locator("#demo-datasets").click();
    await page.locator("[data-demo-id]").first().waitFor();
    assert.equal(await page.locator("[data-demo-id]").count(), 6);
    await page.locator(`[data-demo-id="${id}"]`).click();
    await page.waitForFunction(
      (n) =>
        window.__chronoscope?.snapshot?.count === n &&
        !window.__chronoscope.busy,
      count,
    );
    const snapshot = await api("snapshot", { compact: false });
    assert.equal(snapshot.visible, count);
    assert.equal(Object.keys(snapshot.entities).length, entities);
    assert.equal(snapshot.views.length, 4);
    assert.equal((await api("workspace_status")).source, null);
    check(
      id + ": offline picker loads original observations and four saved views",
      { count, entities },
    );
    for (const mode of ["map", "globe", "space-time"]) {
      await page.locator(`[data-view="${mode}"]`).click();
      await page.waitForFunction(
        (m) =>
          window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
        mode,
      );
      const v = await page.evaluate(() => ({
        errors: window.__chronoscope.view.diagnostics().renderErrorCount,
        points: window.__chronoscope.view.points.length,
      }));
      assert.equal(v.errors, 0);
      assert(v.points > 0);
    }
    check(id + ": 2D, globe and space-time render without errors");
    await page.locator("#toggle-table").click();
    await page
      .locator("#tables-menu [data-table-layer-source]")
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#table-head [data-table-sort]").length > 20,
    );
    await page.locator('[data-table-sort="value"]').click();
    await idle();
    const expected = await api("attribute_table", {
      sort_by: "value",
      descending: false,
      limit: 100,
    });
    await page.waitForFunction(
      (ids) =>
        JSON.stringify(
          Array.from(
            document.querySelectorAll("#table-body [data-event]"),
            (r) => r.dataset.event,
          ),
        ) === JSON.stringify(ids),
      expected.events.map((e) => e.id),
    );
    check(id + ": complete attribute table sorts by actual numeric values", {
      columns: expected.columns.length,
    });
    await page.locator("#close-table").click();
    await page.locator("#play").click();
    await page.waitForTimeout(1200);
    await page.locator("#play").click();
    await idle();
    assert.equal(
      await page.evaluate(
        () => window.__chronoscope.view.diagnostics().renderErrorCount,
      ),
      0,
    );
    await page.screenshot({ path: path.join(out, id + ".png") });
    check(id + ": playback remains functional");
  }
  await api("demo_open", { id: "noaa-ais" });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 8473 &&
      !window.__chronoscope.busy,
  );
  const bloom = await api("restore_view", { index: 3 });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 8473 &&
      !window.__chronoscope.busy,
  );
  assert.equal(
    await page.evaluate(
      () => window.__chronoscope.view.diagnostics().renderErrorCount,
    ),
    0,
  );
  check("Saved bloom view restores with all original AIS observations");
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log("PASS real-world demo datasets");
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
