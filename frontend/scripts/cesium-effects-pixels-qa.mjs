// Native WebGL framebuffer regression: isolate ground effects from evidence and UI.
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  path.join(root, ".qa/effects-pixels/profile");
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS ||
  path.join(root, ".qa/effects-pixels/screenshots");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
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
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) resolve(m[0]);
    });
    setTimeout(() => reject(Error(log)), 15000).unref();
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
    const body = await response.json();
    assert(response.ok, JSON.stringify(body));
    return body.result;
  };
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      theme: "dark",
    },
  });
  const csv = path.join(dir, "density.csv");
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,label\n" +
      Array.from({ length: 3000 }, (_, i) => {
        const group = i % 3,
          angle = ((i % 997) / 997) * 2 * Math.PI;
        return `Group ${group},2026-10-15T${String(10 + Math.floor((i % 120) / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z,${43.24 + group * 0.01 + Math.sin(angle) * 0.004},${-79.98 + group * 0.015 + Math.cos(angle) * 0.004},Synthetic`;
      }).join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  await api("view_set", {
    mode: "map",
    display: {
      mode: "points",
      bloom: false,
      show_points: false,
      show_tracks: false,
      show_trails: false,
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
    viewport: { width: 1800, height: 1100 },
  });
  const errors = [];
  let publicRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const target = route.request().url();
    if (/^https?:/.test(target) && !target.startsWith(url + "/")) {
      publicRequests++;
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 3000 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.ready;
    c.view.onViewportChange = () => {};
    c.view.onSceneChange = () => {};
    await c.restoreScene(c.snapshot.scene);
    c.view.fit();
    window.__effectsCamera = c.view.captureCamera();
  });
  const capture = async (name) => {
    // Give geographic tile requests several actual render frames to settle.
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.__chronoscope.view.viewer.render());
      await page.waitForTimeout(100);
    }
    const data = await page.evaluate(() => {
      const v = window.__chronoscope.view;
      v.requestRender();
      v.viewer.render();
      return v.viewer.canvas.toDataURL();
    });
    fs.writeFileSync(
      path.join(out, name + ".png"),
      Buffer.from(data.split(",")[1], "base64"),
    );
    return PNG.sync.read(fs.readFileSync(path.join(out, name + ".png")));
  };
  const change = async (mode, bloom = false, showPoints = false) => {
    await api("view_set", {
      display: {
        mode,
        bloom,
        show_points: showPoints,
        show_tracks: false,
        show_trails: false,
      },
    });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh();
      await c.restoreScene(c.snapshot.scene);
      c.view.restoreCamera(window.__effectsCamera);
      c.view.axes.show = false;
      c.view.focusLines.show = false;
      c.view.handles.show = false;
      c.view.requestRender();
    });
    if (mode === "heatmap" || bloom)
      await page.waitForFunction(() => {
        const d = window.__chronoscope.view.displayLayer.diagnostics;
        return d.atlasLayers === 1 && !d.pending && !d.error;
      });
  };
  const measure = (a, b, polygon = null) => {
    const contains = (x, y) => {
      if (!polygon) return true;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i],
          [xj, yj] = polygon[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      return inside;
    };
    let n = 0,
      total = 0;
    let left = a.width,
      right = 0,
      top = a.height,
      bottom = 0;
    for (let y = 50; y < a.height - 130; y++)
      for (let x = 80; x < a.width - 80; x++) {
        if (!contains(x, y)) continue;
        const i = (y * a.width + x) * 4;
        let diff = 0;
        for (let c = 0; c < 3; c++)
          diff += Math.abs(a.data[i + c] - b.data[i + c]);
        if (diff > 30) {
          n++;
          total += diff;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    return { changed: n, total, bounds: [left, top, right, bottom] };
  };
  const modes = [];
  for (const sceneMode of ["map", "space-time", "globe"]) {
    await api("view_set", {
      mode: sceneMode,
      display: {
        mode: "points",
        bloom: false,
        show_points: false,
        show_tracks: false,
        show_trails: false,
      },
    });
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.refresh();
      await c.restoreScene(c.snapshot.scene);
      c.view.fit();
      window.__effectsCamera = c.view.captureCamera();
      c.view.axes.show = false;
      c.view.focusLines.show = false;
      c.view.handles.show = false;
    });
    // Warm up the same raster footprint, then compare against an off capture
    // after it is removed; base-map warming cannot masquerade as an effect.
    await change("heatmap");
    await capture(sceneMode + "-warmup");
    await change("points");
    const before = await capture(sceneMode + "-none");
    await change("heatmap");
    const heat = await capture(sceneMode + "-heat");
    await change("points", true);
    const bloom = await capture(sceneMode + "-bloom");
    const camera = await page.evaluate(() =>
      window.__chronoscope.view.captureCamera(),
    );
    const floor = await page.evaluate(() => {
      const v = window.__chronoscope.view,
        b = v.bounds;
      return [
        [b[1], b[0]],
        [b[1], b[2]],
        [b[3], b[2]],
        [b[3], b[0]],
      ].map(([lat, lon]) => {
        const pixel = v.project(v.position(lat, lon, undefined, true));
        return [pixel.x, pixel.y];
      });
    });
    const entry = {
      mode: sceneMode,
      heat: measure(before, heat, floor),
      bloom: measure(before, bloom, floor),
      camera,
      groundPolygon: floor,
    };
    await change("points", true, true);
    const markerState = await page.evaluate(() => {
      const v = window.__chronoscope.view;
      return {
        total: v.points.length,
        shown: [...v.glyphById.values()].filter((g) => g.show).length,
        selected: v.selected.size,
      };
    });
    assert(
      markerState.total > 10 &&
        markerState.shown === markerState.total &&
        markerState.selected === 0,
      `${sceneMode}: bloom must retain unselected Events: ${JSON.stringify(markerState)}`,
    );
    const withEvents = await capture(sceneMode + "-bloom-with-events");
    entry.events = { ...markerState, pixels: measure(bloom, withEvents) };
    assert(
      entry.events.pixels.changed > 20,
      `${sceneMode}: Events must change framebuffer pixels over bloom`,
    );
    const id = await page.evaluate(
      () => window.__chronoscope.view.points[0].id,
    );
    await api("select", { ids: [id] });
    await change("points", true, true);
    assert(
      await page.evaluate(() => {
        const v = window.__chronoscope.view;
        return (
          v.selected.size === 1 &&
          [...v.glyphById.values()].every((g) => g.show)
        );
      }),
      `${sceneMode}: changing selection must not hide unselected Events`,
    );
    await api("select", { ids: [] });
    await change("points", true);
    assert(
      await page.evaluate(() =>
        [...window.__chronoscope.view.glyphById.values()].every((g) => !g.show),
      ),
      `${sceneMode}: Events off must still hide markers`,
    );
    if (sceneMode === "space-time") {
      await page.evaluate(() => {
        const v = window.__chronoscope.view;
        v.timeHeight *= 1.8;
        v.rebuild(true);
        v.restoreCamera(window.__effectsCamera);
        v.axes.show = false;
        v.focusLines.show = false;
        v.handles.show = false;
      });
      await page.waitForFunction(() => {
        const d = window.__chronoscope.view.displayLayer.diagnostics;
        return d.atlasLayers === 1 && !d.pending;
      });
      const taller = await capture(sceneMode + "-bloom-taller");
      entry.heightDifference = measure(bloom, taller, floor);
    }
    modes.push(entry);
    console.log(JSON.stringify(entry));
  }
  const details = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      layer = v.displayLayer.atlas;
    const image = layer?.imageryProvider?._image;
    let atlas = null;
    if (image) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      atlas = canvas.toDataURL();
    }
    return {
      diagnostics: v.displayLayer.diagnostics,
      atlas,
      layerIndex: layer ? v.viewer.imageryLayers.indexOf(layer) : -1,
      layers: Array.from({ length: v.viewer.imageryLayers.length }, (_, i) => {
        const l = v.viewer.imageryLayers.get(i);
        return {
          i,
          alpha: l.alpha,
          show: l.show,
          rectangle: l.imageryProvider.rectangle,
          tiles: l.imageryProvider._image?.width,
        };
      }),
      tilesLoaded: v.scene.globe.tilesLoaded,
      renderedTiles: v.scene.globe._surface._tilesToRender.map((t) => ({
        level: t.level,
        imagery: t.data.imagery.map((i) => ({
          ready: i.readyImagery?.state,
          loading: i.loadingImagery?.state,
          provider:
            i.readyImagery?.imageryLayer?.imageryProvider?.constructor.name,
        })),
      })),
      packetBounds: v.displayLayer.packet.bounds,
    };
  });
  if (details.atlas) {
    fs.writeFileSync(
      path.join(out, "bloom-atlas.png"),
      Buffer.from(details.atlas.split(",")[1], "base64"),
    );
    delete details.atlas;
  }
  await api("view_set", {
    mode: "space-time",
    display: { mode: "points", bloom: false, show_points: true },
  });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh();
    await c.restoreScene(c.snapshot.scene);
    c.view.axes.show = true;
    c.view.focusLines.show = true;
    c.view.handles.show = true;
    c.view.fit();
  });
  const labels = () =>
    page.evaluate(() => {
      const v = window.__chronoscope.view;
      return Array.from(
        { length: v.axisLabels.length },
        (_, i) => v.axisLabels.get(i).text,
      ).filter((t) => t !== "TIME / UTC" && !t.includes("°"));
    });
  await page.waitForFunction(() => {
    const v = window.__chronoscope.view;
    return Array.from(
      { length: v.axisLabels.length },
      (_, i) => v.axisLabels.get(i).text,
    ).some((t) => /^Oct/.test(t));
  });
  const overviewLabels = await labels();
  assert(
    overviewLabels.length > 0 &&
      overviewLabels.every((t) => !/\d{2}:\d{2}/.test(t)),
    "Fit/overview axis must show dates only",
  );
  await capture("time-axis-overview-canvas");
  await page.screenshot({ path: path.join(out, "time-axis-overview.png") });
  // Use the application's navigation transform in Columbus view.
  await page.evaluate(() => window.__chronoscope.view.zoom(6));
  await page.waitForFunction(() => {
    const v = window.__chronoscope.view;
    return Array.from(
      { length: v.axisLabels.length },
      (_, i) => v.axisLabels.get(i).text,
    ).some((t) => /\d{2}:\d{2} UTC/.test(t));
  });
  const detailedLabels = await labels();
  assert(detailedLabels.length > 1 && detailedLabels.length <= 32);
  await capture("time-axis-detail-canvas");
  await page.screenshot({ path: path.join(out, "time-axis-detail.png") });
  const result = {
    overviewLabels,
    detailedLabels,
    modes,
    details,
    errors,
    publicRequests,
  };
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  assert(
    result.modes.every((mode) => mode.heat.changed > 100),
    "Heat map must change actual ground framebuffer pixels",
  );
  assert(
    result.modes.every((mode) => mode.bloom.changed > 100),
    "Bloom must change actual ground framebuffer pixels",
  );
  assert.equal(
    result.modes.find((mode) => mode.mode === "space-time").heightDifference
      .changed,
    0,
    "Changing time height must not move or recolor the ground effect pixels",
  );
  assert.equal(publicRequests, 0);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
}
