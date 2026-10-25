import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
import path from "node:path";
import assert from "node:assert/strict";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
const root = path.resolve(import.meta.dirname, "../.."),
  out =
    process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/field-roles");
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
fs.writeFileSync(out + "/token", token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || root + "/target/debug/chronoscope",
  [
    "--data-dir",
    out + "/profile",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    out + "/token",
    "--frontend",
    root + "/frontend/dist",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
let report = {
  passed: false,
  errors: [],
  timezones: [],
  publicRequests: 0,
  checks: [],
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const hostile = 'Metric "><img src=x onerror=alert(1)>';
  const headers = [
    "timestamp",
    "latitude",
    "longitude",
    "entity",
    "value",
    "Account",
    "Merchant",
    "Year",
    "Bytes",
    "Status",
    "When",
    "Units",
    "Blank",
    hostile,
    ...Array.from({ length: 120 }, (_, i) => "Extra_" + i),
  ];
  const cell = (v) => '"' + String(v).replaceAll('"', '""') + '"';
  const csv = out + "/odd-fields.csv";
  fs.writeFileSync(
    csv,
    [
      headers,
      ...Array.from({ length: 24 }, (_, i) => [
        `2026-01-${String((i % 3) + 1).padStart(2, "0")}T12:00:59Z`,
        40.7 + i * 0.001,
        -74 + i * 0.001,
        "Device " + (i % 2),
        100 + i,
        "000" + (i % 3),
        i % 2 ? "Shop B" : "Shop A",
        10 + i,
        1024 + i * 100,
        200 + (i % 2),
        "2026-01-01T12:00:23Z",
        840,
        "empty",
        i + 1,
        ...Array.from({ length: 120 }, () => i),
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\n"),
  );
  const imported = await api("import_preview", { path: csv });
  await api("import_commit", {
    import_id: imported.import_id,
    mapping: { time: 0, lat: 1, lon: 2, entity: 3, value: 4 },
  });
  const original = (
    await api("query", {
      fields: ["id", "time", "value", "attribute:Account", "attribute:Year"],
      limit: 100,
    })
  ).events;
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      theme: "dark",
    },
  });
  await api("view_set", {
    mode: "map",
    inspector_tab: "charts",
    display: { mode: "points", bloom: false },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (r) => {
    if (
      r.request().url().startsWith(url) ||
      /^(blob|data):/.test(r.request().url())
    )
      return r.continue();
    report.publicRequests++;
    return r.abort();
  });
  const idle = async () => {
    await page.waitForFunction(
      () => document.querySelector("#chart-preview")?.workspaceChart,
    );
    await page.evaluate(() => window.__chronoscope.chartsIdle());
    await page.waitForFunction(() =>
      document
        .querySelector("#chart-status")
        ?.textContent.includes("scoped records"),
    );
  };
  const refresh = async () => {
    await page.evaluate(() => window.__chronoscope.refresh(false));
    await idle();
  };
  const check = (name) => {
    report.checks.push(name);
    console.log("PASS", name);
  };
  const assign = async (field, role) => {
    await page.locator("#field-roles-search").fill(field);
    await page
      .getByRole("combobox", { name: "Role for " + field, exact: true })
      .selectOption(role);
  };
  const open = async () => {
    await page.locator("#chart-field-roles").click();
    await page
      .getByRole("dialog", { name: "Field roles", exact: true })
      .waitFor();
  };
  const apply = async () => {
    await page.locator("#field-roles-apply").click();
    await page
      .getByRole("dialog", { name: "Field roles", exact: true })
      .waitFor({ state: "detached" });
    await idle();
  };
  await page.goto(url + "/#token=" + token);
  await idle();
  assert.deepEqual(
    await page
      .locator(".inspector-tabs [data-tab]")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent)),
    ["Views", "Charts", "Inspect", "Patterns"],
  );
  await open();
  assert.equal(await page.locator("#field-roles-rows tr").count(), 100);
  await page.locator("#field-roles-more").click();
  assert((await page.locator("#field-roles-rows tr").count()) > 100);
  await assign("attribute:" + hostile, "measurement");
  assert.equal(await page.locator(".field-roles-dialog img").count(), 0);
  await assign("attribute:" + hostile, "");
  check(
    "Charts is second; the searchable editor bounds large schemas and escapes original column names",
  );
  for (const [field, role] of Object.entries({
    value: "ignore",
    "attribute:Account": "identifier",
    "attribute:Merchant": "category",
    "attribute:Year": "measurement",
    "attribute:Bytes": "measurement",
    "attribute:Status": "category",
    "attribute:When": "timestamp",
    "attribute:Units": "unit",
  }))
    await assign(field, role);
  await page.locator("#field-roles-search").fill("");
  await page.locator("#field-roles-assigned").check();
  assert.equal(await page.locator("#field-roles-rows tr").count(), 8);
  await page.screenshot({ path: out + "/field-roles-editor.png" });
  await apply();
  const roles = (await api("snapshot", { compact: true })).field_roles;
  assert.equal(roles["attribute:Account"], "identifier");
  assert.deepEqual(
    (
      await api("query", {
        fields: ["id", "time", "value", "attribute:Account", "attribute:Year"],
        limit: 100,
      })
    ).events,
    original,
  );
  await page.locator('[data-chart-task="distribution"]').click();
  await idle();
  let config = (await api("snapshot", { compact: true })).scene.chart;
  assert(["attribute:Bytes", "attribute:Year"].includes(config.y));
  await page.locator('[data-chart-task="relationship"]').click();
  await idle();
  config = (await api("snapshot", { compact: true })).scene.chart;
  assert.deepEqual(
    new Set([config.x, config.y]),
    new Set(["attribute:Year", "attribute:Bytes"]),
  );
  await page.locator('[data-chart-task="compare"]').click();
  await idle();
  config = (await api("snapshot", { compact: true })).scene.chart;
  assert.equal(config.x, "attribute:Merchant");
  await page.screenshot({ path: out + "/roles-category-chart.png" });
  check(
    "Explicit measurements override name guesses, categories guide grouping, and roles leave all source records untouched",
  );
  await open();
  await assign("attribute:Account", "measurement");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Account"],
    "identifier",
  );
  await open();
  await assign("attribute:Account", "");
  await apply();
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Account"],
    undefined,
  );
  await api("undo");
  await refresh();
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Account"],
    "identifier",
  );
  await api("redo");
  await refresh();
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Account"],
    undefined,
  );
  check(
    "Cancel, per-field Automatic reset and undo/redo preserve other roles and update the live workspace",
  );
  await open();
  await assign("attribute:Account", "identifier");
  await api("field_roles_set", {
    assignments: { "attribute:Account": "category" },
  });
  await refresh();
  await page.locator("#field-roles-apply").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#field-roles-status")
      ?.textContent.includes("changed elsewhere"),
  );
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Account"],
    "category",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  check(
    "Concurrent edits to the same role are disclosed without overwriting another client or losing source data",
  );
  const snapshot = await api("snapshot", { compact: true });
  const schema = await api("dataset_schema", { include_attribute_types: true });
  const assignments = Object.fromEntries(
    [
      ...schema.canonical,
      ...schema.attributes.map((n) => "attribute:" + n),
      "year_utc",
    ]
      .filter(
        (f) =>
          ["value", "lat", "lon", "time", "end", "year_utc"].includes(f) ||
          f.startsWith("attribute:"),
      )
      .map((f) => [f, "ignore"]),
  );
  assignments["attribute:Blank"] = "measurement";
  await api("field_roles_set", { assignments });
  await refresh();
  assert(await page.locator('[data-chart-task="distribution"]').isDisabled());
  assert(await page.locator('[data-chart-task="relationship"]').isDisabled());
  await open();
  await page.locator("#field-roles-search").fill("attribute:Blank");
  assert.match(
    await page.locator("#field-roles-rows").innerText(),
    /No numeric values/,
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "Field roles", exact: true })
    .waitFor({ state: "detached" });
  await api("field_roles_set", {
    assignments: {
      "attribute:Year": "measurement",
      "attribute:Bytes": "measurement",
      "attribute:Merchant": "category",
      "attribute:Account": "identifier",
    },
  });
  await refresh();
  assert(await page.locator('[data-chart-task="relationship"]').isEnabled());
  check(
    "Declaring text as Measurement never coerces data; numeric eligibility and disabled starters stay truthful",
  );
  const save = out + "/field-roles.chronoscope";
  await api("save", { path: save });
  await api("open", { path: save });
  await page.reload();
  await idle();
  assert.equal(
    (await api("snapshot", { compact: true })).field_roles["attribute:Year"],
    "measurement",
  );
  await page.locator('[data-chart-task="relationship"]').click();
  await idle();
  config = (await api("snapshot", { compact: true })).scene.chart;
  assert.deepEqual(
    new Set([config.x, config.y]),
    new Set(["attribute:Year", "attribute:Bytes"]),
  );
  assert.deepEqual(
    (
      await api("query", {
        fields: ["id", "time", "value", "attribute:Account", "attribute:Year"],
        limit: 100,
      })
    ).events,
    original,
  );
  check(
    "Roles survive portable save/open and a genuine page reload and continue to guide chart starters",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  fs.writeFileSync(
    out + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
