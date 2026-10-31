// Capture the catalog's actual saved scenes, including year filters and legends.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { withLocalApp } from "./local-browser.mjs";
const manifestPath = new URL("../public/demos/manifest.json", import.meta.url);
const streetDemos = new Set(["noaa-ais", "animal-gps", "local-wildlife", "london-crime", "kabr-uav"]);
const requested = process.env.CHRONOSCOPE_DEMO_IDS?.split(",");
const images = requested
  ? JSON.parse(fs.readFileSync(manifestPath)).images.filter(
      (image) => !requested.includes(image.demo),
    )
  : [];
await withLocalApp("demo-thumbnails", async ({ page, api, root, pass }) => {
  await page.setViewportSize({ width: 900, height: 650 });
  const dest = path.join(root, "frontend/public/demos");
  fs.mkdirSync(dest, { recursive: true });
  const { demos } = await api("demo_catalog");
  for (const demo of demos.filter(
    (demo) => !requested || requested.includes(demo.id),
  )) {
    // Restore each scene on one editable copy, including large bundled demos.
    await page.evaluate(async (id) => {
      await window.__chronoscope.call("demo_open", { id });
    }, demo.id);
    const streets = streetDemos.has(demo.id);
    const prefs = await api("preferences");
    await api("preferences", { preferences: { ...prefs, basemap: streets ? "streets" : "none" } });
    await api("wmts_access", { settings: { offline: false, concurrency: 4, request_interval_ms: 0 } });
    // Load London streets beneath the density view before capturing its heat overlay.
    const capturePreviews = demo.id === "london-crime" ? [...demo.previews].reverse() : demo.previews;
    for (const preview of capturePreviews) {
      const result = await page.evaluate(
        async ({ index }) => {
          const c = window.__chronoscope;
          const restored = await c.call("restore_view", { index });
          await c.restoreScene({ ...restored.scene, expanded: true });
          return {
            scene: c.captureScene(),
            count: c.snapshot.count,
            visible: c.snapshot.visible,
            filter: c.snapshot.filter,
          };
        },
        { index: preview.view_index },
      );
      await page.waitForFunction(
        () =>
          !window.__chronoscope.busy &&
          !window.__chronoscope.view.displayLayer.updating,
        null,
        { polling: 100 },
      );
      if (streets) {
        await page.waitForFunction(() => {
          const v = window.__chronoscope.view, s = v.resources.status;
          return s.basemapError || (s.basemap === "streets" && s.basemapRenderedTiles > 0 && s.basemapPending === 0 && v.scene.globe.tilesLoaded);
        }, null, {timeout: 180000});
        const status = await page.evaluate(() => window.__chronoscope.view.resources.status);
        assert.equal(status.basemapError, "", demo.id + ": " + JSON.stringify(status));
        assert(status.basemapRenderedTiles > 0, demo.id + ": no Streets imagery");
      }
      await page.waitForTimeout(900);
      await page.evaluate((streets) => {
        document.querySelector("#thumbnail-credits")?.remove();
        if (!streets) return;
        const credit = document.createElement("div"); credit.id = "thumbnail-credits";
        credit.textContent = "OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors";
        credit.style.cssText = "position:absolute;bottom:2px;right:4px;z-index:100;font:10px sans-serif;background:#ffffffdf;color:#222;padding:2px 4px;pointer-events:none";
        document.querySelector("#scene").append(credit);
      }, streets);

      const file = `${demo.id}-${preview.key}.jpg`;
      // Capture the app surface, so the fixed measurement legend remains visible.
      const surface = await page.locator("#scene").screenshot({ type: "png" });
      const encoded = await page.evaluate(async (base64) => {
        const source = new Image();
        source.src = "data:image/png;base64," + base64;
        await source.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 300;
        const context = canvas.getContext("2d");
        context.fillStyle = "#101722";
        context.fillRect(0, 0, 480, 300);
        const scale = Math.min(480 / source.width, 300 / source.height);
        const width = source.width * scale,
          height = source.height * scale;
        context.drawImage(
          source,
          (480 - width) / 2,
          (300 - height) / 2,
          width,
          height,
        );
        return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
      }, surface.toString("base64"));
      const bytes = Buffer.from(encoded, "base64");
      fs.writeFileSync(path.join(dest, file), bytes);
      const state = await page.evaluate(() => ({
        ...window.__chronoscope.view.diagnostics(),
        geometryLimited: window.__chronoscope.view.geometryLimited,
      }));
      assert(!state.geometryLimited, `${demo.id}: truncated geometry`);
      images.push({
        file,
        demo: demo.id,
        basemap: streets ? "streets" : "natural-earth",
        map_attribution: streets ? ["OpenFreeMap", "© OpenMapTiles", "© OpenStreetMap contributors"] : ["Natural Earth · public domain"],
        source_url: demo.source_url,
        license: demo.license,
        saved_view_index: preview.view_index,
        events: result.count,
        visible: result.visible,
        scene: result.scene,
        filter: result.filter,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      pass(file);
    }
  }
  fs.writeFileSync(
    path.join(dest, "manifest.json"),
    JSON.stringify(
      {
        renderer: "CesiumJS",
        basemap: "Per-image basemap and map_attribution; older entries use Natural Earth, public domain",
        capture:
          "Actual saved demo scenes and filters; Streets imagery verified before capture; legends and map credits included",
        images,
      },
      null,
      2,
    ) + "\n",
  );
});
