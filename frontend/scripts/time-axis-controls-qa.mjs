import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("time-axis-controls", async ({ page, api, out, root, pass }) => {
  const ready = () =>
    page.evaluate(async () => {
      await window.__chronoscope.ready;
      await window.__chronoscope.refresh(true, false);
      await window.__chronoscope.sceneIdle();
    });
  const setScene = async (args) => {
    await api("view_set", args);
    const state = await api("snapshot");
    await page.evaluate(
      async (s) => window.__chronoscope.restoreScene(s.scene, s.revision),
      state,
    );
  };
  await ready();
  assert.equal(await page.locator(".time-rail-tick").count(), 0);
  pass("An empty workspace has no invented epoch/date ruler");
  const csv = path.join(out, "month-gutter.csv");
  fs.writeFileSync(
    csv,
    "entity,timestamp,latitude,longitude,altitude_m,altitude_reference\n" +
      ["2018-08-01", "2018-08-16", "2018-09-01", "2018-09-16", "2018-10-01"]
        .map(
          (d, i) => `A,${d},${40 + i},${-10 + i},${1000 + i * 100},ellipsoid`,
        )
        .join("\n"),
  );
  const preview = await api("import_preview", { path: csv });
  await api("import_commit", { import_id: preview.import_id });
  await setScene({ mode: "space-time", time_altitude: false });
  await ready();
  await page.waitForFunction(
    () => document.querySelectorAll(".time-rail-tick").length >= 4,
  );
  const inspect = () =>
    page.evaluate(() => {
      const rail = document.querySelector("#time-rail").getBoundingClientRect();
      const ruler = document
        .querySelector("#time-range-track")
        .getBoundingClientRect();
      const scene = document.querySelector("#scene").getBoundingClientRect();
      const ticks = [...document.querySelectorAll(".time-rail-tick")].map(
        (e) => {
          const r = e.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(e.querySelector(".time-tick-day"));
          return {
            text: e.innerText,
            level: e.classList.contains("is-year")
              ? "year"
              : e.classList.contains("is-month")
                ? "month"
                : "date",
            time: Number(e.dataset.time),
            x: r.x,
            right: r.right,
            y: r.y,
            bottom: r.bottom,
            labelRight: text.getBoundingClientRect().right,
            font: getComputedStyle(e.querySelector(".time-tick-day")).fontSize,
          };
        },
      );
      return {
        width: rail.width,
        right: rail.right,
        sceneX: scene.x,
        rulerTop: ruler.top,
        rulerHeight: ruler.height,
        ticks,
        header: document.querySelector(".time-rail-date-heading").innerText,
        diagnostics: window.__chronoscope.view.diagnostics(),
        gripLeft: document
          .querySelector(".time-range-grip")
          .getBoundingClientRect().left,
      };
    });
  const original = await inspect();
  assert.equal(original.width, 64);
  assert(Math.abs(original.right - original.sceneX) < 1);
  assert(original.header.includes("2018") && original.header.includes("UTC"));
  assert.deepEqual(
    original.ticks
      .filter((t) => /[A-Z]/.test(t.text))
      .map((t) => t.text.split("\n")[0]),
    ["AUG", "SEP", "OCT"],
  );
  for (const t of original.ticks)
    assert(t.right <= original.right && t.font === "10px");
  assert.equal(original.diagnostics.axisLabels, 0);
  assert.equal(original.diagnostics.axisGrabHandle, 0);
  pass(
    "One 64px month/day gutter replaces the floating date axis; year and UTC are named once",
  );

  for (const action of [
    { action: "zoom", factor: 0.7 },
    {
      action: "look_at",
      center: [-5, 42, 0],
      distance_m: 2000000,
      heading_degrees: 40,
      tilt_degrees: 15,
    },
  ]) {
    await page.evaluate(
      (a) => window.__chronoscope.liveViewRequest("view_navigate", a),
      action,
    );
    await ready();
    assert.deepEqual((await inspect()).ticks, original.ticks);
  }
  await api("filter", {
    filter: {
      start: Date.parse("2018-08-16Z") / 1000,
      end: Date.parse("2018-09-16Z") / 1000,
    },
  });
  await ready();
  assert.deepEqual((await inspect()).ticks, original.ticks);
  pass(
    "Camera navigation and filtering preserve the calendar ruler's exact labels, font size and screen positions",
  );
  await page.click("#collapse-time-rail");
  assert.equal(
    await page
      .locator("#time-rail")
      .evaluate((e) => e.getBoundingClientRect().width),
    24,
  );
  await page.click("#collapse-time-rail");
  await page.waitForFunction(
    () => document.querySelectorAll(".time-rail-tick").length >= 4,
  );
  assert.deepEqual((await inspect()).ticks, original.ticks);

  for (const size of [
    { width: 1000, height: 650 },
    { width: 1440, height: 960 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForFunction(
      () => document.querySelector("#time-rail-labels").children.length >= 2,
    );
    await page.waitForTimeout(100);
    const s = await inspect();
    assert.equal(s.width, 64);
    assert(
      s.ticks.every(
        (t) =>
          t.font === "10px" &&
          t.y >= s.rulerTop - 24 &&
          t.bottom <= s.rulerTop + s.rulerHeight + 24,
      ),
    );
    for (let i = 1; i < s.ticks.length; i++)
      assert(s.ticks[i].y >= s.ticks[i - 1].bottom);
  }
  const p = await api("preferences");
  await api("preferences", { preferences: { ...p, theme: "light" } });
  await page.reload();
  await ready();
  await page.screenshot({ path: path.join(out, "grouped-months-light.png") });
  await api("preferences", { preferences: { ...p, theme: "dark" } });
  await page.reload();
  await ready();
  await page.screenshot({ path: path.join(out, "grouped-months-dark.png") });
  pass(
    "Collapse, window resizing and both themes preserve readable, non-overlapping labels inside the rail",
  );

  for (const mode of ["map", "globe", "space-time"]) {
    await setScene({ mode });
    await ready();
    assert.equal((await inspect()).diagnostics.axisLabels, 0);
    assert((await inspect()).ticks.length >= 4);
  }
  await setScene({ mode: "space-time", time_altitude: true });
  await ready();
  assert((await inspect()).diagnostics.axisLabels > 0);
  assert((await inspect()).diagnostics.physicalAltitude);
  await setScene({ mode: "space-time", time_altitude: false });
  await ready();
  assert.equal((await inspect()).diagnostics.axisLabels, 0);
  pass(
    "Map, Globe and Time share the UTC gutter; physical altitude retains a separate metre axis",
  );

  const workspace = path.join(out, "grouped-months.chronoscope");
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  scene.time_axis_anchor = [0.9, 0.2];
  await api("save", { path: workspace, scene });
  await api("open", { path: workspace });
  await page.reload();
  await ready();
  await page.waitForFunction(
    () => document.querySelectorAll(".time-rail-tick").length >= 4,
  );
  const restored = await inspect();
  assert.equal(restored.diagnostics.axisLabels, 0);
  assert.equal(restored.diagnostics.renderErrorCount, 0);
  pass(
    "Workspace reopening and legacy axis-position settings cannot restore the retired floating date axis",
  );
  await api("wmts_access", { settings: { offline: true } });
  for (const id of ["hurricanes", "hurricanes-short"]) {
    if (id === "hurricanes-short")
      await api("open", {
        path: path.join(root, "samples/atlantic-hurricanes-2021-2025-tracks.chronoscope"),
      });
    else await api("demo_open", { id });
    const prefs = await api("preferences");
    await api("preferences", {
      preferences: {
        ...prefs,
        basemap: "none",
        map: { ...prefs.map, enabled: false },
        map_layers: [],
        terrain_path: null,
        terrain_builtin: false,
      },
    });
    await setScene({ mode: "space-time", time_altitude: false });
    await ready();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForTimeout(100);
    const normal = await inspect();
    assert(normal.ticks.filter((t) => t.level === "year").length >= 3);
    if (id === "hurricanes-short")
      assert(
        normal.ticks.some((t) => t.level === "month" && t.text.includes("JUL")),
      );
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.waitForTimeout(100);
    const tall = await inspect();
    assert(tall.ticks.length > normal.ticks.length);
    assert(
      tall.ticks.some((t) => t.level === "month" && t.text.includes("JUL")),
    );
    for (let i = 1; i < tall.ticks.length; i++)
      assert(tall.ticks[i].y >= tall.ticks[i - 1].bottom);
    assert.equal(tall.width, 64);
    assert(
      tall.ticks
        .filter((t) => t.level === "year")
        .every((t) => t.labelRight < tall.gripLeft),
      `Year labels must stay outside the window drag-grip lane: ${JSON.stringify({ grip: tall.gripLeft, labels: tall.ticks.filter((t) => t.level === "year").map((t) => ({ text: t.text, right: t.labelRight })) })}`,
    );
    await page.screenshot({
      path: path.join(out, `${id}-year-month-gutter.png`),
    });
  }
  pass(
    "Both real hurricane studies use year landmarks and fill available height with month subdivisions without widening or overlap",
  );
});
