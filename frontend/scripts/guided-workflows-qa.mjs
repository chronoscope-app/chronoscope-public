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
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/guided-workflows"),
);
fs.mkdirSync(out, { recursive: true });
const data =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-guided-"));
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
  await page.locator("#welcome-empty").click();
  await page.click("#new-analysis");
  await page.waitForSelector("#analysis-form");
  assert.equal(await page.locator("#run-guided-analysis").isDisabled(), true);
  await page.keyboard.press("Escape");
  console.log("Completed workflow stage");
  report.checks.push(
    "Empty workspaces cannot submit an analysis; native dialog Escape closes it",
  );

  const source = path.join(data, "study.csv");
  const records = Array.from(
    { length: 11 },
    (_, i) =>
      `A,2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z,40,-70,${i === 10 ? 1000 : i + 1}`,
  );
  records.push(
    records[0],
    "B,2026-10-12T12:00:00Z,,,4",
    "Bad,not-a-date,40,-70,5",
  );
  fs.writeFileSync(
    source,
    "entity,timestamp,latitude,longitude,value\n" + records.join("\n") + "\n",
  );
  page.once("dialog", (d) => d.accept(source));
  await page.click("#open");
  await page.waitForSelector("#review-import");
  await page.keyboard.press("Escape");
  await page.locator("#import-dialog").waitFor({ state: "detached" });
  assert.equal((await api("snapshot", { compact: true })).count, 0);
  page.once("dialog", (d) => d.accept(source));
  await page.click("#open");
  await page.waitForSelector("#review-import");
  assert.equal(await page.locator("#import-sheet option").count(), 1);
  await page.locator("#import-advanced summary").click();
  await page.locator("#default-entity").fill("Fallback");
  await page.click("#preview-mapping");
  assert.equal(await page.locator("#default-entity").inputValue(), "Fallback");
  await page.click("#review-import");
  await page.waitForSelector("#accept-rejections");
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  assert.equal((await api("snapshot", { compact: true })).count, 0);
  const quality = await page
    .locator(".import-quality strong")
    .allTextContents();
  assert.deepEqual(quality, ["13", "1", "1", "1"]);
  assert.match(await page.locator("#import-dialog").innerText(), /Row 15/);
  await page.screenshot({ path: path.join(out, "import-review.png") });
  console.log("Completed workflow stage");
  report.checks.push(
    "Full-file review catches a rejection beyond the six-row preview, reports location/duplicate counts, and does not publish Events",
  );

  const reportPath = path.join(data, "rejects.csv");
  page.once("dialog", (d) => d.accept(reportPath));
  await page.click("#export-import-rejections");
  await page.waitForFunction(() =>
    document
      .querySelector("#import-status")
      ?.textContent.includes("Exported 1"),
  );
  assert.match(fs.readFileSync(reportPath, "utf8"), /15,/);
  await page.click("#preview-mapping");
  assert.equal(await page.locator("#default-entity").inputValue(), "Fallback");
  await page.click("#review-import");
  await page.waitForSelector("#accept-rejections");
  await page.check("#accept-rejections");
  await page.click("#commit-import");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 13 &&
      !document.querySelector("#import-dialog") &&
      !window.__chronoscope.busy,
  );
  console.log("Completed workflow stage");
  report.checks.push(
    "Rejected-row CSV exports source rows/reasons; inline sample refresh preserves the draft; explicit acceptance commits valid rows",
  );

  // Own the former renderer-suite regression as well: invalid coordinates
  // must preserve an already populated workspace until explicit acceptance.
  const badCoordinates = path.join(data, "bad-coordinates.csv");
  fs.writeFileSync(
    badCoordinates,
    "entity,timestamp,latitude,longitude\nValid,2026-10-15T10:20:34Z,43.24,-79.97\nInvalid,2026-10-15T10:20:34Z,95,-79.97\n",
  );
  const beforeRejectedCoordinates = (await api("query", { limit: 100 })).events;
  page.once("dialog", (dialog) => dialog.accept(badCoordinates));
  await page.locator("#open").click();
  await page.locator("#review-import").click();
  await page.locator("#accept-rejections").waitFor();
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  assert.deepEqual(
    (await api("query", { limit: 100 })).events,
    beforeRejectedCoordinates,
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(
    (await api("query", { limit: 100 })).events,
    beforeRejectedCoordinates,
  );
  report.checks.push(
    "Invalid-coordinate review/cancellation preserves an existing populated workspace",
  );

  const analyze = async (task, configure = async () => {}) => {
    await page.click("#new-analysis");
    await page.waitForSelector("#analysis-form");
    await page.check(`input[name=task][value=${task}]`);
    assert.equal(
      await page.locator("#analysis-detail-title").textContent(),
      {
        profile: "Profile data",
        duplicates: "Find duplicates",
        outliers: "Find outliers",
        trajectories: "Summarize trajectories",
      }[task],
    );
    await configure();
    await page.click("#run-guided-analysis");
    await page.waitForSelector("#analytics-dialog h3", { timeout: 30000 });
    assert.equal(
      (await page.locator("#analytics-dialog h3").textContent()).toLowerCase(),
      task,
    );
    assert(!(await api("analytics_list")).results.at(-1)?.error);
  };
  const closeResults = () =>
    page.getByRole("button", { name: "Close analysis results" }).click();
  await analyze("profile");
  await page.screenshot({ path: path.join(out, "profile-result.png") });
  await closeResults();
  await analyze("duplicates");
  assert.equal(await page.locator("#analytics-dialog tbody tr").count(), 1);
  await page.locator("#analytics-dialog tbody tr").first().click();
  await page.waitForSelector("#analytics-dialog tbody tr.selected");
  assert.equal((await api("snapshot", { compact: true })).selected_count, 1);
  await closeResults();
  await analyze("outliers", async () => {
    await page.selectOption("#analysis-measurement", "value");
  });
  assert.equal(await page.locator("#analytics-dialog tbody tr").count(), 1);
  await closeResults();
  await analyze("trajectories");
  await closeResults();
  assert.equal((await api("analytics_list")).results.length, 4);
  console.log("Completed workflow stage");
  report.checks.push(
    "All four guided analyses create persistent Rust results without SI; duplicate rows link to explicitly labelled example Events",
  );

  const save = path.join(data, "study.chronoscope");
  await api("save", { path: save });
  await api("open", { path: save });
  assert.equal((await api("analytics_list")).results.length, 4);
  console.log("Completed workflow stage");
  report.checks.push(
    "Guided results persist through a portable save/open round trip",
  );

  // Existing table behavior survives the extraction: keyboard ranges cross displayed pages.
  await page.evaluate(() => window.__chronoscope.refresh());
  await page.click("#toggle-table");
  await page.locator("#tables-menu button").first().click();
  await page.locator("#table-body tr[data-event]").first().click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.evaluate(() => window.__chronoscope.selectionIdle());
  assert.equal((await api("snapshot", { compact: true })).selected_count, 2);
  console.log("Completed workflow stage");
  report.checks.push(
    "Extracted table selection retains keyboard range selection and exact shared IDs",
  );

  // Exercise the extracted map-dialog controller with a real, bounded local service.
  const tile = new PNG({ width: 256, height: 256 });
  tile.data.fill(180);
  for (let i = 3; i < tile.data.length; i += 4) tile.data[i] = 255;
  const png = PNG.sync.write(tile);
  mapFixture = createServer((req, res) => {
    if (req.url.startsWith("/caps")) {
      res.setHeader("Content-Type", "text/xml");
      res.end(
        `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer><ows:Title>Local test imagery</ows:Title><ows:Identifier>fixture</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="http://127.0.0.1:${mapFixture.address().port}/tiles/{TileRow}/{TileCol}"/></Layer><TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>EPSG:3857</ows:SupportedCRS><TileMatrix><ows:Identifier>world</ows:Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`,
      );
    } else {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    }
  });
  await new Promise((resolve) => mapFixture.listen(0, "127.0.0.1", resolve));
  await page.click("#maps");
  await page.locator(".map-advanced summary").click();
  await page.click("#custom-map-server");
  await page.fill(
    "#wmts-url",
    `http://127.0.0.1:${mapFixture.address().port}/caps`,
  );
  await page.click("#inspect-wmts");
  await page.waitForSelector("#wmts-layer option[value=fixture]", {
    state: "attached",
  });
  await page.selectOption("#wmts-layer", "fixture");
  await page.fill("#wmts-server-name", "Local regression fixture");
  await page.click("#add-map-layer");
  await page.waitForSelector("[data-map-opacity]");
  await page.fill("[data-map-opacity]", "35");
  await page.click("#save-map-stack");
  await page.waitForFunction(() => !document.querySelector("#save-map-stack"));
  const configured = await api("preferences");
  assert.equal(configured.map_layers.length, 1);
  assert.equal(configured.map_layers[0].opacity, 0.35);
  assert.equal(configured.map_layers[0].config.layer, "fixture");
  assert.equal(
    (await api("wmts_servers")).servers.some(
      (s) => s.name === "Local regression fixture",
    ),
    true,
  );
  report.checks.push(
    "Extracted map dialogs discover a local WMTS service, save a server, add its layer, and persist edited opacity",
  );

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 820, height: 650 },
  ]) {
    await page.setViewportSize(viewport);
    await page.click("#new-analysis");
    await page.waitForSelector("#analysis-form");
    const geometry = await page.locator("#guided-analysis").evaluate((d) => ({
      width: d.getBoundingClientRect().width,
      scroll: d.scrollWidth,
      client: d.clientWidth,
    }));
    assert(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
    await page.screenshot({
      path: path.join(out, `guided-analysis-${viewport.width}.png`),
    });
    await page.keyboard.press("Escape");
  }
  console.log("Completed workflow stage");
  report.checks.push(
    "Guided form remains readable without horizontal overflow at desktop and compact window sizes",
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.publicRequests, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  console.log(report.failure);
  await page
    ?.screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  mapFixture?.closeAllConnections();
  mapFixture?.close();
  server.kill("SIGTERM");
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report, null, 2));
