import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust bridge and actual mouse/keyboard input. No public map requests.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/navigation"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/release/chronoscope"),
  [
    "--data-dir",
    out,
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
    "--frontend",
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
let browser;
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const p = await api("preferences");
  await api("preferences", {
    preferences: {
      ...p,
      theme: "light",
      map: { ...p.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  await page.click('[data-view="map"]');
  await page.keyboard.press("f");
  await page.waitForTimeout(700);
  const canvas = page.locator("#scene canvas").first();
  const find = async (kind) =>
    page.evaluate((kind) => {
      const v = window.__chronoscope.view,
        r = v.viewer.canvas.getBoundingClientRect();
      if (kind === "event") {
        for (const point of v.points) {
          const pixel = v.project(v.pos(point));
          if (!pixel || pixel.x < 10 || pixel.y < 10 || pixel.x >= r.width || pixel.y >= r.height) continue;
          const id = v.pickId(pixel.x,pixel.y);
          if (id?.kind === "event") return {x:r.left+pixel.x,y:r.top+pixel.y,id:id.id};
        }
      } else {
        for (let y=40;y<r.height-40;y+=30) for (let x=40;x<r.width-40;x+=30)
          if (!v.pickId(x,y) && v.groundAt({x,y})) return {x:r.left+x,y:r.top+y};
      }
    }, kind);
  const ground = await find("ground");
  assert(ground);
  await page.mouse.click(ground.x, ground.y, { button: "right" });
  await page.waitForSelector("#radius-query");
  await page.waitForFunction(() =>
    document.querySelector("#radius-coordinates")?.textContent.includes("MGRS"),
  );
  assert.match(
    await page.locator("#radius-coordinates").innerText(),
    /Decimal degrees/,
  );
  await page.screenshot({ path: path.join(out, "radius-dialog.png") });
  await page.locator("#query-radius").fill("0");
  await page.locator('#radius-query [type="submit"]').click();
  assert.match(
    await page.locator("#radius-error").innerText(),
    /greater than zero/,
  );
  await page.locator("#query-radius").fill("21000");
  await page.locator('#radius-query [type="submit"]').click();
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 192,
  );
  await page.waitForSelector("#radius-query", { state: "detached" });
  check(
    "Radius dialog shows coordinates, validates input and selects all workspace records",
  );
  await page.mouse.click(ground.x, ground.y, { button: "right" });
  await page.waitForSelector("#radius-query");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#radius-query").count(), 0);
  assert.equal((await api("snapshot")).selected_count, 192);
  check("Cancel preserves selection");
  const event = await find("event");
  assert(event, "rendered event found");
  await page.click('[data-tab="views"]');
  await page.mouse.click(event.x, event.y, { button: "right" });
  await page.waitForFunction(
    (id) =>
      window.__chronoscope.snapshot.selected_count === 1 &&
      window.__chronoscope.snapshot.selected[0] === id,
    event.id,
  );
  assert.equal(
    await page.locator('[data-tab="inspect"]').getAttribute("class"),
    "active",
  );
  assert.equal(await page.locator("#radius-query").count(), 0);
  await page.screenshot({ path: path.join(out, "event-properties.png") });
  check("Right click event reveals Inspect properties and selects the event");
  // A drag returning to its starting point must never become a context click.
  await page.mouse.move(ground.x, ground.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(ground.x + 50, ground.y, { steps: 8 });
  await page.mouse.move(ground.x, ground.y, { steps: 8 });
  await page.mouse.up({ button: "right" });
  assert.equal(await page.locator("#radius-query").count(), 0);
  check("Out-and-back right drag does not open a dialog");
  for (const mode of ["space-time", "globe"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction((mode) => window.__chronoscope.view.mode === mode && !window.__chronoscope.busy,mode);
    await canvas.focus();
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const surface = await find("ground");
    assert(surface,mode + " ground found");
    await page.mouse.click(surface.x,surface.y,{button:"right"});
    await page.waitForSelector("#radius-query");
    await page.locator("#query-radius-unit").selectOption("1");
    await page.locator("#query-radius").fill("21000000");
    await page.locator('#radius-query [type="submit"]').click();
    await page.waitForSelector("#radius-query",{state:"detached"});
    await page.waitForFunction(() => window.__chronoscope.snapshot.selected_count === 192);
    check(mode + " ground right-click and radius selection in meters");
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack || String(error);
  throw error;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
  fs.rmSync(tokenFile, { force: true });
}
