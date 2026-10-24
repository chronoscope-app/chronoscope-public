import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/display-recovery");
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    dir,
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
let browser;
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
    server.on("error", reject);
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
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const result = await response.json();
    assert(response.ok, JSON.stringify(result));
    return result.result;
  };
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
      terrain_path: null,
    },
  });
  await api("view_set", {
    mode: "space-time",
    inspector_tab: "views",
    display: {
      mode: "points",
      bloom: false,
      spatial_culling: false,
      show_points: true,
      show_tracks: true,
      show_trails: true,
      trail_gap_minutes: 0,
      track_opacity: 0.25,
      trail_opacity: 0.25,
    },
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium"),
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /Cesium render failure/.test(message.text()) &&
      !message.text().includes("QA injected")
    )
      report.errors.push(message.text());
  });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    return /^https?:/.test(u) && !u.startsWith(url + "/")
      ? route.abort()
      : route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3568 &&
      !window.__chronoscope.busy &&
      window.__chronoscope.view.renderPoints.length === 3568,
  );
  await page.waitForTimeout(300);
  const axis = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    const height = (time) => {
      const p = v.position(30, -80, time);
      return Math.hypot(p.x, p.y, p.z);
    };
    return {
      oldest: height(v.lo),
      newest: height(v.hi),
      span: v.timeHeightMeters,
      separation: (() => {
        const a = v.position(30, -80, v.lo),
          b = v.position(30, -80, v.hi);
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      })(),
    };
  });
  assert(axis.oldest > axis.newest);
  assert(Math.abs(axis.separation - axis.span) < 1e-5);
  check("Oldest events at top; newest events at ground level", axis);
  const fading = await page.evaluate(async () => {
    const v = window.__chronoscope.view;
    const points = [...v.points];
    v.setPlayback(true);
    await v.setData(points.slice(0, 100), v.names, v.bounds, [v.lo, v.hi]);
    // Check creation before software shader compilation can consume the
    // entire 2.4-second fade lifetime; presentation must still render cleanly.
    const fadingStems = v.fadeTrails.length;
    v.requestRender();
    v.viewer.render();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const result = {
      diagnostics: v.diagnostics(),
      fadingStems,
      remainingFadingStems: v.fadeTrails.length,
    };
    v.setPlayback(false);
    await v.setData(points, v.names, v.bounds, [v.lo, v.hi]);
    return result;
  });
  assert(fading.fadingStems > 0);
  assert.equal(fading.diagnostics.renderErrorCount, 0);
  check(
    "Hurricane playback fades across hemispheres without geometry failure",
    {
      fadingStems: fading.fadingStems,
      errors: fading.diagnostics.renderErrorCount,
    },
  );
  await page.locator('[data-tab="views"]').click();
  await page.locator("#display-heat").check();
  const idle = () => page.evaluate(() => window.__chronoscope.displayIdle());
  await idle();
  const visible = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        shown: [...v.glyphById.values()].filter((g) => g.show).length,
        count: v.points.length,
        options: v.display,
        overlay: v.displayLayer.diagnostics,
        errors: v.diagnostics().renderErrorCount,
      };
    });
  let state = await visible();
  assert.equal(state.shown, 3568);
  assert.equal(state.overlay.atlasLayers, 1);
  await page.locator("#display-points").uncheck();
  await idle();
  assert.equal((await visible()).shown, 0);
  await page.locator("#display-points").check();
  await idle();
  assert.equal((await visible()).shown, 3568);
  check(
    "Heat map overlays events; Events checkbox independently hides/shows them",
    { shown: 3568 },
  );
  await page.evaluate(() => {
    const l = window.__chronoscope.view.displayLayer,
      add = l.addAtlas;
    window.__previews = [];
    window.__sliderHeld = false;
    l.addAtlas = async function (canvas, ...args) {
      await add.call(this, canvas, ...args);
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < pixels.length; i += 97)
        hash = (hash * 31 + pixels[i]) | 0;
      window.__previews.push({ held: window.__sliderHeld, hash });
    };
  });
  const dragAmount = async (key) => {
    const slider = page.locator(`[data-amount="${key}"]`);
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.evaluate(() => {
      window.__previews = [];
      window.__sliderHeld = true;
    });
    await page.mouse.down();
    for (let step = 0; step < 28; step++) {
      await page.mouse.move(
        box.x + box.width * (0.2 + (0.6 * step) / 27),
        box.y + box.height / 2,
      );
      await page.waitForTimeout(45);
    }
    const during = await page.evaluate(() =>
      window.__previews.filter((p) => p.held),
    );
    await page.evaluate(() => {
      window.__sliderHeld = false;
    });
    await page.mouse.up();
    await idle();
    assert(
      new Set(during.map((p) => p.hash)).size >= 2,
      `${key} must render distinct effect images before pointer release: ${JSON.stringify(during)}`,
    );
    return {
      intermediateImages: during.length,
      distinctImages: new Set(during.map((p) => p.hash)).size,
    };
  };
  check("Heat slider updates before releasing mouse", await dragAmount("heat"));
  await page.locator("#display-bloom").check();
  await idle();
  check(
    "Bloom slider updates before releasing mouse",
    await dragAmount("bloom"),
  );
  for (const [button, mode] of [
    ["2D Map", "map"],
    ["Globe", "globe"],
    ["Space-time", "space-time"],
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    await page.waitForFunction(
      () => !window.__chronoscope.view.displayLayer.diagnostics.pending,
    );
    state = await visible();
    assert.equal(state.shown, 3568, mode);
    assert.equal(state.errors, 0, mode);
    check(`Heat and bloom retain all events in ${mode}`, {
      shown: state.shown,
    });
  }
  const before = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    window.__oldCanvas = v.viewer.canvas;
    return {
      camera: v.captureCamera(),
      points: v.points.length,
      selected: [...v.selected],
    };
  });
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.scene.renderError.raiseEvent(
      v.scene,
      new Error("QA injected rendering failure"),
    );
  });
  await page.waitForFunction(() => {
    const v = window.__chronoscope.view;
    return (
      !v.recovering &&
      v.viewer.canvas !== window.__oldCanvas &&
      v.viewer.useDefaultRenderLoop
    );
  });
  const recovered = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    return {
      camera: v.captureCamera(),
      points: v.points.length,
      selected: [...v.selected],
      diagnostics: v.diagnostics(),
    };
  });
  assert.equal(recovered.points, before.points);
  assert.deepEqual(recovered.selected, before.selected);
  assert.equal(recovered.diagnostics.renderErrorCount, 0);
  assert(recovered.diagnostics.lastRenderError.includes("QA injected"));
  for (const name of ["position", "direction", "up"])
    before.camera.cesium_camera[name].forEach((x, i) =>
      assert(Math.abs(x - recovered.camera.cesium_camera[name][i]) < 1e-5),
    );
  check(
    "Automatic renderer recovery preserves hurricane workspace and camera",
    {
      count: recovered.points,
      recoveries: recovered.diagnostics.contextRecoveries,
    },
  );
  await page.evaluate(() => {
    window.__oldCanvas = window.__chronoscope.view.viewer.canvas;
  });
  await page.locator("#backend").click();
  await page.waitForFunction(() => {
    const v = window.__chronoscope.view;
    return (
      !v.recovering &&
      v.viewer.canvas !== window.__oldCanvas &&
      v.viewer.useDefaultRenderLoop
    );
  });
  check(
    "Renderer indicator explicitly refreshes the map after prior recovery",
    {
      recoveries: await page.evaluate(
        () => window.__chronoscope.view.diagnostics().contextRecoveries,
      ),
    },
  );
  assert.deepEqual(report.errors, []);
  await page.screenshot({
    path: path.join(dir, "hurricanes-after-recovery.png"),
  });
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
