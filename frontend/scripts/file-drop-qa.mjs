import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("file-drop", async ({ page, api, out, root, pass }) => {
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/invoke") && response.status() >= 400)
      console.log("API", await response.text());
  });
  await page.evaluate(async () => {
    await window.__chronoscope.ready;
    await window.__chronoscope.sceneIdle();
  });
  const first = path.join(out, "first.csv"),
    second = path.join(out, "second.csv");
  fs.writeFileSync(
    first,
    "timestamp,entity,latitude,longitude\n2026-01-01T00:00:00Z,A,40,-74\n2026-01-02T00:00:00Z,A,41,-73\n",
  );
  fs.writeFileSync(
    second,
    "timestamp,entity,latitude,longitude\n2026-01-03T00:00:00Z,B,42,-72\n2026-01-04T00:00:00Z,B,43,-71\n",
  );
  const drop = async (paths) => {
    console.log("Drop", paths.map((p) => path.basename(p)).join(", "));
    await page.evaluate(
      (paths) =>
        Promise.race([
          window.__chronoscope.dropFiles(paths),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Error(
                    "Drop timeout: " +
                      document.querySelector("#import-dialog")?.textContent +
                      " / " +
                      [...document.querySelectorAll(".toast")]
                        .map((e) => e.textContent)
                        .join("; "),
                  ),
                ),
              15000,
            ),
          ),
        ]),
      paths,
    );
    console.log("Drop ready");
  };
  const close = async () => {
    await page.locator("#import-dialog [data-close]").click();
    await page.locator("#import-dialog").waitFor({ state: "detached" });
  };
  const commit = async () => {
    await page.locator("#review-import").click();
    await page.locator("#commit-import:not(:disabled)").waitFor();
    await page.locator("#commit-import").click();
  };
  await drop([first, second, first]);
  assert.equal(await page.locator("#import-file-select option").count(), 2);
  await page.locator("#import-advanced summary").click();
  await page.locator("#default-entity").fill("Remember my draft");
  await page.locator("#import-file-next").click();
  await page.locator("#import-file-select").selectOption("0");
  await page.locator("#default-entity").waitFor({ state: "attached" });
  assert.equal(
    await page.locator("#default-entity").inputValue(),
    "Remember my draft",
  );
  assert.equal(await page.locator("#append-import").isChecked(), true);
  await page.screenshot({ path: path.join(out, "multiple-file-import.png") });
  await close();
  assert.equal((await api("snapshot")).count, 0);
  pass(
    "Multiple drops deduplicate paths; paging preserves mapping drafts; closing before import changes no Events",
  );

  await drop([first, second]);
  await commit();
  await page.waitForFunction(
    () =>
      document.querySelector("#import-file-select")?.value === "1" &&
      !!document.querySelector("#review-import"),
    null,
    { timeout: 10000 },
  );
  assert.equal(await page.locator("#append-import").isChecked(), true);
  await commit();
  await page
    .getByText("All dropped files have been handled.", { exact: false })
    .waitFor();
  assert.equal((await api("snapshot")).count, 4);
  await page.locator("#import-file-previous").click();
  assert.equal(await page.locator("#commit-import").count(), 0);
  assert.match(await page.locator("#import-dialog").innerText(), /Imported/);
  await close();
  pass(
    "Each reviewed CSV imports exactly once; the second appends without replacing the first; completed pages cannot duplicate Events",
  );

  const gis = (name) => path.join(root, "tests/fixtures/gis", name);
  await drop([
    gis("events.geojson"),
    gis("timed-zones.kml"),
    gis("box/Box.glb"),
  ]);
  assert.equal(
    (await api("gis_layers")).layers.length,
    1,
    "Display-only models load immediately",
  );
  await page.locator("#import-file-events").waitFor();
  assert(
    (await page.locator("#import-dialog").boundingBox()).height < 600,
    "GIS choice uses a compact modal",
  );
  await page.screenshot({ path: path.join(out, "gis-import-or-display.png") });
  await page.locator("#import-file-display").click();
  await page.waitForFunction(
    () => document.querySelector("#import-file-select")?.value === "1",
  );
  assert.equal((await api("gis_layers")).layers.length, 2);
  await page.locator("#import-file-previous").click();
  assert.equal(await page.locator("#import-file-display").count(), 0);
  await page.locator("#import-file-next").click();
  await page.locator("#import-file-events").click();
  await page.locator("#review-import").waitFor();
  assert.equal(
    await page.locator("#import-file-display").count(),
    1,
    "Display remains available inside full mapping form",
  );
  await commit();
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 5 && !window.__chronoscope.busy,
  );
  assert.equal((await api("gis_layers")).layers.length, 2);
  await close();
  pass(
    "Mixed drop: model displays immediately, GeoJSON adds a reference layer, KML imports as Events through the same modal",
  );

  const bad = path.join(out, "broken.json");
  fs.writeFileSync(bad, "broken");
  await drop([bad, first]);
  await page
    .getByRole("alert")
    .filter({ hasText: /Invalid JSON/ })
    .waitFor();
  await page.locator("#import-file-next").click();
  await page.locator("#review-import").waitFor();
  await close();
  assert.equal((await api("snapshot")).count, 5);
  await drop([gis("events.geojson")]);
  await page.locator("#import-file-events").click();
  await page.locator("#review-import").waitFor();
  await page.locator("#import-file-display").click();
  await page
    .getByText("All dropped files have been handled.", { exact: false })
    .waitFor();
  await close();
  assert.equal((await api("snapshot")).count, 5);
  assert.equal((await api("gis_layers")).layers.length, 3);
  pass(
    "A malformed file does not block later pages; reference display is also available after opening Event mapping",
  );

  await drop([
    gis("vector/events.shp"),
    gis("vector/events.dbf"),
    gis("vector/events.shx"),
    gis("vector/events.prj"),
  ]);
  await page.locator("#import-file-display").click();
  await page
    .getByText("All dropped files have been handled.", { exact: false })
    .waitFor();
  assert.equal((await api("gis_layers")).layers.length, 4);
  assert.match(
    await page.locator("#import-file-select").innerText(),
    /Companion file/,
  );
  await close();
  pass(
    "Shapefile companions are collected with their layer rather than imported as separate files",
  );

  const workspace = path.join(out, "dropped.chronoscope");
  await api("save", { path: workspace });
  await drop([workspace, first]);
  await page
    .getByRole("alert")
    .filter({ hasText: /Workspace files open separately/ })
    .waitFor();
  await page.locator("#import-file-next").click();
  await page.locator("#review-import").waitFor();
  await close();
  await page.setViewportSize({ width: 1000, height: 700 });
  await drop([first, second]);
  const box = await page.locator("#import-dialog").boundingBox();
  assert(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 1001 &&
      box.y + box.height <= 701,
  );
  await page.locator("#review-import").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "compact-file-import.png") });
  await close();
  pass(
    "Mixed workspace drops cannot replace the dataset; import modal remains usable at the minimum window size",
  );
});
