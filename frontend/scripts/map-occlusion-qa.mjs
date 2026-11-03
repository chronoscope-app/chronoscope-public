import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import { withLocalApp } from "./local-browser.mjs";
const hits = [];
const png = new PNG({ width: 256, height: 256 });
for (let i = 0; i < png.data.length; i += 4)
  png.data.set([80, 120, 170, 255], i);
const opaque = PNG.sync.write(png);
for (let i = 3; i < png.data.length; i += 4) png.data[i] = 128;
const transparent = PNG.sync.write(png);
const server = createServer((req, res) => {
  if (req.url.includes("/caps")) {
    const source = req.url.split("/")[1];
    res.setHeader("Content-Type", "application/xml");
    res.end(
      `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1"><Contents>${["base", "top", "holes"].map((id) => `<Layer><ows:Title>${id}</ows:Title><ows:Identifier>${id}</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>grid</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="http://127.0.0.1:${server.address().port}/${source}/${id}/{TileRow}/{TileCol}"/></Layer>`).join("")}<TileMatrixSet><ows:Identifier>grid</ows:Identifier><ows:SupportedCRS>EPSG:3857</ows:SupportedCRS><TileMatrix><ows:Identifier>world</ows:Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`,
    );
  } else {
    hits.push(req.url);
    res.setHeader("Content-Type", "image/png");
    res.end(req.url.includes("/holes/") ? transparent : opaque);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  await withLocalApp(
    "map-occlusion",
    async ({ page, api, pass }) => {
      const jobs = [];
      page.on("request", (request) => {
        if (!request.url().endsWith("/api/invoke") || !request.postData())
          return;
        const body = JSON.parse(request.postData());
        if (
          body.command === "job_start" &&
          body.args.command === "wmts_rasters"
        )
          jobs.push(body.args.arguments.config);
      });
      const config = (source) => ({
        url: `http://127.0.0.1:${server.address().port}/${source}/caps`,
        layer: "base",
        matrix_set: "grid",
        format: "image/png",
        style: "default",
        time: "",
        enabled: true,
        level: 0,
      });
      await api("wmts_servers", {
        settings: {
          servers: [
            { id: "a", name: "First server", config: config("a") },
            { id: "b", name: "Second server", config: config("b") },
          ],
        },
      });
      await page.click("#settings");
      await page.click("#preferences-tab-maps");
      await page.click("#custom-map-server");
      await page.selectOption("#wmts-server", "a");
      await page.click("#inspect-wmts");
      await page.locator('[data-wmts-select="base"]').waitFor();
      await page.locator('[data-wmts-select="base"]').check();
      await page.locator('[data-wmts-select="top"]').check();
      await page.selectOption("#wmts-server", "b");
      await page.locator('[data-wmts-select="top"]').waitFor();
      await page.locator('[data-wmts-select="top"]').check();
      assert.match(
        await page.locator("#wmts-selected-count").textContent(),
        /3 layers/,
      );
      await page.click("#add-map-layer");
      await page.locator("#map-stack-list").waitFor();
      const stack = (await api("preferences")).map_layers;
      assert.equal(stack.length, 3);
      assert.deepEqual(
        stack.map((l) => l.server_name),
        ["First server", "First server", "Second server"],
      );
      assert(
        hits.some((url) => url.startsWith("/b/top/")),
        "Upper map must load",
      );
      assert(
        !hits.some((url) => url.startsWith("/a/")),
        "Opaque upper map must prevent all lower server imagery requests",
      );
      pass(
        "Three layers selected across two servers; only the upper opaque source requests imagery",
      );
      // Partial opacity must reveal an underlying map rather than dropping it.
      stack[2].opacity = 0.5;
      await api("preferences", { preferences: { map_layers: stack } });
      await page.evaluate(async () => {
        await window.__chronoscope.refresh();
        await window.__chronoscope.loadRasters();
      });
      assert(
        hits.some((url) => url.startsWith("/a/top/")),
        "Translucent upper imagery needs a lower map",
      );
      assert(
        !hits.some((url) => url.startsWith("/a/base/")),
        "An opaque middle map still hides the bottom source",
      );
      pass(
        "Translucent imagery loads the next underlying map while skipping the fully covered bottom source",
      );
      stack[2].opacity = 1;
      stack[2].config.layer = "holes";
      jobs.length = 0;
      await api("preferences", { preferences: { map_layers: stack } });
      await page.evaluate(async () => {
        await window.__chronoscope.refresh();
        await window.__chronoscope.loadRasters();
      });
      assert(
        jobs.some((config) => config.layer === "holes"),
        "Transparent PNG must load",
      );
      assert(
        jobs.some(
          (config) => config.url.includes("/a/") && config.layer === "top",
        ),
        "Transparent pixels must retain the underlying source even at 100% configured opacity",
      );
      assert(
        !jobs.some((config) => config.layer === "base"),
        "Opaque middle imagery hides the bottom map",
      );
      pass(
        "Actual transparent image pixels preserve lower imagery at full configured opacity",
      );
      stack[2].config.enabled = false;
      stack[1].config.enabled = false;
      await api("preferences", { preferences: { map_layers: stack } });
      await page.evaluate(async () => {
        await window.__chronoscope.refresh();
        await window.__chronoscope.loadRasters();
      });
      assert(
        hits.some((url) => url.startsWith("/a/base/")),
        "Disabling upper maps must expose and request the lower source",
      );
      pass("Unchecking upper layers makes the lower source load");
    },
    { demo: true },
  );
} finally {
  server.close();
}
