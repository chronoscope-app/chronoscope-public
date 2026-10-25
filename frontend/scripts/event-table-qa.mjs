import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Layer table picker, full columns, ordering and selection against the real Rust bridge.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { randomBytes } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/event-table"),
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
    if (
      (packet.command === "events" && !packet.args?.id) ||
      packet.args?.page?.command === "events"
    )
      report.compactTableRequests++;
  });
  async function ready() {
    await page.goto(url + "/#token=" + token);
    await page.waitForFunction(
      () =>
        window.__chronoscope?.snapshot?.count > 0 && !window.__chronoscope.busy,
    );
    await page.evaluate(() => window.__chronoscope.ready);
    assert.equal(
      (await page.locator("#toggle-table").innerText()).trim(),
      "Tables",
    );
    await page.click("#toggle-table");
    await page.waitForSelector("#tables-menu [data-table-layer-source]");
    assert.equal(await page.locator("#table-panel.open").count(), 0);
    await page
      .locator("#tables-menu [data-table-layer-source]")
      .first()
      .click();
    await page.waitForSelector("#table-body [data-event]");
    assert.match(
      await page.locator("#table-title").textContent(),
      /^Attributes · /,
    );
    assert.equal(
      await page.locator("#toggle-table").getAttribute("aria-expanded"),
      "false",
    );
  }
  async function ids() {
    return page
      .locator("#table-body [data-event]")
      .evaluateAll((rows) => rows.map((r) => r.dataset.event));
  }
  async function expectOrder(field, descending, command = "attribute_table") {
    const expected = await api(command, {
      sort_by: field,
      descending,
      limit: 100,
    });
    await page.waitForFunction(
      (expected) =>
        JSON.stringify(
          Array.from(
            document.querySelectorAll("#table-body [data-event]"),
            (r) => r.dataset.event,
          ),
        ) === JSON.stringify(expected),
      expected.events.map((e) => e.id),
    );
    const h = page.locator(`[data-table-sort="${field}"]`).locator("..");
    assert.equal(
      await h.getAttribute("aria-sort"),
      descending ? "descending" : "ascending",
    );
  }
  for (const dataset of ["synthetic", "hurricanes"]) {
    if (dataset === "hurricanes") {
      await page.goto("about:blank");
      await api("open", {
        path: path.join(
          root,
          "samples/atlantic-hurricanes-2016-2025.chronoscope",
        ),
      });
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
    }
    await ready();
    const full = await api("attribute_table", { limit: 1 });
    assert.equal(
      await page.locator("#table-head [data-table-sort]").count(),
      full.columns.length,
    );
    assert(full.columns.length > 6);
    pass(
      dataset +
        ": Tables picker opens every canonical and imported attribute column",
    );
    for (const field of [
      "entity",
      "category",
      "lat",
      "value",
      "label",
      "time",
    ]) {
      await page.locator(`[data-table-sort="${field}"]`).click();
      await expectOrder(field, false);
      await page.locator(`[data-table-sort="${field}"]`).click();
      await expectOrder(field, true);
    }
    pass(
      dataset +
        ": full attribute table sorts canonical columns globally in both directions",
    );
    await page.locator('[data-table-sort="value"]').click();
    await expectOrder("value", false);
    await page.locator('[data-table-sort="value"]').click();
    await expectOrder("value", true);
    const expected = await api("attribute_table", {
      sort_by: "value",
      descending: true,
      limit: 100,
    });
    await page.locator("#table-body [data-event]").first().click();
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.selected_count === 1,
    );
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.selected_count === 2,
    );
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.selected_count === 3,
    );
    assert.deepEqual(
      (await api("snapshot")).selected.sort(),
      expected.events
        .slice(0, 3)
        .map((e) => e.id)
        .sort(),
    );
    await page
      .locator("#table-body [data-event]")
      .nth(5)
      .click({ modifiers: ["Shift"] });
    await page.waitForFunction(
      () => window.__chronoscope.snapshot.selected_count === 6,
    );
    assert.deepEqual(
      (await api("snapshot")).selected.sort(),
      expected.events
        .slice(0, 6)
        .map((e) => e.id)
        .sort(),
    );
    pass(
      dataset +
        ": Shift+arrow and Shift+click select exactly the displayed sorted range",
    );
    await page.keyboard.press("End");
    const last = await api("attribute_table", {
      sort_by: "value",
      descending: true,
      offset: expected.count - 1,
      limit: 1,
    });
    await page.waitForFunction(
      (id) => document.activeElement?.getAttribute("data-event") === id,
      last.events[0].id,
    );
    await page.keyboard.press("Home");
    await page.waitForFunction(
      (id) => document.activeElement?.getAttribute("data-event") === id,
      expected.events[0].id,
    );
    pass(
      dataset +
        ": keyboard navigation/reveal retain sorted order across virtual pages",
    );
    await page.click("#close-table");
    await page.locator("[data-layer-source] strong").first().dblclick();
    await page.waitForSelector(
      '#table-head [data-table-sort="attribute:' +
        (dataset === "synthetic" ? "confidence" : "category") +
        '"]',
    );
    const field =
      dataset === "synthetic" ? "attribute:confidence" : "attribute:category";
    await page.locator(`[data-table-sort="${field}"]`).click();
    await expectOrder(field, false, "attribute_table");
    await page.locator(`[data-table-sort="${field}"]`).click();
    await expectOrder(field, true, "attribute_table");
    pass(
      dataset + ": full layer attributes retain imported columns and sorting",
    );
    await page.click("#close-table");
  }

  // Multiple Event layers plus a timeless GIS reference share one picker.
  const extraFile = path.join(out, "Picker & source.csv");
  fs.writeFileSync(
    extraFile,
    [
      "entity,timestamp,latitude,longitude," +
        Array.from({ length: 40 }, (_, i) => "extra" + i).join(","),
      "Fixture,2025-01-01T00:00:00Z,20,-60," +
        Array.from({ length: 40 }, (_, i) => "text" + i).join(","),
    ].join("\n"),
  );
  const ticket = await api("import_preview", { path: extraFile });
  await api("import_commit", { import_id: ticket.import_id, append: true });
  const geojson = path.join(out, "reference.geojson");
  fs.writeFileSync(
    geojson,
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "a",
          properties: { place: "Harbor", population: 200 },
          geometry: { type: "Point", coordinates: [-60, 20] },
        },
        {
          type: "Feature",
          id: "b",
          properties: { place: "Inland", population: 100 },
          geometry: { type: "Point", coordinates: [-61, 21] },
        },
      ],
    }),
  );
  const reference = (
    await api("gis_load", { path: geojson, name: "Reference & places" })
  ).layer;
  const before = await api("snapshot");
  const extra = before.layers.find((layer) => layer.count === 1).source;
  await api("filter", { filter: { hidden_sources: [extra] } });
  await api("gis_set", { id: reference.id, enabled: false });
  await page.evaluate(() => window.__chronoscope.refresh());
  await page.click("#toggle-table");
  assert.equal(await page.locator("#tables-menu [role=menuitem]").count(), 3);
  assert.match(await page.locator("#tables-menu").innerText(), /hidden/);
  assert.equal(
    await page.locator("#tables-menu [data-table-gis-id]").count(),
    1,
  );
  await page.keyboard.press("End");
  assert.equal(
    await page
      .locator("#tables-menu [role=menuitem]")
      .last()
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .locator("#tables-menu [role=menuitem]")
      .first()
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#tables-menu").count(), 0);
  assert.equal(
    await page
      .locator("#toggle-table")
      .evaluate((e) => document.activeElement === e),
    true,
  );
  await page.click("#toggle-table");
  await page.click("#toggle-table");
  assert.equal(await page.locator("#tables-menu").count(), 0);
  await page.click("#toggle-table");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#tables-menu").count(), 0);
  pass(
    "Picker lists both Event sources and the GIS table, including hidden layers; keyboard and trigger dismissal work",
  );
  await page.click("#toggle-table");
  const extraButton = page
    .locator("#tables-menu [data-table-layer-source]")
    .filter({ hasText: "Picker & source" });
  await extraButton.click();
  await page.waitForFunction(() =>
    document.querySelector("#table-count").textContent.startsWith("0 events"),
  );
  await page.uncheck("#table-respect-filters");
  await page.waitForSelector("#table-body [data-event]");
  assert.equal(await page.locator("#table-body [data-event]").count(), 1);
  await page.click("#next-fields");
  await page.waitForSelector('[data-table-sort="attribute:extra39"]');
  pass(
    "Hidden source opens its exact full table; filter control and wide-column paging retain original fields",
  );
  await page.click("#toggle-table");
  await page.locator("#tables-menu [data-table-gis-id]").click();
  await page.waitForSelector("#table-body [data-gis-row]");
  assert.equal(await page.locator("#table-body [data-gis-row]").count(), 2);
  assert.match(
    await page.locator("#table-title").innerText(),
    /Reference & places/i,
  );
  await page.locator('[data-gis-sort="population"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("#table-body [data-gis-row]")
      .textContent.includes("Inland"),
  );
  pass(
    "Choosing a hidden GIS reference opens its real properties and sortable feature rows",
  );
  await page.click("#close-table");
  await page.goto("about:blank");
  const legacy = (await api("snapshot")).scene;
  await api("scene_sync", {
    scene: {
      ...legacy,
      gis_table: null,
      table_open: true,
      table_attributes: false,
      table_source: extra,
      table_sort: "time",
      table_column_offset: 0,
    },
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForSelector(
    '#table-panel.open [data-table-sort="attribute:extra0"]',
  );
  assert.equal(await page.locator("#table-head [data-table-sort]").count(), 32);
  pass("An older compact-table workspace restores the full attribute table");
  assert.equal(report.compactTableRequests, 0);
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (e) {
  report.error = String(e);
  throw e;
} finally {
  save();
  await browser?.close();
  server.kill();
}
