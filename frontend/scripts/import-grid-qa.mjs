import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("import-grid", async ({ page, api, out, root, pass }) => {
  const initialPrefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...initialPrefs,
      date_format: "iso",
      time_format: "24h-seconds",
    },
  });
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await page.locator("#welcome-empty").click();
  const source = path.join(out, "ambiguous.csv");
  fs.writeFileSync(
    source,
    "entity,date,latitude,mystery,value,description\nA,03/04/2026,40,-70,2,Foraging\nB,04/05/2026,41,-71,3,Travelling\n",
  );
  const open = async (file) => {
    page.once("dialog", (d) => d.accept(file));
    await page.locator("#open").click();
    await page.locator("#review-import").waitFor();
  };
  const state = (key, value) =>
    page.waitForFunction(
      ([key, value]) =>
        document
          .querySelector(`[data-field="${key}"]`)
          ?.getAttribute("data-state") === value &&
        !document
          .querySelector("#import-validation-summary")
          ?.textContent.includes("Checking"),
      [key, value],
    );
  const mapping = (key) => page.locator(`[data-map="${key}"]`);
  await open(source);
  assert.equal(
    await page.locator(".workflow-steps, #import-next, #import-back").count(),
    0,
  );
  assert.equal(
    await page
      .locator(".import-field-grid")
      .first()
      .locator("[data-field]")
      .count(),
    8,
  );
  await state("time", "invalid");
  await state("lat", "valid");
  await state("lon", "invalid");
  await state("value", "valid");
  await state("end", "optional");
  assert.match(
    await page.locator('[data-field="time"] [data-feedback]').innerText(),
    /Ambiguous/,
  );
  assert.equal((await api("snapshot")).count, 0);
  await page.screenshot({ path: path.join(out, "grid-attention-dark.png") });
  pass(
    "One scrollable field grid opens immediately with independent green, red and optional feedback; no workspace changes",
  );

  await page.locator("#date-order").selectOption("dmy");
  await mapping("lon").selectOption("3");
  await state("time", "valid");
  await state("lon", "valid");
  await page.waitForFunction(() =>
    document
      .querySelector("#normalized-preview")
      ?.textContent.includes("2026-04-03"),
  );
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  await mapping("value").selectOption("5");
  await state("value", "invalid");
  assert.match(
    await page.locator('[data-field="value"] [data-feedback]').innerText(),
    /Invalid number/,
  );
  await mapping("value").selectOption("4");
  await state("value", "valid");
  pass(
    "Live date-order, longitude and numeric corrections update field shading and converted UTC sample",
  );

  // An older response must not repaint the corrected mapping as invalid.
  let releaseOld, capturedOld, oldDone;
  const held = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const captured = new Promise((resolve) => {
    capturedOld = resolve;
  });
  const done = new Promise((resolve) => {
    oldDone = resolve;
  });
  const delayOld = async (route) => {
    const request = route.request().postDataJSON();
    if (
      request?.command !== "import_validate" ||
      request.args.mapping.value !== 5
    )
      return route.fallback();
    const response = await route.fetch();
    capturedOld();
    await held;
    await route.fulfill({ response });
    oldDone();
  };
  await page.route("**/api/invoke", delayOld);
  await mapping("value").selectOption("5");
  await captured;
  await mapping("value").selectOption("4");
  await state("value", "valid");
  releaseOld();
  await done;
  await page.unroute("**/api/invoke", delayOld);
  await state("value", "valid");
  assert.equal(await mapping("value").inputValue(), "4");
  pass(
    "Delayed validation responses cannot overwrite newer field selections or feedback",
  );

  await page.locator("#review-import").click();
  await page.waitForFunction(
    () => !document.querySelector("#commit-import")?.disabled,
  );
  assert.equal((await api("snapshot")).count, 0);
  await mapping("label").selectOption("0");
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  assert.equal(await page.locator(".import-quality").count(), 0);
  await page.locator("#review-import").click();
  await page.waitForFunction(
    () => !document.querySelector("#commit-import")?.disabled,
  );
  await state("label", "valid");
  await page.locator("#commit-import").click();
  await page.locator("#import-dialog").waitFor({ state: "detached" });
  assert.equal((await api("snapshot")).count, 2);
  pass(
    "Full-file check and import stay in the same window; mapping edits immediately invalidate the previous check",
  );

  await open(source);
  await mapping("time").selectOption("");
  await state("time", "invalid");
  assert.equal(await page.locator("#review-import").isDisabled(), true);
  await mapping("lat").selectOption("");
  await state("lat", "optional");
  await state("lon", "optional");
  assert.equal(await page.locator("#commit-import").isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal((await api("snapshot")).count, 2);
  pass(
    "Missing required timestamps disable the full check; leaving both location columns unmapped stays optional; Escape preserves data",
  );

  // Exercise switching between real workbook sheets without losing either draft.
  const workbook = path.join(root, "tests/fixtures/import/small-study.xlsx");
  await open(workbook);
  const options = await page.locator("#import-sheet option").count();
  assert(options > 1, "fixture must have multiple worksheets");
  const initialEntity = await mapping("entity").inputValue();
  await mapping("entity").selectOption("");
  await page.locator("#import-sheet").selectOption("1");
  await page.locator("#import-sheet").selectOption("0");
  assert.equal(await mapping("entity").inputValue(), "");
  await mapping("entity").selectOption(initialEntity);
  await page.keyboard.press("Escape");
  pass("Workbook sheet changes preserve separate mapping drafts");

  const prefs = await api("preferences");
  await api("preferences", { preferences: { ...prefs, theme: "light" } });
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await open(source);
  await state("time", "invalid");
  await page.screenshot({ path: path.join(out, "grid-attention-light.png") });
  for (const width of [960, 600, 360]) {
    await page.setViewportSize({ width, height: 820 });
    const fit = await page.locator("#import-dialog").evaluate((dialog) => {
      const body = dialog.querySelector("#import-body"),
        footer = dialog.querySelector("footer");
      const bounds = dialog.getBoundingClientRect(),
        footerBounds = footer.getBoundingClientRect();
      return {
        fits:
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight,
        horizontal: body.scrollWidth <= body.clientWidth + 1,
        footer: footerBounds.bottom <= bounds.bottom,
        outer: dialog.scrollHeight <= dialog.clientHeight + 1,
      };
    });
    assert.deepEqual(fit, {
      fits: true,
      bodyScrolls: true,
      horizontal: true,
      footer: true,
      outer: true,
    });
  }
  await page.screenshot({ path: path.join(out, "grid-compact-light.png") });
  await page.keyboard.press("Escape");
  pass(
    "Light/dark shading, compact layout and single body scrolling keep footer actions visible without horizontal overflow",
  );

  const delimited = path.join(out, "semicolon.csv");
  fs.writeFileSync(delimited, "entity;timestamp;value\nA;2026-01-01;2\n");
  await page.setViewportSize({ width: 1440, height: 960 });
  await open(delimited);
  await page.locator("#append-import").check();
  await page.locator("#import-delimiter").selectOption(";");
  await page.waitForFunction(
    () =>
      document.querySelector("#import-delimiter")?.value === ";" &&
      document.querySelectorAll("#import-sheet option").length > 0,
  );
  assert.equal(await page.locator("#append-import").isChecked(), true);
  await state("time", "valid");
  await page.locator("#review-import").click();
  await page.waitForFunction(
    () => !document.querySelector("#commit-import")?.disabled,
  );
  await page.locator("#commit-import").click();
  await page.locator("#import-dialog").waitFor({ state: "detached" });
  assert.equal((await api("snapshot")).count, 3);
  pass(
    "Delimiter changes reopen the same single-window interface while preserving append mode; append retains existing Events",
  );
});
