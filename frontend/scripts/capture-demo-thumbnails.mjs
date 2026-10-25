// Regenerate the shipped thumbnails from the real offline demo hero views.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { withLocalApp, root } from "./local-browser.mjs";
const images = [];
for (const id of [
  "hurricanes",
  "noaa-ais",
  "animal-gps",
  "local-wildlife",
  "stork-migration",
  "elephant-seals",
])
  await withLocalApp(
    `demo-thumbnails-${id}`,
    async ({ page, api, root, pass }) => {
      const dest = path.join(root, "frontend/public/demos");
      fs.mkdirSync(dest, { recursive: true });
      const { demos } = await api("demo_catalog");

      for (const demo of demos.filter((d) => d.id === id)) {
        for (const [index, mode] of [
          [0, "time"],
          [1, "map"],
        ]) {
          const result = await page.evaluate(
            async ({ id, index }) => {
              const c = window.__chronoscope;
              await c.call("demo_open", { id });
              const restored = await c.call("restore_view", { index });
              await c.restoreScene({ ...restored.scene, expanded: true });
              return { scene: c.captureScene(), count: c.snapshot.count };
            },
            { id: demo.id, index },
          );
          // Wait for geometry refinement and tile texture upload before export.
          await page.waitForTimeout(750);
          const png = await page.evaluate(async () => {
            const v = window.__chronoscope.view;
            const data = await v.screenshot();
            // The app export has a credit footer; the picker carries credits in its source disclosure.
            const image = new Image();
            image.src = data;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 480;
            canvas.height = 300;
            canvas
              .getContext("2d")
              .drawImage(
                image,
                0,
                0,
                v.viewer.canvas.width,
                v.viewer.canvas.height,
                0,
                0,
                480,
                300,
              );
            return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
          });
          const file = `${demo.id}-${mode}.jpg`,
            bytes = Buffer.from(png, "base64");
          fs.writeFileSync(path.join(dest, file), bytes);
          images.push({
            file,
            demo: demo.id,
            source_url: demo.source_url,
            license: demo.license,
            saved_view_index: index,
            events: result.count,
            scene: result.scene,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
          pass(file);
        }
      }
    },
  );

fs.writeFileSync(
  path.join(root, "frontend/public/demos/manifest.json"),
  JSON.stringify(
    {
      renderer: "CesiumJS",
      basemap: "Bundled Natural Earth, public domain",
      capture: "Actual saved demo hero views, rendered offline",
      images,
    },
    null,
    2,
  ) + "\n",
);
