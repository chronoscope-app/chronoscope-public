import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp(
  "navigation-table-cleanup",
  async ({ page, api, out, pass }) => {
    const refresh = () => page.evaluate(() => window.__chronoscope.refresh());
    const rows = () =>
      page
        .locator("#table-body [data-event]")
        .evaluateAll((rs) => rs.map((r) => r.dataset.event));
    const expectRows = async (ids) =>
      page.waitForFunction((ids) => {
        const actual = Array.from(
          document.querySelectorAll("#table-body [data-event]"),
          (r) => r.dataset.event,
        ).sort();
        return JSON.stringify(actual) === JSON.stringify([...ids].sort());
      }, ids);
    const all = (await api("query", { limit: 20, sort_by: "time" })).events;
    const selected = [all[0].id, all[5].id, all[12].id];
    await api("select", { ids: selected, mode: "replace" });
    await refresh();
    await page.evaluate(() => window.__chronoscope.openAttributes(null));
    await page.waitForSelector("#table-body [data-event]");
    const global = (await api("snapshot")).filter;
    assert.match(
      await page.locator("#table-all").getAttribute("data-tooltip"),
      /all imported event layers/i,
    );
    assert.match(
      await page
        .locator("#table-tabs [aria-selected=true]")
        .getAttribute("data-tooltip"),
      /all imported event layers/i,
    );
    await page.locator("#table-selected-only").check();
    await expectRows(selected);
    assert.deepEqual((await api("snapshot")).filter, global);
    pass(
      "Show selected restricts the table without changing workspace filters; All sources has explanatory tooltips",
    );
    const bodyRows = page.locator("#table-body [data-event]");
    await bodyRows.first().click();
    // Restoring separated selections then Shift-click must not include hidden intervening records.
    await api("select", { ids: selected, mode: "replace" });
    await refresh();
    await expectRows(selected);
    await bodyRows.last().click({ modifiers: ["Shift"] });
    assert.equal((await api("snapshot")).selected_count, 3);
    pass("Shift selection remains inside the selected-only table scope");
    await api("select", { ids: [], mode: "replace" });
    await refresh();
    await expectRows([]);
    assert(await page.locator("#table-selected-only").isChecked());
    await api("select", { ids: [all[3].id, all[8].id], mode: "replace" });
    await refresh();
    await expectRows([all[3].id, all[8].id]);
    pass(
      "Selected table updates when selection changes, including empty selections",
    );
    await page.locator("#table-search").fill(all[3].entity);
    const searched = await api("query", {
      selected_only: true,
      table_search: all[3].entity,
    });
    await expectRows(searched.events.map((e) => e.id));
    await page.locator("#table-search").fill("");
    await expectRows([all[3].id, all[8].id]);
    const source = (await api("snapshot")).layers[0].source;
    await api("filter", { filter: { hidden_sources: [source] } });
    await refresh();
    await expectRows([]);
    await page.locator("#table-respect-filters").uncheck();
    await expectRows([all[3].id, all[8].id]);
    pass("Show selected intersects search and optional workspace filters");
    await api("filter", { filter: {} });
    await refresh();
    await page.screenshot({ path: path.join(out, "selected-table.png") });
    await page.locator("#table-tabs [role=tab]").first().hover();
    await page.waitForSelector("#control-tooltip:not([hidden])");
    assert.match(
      await page.locator("#control-tooltip").innerText(),
      /all imported event layers/i,
    );
    const detached = page.waitForEvent("popup");
    await page.click("#table-popout");
    const popup = await detached;
    await popup.waitForFunction(
      () => document.querySelector("#table-selected-only")?.checked,
    );
    await popup.waitForFunction(
      () => document.querySelectorAll("#table-body [data-event]").length === 2,
    );
    await popup.click("#table-popout");
    await page.waitForSelector("#table-panel.open");
    assert(await page.locator("#table-selected-only").isChecked());
    await expectRows([all[3].id, all[8].id]);
    pass(
      "Selected-only tab state survives detaching and docking; the All sources tooltip is visible",
    );

    // Close the tab group before navigation so the canvas has its full height.
    await page.locator("#table-tabs [data-close-tab]").first().click();
    for (const mode of ["space-time", "globe"]) {
      await page.click(`[data-view="${mode}"]`);
      await page.waitForFunction(
        (mode) =>
          window.__chronoscope.view.mode === mode && !window.__chronoscope.busy,
        mode,
      );
      await page.waitForFunction(() => document.querySelector('#navigate').dataset.tooltip.includes('middle-drag rotates horizontally'));
      await page.evaluate(() => {
        const v = window.__chronoscope.view;
        v.fit();
        v.setTilt(45);
        v.setBearing(15);
      });
      await page.waitForTimeout(150);
      const rect = await page.locator(".cesium-widget canvas").boundingBox();
      const start = {
        x: rect.x + rect.width * 0.4,
        y: rect.y + rect.height * 0.4,
      };
      const pivot = await page.evaluate(() => {
        const v = window.__chronoscope.view,
          p = v.centerGround();
        return {
          target: { x: p.x, y: p.y, z: p.z },
          pixel: v.project(p),
          tilt: v.tilt(),
        };
      });
      for (const button of ["right", "middle"]) {
        for (let repeat = 0; repeat < 4; repeat++) {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down({ button });
          await page.mouse.move(start.x + 350, start.y, { steps: 20 });
          await page.mouse.up({ button });
          await page.waitForTimeout(70);
          const after = await page.evaluate((target) => {
            const v = window.__chronoscope.view;
            return {
              pixel: v.project(target),
              tilt: v.tilt(),
              bearing: v.bearing(),
            };
          }, pivot.target);
          const drift = Math.hypot(
            after.pixel.x - pivot.pixel.x,
            after.pixel.y - pivot.pixel.y,
          );
          assert(drift < 0.5, `${mode} ${button} fixed pivot drift ${drift}px`);
          assert(
            Math.abs(after.tilt - pivot.tilt) < 0.02,
            `${mode} ${button} horizontal drag retains tilt`,
          );
        }
        pass(
          `${mode} ${button}: repeated horizontal rotations retain their axis within half a pixel`,
        );
      }
      await page.screenshot({ path: path.join(out, `${mode}-rotation.png`) });
    }
    const catalog = await api("demo_catalog");
    assert.equal(catalog.demos.length, 13);
    assert(!catalog.demos.some((d) => /madagascar|uav/i.test(d.id)));
    pass("Synthetic UAV demo is absent from the 13-demo catalog");
  },
  { demo: true },
);
