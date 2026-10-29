import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const root = path.resolve(import.meta.dirname, "../..");
const out =
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/table-playback");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    fs.mkdtempSync(path.join(out, "profile-")),
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
  const url = await localServerUrl(server),
    api = createApi(url, token);
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_builtin: false,
      terrain_path: null,
    },
  });
  const snapshot = await api("snapshot");
  const [lo, hi] = snapshot.time_bounds;
  await api("filter", { filter: { start: lo, end: lo + (hi - lo) / 3 } });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (route) =>
    /^https?:/.test(route.request().url()) &&
    !route
      .request()
      .url()
      .startsWith(url + "/")
      ? route.abort()
      : route.continue(),
  );
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count > 0 && !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.ready);
  await page.evaluate(() => window.__chronoscope.openAttributes(null));
  await page.uncheck("#table-respect-filters");
  await page.waitForSelector('.table-scroll[aria-busy="false"]');
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", {
      action: "configure",
      increment_seconds: 86400,
      speed: 1,
    }),
  );
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", { action: "play" }),
  );

  async function probe(surface, name, rowSelector) {
    await surface.bringToFront();
    await surface.locator(rowSelector).first().hover();
    await surface.locator(".table-scroll").evaluate((el) => {
      el.scrollTop = 700;
      el.dispatchEvent(new Event("scroll"));
    });
    await surface.waitForTimeout(150);
    const scrollTop = await surface
      .locator(".table-scroll")
      .evaluate((el) => el.scrollTop);
    const scrollRevision = await page.evaluate(
      () => window.__chronoscope.snapshot.revision,
    );
    await page.waitForFunction(
      (revision) => window.__chronoscope.snapshot.revision >= revision + 3,
      scrollRevision,
    );
    await surface.waitForTimeout(700);
    assert.equal(
      await surface.locator(".table-scroll").evaluate((el) => el.scrollTop),
      scrollTop,
      name + " retains scroll while workspace time changes",
    );
    assert(
      scrollTop > 0,
      name +
        " exercises a scrolled table: " +
        JSON.stringify(
          await surface
            .locator(".table-scroll")
            .evaluate((el) => ({
              height: el.clientHeight,
              extent: el.scrollHeight,
              top: el.scrollTop,
            })),
        ),
    );
    const row = surface.locator(rowSelector).first();
    await row.hover();
    const revision = await page.evaluate(
      () => window.__chronoscope.snapshot.revision,
    );
    await surface.evaluate((rowSelector) => {
      const row = document.querySelector(rowSelector);
      window.tableProbe = {
        row,
        head: document.querySelector("#table-head button"),
        close: document.querySelector("#close-table"),
        col: document.querySelector("col"),
        hovered: row.matches(":hover"),
      };
    }, rowSelector);
    await page.waitForFunction(
      (revision) => window.__chronoscope.snapshot.revision >= revision + 4,
      revision,
    );
    await surface.waitForTimeout(700);
    const identity = await surface.evaluate(() =>
      Object.fromEntries(
        Object.entries(window.tableProbe).map(([key, value]) => [
          key,
          key === "hovered"
            ? window.tableProbe.row.matches(":hover")
            : value.isConnected,
        ]),
      ),
    );
    const box = await surface.locator("#close-table").boundingBox();
    await surface.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await surface.mouse.down();
    const pressedRevision = await page.evaluate(
      () => window.__chronoscope.snapshot.revision,
    );
    await page.waitForFunction(
      (revision) => window.__chronoscope.snapshot.revision >= revision + 3,
      pressedRevision,
    );
    await surface.waitForTimeout(700);
    await surface.mouse.up();
    await page.waitForFunction(
      () =>
        !document.querySelector("#toggle-table").classList.contains("active"),
    );
    const closed =
      surface === page
        ? (await page.locator("#table-panel.open").count()) === 0
        : surface.isClosed() ||
          (await surface.waitForEvent("close").then(() => true));
    const playing = await page.evaluate(
      () => window.__chronoscope.view.playback,
    );
    report.checks.push({ name, identity, closed, playing });
    assert.deepEqual(
      identity,
      { row: true, head: true, close: true, col: true, hovered: true },
      name + " retains hovered row and controls across ticks",
    );
    assert(
      closed && playing,
      name + " closes with a deliberate click while playback continues",
    );
  }
  await probe(page, "Docked Event table", "#table-body [data-event]");
  async function openEvents() {
    await page.evaluate(() => window.__chronoscope.openAttributes(null));
    await page.uncheck("#table-respect-filters");
    await page.waitForSelector('.table-scroll[aria-busy="false"]');
  }
  async function detachedProbe(name, rowSelector) {
    const opened = page.waitForEvent("popup");
    await page.click("#table-popout");
    const popup = await opened;
    popup.on("pageerror", (e) => report.errors.push(e.message));
    await popup.waitForSelector(rowSelector);
    await popup.waitForSelector('.table-scroll[aria-busy="false"]');
    await probe(popup, name, rowSelector);
  }
  await openEvents();
  await detachedProbe("Detached Event table", "#table-body [data-event]");
  const gisFile = path.join(out, "stations.geojson");
  fs.writeFileSync(
    gisFile,
    JSON.stringify({
      type: "FeatureCollection",
      features: Array.from({ length: 120 }, (_, n) => n + 1).map((i) => ({
        type: "Feature",
        id: String(i),
        geometry: { type: "Point", coordinates: [-70 - i / 100, 35 + i / 100] },
        properties: { name: `Station ${i}` },
      })),
    }),
  );
  const gis = (await api("gis_load", { path: gisFile })).layer;
  await page.evaluate(() => window.__chronoscope.refresh(false));
  async function openGis() {
    await page.click("#toggle-table");
    await page.locator(`[data-table-gis-id="${gis.id}"]`).click();
    await page.waitForSelector("#table-body [data-gis-row]");
  }
  await openGis();
  await probe(page, "Docked GIS table", "#table-body [data-gis-row]");
  await openGis();
  await detachedProbe("Detached GIS table", "#table-body [data-gis-row]");
  await page.evaluate(() => window.__chronoscope.openAttributes(null));
  await page.waitForSelector("#table-body [data-event]");
  const initialIds = await page
    .locator("#table-body [data-event]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.event));
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", {
      action: "configure",
      speed: 2,
      increment_seconds: 604800,
    }),
  );
  await page.waitForFunction(
    (ids) =>
      JSON.stringify(
        [...document.querySelectorAll("#table-body [data-event]")].map(
          (row) => row.dataset.event,
        ),
      ) !== JSON.stringify(ids),
    initialIds,
  );
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_playback", { action: "pause" }),
  );
  await page.evaluate(() => window.__chronoscope.refresh(false, false));
  const expected = await api("attribute_table", {
    limit: 100,
    apply_filter: true,
    sort_by: "time",
  });
  const ids = await page
    .locator("#table-body [data-event]")
    .evaluateAll((rows) => rows.map((row) => row.dataset.event));
  assert.deepEqual(
    ids,
    expected.events.map((e) => e.id),
  );
  report.checks.push({
    name: "Filtered table continues to update during playback and matches exact Rust rows after pause",
    rows: ids.length,
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser?.close();
  server.kill();
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
