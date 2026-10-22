import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/space-time-window");
fs.mkdirSync(dir, { recursive: true });
const profile = fs.mkdtempSync(path.join(dir, "profile-"));
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(profile, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI ||
    path.join(
      root,
      "target/debug/chronoscope" + (process.platform === "win32" ? ".exe" : ""),
    ),
  [
    "--data-dir",
    profile,
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
const report = { passed: false, checks: [], errors: [], screenshots: [] };
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
  await api("demo_open", { id: "local-wildlife" });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
      theme: "dark",
    },
  });
  await api("wmts_access", { settings: { offline: true } });
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
    },
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
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
    viewport: { width: 1720, height: 1080 },
  });
  page.setDefaultTimeout(30000);
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
      window.__chronoscope?.view.renderPoints.length === 3439 &&
      !window.__chronoscope.busy,
  );
  // Initialization restores the saved camera after the first data packet.
  await page.waitForTimeout(500);
  await page.locator("#fit").click();
  await page.waitForFunction(() => !document.querySelector("#fit").disabled);
  await page.waitForFunction(() => window.__chronoscope.view.bounds[0] > -80);
  await page.evaluate(async () => {
    const app = window.__chronoscope,
      v = app.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    await app.filterIdle();
    await app.displayIdle();
    // A button click starts asynchronous refresh; explicitly drain it before
    // measuring a fixed source extent and camera over successive zoom frames.
    await app.refresh(true, false);
    v.fit();
  });
  const state = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      v.requestRender();
      v.viewer.render();
      const floor = v.diagnostics().spaceTimeFloor;
      return {
        mode: v.mode,
        study: [...v.bounds],
        timeHeight: v.timeHeightMeters,
        distance: v.navigationDistance(),
        bearing: v.bearing(),
        tilt: v.tilt(),
        camera: v.captureCamera(),
        floor,
        size: [v.host.clientWidth, v.host.clientHeight],
        generation: v.generation,
        corners: floor?.bounds
          ? [
              [0, 1],
              [2, 1],
              [2, 3],
              [0, 3],
            ].map(([x, y]) =>
              v.project(v.groundPosition(floor.bounds[y], floor.bounds[x])),
            )
          : [],
        handles: Array.from({ length: v.handles.length }, (_, i) =>
          v.project(v.handles.get(i).position),
        ),
        errors: v.diagnostics().renderErrorCount,
      };
    });
  const near = (a, b, tolerance = 1) =>
    assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
  const inset = (s) => {
    assert(s.floor?.bounds);
    const p = s.floor.padding;
    for (const c of s.corners) {
      assert(
        c &&
          c.x >= p.left - 1 &&
          c.x <= s.size[0] - p.right + 1 &&
          c.y >= p.top - 1 &&
          c.y <= s.size[1] - p.bottom + 1,
        JSON.stringify(s),
      );
    }
    for (const h of s.handles)
      assert(
        h && h.x > 0 && h.x < s.size[0] && h.y > 0 && h.y < s.size[1],
        JSON.stringify({ handles: s.handles, size: s.size }),
      );
    assert.equal(s.errors, 0);
  };
  const original = await state();
  inset(original);
  const source = await page.evaluate(() =>
    JSON.stringify(
      window.__chronoscope.view.points.map((p) => [p.id, p.lat, p.lon, p.time]),
    ),
  );
  const zooms = [original];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__chronoscope.view.zoom(0.5));
    const s = await state();
    inset(s);
    zooms.push(s);
    s.corners.forEach((c, j) => {
      near(c.x, original.corners[j].x, 0.1);
      near(c.y, original.corners[j].y, 0.1);
    });
    near(
      (s.floor.bounds[2] - s.floor.bounds[0]) /
        (original.floor.bounds[2] - original.floor.bounds[0]),
      2 ** (i + 1),
      0.01,
    );
    assert.deepEqual(s.study, original.study);
    assert.equal(s.timeHeight, original.timeHeight);
    assert.equal(s.generation, original.generation);
  }
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        window.__chronoscope.view.points.map((p) => [
          p.id,
          p.lat,
          p.lon,
          p.time,
        ]),
      ),
    ),
    source,
  );
  check(
    "8x geographic zoom keeps floor screen footprint; no source-coordinate/time changes or Event rebuild",
    zooms.map((s) => ({
      floor: s.floor,
      corners: s.corners,
      generation: s.generation,
    })),
  );
  await page.evaluate(() => window.__chronoscope.view.fit());
  const fit = await state();
  fit.camera.cesium_camera.position.forEach((x, i) =>
    near(x, original.camera.cesium_camera.position[i], 0.001),
  );
  check("Fit returns to study bounds, independent of zoomed map extent");
  const rotated = [];
  for (const heading of [0, 45, 90, 180, 275])
    for (const tilt of [0, 30, 65, 80]) {
      await page.evaluate(
        ({ heading, tilt }) => {
          const v = window.__chronoscope.view;
          v.fit();
          v.setBearing(heading);
          v.setTilt(tilt);
        },
        { heading, tilt },
      );
      const s = await state();
      s.floor.bounds.forEach((x, i) => near(x, original.floor.bounds[i], 1e-6));
      near(s.distance, original.distance, 0.01);
      assert.equal(s.errors, 0);
      rotated.push({
        heading,
        tilt,
        bounds: s.floor.bounds,
        corners: s.corners,
      });
    }
  check(
    "Rotation preserves geographic floor dimensions and camera range across bearings/tilts",
    rotated,
  );
  // Exercise the same continuous pointer and wheel paths used by the controls.
  const stable = (s, before) => {
    s.floor.bounds.forEach((x, i) => near(x, before.floor.bounds[i], 1e-6));
    near(s.distance, before.distance, 0.01);
    assert.equal(s.errors, 0);
  };
  await page.evaluate(() => window.__chronoscope.view.fit());
  const sphereBefore = await state();
  const sphere = await page.locator(".navigation-sphere").boundingBox();
  await page.mouse.move(
    sphere.x + sphere.width / 2,
    sphere.y + sphere.height / 2,
  );
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(
      sphere.x + sphere.width / 2 + step * 4,
      sphere.y + sphere.height / 2 - step * 2,
    );
    stable(await state(), sphereBefore);
  }
  await page.mouse.up();
  const sphereAfter = await state();
  stable(sphereAfter, sphereBefore);
  assert(Math.abs(sphereAfter.bearing - sphereBefore.bearing) > 1);
  assert(Math.abs(sphereAfter.tilt - sphereBefore.tilt) > 1);
  check("Navigation sphere drag keeps floor fixed on every sampled frame");
  await page.evaluate(() => window.__chronoscope.view.fit());
  const handleBefore = await state();
  const canvas = await page.locator(".cesium-widget canvas").boundingBox();
  const handle = handleBefore.handles[1];
  await page.mouse.move(canvas.x + handle.x, canvas.y + handle.y);
  await page.mouse.down();
  assert(await page.evaluate(() => window.__chronoscope.view.drag?.orbit));
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(
      canvas.x + handle.x + step * 5,
      canvas.y + handle.y + step * 2,
    );
    stable(await state(), handleBefore);
  }
  await page.mouse.up();
  const handleAfter = await state();
  stable(handleAfter, handleBefore);
  assert(Math.abs(handleAfter.bearing - handleBefore.bearing) > 1);
  assert(Math.abs(handleAfter.tilt - handleBefore.tilt) > 1);
  check("On-map grab sphere drag keeps floor fixed on every sampled frame");
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  for (const modifier of ["Shift", "Control"]) {
    const before = await state();
    await page.keyboard.down(modifier);
    for (let step = 0; step < 5; step++) {
      await page.mouse.wheel(0, 15);
      stable(await state(), before);
    }
    await page.keyboard.up(modifier);
    const after = await state();
    assert(
      Math.abs(
        modifier === "Shift"
          ? after.tilt - before.tilt
          : after.bearing - before.bearing,
      ) > 1,
    );
  }
  check("Trackpad wheel rotation and tilt preserve floor extent and range");
  const oblique = await state();
  await page.evaluate(() => window.__chronoscope.view.zoom(0.5));
  const obliqueZoom = await state();
  for (const [a, b] of [
    [0, 2],
    [1, 3],
  ])
    near(
      (obliqueZoom.floor.bounds[b] - obliqueZoom.floor.bounds[a]) /
        (oblique.floor.bounds[b] - oblique.floor.bounds[a]),
      2,
      0.0001,
    );
  check("Zoom after rotation scales both geographic dimensions equally");
  const screenshots = [];
  for (const heading of [0, 45, 90]) {
    await page.evaluate((heading) => {
      const v = window.__chronoscope.view;
      v.fit();
      v.setBearing(heading);
    }, heading);
    await state();
    const file = `floor-heading-${heading}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    screenshots.push(file);
  }
  report.screenshots.push(...screenshots);
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.fit();
    v.panPixels(70, -30);
  });
  inset(await state());
  check("Pan recomputes geographic floor without shrinking it");
  const wheel = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.fit();
    v.requestRender();
    v.viewer.render();
    const r = v.viewer.canvas.getBoundingClientRect(),
      pixel = { x: r.width * 0.58, y: r.height * 0.7 };
    window.__windowAnchor = v.groundAt(pixel);
    return { x: r.x + pixel.x, y: r.y + pixel.y, pixel };
  });
  await page.mouse.move(wheel.x, wheel.y);
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => !window.__chronoscope.view.drag);
  const anchor = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.requestRender();
    v.viewer.render();
    return v.project(window.__windowAnchor);
  });
  near(anchor.x, wheel.pixel.x, 1);
  near(anchor.y, wheel.pixel.y, 1);
  inset(await state());
  check(
    "Actual scroll-wheel zoom remains anchored to geographic point under cursor",
    { before: wheel.pixel, after: anchor },
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  inset(await state());
  await page.setViewportSize({ width: 1920, height: 1200 });
  inset(await state());
  check("Map window follows viewport resize");
  for (const mode of ["globe", "map", "space-time"]) {
    await page.evaluate(
      (mode) => window.__chronoscope.view.setMode(mode),
      mode,
    );
    const s = await state();
    if (mode === "space-time") inset(s);
    else {
      assert.equal(s.floor, null);
      const rect = await page.evaluate(() => {
        const r =
          window.__chronoscope.view.scene.globe.cartographicLimitRectangle;
        return [r.west, r.south, r.east, r.north];
      });
      near(rect[0], -Math.PI, 0.00001);
      near(rect[2], Math.PI, 0.00001);
    }
  }
  check(
    "Globe and 2D remain unconstrained; return to space-time restores floor",
  );
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.fit();
    v.zoom(0.5);
    v.setBearing(32);
  });
  const saved = await state(),
    scene = await page.evaluate(() => window.__chronoscope.captureScene());
  const workspace = path.join(profile, "window.chronoscope");
  await api("save", { path: workspace, scene });
  await api("open", { path: workspace });
  await page.reload();
  await page.waitForFunction((bounds) => {
    const v = window.__chronoscope?.view;
    const b = v?.diagnostics().spaceTimeFloor?.bounds;
    return (
      b &&
      b.every((x, i) => Math.abs(x - bounds[i]) < 1e-5) &&
      !window.__chronoscope.busy
    );
  }, saved.floor.bounds);
  const restored = await state();
  restored.corners.forEach((c, i) => {
    near(c.x, saved.corners[i].x, 0.1);
    near(c.y, saved.corners[i].y, 0.1);
  });
  assert.deepEqual(restored.study, saved.study);
  check("Portable save/reopen restores native camera and derives same floor", {
    before: saved.floor,
    after: restored.floor,
  });
  await page.evaluate(() => {
    const v = window.__chronoscope.view;
    v.onViewportChange = () => {};
    v.onSceneChange = () => {};
    v.fit();
    v.viewer.render();
  });
  await page.waitForTimeout(800);
  const frames = await page.evaluate(
    () => window.__chronoscope.view.diagnostics().performance.renderedFrames,
  );
  await page.waitForTimeout(500);
  const additionalFrames = await page.evaluate(
    (before) =>
      window.__chronoscope.view.diagnostics().performance.renderedFrames -
      before,
    frames,
  );
  const unchanged = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      floor = v.spaceTimeFloor,
      firstLabel = v.axisLabels.get(0);
    for (let i = 0; i < 10; i++) {
      v.requestRender();
      v.viewer.render();
    }
    return v.spaceTimeFloor === floor && v.axisLabels.get(0) === firstLabel;
  });
  assert(
    unchanged,
    "Stationary frames must not rebuild the floor/axes or schedule further renders",
  );
  check("Stationary frames reuse floor/axes in request-render mode", {
    additionalFrames,
  });
  for (const [id, count] of [
    ["local-wildlife", 3439],
    ["elephant-seals", 15501],
    ["animal-gps", 15697],
    ["stork-migration", 6090],
  ]) {
    await page.goto("about:blank");
    await api("demo_open", { id });
    const preferences = await api("preferences");
    await api("preferences", {
      preferences: {
        ...preferences,
        basemap: "none",
        map: { ...preferences.map, enabled: false },
        map_layers: [],
      },
    });
    await api("view_set", {
      mode: "space-time",
      table_open: false,
      inspector_tab: "views",
      display: {
        mode: "points",
        show_points: true,
        show_tracks: true,
        show_trails: false,
        point_scale: 0.4,
        bloom: false,
      },
    });
    await page.goto(url + "/#token=" + token);
    await page.waitForFunction(
      (count) =>
        window.__chronoscope?.snapshot?.count === count &&
        !window.__chronoscope.busy,
      count,
    );
    const title = await page.evaluate(async () => {
      const app = window.__chronoscope;
      await app.filterIdle();
      await app.displayIdle();
      const view = app.view;
      view.fit();
      view.viewer.render();
      for (let i = 0; i < view.axisLabels.length; i++) {
        const label = view.axisLabels.get(i);
        if (label.text !== "TIME / UTC") continue;
        const point = view.project(label.position);
        return {
          y: point.y + label.pixelOffset.y,
          height: view.host.clientHeight,
          events: view.renderPoints.length,
          errors: view.diagnostics().renderErrorCount,
        };
      }
    });
    assert(
      title && title.y >= 8 && title.y < title.height - 8,
      JSON.stringify({ id, title }),
    );
    assert.equal(title.events, count);
    assert.equal(title.errors, 0);
    check(id + " preserves Events and keeps its UTC title visible", title);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
