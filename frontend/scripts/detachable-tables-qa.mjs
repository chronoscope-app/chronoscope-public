import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Layer table picker, full columns, ordering and selection against the real Rust bridge.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { randomBytes } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/detachable-tables"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    fs.mkdtempSync(path.join(out, "profile-")),
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
const report = {
  passed: false,
  checks: [],
  errors: [],
  publicRequests: 0,
  compactTableRequests: 0,
};
let browser;
const columnRequests = [];
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const pass = (name) => {
  report.checks.push(name);
  save();
  console.log("PASS " + name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1100 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (r) => {
    const u = r.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      await r.abort();
    } else await r.continue();
  });
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/invoke")) return;
    const packet = request.postDataJSON();
    const tablePacket =
      packet.command === "view_snapshot_v1" ? packet.args?.page : packet;
    if (tablePacket?.args?.column_limit)
      columnRequests.push({
        command: tablePacket.command,
        ...tablePacket.args,
      });
    if (
      (packet.command === "events" && !packet.args?.id) ||
      packet.args?.page?.command === "events"
    )
      report.compactTableRequests++;
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count > 0 && !window.__chronoscope.busy,
  );
  await page.evaluate(() => window.__chronoscope.ready);
  const sources = (await api("snapshot")).layers.map((layer) => layer.source);
  async function open(source) {
    await page.click("#toggle-table");
    await page
      .locator("[data-table-layer-source]")
      .filter({ hasText: source })
      .first()
      .click();
    await page.waitForFunction(
      (source) =>
        document
          .querySelector("#table-tabs [role=tab][aria-selected=true]")
          .textContent.includes(source),
      source,
    );
    await page.waitForSelector('.table-scroll[aria-busy="false"]');
  }
  await open(sources[0]);
  await page.click('[data-table-sort="entity"]');
  await page.waitForSelector(
    '[aria-sort="ascending"] [data-table-sort="entity"]',
  );
  await page.uncheck("#table-respect-filters");
  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollTop = 1000;
  });
  await page.waitForTimeout(400);
  const position = await page
    .locator(".table-scroll")
    .evaluate((el) => el.scrollTop);
  await page.click("#table-all");
  await page.waitForFunction(
    () => document.querySelectorAll("#table-tabs [role=tab]").length === 2,
  );
  await page.locator("[role=tab]").filter({ hasText: sources[0] }).click();
  await page.waitForSelector(
    '[aria-sort="ascending"] [data-table-sort="entity"]',
  );
  assert.equal(await page.isChecked("#table-respect-filters"), false);
  assert.equal(
    await page.locator(".table-scroll").evaluate((el) => el.scrollTop),
    position,
  );
  await open(sources[0]);
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 2);
  pass(
    "Multiple tables share tabs; reopening deduplicates; sort/filter/scroll survive switching",
  );
  const popupPromise = page.waitForEvent("popup");
  await page.click("#table-popout");
  let popup = await popupPromise;
  popup.setDefaultTimeout(15000);
  popup.on("pageerror", (e) => report.errors.push(e.message));
  await popup.waitForSelector("#table-tabs [role=tab]");
  assert.equal(await popup.locator("#table-tabs [role=tab]").count(), 2);
  assert(await page.locator("#table-panel").isHidden());
  await popup.waitForSelector(
    '[aria-sort="ascending"] [data-table-sort="entity"]',
  );
  assert.equal(await popup.isChecked("#table-respect-filters"), false);
  assert.equal(
    await popup.locator(".table-scroll").evaluate((el) => el.scrollTop),
    position,
  );
  const row = popup.locator("#table-body [data-event]").first();
  const id = await row.getAttribute("data-event");
  await row.click();
  await page.waitForFunction(
    (id) => window.__chronoscope.snapshot.selected.includes(id),
    id,
  );
  await popup.waitForSelector("#table-body tr.selected");
  pass(
    "Detached tabs retain state and row selection updates the main workspace",
  );
  await popup.locator("[role=tab]").filter({ hasText: "All sources" }).click();
  await popup.waitForFunction(() =>
    document
      .querySelector("#table-tabs [role=tab][aria-selected=true]")
      .textContent.includes("All sources"),
  );
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  await page.waitForFunction(() =>
    document
      .querySelector("#table-tabs [role=tab][aria-selected=true]")
      .textContent.includes("All sources"),
  );
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 2);
  pass("Dock returns the whole tab group and its active tab");
  await page.locator("[role=tab]").filter({ hasText: sources[0] }).click();
  await page.locator("[role=tab][aria-selected=true]").press("ArrowRight");
  await page.waitForFunction(() =>
    document
      .querySelector("#table-tabs [role=tab][aria-selected=true]")
      .textContent.includes("All sources"),
  );
  await page.click("#close-table");
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 1);
  assert(await page.locator("#table-panel").isVisible());
  pass("Keyboard navigation and closing a tab keep its neighbor open");
  const again = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await again;
  await popup.waitForSelector("#table-tabs [role=tab]");
  await popup.close();
  await page.waitForSelector("#table-panel.open");
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 1);
  pass("Native-style window close returns tabs to the workspace");
  const gisFile = path.join(out, "table-reference.geojson");
  fs.writeFileSync(
    gisFile,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "one",
          geometry: { type: "Point", coordinates: [-70, 35] },
          properties: { name: "First station", rank: 2 },
        },
        {
          type: "Feature",
          id: "two",
          geometry: { type: "Point", coordinates: [-71, 36] },
          properties: { name: "Second station", rank: 1 },
        },
      ],
    }),
  );
  const gis = (await api("gis_load", { path: gisFile })).layer;
  await page.evaluate(() => window.__chronoscope.refresh(false));
  const third = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await third;
  popup.setDefaultTimeout(15000);
  await popup.waitForSelector("#table-tabs [role=tab]");
  await page.click("#toggle-table");
  await page.locator(`[data-table-gis-id="${gis.id}"]`).click();
  await popup.waitForSelector("#table-body [data-gis-row]");
  assert.equal(await popup.locator("#table-tabs [role=tab]").count(), 2);
  await popup.fill("#table-search", "First");
  await popup.waitForFunction(
    () => document.querySelectorAll("#table-body [data-gis-row]").length === 1,
  );
  await popup.click('[data-gis-sort="rank"]');
  await popup.locator("#table-tabs [role=tab]").first().click();
  await popup.waitForSelector("#table-body [data-event]");
  await popup.locator("#table-tabs [role=tab]").last().click();
  assert.equal(await popup.inputValue("#table-search"), "First");
  await popup.waitForSelector("#table-body [data-gis-row]");
  await popup.locator("#table-body [data-gis-row]").click();
  await page.waitForFunction(
    (id) =>
      window.__chronoscope.snapshot.gis_layers.find((l) => l.id === id).selected
        .length === 1,
    gis.id,
  );
  pass(
    "GIS tables join the detached group and retain search/sort with linked reference selection",
  );
  await popup.reload();
  await popup.waitForSelector("#table-body [data-gis-row]");
  assert.equal(await popup.locator("#table-tabs [role=tab]").count(), 2);
  assert.equal(await popup.inputValue("#table-search"), "First");
  pass("Reloading the detached page restores its tab group from main");
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  await api("gis_remove", { id: gis.id });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  await page.waitForSelector("#table-body [data-event]");
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 1);
  pass("Removed GIS layers close their tab and retain the neighboring table");
  await page.screenshot({ path: path.join(out, "docked-tabs.png") });
  await page.click("#table-all");
  await page.waitForFunction(
    () => document.querySelectorAll("#table-tabs [role=tab]").length === 2,
  );
  await page.evaluate(async () => {
    const scene = window.__chronoscope.captureScene();
    await window.__chronoscope.restoreScene(scene);
  });
  assert.equal(await page.locator("#table-tabs [role=tab]").count(), 2);
  pass("Restoring a scene in the same workspace keeps the other table tabs");
  const last = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await last;
  popup.setDefaultTimeout(15000);
  await popup.waitForSelector("#table-tabs [role=tab]");
  await popup.click("#close-table");
  await popup.waitForFunction(
    () => document.querySelectorAll("#table-tabs [role=tab]").length === 1,
  );
  await popup.click("#close-table");
  await page.waitForFunction(
    () => !document.querySelector("#table-panel").classList.contains("open"),
  );
  await page.waitForFunction(
    () => !document.querySelector("#toggle-table").classList.contains("active"),
  );
  pass(
    "Closing the last detached tab closes its utility window and clears the table surface",
  );
  const wideFile = path.join(out, "tab-state-wide.csv");
  fs.writeFileSync(
    wideFile,
    [
      "entity,timestamp,latitude,longitude," +
        Array.from({ length: 40 }, (_, i) => "extra" + i).join(","),
      ...Array.from(
        { length: 240 },
        (_, i) =>
          `Tab fixture,${new Date(Date.UTC(2025, 0, 1) + i * 1000).toISOString()},20,-60,` +
          Array.from({ length: 40 }, (_, j) => `value${i}-${j}`).join(","),
      ),
    ].join("\n"),
  );
  const wideTicket = await api("import_preview", { path: wideFile });
  await api("import_commit", { import_id: wideTicket.import_id, append: true });
  await page.evaluate(() => window.__chronoscope.refresh());
  const wideSource = (await api("snapshot")).layers.find(
    (l) => l.count === 240,
  ).source;
  await open(wideSource);
  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await page.waitForSelector('[data-table-sort="attribute:extra39"]');
  const scrollPosition = await page.locator(".table-scroll").evaluate((el) => {
    el.scrollTop = 1000;
    el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth - 350);
    return { top: el.scrollTop, left: el.scrollLeft };
  });
  assert(scrollPosition.top > 0 && scrollPosition.left > 0);
  await page.waitForTimeout(400);
  await page.click("#table-all");
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: wideSource })
    .click();
  await page.waitForSelector('[data-table-sort="attribute:extra39"]');
  assert.deepEqual(
    await page
      .locator(".table-scroll")
      .evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
    scrollPosition,
  );
  const widePopupPromise = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await widePopupPromise;
  popup.setDefaultTimeout(15000);
  popup.on("pageerror", (e) => report.errors.push(e.message));
  await popup.waitForSelector('[data-table-sort="attribute:extra39"]');
  assert.deepEqual(
    await popup
      .locator(".table-scroll")
      .evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
    scrollPosition,
  );
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  await page.waitForSelector('[data-table-sort="attribute:extra39"]');
  assert.deepEqual(
    await page
      .locator(".table-scroll")
      .evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
    scrollPosition,
  );
  pass(
    "Per-tab demand-loaded columns and both scroll axes survive switching, detaching and docking",
  );

  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  await page.waitForSelector('[data-table-sort="id"]');
  assert.equal(await page.locator("#table-head [data-table-sort]").count(), 32);
  assert.equal(
    await page
      .locator(
        ".table-header #close-table,#table-title,#previous-fields,#next-fields",
      )
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator("#table-tabs [role=tab][aria-selected=true]")
      .evaluate((el) => getComputedStyle(el).textAlign),
    "left",
  );
  assert.equal(
    await page
      .locator("#table-tabs [role=tab][aria-selected=true]")
      .evaluate((el) => getComputedStyle(el).justifyContent),
    "flex-start",
  );
  const beforeSearch = await api("snapshot");
  await page.fill("#table-search", "value13-39");
  await page.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("1 events"),
  );
  assert.equal(await page.locator("#table-body [data-event]").count(), 1);
  assert.deepEqual((await api("snapshot")).filter, beforeSearch.filter);
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: "All sources" })
    .click();
  assert.equal(await page.inputValue("#table-search"), "");
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: wideSource })
    .click();
  assert.equal(await page.inputValue("#table-search"), "value13-39");
  await page.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("1 events"),
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.restoreScene(c.captureScene());
  });
  assert.equal(await page.inputValue("#table-search"), "value13-39");
  await page.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("1 events"),
  );
  const searchPopup = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await searchPopup;
  popup.setDefaultTimeout(15000);
  await popup.waitForFunction(
    () => document.querySelector("#table-search")?.value === "value13-39",
  );
  await popup.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("1 events"),
  );
  await popup.fill("#table-search", "nothing matches this row");
  await popup.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("0 events"),
  );
  await popup.fill("#table-search", "");
  await popup.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("240 events"),
  );
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  pass(
    "The single left-aligned tab title and per-table search retain independent scope and survive detachment",
  );

  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  const anchor = await page
    .locator("#table-body [data-event]")
    .first()
    .getAttribute("data-event");
  await page.locator("#table-body [data-event]").first().click();
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: "All sources" })
    .click();
  await page.locator("#table-body [data-event]").nth(4).click();
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: wideSource })
    .click();
  const range = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.postDataJSON()?.command === "select_query",
  );
  await page
    .locator("#table-body [data-event]")
    .nth(3)
    .click({ modifiers: ["Shift"] });
  const rangeArgs = (await range).postDataJSON().args;
  assert.equal(rangeArgs.table_range.anchor, anchor);
  assert.equal(rangeArgs.source, wideSource);
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  assert.equal((await api("snapshot")).selected_count, 4);
  const anchorPopupPromise = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await anchorPopupPromise;
  popup.setDefaultTimeout(15000);
  await popup.waitForSelector("#table-body [data-event]");
  const detachedRange = popup.waitForRequest(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.postDataJSON()?.command === "select_query",
  );
  await popup
    .locator("#table-body [data-event]")
    .nth(6)
    .click({ modifiers: ["Shift"] });
  assert.equal(
    (await detachedRange).postDataJSON().args.table_range.anchor,
    anchor,
  );
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 7,
  );
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  pass(
    "Independent tab selection anchors retain exact shift ranges across tab changes and detachment",
  );

  const wideGisFile = path.join(out, "wide-reference.geojson");
  fs.writeFileSync(
    wideGisFile,
    JSON.stringify({
      type: "FeatureCollection",
      features: [0, 1].map((row) => ({
        type: "Feature",
        id: `wide-${row}`,
        geometry: { type: "Point", coordinates: [-65 + row, 30] },
        properties: {
          name: `Station ${row}`,
          ...Object.fromEntries(
            Array.from({ length: 80 }, (_, i) => [
              `wide_${String(i).padStart(3, "0")}`,
              i === 79 && row === 0 ? "Hidden GIS needle" : `cell ${row}-${i}`,
            ]),
          ),
        },
      })),
    }),
  );
  const wideGis = (await api("gis_load", { path: wideGisFile })).layer;
  await page.evaluate(() => window.__chronoscope.refresh(false));
  await page.click("#toggle-table");
  await page.locator(`[data-table-gis-id="${wideGis.id}"]`).click();
  await page.waitForSelector('.table-scroll[aria-busy="false"]');
  assert.equal(await page.locator("#table-head [data-gis-sort]").count(), 32);
  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await page.waitForSelector('[data-gis-sort="wide_079"]');
  assert.equal(await page.locator("#table-head [data-gis-sort]").count(), 32);
  assert(
    await page
      .locator("#table-body")
      .textContent()
      .then((text) => text.includes("Hidden GIS needle")),
  );
  await page.locator(".table-scroll").evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.waitForSelector('[data-gis-sort="id"]');
  await page.fill("#table-search", "Hidden GIS needle");
  await page.waitForFunction(() =>
    document
      .querySelector("#table-count")
      .textContent.startsWith("1 reference features"),
  );
  assert.equal(await page.locator("#table-body [data-gis-row]").count(), 1);
  await page.click("#close-table");
  await api("gis_remove", { id: wideGis.id });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  assert(
    columnRequests.some(
      (request) =>
        request.command === "attribute_table" && request.column_offset > 0,
    ),
  );
  assert(
    columnRequests.some(
      (request) => request.command === "gis_table" && request.column_offset > 0,
    ),
  );
  assert(columnRequests.every((request) => request.column_limit <= 32));
  pass(
    "Event and GIS tables load bounded column windows on horizontal scroll and search values in unloaded columns",
  );

  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.call("view_set", {
      mode: "map",
      display: { mode: "clusters", bloom: false },
    });
    await c.refresh();
    await c.restoreScene(c.snapshot.scene);
    c.view.fit();
  });
  await page.waitForFunction(() =>
    window.__chronoscope.view.displayLayer.hits.some((h) => h.bin.count > 1),
  );
  const pickedCell = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      r = v.host.getBoundingClientRect();
    return v.displayLayer.hits
      .filter((h) => h.bin.count > 1)
      .map((h) => ({ x: r.x + h.x, y: r.y + h.y }))
      .find((h) => document.elementFromPoint(h.x, h.y)?.tagName === "CANVAS");
  });
  assert(
    pickedCell,
    "A real cluster is visible for the display-cell table test",
  );
  await page.mouse.click(pickedCell.x, pickedCell.y);
  await page.waitForSelector("#cell-table");
  const cellTableRequest = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/invoke") &&
      r.postDataJSON()?.command === "attribute_table" &&
      r.postDataJSON().args.display_cell,
  );
  await page.click("#cell-table");
  const cellScope = (await cellTableRequest).postDataJSON().args.display_cell;
  const members = await api("attribute_table", {
    display_cell: cellScope,
    apply_filter: true,
    limit: 100,
  });
  await page.waitForFunction(
    (n) =>
      document
        .querySelector("#table-count")
        .textContent.startsWith(n.toLocaleString() + " events"),
    members.count,
  );
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: wideSource })
    .click();
  await page
    .locator("#table-tabs [role=tab]")
    .filter({ hasText: "Display cell members" })
    .click();
  const cellPopupPromise = page.waitForEvent("popup");
  await page.click("#table-popout");
  popup = await cellPopupPromise;
  popup.setDefaultTimeout(15000);
  await popup.waitForFunction(
    (n) =>
      document
        .querySelector("#table-count")
        .textContent.startsWith(n.toLocaleString() + " events"),
    members.count,
  );
  const memberId = await popup
    .locator("#table-body [data-event]")
    .first()
    .getAttribute("data-event");
  await popup.locator("#table-body [data-event]").first().click();
  await page.waitForFunction(
    (id) => window.__chronoscope.snapshot.selected.includes(id),
    memberId,
  );
  await popup.click("#table-popout");
  await page.waitForSelector("#table-panel.open");
  assert.equal(
    await page
      .locator("#table-tabs [role=tab][aria-selected=true]")
      .textContent(),
    "Display cell members",
  );
  pass(
    "Display-cell tables preserve their exact member scope across tab switching and native-style detach/dock",
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.error = String(e);
  throw e;
} finally {
  save();
  await browser?.close();
  server.kill();
}
