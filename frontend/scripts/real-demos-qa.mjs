import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real offline demos, UI picker, attribute tables, saved views and playback.

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
const report = { passed: false, checks: [], errors: [], requests: [] };
let browser, page;
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
  const launchBrowser = () => chromium.launch();
  // Data/DOM readiness must not depend on animation frames. A busy software
  // GPU can stop RAF polling after the engine and UI have already become ready.
  // Keep Playwright's existing timeout and every predicate unchanged.
  const stateReady = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { polling: 100 });
  browser = await launchBrowser();
  const newPage = async () => {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });
    page.on("pageerror", (e) => report.errors.push(e.message));
    // Retain bounded command timings so a load timeout distinguishes engine
    // work, a failed request, a dialog and a stalled browser render.
    const starts = new WeakMap();
    page.on("request", (request) => {
      if (request.url() === url + "/api/invoke")
        starts.set(request, performance.now());
    });
    const record = (request, outcome) => {
      const start = starts.get(request);
      if (start === undefined) return;
      report.requests.push({
        command: request.postDataJSON()?.command,
        milliseconds: Math.round(performance.now() - start),
        outcome,
      });
      if (report.requests.length > 200) report.requests.shift();
    };
    page.on("requestfinished", (request) => record(request, "finished"));
    page.on("requestfailed", (request) =>
      record(request, request.failure()?.errorText || "failed"),
    );
    await page.route("**/*", (r) =>
      /^https?:/.test(r.request().url()) &&
      !r
        .request()
        .url()
        .startsWith(url + "/")
        ? r.abort()
        : r.continue(),
    );
    page.setDefaultTimeout(30000);
    return page;
  };
  page = await newPage();
  await page.goto(url + "/#token=" + token);
  await stateReady(
    () =>
      window.__chronoscope?.snapshot?.count === 0 && !window.__chronoscope.busy,
  );
  page.setDefaultTimeout(30000);
  const idle = () => stateReady(() => !window.__chronoscope.busy);
  const check = (name, evidence = {}) => {
    report.checks.push({ name, evidence });
    console.log("PASS", name);
  };
  const datasets = [
    ["noaa-ais", 8473, 10],
    ["animal-gps", 15697, 3],
    ["local-wildlife", 3439, 3],
    ["stork-migration", 6090, 3],
    ["elephant-seals", 15501, 3],
  ];
  for (const [id, count, entities] of process.env.CHRONOSCOPE_QA_FULL === "1"
    ? datasets
    : datasets.filter(([id]) => id === "local-wildlife")) {
    // Keep each large-demo render/mode/playback test in a fresh GPU browser.
    // The picker still replaces the preceding real workspace within this page.
    if (id !== "noaa-ais") {
      await browser.close();
      browser = await launchBrowser();
      page = await newPage();
      await page.goto(url + "/#token=" + token);
      await stateReady(
        () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
      );
    }
    await page.locator("#help").click();
    await page.locator("#demo-datasets").click();
    await page.locator("[data-demo-id]").first().waitFor();
    assert.equal(await page.locator("[data-demo-id]").count(), 6);
    await page.locator(`[data-demo-id="${id}"]`).click();
    await stateReady(
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
      await page.evaluate(() => window.__chronoscope.viewModeIdle());
      const frames = await page.evaluate(() => {
        const view = window.__chronoscope.view;
        const count = view.diagnostics().performance.renderedFrames;
        view.scene.requestRender();
        return count;
      });
      await stateReady(
        ({ mode, frames }) => {
          const c = window.__chronoscope,
            view = c.view;
          return (
            view.mode === mode &&
            !c.busy &&
            view.scene.frameState.mode === view.scene.mode &&
            view.diagnostics().performance.renderedFrames > frames
          );
        },
        { mode, frames },
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
    await stateReady(
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
    await stateReady(
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
    const focusBefore = await page.evaluate(
      () => window.__chronoscope.view.focusFraction,
    );
    await page.locator("#play").click();
    await page.waitForFunction(
      (before) =>
        Math.abs(window.__chronoscope.view.focusFraction - before) > 0.00001,
      focusBefore,
      { timeout: 10000 },
    );
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
  await browser.close();
  await api("demo_open", { id: "noaa-ais" });
  browser = await launchBrowser();
  page = await newPage();
  await page.goto(url + "/#token=" + token);
  await stateReady(
    () =>
      window.__chronoscope?.snapshot?.count === 8473 &&
      !window.__chronoscope.busy,
  );
  const bloom = await api("restore_view", { index: 3 });
  await page.reload();
  await stateReady(
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
  // Failure collection must not mask the original assertion or wait forever
  // if the renderer itself is unresponsive.
  if (page && !page.isClosed()) {
    const pending = [
      page
        .evaluate(() => ({
          count: window.__chronoscope?.snapshot?.count,
          busy: window.__chronoscope?.busy,
          status: document.querySelector("#status")?.textContent,
          modal: document.querySelector(".modal")?.textContent?.slice(0, 2000),
          text: document.body.innerText.slice(-4000),
        }))
        .then((state) => {
          report.failureState = state;
        })
        .catch(() => {}),
      page
        .screenshot({ path: path.join(out, "failure.png"), timeout: 3000 })
        .catch(() => {}),
    ];
    let timer;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 3500);
      }),
    ]);
    clearTimeout(timer);
  }
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
