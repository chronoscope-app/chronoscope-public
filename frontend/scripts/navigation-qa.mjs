import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust bridge and actual mouse/keyboard input. No public map requests.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/navigation"),
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
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
let browser;
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const p = await api("preferences");
  await api("preferences", {
    preferences: {
      ...p,
      theme: "light",
      map: { ...p.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  const state = () =>
    page.evaluate(() => {
      const c = window.__chronoscope,
        v = c.view;
      return {
        camera: v.captureCamera().cesium_camera,
        bearing: v.bearing(),
        tilt: v.tilt(),
        height: v.camera.positionCartographic.height,
        width: v.captureCamera().cesium_camera.frustum_width,
        selected: [...c.snapshot.selected].sort(),
        rendererSelected: [...v.selected].sort(),
        selectedCount: c.snapshot.selected_count,
        nav: v.diagnostics().navigation,
        timeHeight: v.timeHeight,
        time: [v.lo, v.hi],
        filter: c.snapshot.filter,
      };
    });
  const selectionUnchanged = async (ids, label) => {
    // view.selected is intentionally only the selected evidence in the
    // current render packet. Verify the full selection in the engine, then
    // require every currently represented selected event to be highlighted.
    await page.waitForFunction(async (ids) => {
      const c = window.__chronoscope,
        v = c.view;
      const backend = await c.call("snapshot", {
        compact: true,
        selection_limit: 1000000,
      });
      const expected = new Set(ids);
      return (
        backend.selected_count === ids.length &&
        backend.selected.length === ids.length &&
        backend.selected.every((id) => expected.has(id)) &&
        c.snapshot.selected_count === ids.length &&
        [...v.selected].every((id) => expected.has(id)) &&
        [...v.points, ...v.geometryFeatures].every(
          (p) => !expected.has(p.id) || v.selected.has(p.id),
        )
      );
    }, ids);
    const backend = await api("snapshot", {
      compact: true,
      selection_limit: 1000000,
    });
    assert.deepEqual([...backend.selected].sort(), [...ids].sort(), label);
  };
  const changed = (a, b) =>
    JSON.stringify(a.camera) !== JSON.stringify(b.camera);
  const sameCamera = (actual, expected, label = "camera unchanged") => {
    for (const key of ["position", "direction", "up"])
      assert(
        Math.hypot(
          ...actual[key].map((x, i) => {
            // Cesium recomputes 2D camera depth when updating an orthographic
            // view. Its visible framing is XY + orientation + frustum width.
            if (
              key === "position" &&
              i === 2 &&
              actual.frustum_width !== undefined &&
              expected.frustum_width !== undefined
            )
              return 0;
            return x - expected[key][i];
          }),
        ) < (key === "position" ? 1e-5 : 1e-10),
        `${label} ${key}: ${JSON.stringify({ actual: actual[key], expected: expected[key] })}`,
      );
    if (actual.frustum_width !== undefined)
      assert(
        Math.abs(actual.frustum_width - expected.frustum_width) < 1e-5,
        label + " frustum",
      );
  };
  const metric = (s) => s.width ?? s.height;
  const fit = async () => {
    await page.evaluate(() => window.__chronoscope.view.fit());
    await page.waitForTimeout(80);
  };
  const canvas = page.locator(".cesium-widget canvas");
  const location = async () => {
    const r = await canvas.boundingBox();
    return {
      x: Math.round(r.x + r.width * 0.57),
      y: Math.round(r.y + r.height * 0.52),
    };
  };
  const drag = async (button, dx, dy, modifier) => {
    const p = await location();
    await page.mouse.move(p.x, p.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down({ button });
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 });
    await page.mouse.up({ button });
    if (modifier) await page.keyboard.up(modifier);
    await page.waitForTimeout(70);
  };
  const wheel = async (dy, modifier) => {
    const p = await location();
    await page.mouse.move(p.x, p.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.wheel(0, dy);
    if (modifier) await page.keyboard.up(modifier);
    await page.waitForTimeout(70);
  };
  const invariant = (a, b) => {
    assert.deepEqual(b.time, a.time);
    assert.equal(b.timeHeight, a.timeHeight);
    assert.deepEqual(b.filter, a.filter);
  };
  for (const mode of ["globe", "space-time", "map"]) {
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction(
      (m) => window.__chronoscope.view.mode === m && !window.__chronoscope.busy,
      mode,
    );
    await fit();
    const initial = await state();
    assert.equal(initial.nav.inertia, false);
    assert.equal(initial.nav.freeLook, false);
    await drag("left", 45, 15);
    let next = await state();
    assert(changed(initial, next), mode + " left drag");
    invariant(initial, next);
    const stopped = await state();
    await page.waitForTimeout(250);
    sameCamera(
      (await state()).camera,
      stopped.camera,
      mode + " no left-drag inertia",
    );
    await fit();
    const orbitBefore = await state();
    await drag("middle", 55, -35);
    const orbit = await state();
    if (mode === "map")
      sameCamera(orbit.camera, orbitBefore.camera, "2D middle drag ignored");
    else {
      assert(changed(orbitBefore, orbit), mode + " middle orbit");
      assert(orbit.tilt <= 85.001);
      assert(Math.abs(orbit.bearing - orbitBefore.bearing) > 1);
    }
    const orbitStopped = await state();
    await page.waitForTimeout(200);
    sameCamera(
      (await state()).camera,
      orbitStopped.camera,
      mode + " no middle-drag inertia",
    );
    await fit();
    const z = await state();
    await drag("right", 0, 55);
    const zoomed = await state();
    assert(metric(zoomed) < metric(z), mode + " right drag zoom");
    assert(
      Math.hypot(
        ...zoomed.camera.direction.map((n, i) => n - z.camera.direction[i]),
      ) < 1e-10,
      mode + " no automatic tilt",
    );
    await fit();
    const p = await location();
    await page.mouse.move(p.x, p.y);
    const anchor = await page.evaluate(({ x, y }) => {
      const v = window.__chronoscope.view,
        r = v.viewer.canvas.getBoundingClientRect(),
        p = v.groundAt({ x: x - r.left, y: y - r.top });
      return p && [p.x, p.y, p.z];
    }, p);
    assert(anchor, mode + " has ground anchor");
    const wheelBefore = await state();
    await wheel(-150);
    const zoomWheel = await state();
    assert(metric(zoomWheel) < metric(wheelBefore), mode + " wheel zoom");
    const anchorError = await page.evaluate(
      ({ anchor, p }) => {
        const v = window.__chronoscope.view,
          r = v.viewer.canvas.getBoundingClientRect();
        const projected = v.scene.cartesianToCanvasCoordinates({
          x: anchor[0],
          y: anchor[1],
          z: anchor[2],
        });
        return Math.hypot(
          projected.x - (p.x - r.left),
          projected.y - (p.y - r.top),
        );
      },
      { anchor, p },
    );
    assert(anchorError < 0.1, mode + " zoom anchor pixel error " + anchorError);
    await fit();
    const normalBefore = await state();
    await wheel(-100);
    const normal = Math.abs(
      Math.log(metric(await state()) / metric(normalBefore)),
    );
    await fit();
    const fineBefore = await state();
    await wheel(-100, "Alt");
    const fine = Math.abs(Math.log(metric(await state()) / metric(fineBefore)));
    assert(fine > 0 && fine < normal * 0.5, mode + " fine zoom");
    await fit();
    const modBefore = await state();
    await wheel(100, "Shift");
    const tilted = await state();
    await wheel(100, "Control");
    const rotated = await state();
    if (mode === "map")
      sameCamera(
        rotated.camera,
        modBefore.camera,
        "2D modifier wheels ignored",
      );
    else {
      assert(tilted.tilt > modBefore.tilt);
      assert(Math.abs(rotated.bearing - tilted.bearing) > 1);
    }
    await fit();
    await drag("left", 35, -25, "Shift");
    const shift = await state();
    if (mode !== "map")
      assert(
        shift.tilt <= 85.001 && shift.tilt > 0,
        mode + " Shift-drag constrained orbit",
      );
    await fit();
    const ids = await page.evaluate(() =>
      window.__chronoscope.view.points.slice(0, 2).map((p) => p.id),
    );
    await api("select", { ids });
    await page.evaluate(() => window.__chronoscope.refresh(false));
    const selectedBefore = await state();
    assert.deepEqual(selectedBefore.selected, [...ids].sort());
    const d = await location();
    await page.mouse.dblclick(d.x, d.y);
    await page.waitForTimeout(350);
    await selectionUnchanged(
      ids,
      mode + " double-click preserves the full engine selection",
    );
    let afterDouble = await state();
    assert(
      metric(afterDouble) < metric(selectedBefore),
      mode + " double-click zoom in",
    );
    assert.deepEqual(
      afterDouble.selected,
      selectedBefore.selected,
      mode + " double-click preserves selection",
    );
    await page.mouse.click(d.x, d.y, { button: "right", clickCount: 2 });
    await page.waitForTimeout(80);
    await selectionUnchanged(
      ids,
      mode + " right double-click preserves selection",
    );
    const rightDouble = await state();
    assert(
      metric(rightDouble) > metric(afterDouble),
      mode + " right double-click zoom out",
    );
    assert.deepEqual(rightDouble.selected, selectedBefore.selected);
    await canvas.focus();
    const keyBefore = await state();
    await page.keyboard.press("ArrowRight");
    const keyAfter = await state();
    assert(changed(keyBefore, keyAfter), mode + " keyboard pan");
    await page.keyboard.press("PageUp");
    assert(metric(await state()) < metric(keyAfter), mode + " PageUp zoom");
    if (mode !== "map") {
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("n");
      assert(Math.abs((await state()).bearing) < 0.01);
      await page.keyboard.press("u");
      assert((await state()).tilt < 0.01);
      const h = (await state()).height;
      await page.keyboard.press("Shift+PageUp");
      assert((await state()).height > h);
      await page.keyboard.press("r");
    }
    await page.locator("#search").focus();
    const field = await state();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("n");
    sameCamera(
      (await state()).camera,
      field.camera,
      mode + " field keys do not navigate",
    );
    await page.locator("#search").fill("");
    await fit();
    const e = await location();
    await page.mouse.move(e.x, e.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(e.x, e.y + 20, { steps: 3 });
    await page.keyboard.press("Escape");
    const escaped = await state();
    await page.mouse.move(e.x, e.y + 70, { steps: 3 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(80);
    sameCamera(
      (await state()).camera,
      escaped.camera,
      mode + " Escape stops held drag",
    );
    assert.deepEqual(
      (await state()).selected,
      selectedBefore.selected,
      mode + " Escape did not clear selection",
    );
    await selectionUnchanged(
      ids,
      mode + " keyboard/Escape preserves selection",
    );
    const final = await state();
    invariant(initial, final);
    assert(final.height >= 2, mode + " camera above floor");
    if (mode === "map") {
      assert.equal(final.tilt, 0);
      assert(
        Math.min(final.bearing, 360 - final.bearing) < 0.01,
        "Map remains north-facing after Fit",
      );
    }
    assert.equal(
      (await page.evaluate(() => window.__chronoscope.view.diagnostics()))
        .renderErrorCount,
      0,
    );
    check(
      mode +
        " mouse, wheel modifiers, double-click, keyboard focus, selection, immediate stop and bounds",
      {
        anchorErrorPixels: anchorError,
        fineZoomRatio: fine / normal,
        navigation: final.nav,
      },
    );
  }
  await page.click('[data-view="map"]');
  // Prepared navigation intentionally retains the complete eligible pool.
  // Exercise the original off-screen-selection rollback in the canonical
  // renderer, where viewport culling can actually omit those selected rows.
  await page.locator('#vfx-smooth-playback').setChecked(false);
  await page.evaluate(()=>window.__chronoscope.sceneIdle());
  await page.waitForFunction(()=>!window.__chronoscope.view.residentPlaybackActive);
  await fit();
  // Reproduce the actual slow-double-click bug with off-screen selections.
  const preserved = ["1", "2"];
  await api("select", { ids: preserved });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  const centre = await location();
  for (let i = 0; i < 4; i++) {
    await page.mouse.dblclick(centre.x, centre.y);
    await page.waitForTimeout(350);
    await selectionUnchanged(
      preserved,
      "fast Map zoom preserves complete selection",
    );
    if ((await state()).rendererSelected.length < preserved.length) break;
  }
  assert(
    (await state()).rendererSelected.length < preserved.length,
    "fixture must cull selected evidence",
  );
  for (const delay of [300, 750]) {
    const before = await state();
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(delay);
    const interim = await api("snapshot", { compact: true });
    assert(
      interim.selected_count < 2,
      "the first click must have committed before rollback",
    );
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(350);
    await selectionUnchanged(
      preserved,
      "slow Map double-click restores off-screen selections",
    );
    assert(
      metric(await state()) < metric(before),
      "slow double-click still zooms",
    );
  }
  await fit();
  await page.waitForFunction((ids) => {
    const v = window.__chronoscope.view;
    return ids.every(
      (id) => v.points.some((p) => p.id === id) && v.selected.has(id),
    );
  }, preserved);
  await selectionUnchanged(
    preserved,
    "zooming back restores selected highlights",
  );
  assert.deepEqual((await state()).rendererSelected, preserved);
  check(
    "Map fast and slow double-clicks preserve off-screen selections and restore visible highlights",
    { delaysMs: [300, 750] },
  );
  const exported = await api("export", {
    path: path.join(out, "double-click-selected.csv"),
    selected_only: true,
    overwrite: true,
  });
  assert.equal(
    exported.exported,
    2,
    "selected-only export uses the complete preserved selection",
  );
  const query = await api("query", {
    filter: { selected_only: true },
    apply_filter: false,
    limit: 1000,
  });
  assert.deepEqual(query.events.map((e) => e.id).sort(), preserved);
  check(
    "Selected-only query and CSV export retain both off-screen and on-screen selections",
  );
  await api("select", { ids: [] });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  const picks = await page.evaluate(async () => {
    const v = window.__chronoscope.view,
      r = v.viewer.canvas.getBoundingClientRect(),
      found = [];
    v.requestRender();
    await new Promise(requestAnimationFrame);
    v.viewer.render();
    for (const p of v.points) {
      const q = v.projectEvent(p.id);
      if (
        !q ||
        q.x < 20 ||
        q.y < 60 ||
        q.x > r.width - 100 ||
        q.y > r.height - 100
      )
        continue;
      const hit = v.scene.pick(q)?.id;
      if (
        hit?.kind !== "event" ||
        found.some(
          (f) => Math.hypot(f.x - (q.x + r.left), f.y - (q.y + r.top)) < 20,
        )
      )
        continue;
      found.push({
        id: hit.id,
        x: Math.round(q.x + r.left),
        y: Math.round(q.y + r.top),
      });
      if (found.length === 2) break;
    }
    return found;
  });
  assert.equal(picks.length, 2, "two real rendered events can be picked");
  await page.mouse.click(picks[0].x, picks[0].y);
  await page.keyboard.down("Shift");
  await page.mouse.click(picks[1].x, picks[1].y);
  await page.keyboard.up("Shift");
  await page.waitForFunction(
    (ids) =>
      ids.every((id) => window.__chronoscope.view.selected.has(id)) &&
      window.__chronoscope.snapshot.selected_count === 2,
    picks.map((p) => p.id),
  );
  check("Rapid additive map clicks retain both exact records", {
    ids: picks.map((p) => p.id),
  });
  const savedSelection = (await state()).selected;
  await page.mouse.click(picks[0].x, picks[0].y);
  await page.waitForTimeout(320);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(350);
  assert.deepEqual((await state()).selected, savedSelection);
  check("Slower double-click restores selection after initial click feedback");
  await fit();
  await page.mouse.click(picks[0].x, picks[0].y);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  assert.equal((await state()).selected.length, 0);
  check("Escape cancels delayed picking without reselecting a record");
  for (const m of ["globe", "space-time", "map"]) {
    await page.click(`[data-view="${m}"]`);
    await fit();
    const before = await state();
    await page.evaluate(() => {
      const v = window.__chronoscope.view;
      for (let i = 0; i < 8; i++) v.zoom(20);
    });
    const near = await state();
    assert(near.height >= 1.99, m + " close zoom stays above floor");
    await page.evaluate(() => {
      const v = window.__chronoscope.view;
      for (let i = 0; i < 10; i++) v.zoom(0.05);
    });
    const far = await state();
    assert(Object.values(far.camera).flat().every(Number.isFinite));
    assert(far.height <= 8e7 + 0.01);
    invariant(before, far);
    if (m !== "map") {
      await fit();
      await wheel(10000, "Shift");
      assert((await state()).tilt <= 85.001);
      await wheel(-10000, "Shift");
      assert((await state()).tilt < 0.01);
    }
  }
  check(
    "Extreme zoom/tilt remains bounded and never changes event time or Time height",
  );
  await page.click('[data-view="space-time"]');
  await fit();
  // Selection mode retains additive boxes; these never turn into Shift-orbit.
  await api("select", { ids: [] });
  await page.evaluate(() => window.__chronoscope.refresh(false));
  await page.click("#box-select");
  const beforeBox = await state();
  await drag("left", 80, 60, "Shift");
  sameCamera((await state()).camera, beforeBox.camera);
  await page.click("#navigate");
  check("Select mode keeps Shift-drag box selection and camera position");
  await canvas.focus();
  await page.keyboard.press("o");
  await page.waitForFunction(() => window.__chronoscope.view.mode === "globe");
  await canvas.focus();
  await page.keyboard.press("o");
  await page.waitForFunction(() => window.__chronoscope.view.mode === "map");
  check("Focused O switches Globe/2D");
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() =>
    document.querySelector("#play").textContent.includes("Pause"),
  );
  await page.keyboard.press("Space");
  await page.waitForFunction(() =>
    document.querySelector("#play").textContent.includes("Play"),
  );
  check("Space retains timeline play/pause");
  await page.click("#toggle-table");
  await page.locator("#tables-menu [data-table-layer-source]").first().click();
  await page.waitForSelector("#table-body [data-event]");
  await page.locator("#table-body [data-event]").first().click();
  const tableCamera = await state();
  await page.keyboard.press("Shift+ArrowDown");
  await page.waitForFunction(
    () => window.__chronoscope.snapshot.selected_count === 2,
  );
  sameCamera((await state()).camera, tableCamera.camera);
  check("Table Shift+Down selects rows without camera navigation");
  await page.click("#close-table");
  await page.click('[data-view="map"]');
  await fit();
  const apiZoomBefore = await state();
  await page.evaluate(() =>
    window.__chronoscope.liveViewRequest("view_navigate", {
      action: "zoom",
      factor: 4,
    }),
  );
  assert(Math.abs(metric(apiZoomBefore) / metric(await state()) - 4) < 1e-6);
  check("Shared CLI/MCP view adapter retains full zoom factor semantics");
  await page.screenshot({ path: path.join(out, "navigation-final.png") });
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (error) {
  report.failure = error.stack || String(error);
  throw error;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
  fs.rmSync(tokenFile, { force: true });
}
