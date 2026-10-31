import assert from "node:assert/strict";
import path from "node:path";
import { withLocalApp } from "./local-browser.mjs";

await withLocalApp("release-updates", async ({ page, out, pass }) => {
  const release = (tag, extra = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: true,
    published_at: "2026-10-31T12:00:00Z",
    ...extra,
  });
  let mode = "new",
    gets = 0,
    delayed;
  await page.route("https://api.github.com/**", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "accept,x-github-api-version",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    gets++;
    assert.equal(
      route.request().url(),
      "https://api.github.com/repos/chronoscope-app/chronoscope-public/releases?per_page=20",
    );
    assert(!route.request().headers().authorization);
    if (mode === "delay")
      await new Promise((resolve) => {
        delayed = resolve;
      });
    await route.fulfill({
      status: mode === "error" ? 403 : 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify(
        mode === "old"
          ? [release("v0.16.9")]
          : [
              release("v0.16.13", { html_url: "https://evil.invalid" }),
              release("v99.0.0", { draft: true }),
              release("tester-20261022"),
            ],
      ),
    });
  });
  await page.evaluate(() => {
    window.__openedReleases = [];
    window.open = (...args) => {
      window.__openedReleases.push(args);
      return null;
    };
  });
  await page.locator("#help").click();
  await page.locator("#check-updates").click();
  await page
    .getByRole("heading", { name: "Update available", exact: true })
    .waitFor();
  assert.match(await page.locator('.modal [role="status"]').innerText(), /0\.16\.13/);
  assert.match(await page.locator('.modal [role="status"]').innerText(), /0\.16\.12/);
  await page.locator("#updates-release").click();
  assert.equal(
    await page.evaluate(() => window.__openedReleases[0][0]),
    "https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.13",
  );
  await page.screenshot({ path: path.join(out, "update-available.png") });
  pass(
    "Help checks GitHub directly, accepts a published preview, ignores drafts and opens the trusted release page",
  );
  await page.keyboard.press("Escape");
  await page.locator("#notifications").click();
  await page
    .getByRole("heading", {
      name: "Chronoscope 0.16.13 is available",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .locator('.notification-card[data-notification-id="release:0.16.13"]')
      .count(),
    1,
  );
  await page.screenshot({ path: path.join(out, "release-notification.png") });
  await page.keyboard.press("Escape");
  const checked = gets;
  await page.evaluate(() => window.__chronoscope.releaseUpdates.start());
  assert.equal(gets, checked);
  pass(
    "A new version appears in Notifications and automatic checking reuses the daily cache",
  );
  mode = "old";
  await page.locator("#help").click();
  await page.locator("#check-updates").click();
  await page
    .getByRole("heading", { name: "No newer release", exact: true })
    .waitFor();
  assert.match(
    await page.locator('.modal [role="status"]').innerText(),
    /Latest published release: 0\.16\.9/,
  );
  assert(await page.locator(".notification-badge").isHidden());
  pass(
    "A development build ahead of Public never advertises an older release as an update",
  );
  mode = "error";
  await page.locator("#updates-retry").click();
  await page
    .getByRole("heading", { name: "Couldn’t check for updates", exact: true })
    .waitFor();
  assert.match(await page.locator('.modal [role="status"]').innerText(), /limiting/);
  pass("GitHub rate limiting is shown as a check failure with a retry action");
  mode = "delay";
  await page.locator("#updates-retry").click();
  await page.waitForFunction(() =>
    document
      .querySelector('.modal [role="status"]')
      ?.textContent.includes("Checking GitHub"),
  );
  await page.keyboard.press("Escape");
  await page.locator("#help").click();
  while (!delayed) await new Promise((resolve) => setTimeout(resolve, 10));
  delayed();
  await page.waitForTimeout(300);
  assert.equal(
    await page.getByRole("heading", { name: "Help", exact: true }).count(),
    1,
  );
  pass(
    "A late response cannot reopen a closed update dialog or replace another dialog",
  );
  await page.keyboard.press("Escape");
  await page.locator("#settings").click();
  await page.locator("#pref-updates").uncheck();
  await page.locator("#save-preferences").click();
  await page.waitForFunction(
    () => !window.__chronoscope.releaseUpdates.automatic,
  );
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  assert.equal(
    await page.evaluate(() => window.__chronoscope.releaseUpdates.automatic),
    false,
  );
  await page.locator("#settings").click();
  assert(!(await page.locator("#pref-updates").isChecked()));
  await page.locator("#pref-updates").check();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => window.__chronoscope.releaseUpdates.automatic),
    false,
  );
  pass(
    "Automatic-check preferences survive reload and cancelling Preferences keeps the saved value",
  );
});
