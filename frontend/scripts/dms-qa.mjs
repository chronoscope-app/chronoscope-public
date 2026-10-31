import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("dms", async ({ page, api, out, pass }) => {
  await page.locator("#welcome-empty").click();
  const source = path.join(out, "dms.csv");
  fs.writeFileSync(source, 'entity,time,latitude_dms,longitude_dms\nDMS sample,2026-10-31T12:00:00Z,40°44′54″N,73°59′6″W\n');
  page.once("dialog", d => d.accept(source));
  await page.locator("#open").click();
  await page.locator("#review-import").waitFor();
  assert.equal(await page.locator("#import-crs").inputValue(), "dms");
  for (const key of ["lat", "lon"]) {
    await page.waitForFunction(key => document.querySelector(`[data-field="${key}"]`)?.dataset.state === "valid", key);
  }
  await page.locator("#review-import").click();
  await page.waitForFunction(() => !document.querySelector("#commit-import")?.disabled);
  await page.locator("#commit-import").click();
  await page.locator("#import-dialog").waitFor({ state: "detached" });
  assert.equal((await api("snapshot")).count, 1);
  pass("DMS CSV detection, field feedback, full validation and import");
  await page.locator("#settings").click();
  await page.locator("#pref-coordinates").selectOption("dms");
  await page.locator("#save-preferences").click();
  await page.locator(".preferences-dialog").waitFor({ state: "detached" });
  assert.equal((await api("preferences")).coordinates,"dms");
  await page.click('[data-view="map"]');
  await page.waitForFunction(() => window.__chronoscope.view.mode === "map" && !window.__chronoscope.busy);
  const canvas = page.locator("#scene canvas").first();
  await canvas.focus();
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  const event = await page.evaluate(() => {
    const v=window.__chronoscope.view, r=v.viewer.canvas.getBoundingClientRect();
    for (const p of v.points) {
      const pixel=v.project(v.pos(p));
      if (pixel && v.pickId(pixel.x,pixel.y)?.kind === "event") return {x:r.left+pixel.x,y:r.top+pixel.y};
    }
  });
  assert(event);
  await page.mouse.click(event.x,event.y,{button:"right"});
  await page.waitForFunction(() => document.querySelector("#inspector-content")?.textContent.includes("40°44′54.000″N"));
  assert.match(await page.locator("#inspector-content").innerText(),/73°59′06.000″W/);
  await page.screenshot({path:path.join(out,"dms-properties.png")});
  pass("DMS preference and event properties use hemisphere-formatted DMS");
  const ground=await page.evaluate(() => {
    const v=window.__chronoscope.view,r=v.viewer.canvas.getBoundingClientRect();
    for(let y=40;y<r.height-40;y+=40) for(let x=40;x<r.width-40;x+=40)
      if(!v.pickId(x,y) && v.groundAt({x,y})) return {x:r.left+x,y:r.top+y};
  });
  assert(ground);
  await page.mouse.click(ground.x,ground.y,{button:"right"});
  await page.waitForFunction(() => document.querySelector("#radius-coordinates")?.textContent.includes("DMS"));
  assert.match(await page.locator("#radius-coordinates").innerText(),/°\d{2}′\d{2}\.\d{3}″[NS]/);
  await page.screenshot({path:path.join(out,"dms-radius-dialog.png")});
  await page.keyboard.press("Escape");
  await page.locator("#settings").click();
  assert.equal(await page.locator("#pref-coordinates").inputValue(),"dms");
  pass("Radius dialog shows DMS alongside other formats; saved preference survives reopening");
});
