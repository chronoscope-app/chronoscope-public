// Exercise the shipped UI with the real Rust bridge, including linked selection.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/spectrum"),
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
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = { passed: false, checks: [], errors: [] };
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
    server.once("error", reject);
    server.stderr.on("data", (d) => {
      log += d;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
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
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  let prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      theme: "dark",
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
    },
  });
  await api("view_set", {
    mode: "space-time",
    display: {
      mode: "points",
      bloom: false,
      show_tracks: true,
      trail_gap_minutes: 0,
    },
  });
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(60000);
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
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy,
  );
  assert.equal(await page.locator("#scene #backend").count(), 0);
  assert.equal(await page.locator(".topbar #backend svg").count(), 1);
  assert.match(
    await page.locator("#backend").getAttribute("aria-label"),
    /Renderer: WebGL2/,
  );
  for (const width of [1600, 1000]) {
    await page.setViewportSize({ width, height: 1000 });
    const renderer = await page.locator("#backend").boundingBox();
    const bell = await page.locator("#notifications").boundingBox();
    assert(renderer.x + renderer.width <= bell.x);
    assert(Math.abs(renderer.y - bell.y) < 20);
    assert(bell.x + bell.width <= width);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  check(
    "Renderer icon stays left of Notifications and outside the map at desktop/minimum widths",
  );
  const first = page.locator("[data-select-entity]").first();
  const name = await first.getAttribute("data-select-entity");
  await first.click();
  await page.waitForFunction(
    (name) => !!window.__chronoscope.snapshot.selected_entities[name],
    name,
  );
  const row = page.locator(".entity").filter({
    has: page.locator("[data-select-entity=" + JSON.stringify(name) + "]"),
  });
  assert.equal(await row.getAttribute("data-selected"), "true");
  const second = page.locator("[data-select-entity]").nth(1);
  const secondName = await second.getAttribute("data-select-entity");
  const toggle = (entity) =>
    page.locator("[data-select-entity=" + JSON.stringify(entity) + "]");
  const idle = () => page.evaluate(() => window.__chronoscope.selectionIdle());
  assert.equal(await first.getAttribute("aria-pressed"), "true");
  const removeIcon = await first.locator("path").getAttribute("d");
  await second.click();
  await idle();
  let state = await api("snapshot", { selection_limit: 0 });
  assert(state.selected_entities[name] > 0);
  assert(state.selected_entities[secondName] > 0);
  assert.equal(
    state.selected_count,
    state.entities[name] + state.entities[secondName],
  );
  await first.click();
  await idle();
  state = await api("snapshot", { selection_limit: 0 });
  assert.equal(state.selected_entities[name], undefined);
  assert.equal(state.selected_entities[secondName], state.entities[secondName]);
  assert.equal(await first.getAttribute("aria-pressed"), "false");
  assert.notEqual(await first.locator("path").getAttribute("d"), removeIcon);
  check("Entity toggles add selections and deselect only the chosen entity");

  // Two clicks before the first bridge round trip must cancel out.
  await toggle(name).evaluate((button) => {
    button.click();
    button.click();
  });
  await idle();
  state = await api("snapshot", { selection_limit: 0 });
  assert.equal(state.selected_entities[name], undefined);
  assert.equal(state.selected_entities[secondName], state.entities[secondName]);
  check("Rapid entity toggles preserve other selections");

  // A partial selection must also be removable, even if filters hide its rows.
  const selectedId = (await api("snapshot")).selected[0];
  await api("select", { ids: [selectedId] });
  const originalFilter = state.filter;
  await api("filter", { filter: { hidden_entities: [secondName] } });
  await page.evaluate(() => window.__chronoscope.refresh());
  await toggle(secondName).click();
  await idle();
  state = await api("snapshot", { selection_limit: 0 });
  assert.equal(state.selected_count, 0);
  await toggle(secondName).click();
  await idle();
  state = await api("snapshot", { selection_limit: 0 });
  assert.equal(state.selected_entities[secondName], state.entities[secondName]);
  assert(state.visible < state.count);
  await api("filter", { filter: originalFilter });
  await page.evaluate(() => window.__chronoscope.refresh());
  // Keyboard activation keeps focus on the toggled entity after list refresh.
  await toggle(secondName).focus();
  await page.keyboard.press("Space");
  await idle();
  assert.equal(await toggle(secondName).getAttribute("aria-pressed"), "false");
  assert(
    await toggle(secondName).evaluate(
      (button) => document.activeElement === button,
    ),
  );
  check(
    "Partial and filtered entity selections toggle completely; keyboard focus survives",
  );

  const expand = page.locator("#fullscreen");
  const expandedIcon = await expand.locator("path").getAttribute("d");
  assert.notEqual(
    expandedIcon,
    await page.locator("#box-select path").getAttribute("d"),
  );
  await expand.click();
  assert.equal(await expand.getAttribute("aria-label"), "Restore workspace");
  assert.equal(await expand.getAttribute("aria-pressed"), "true");
  assert.notEqual(await expand.locator("path").getAttribute("d"), expandedIcon);
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  assert.equal(scene.expanded, true);
  await expand.click();
  await page.evaluate(
    (scene) => window.__chronoscope.restoreScene(scene),
    scene,
  );
  assert.equal(await expand.getAttribute("aria-label"), "Restore workspace");
  assert.equal(await expand.getAttribute("aria-pressed"), "true");
  await expand.click();
  assert.equal(await expand.getAttribute("aria-label"), "Expand workspace");
  check(
    "Distinct workspace arrows update on expansion, restoration and saved scenes",
  );
  await toggle(name).click();
  await idle();
  await page.locator('[data-tab="views"]').click();
  assert.equal(await row.getAttribute("data-selected"), "true");
  assert.equal(await page.locator(".view-entity").count(), 0);
  assert.equal(await page.locator("#scene .selection-chip").count(), 0);
  check(
    "Entity selection stays in the left list without a duplicate list or map selection banner",
    { entity: name },
  );
  const custom = "#d0549a";
  await page
    .locator("[data-entity-color=" + JSON.stringify(name) + "]")
    .fill(custom);
  await page.waitForFunction(
    ({ name, custom }) =>
      window.__chronoscope.snapshot.scene.entity_colors?.[name] === custom,
    { name, custom },
  );
  for (const theme of ["dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator("#theme").click();
    await page.waitForFunction(
      (theme) =>
        document.documentElement.dataset.theme === theme &&
        !window.__chronoscope.busy,
      theme,
    );
    assert.equal(
      await page
        .locator("[data-entity-color=" + JSON.stringify(name) + "]")
        .inputValue(),
      custom,
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector("#play")
          .getAnimations()
          .some((animation) => animation.playState === "running"),
    );
    await page.locator("#time-rail-range").click();
    const contrast = await page.evaluate(() => {
      const rgb = (c) => {
        const x = document.createElement("canvas").getContext("2d");
        x.fillStyle = c;
        x.fillRect(0, 0, 1, 1);
        return [...x.getImageData(0, 0, 1, 1).data].map((n, i) =>
          i < 3 ? n / 255 : n / 255,
        );
      };
      const blend = (fg, bg) =>
        [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
      const bg = (e) =>
        !e
          ? [1, 1, 1, 1]
          : blend(
              rgb(getComputedStyle(e).backgroundColor),
              bg(e.parentElement),
            );
      const lum = (c) =>
        c
          .slice(0, 3)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
      return [
        '.entity[data-selected="true"] .entity-name',
        '.entity[data-selected="true"] .entity-count',
        "#play",
        '[data-tab="views"]',
        ".range-label",
        "#time-rail-range-popup header strong",
      ].map((selector) => {
        const e = document.querySelector(selector),
          background = bg(e),
          foreground = blend(rgb(getComputedStyle(e).color), background);
        const a = lum(foreground),
          b = lum(background);
        return {
          selector,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    assert(
      contrast.every((x) => x.ratio >= 4.5),
      JSON.stringify({ theme, contrast }),
    );
    const shading = await row.evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor,
      border: getComputedStyle(e).borderLeftColor,
    }));
    assert.notEqual(shading.background, "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: path.join(out, theme + ".png") });
    check(theme + " contrast, custom entity colors and amber selection", {
      contrast,
      shading,
    });
  }
  await page.evaluate(async () => {
    await window.__chronoscope.select([]);
  });
  await page.waitForFunction(
    () =>
      Object.keys(window.__chronoscope.snapshot.selected_entities).length === 0,
  );
  assert.equal(
    await page
      .locator(
        '.entity[data-selected="true"],.view-entity[data-selected="true"]',
      )
      .count(),
    0,
  );
  check("Clearing selection clears both entity list highlights");
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
