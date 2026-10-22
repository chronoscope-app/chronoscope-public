import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/notifications"),
);
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/release/chronoscope");
fs.mkdirSync(out, { recursive: true });
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log("PASS", name);
};
let browser;
const servers = [];
async function checkpoint(dir, autoSave) {
  fs.mkdirSync(dir, { recursive: true });
  const p = spawn(cli, ["--data-dir", dir, "--demo-data", "session"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  servers.push(p);
  const lines = createInterface({ input: p.stdout })[Symbol.asyncIterator]();
  p.stdin.write(JSON.stringify({ command: "preferences", args: {} }) + "\n");
  const defaults = JSON.parse((await lines.next()).value).result;
  for (const [command, args] of [
    [
      "preferences",
      {
        preferences: {
          ...defaults,
          auto_save_unsaved: autoSave,
          map: { ...defaults.map, enabled: false },
          basemap: "none",
          map_layers: [],
        },
      },
    ],
    ["edit", { id: "1", changes: { note: "notification recovery fixture" } }],
    ["recovery_checkpoint", {}],
  ]) {
    p.stdin.write(JSON.stringify({ command, args }) + "\n");
    const r = JSON.parse((await lines.next()).value);
    assert(r.ok, JSON.stringify(r));
  }
  p.kill("SIGKILL");
  await new Promise((resolve) => p.once("exit", resolve));
}
async function bridge(dir) {
  const token = randomBytes(32).toString("hex"),
    tokenFile = path.join(dir, "qa-token");
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  const p = spawn(
    cli,
    [
      "--data-dir",
      dir,
      "--demo-data",
      "serve",
      "--listen",
      "127.0.0.1:0",
      "--token-file",
      tokenFile,
      "--frontend",
      path.join(root, "frontend/dist"),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  servers.push(p);
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
    p.once("error", reject);
    p.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
  });
  const api = async (command, args = {}) => {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const r = await response.json();
    assert(response.ok, JSON.stringify(r));
    return r.result;
  };
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", (d) => {
    report.errors.push("Unexpected startup dialog: " + d.message());
    void d.dismiss();
  });
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  return { page, api, url, token };
}
try {
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const unit = await browser.newPage();
  await unit.setContent(
    '<button id="bell" aria-controls="notifications-panel"><span class="notification-badge" hidden></span></button><button id="outside">Outside</button>',
  );
  await unit.addScriptTag({
    type: "module",
    content:
      ts.transpileModule(
        fs.readFileSync(
          path.join(root, "frontend/src/notifications.ts"),
          "utf8",
        ),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        },
      ).outputText + "\nwindow.NotificationCenter = NotificationCenter;",
  });
  await unit.evaluate(() => {
    window.center = new window.NotificationCenter(
      document.querySelector("#bell"),
      "×",
    );
    window.center.replace("future", [
      {
        id: "future",
        source: "future",
        severity: "info",
        title: '<img src=x onerror="window.injected=true">',
        message: "Future notification",
        actions: [
          {
            label: "Try action",
            run: () => {
              throw Error("Try again");
            },
          },
        ],
      },
    ]);
  });
  assert.equal(
    await unit.locator("#bell").getAttribute("aria-label"),
    "Notifications, 1 unread",
  );
  await unit.click("#bell");
  assert.equal(
    await unit.locator("#bell").getAttribute("aria-label"),
    "Notifications",
  );
  assert.equal(await unit.locator(".notification-card img").count(), 0);
  await unit.getByRole("button", { name: "Try action" }).click();
  await unit.getByRole("status").filter({ hasText: "Try again" }).waitFor();
  await unit.getByRole("button", { name: "Dismiss", exact: true }).click();
  await unit.evaluate(() =>
    window.center.replace("future", [
      {
        id: "future",
        source: "future",
        severity: "info",
        title: '<img src=x onerror="window.injected=true">',
        message: "Future notification",
      },
    ]),
  );
  assert.equal(await unit.locator(".notification-card").count(), 0);
  await unit.evaluate(() =>
    window.center.replace("second", [
      {
        id: "second",
        source: "second",
        title: "Another source",
        message: "Ready",
      },
    ]),
  );
  assert.equal(await unit.locator(".notification-card").count(), 1);
  await unit.click("#outside");
  assert(await unit.locator("#notifications-panel").isHidden());
  await unit.evaluate(() =>
    window.center.replace("closed-error", [
      {
        id: "closed-error",
        source: "closed-error",
        title: "Action test",
        message: "A failed action stays available",
        actions: [
          {
            label: "Fail after close",
            run: () => {
              window.center.close();
              throw Error("Closed action failed");
            },
          },
        ],
      },
    ]),
  );
  await unit.click("#bell");
  await unit.getByRole("button", { name: "Fail after close" }).click();
  assert(await unit.locator("#notifications-panel").isHidden());
  assert.equal(
    await unit.locator("#bell").getAttribute("aria-label"),
    "Notifications, 1 unread",
  );
  check(
    "Reusable notifications deduplicate, track unread state, preserve dismissals, escape text and display action errors",
  );
  await unit.close();

  const manual = path.join(out, "manual");
  await checkpoint(manual, false);
  const { page, api, url, token } = await bridge(manual);
  const pending = await api("recovery_list");
  assert.equal(pending.checkpoints.length, 1);
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#notifications")?.getAttribute("aria-label") ===
      "Notifications, 1 unread",
  );
  assert.equal(await page.locator(".modal-backdrop").count(), 0);
  assert(await page.locator("#notifications-panel").isHidden());
  assert(
    !(await page.evaluate(() =>
      document
        .querySelector("#notifications-panel")
        .contains(document.activeElement),
    )),
  );
  await page.click("#notifications");
  assert(await page.locator("#notifications-panel").isVisible());
  assert.equal(
    await page.getByRole("button", { name: "Recover", exact: true }).count(),
    1,
  );
  await page.keyboard.press("Escape");
  assert(await page.locator("#notifications-panel").isHidden());
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "notifications",
  );
  await page.click("#notifications");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  assert.equal((await api("recovery_list")).checkpoints.length, 1);
  assert(
    await page.getByText("No notifications. You’re all caught up.").isVisible(),
  );
  check(
    "Launch leaves recovery in the bell without a dialog or focus grab; Escape returns focus and Dismiss keeps the checkpoint",
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#notifications")?.getAttribute("aria-label") ===
      "Notifications, 1 unread",
  );
  await api("edit", { id: "2", changes: { note: "Keep my active work" } });
  await page.evaluate(() => window.__chronoscope.refresh());
  await page.click("#notifications");
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await page.click("#unsaved-cancel");
  assert.equal(
    (await api("events", { id: "2" })).events[0].note,
    "Keep my active work",
  );
  await page.click("#notifications");
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await page.click("#unsaved-discard");
  await page.waitForFunction(() => !window.__chronoscope.busy);
  await page.waitForTimeout(300);
  assert.equal(
    (await api("events", { id: "1" })).events[0].note,
    "notification recovery fixture",
  );
  assert.equal((await api("recovery_list")).checkpoints.length, 0);
  check(
    "Explicit recovery protects dirty active work, restores exact records and retires the resolved checkpoint",
  );
  let fail = true;
  await page.route("**/api/invoke", async (route) => {
    if (fail && route.request().postDataJSON().command === "recovery_list") {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UNAVAILABLE",
            message: "Recovery temporarily unavailable",
          },
        }),
      });
    } else await route.fallback();
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#notifications")?.getAttribute("aria-label") ===
      "Notifications, 1 unread",
  );
  assert.equal(await page.locator(".modal-backdrop").count(), 0);
  assert.equal(await page.locator(".toast").count(), 0);
  await page.click("#notifications");
  await page.getByText("Recovery check needs attention").waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("No notifications. You’re all caught up.").waitFor();
  check(
    "Recovery failures stay in notifications and retry clears resolved alerts without startup popups",
  );
  for (const width of [900, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    const rect = await page.locator("#notifications").boundingBox();
    assert(
      rect.x >= 0 && rect.x + rect.width <= width,
      JSON.stringify({ width, rect }),
    );
  }
  await page.screenshot({ path: path.join(out, "notifications-empty.png") });
  await page.close();
  const auto = path.join(out, "automatic");
  await checkpoint(auto, true);
  const automatic = await bridge(auto);
  await automatic.page.goto(automatic.url + "/#token=" + automatic.token);
  await automatic.page.waitForFunction(
    () =>
      document.querySelector("#notifications")?.getAttribute("aria-label") ===
      "Notifications, 1 unread",
  );
  assert.equal(await automatic.page.locator(".modal-backdrop").count(), 0);
  assert(await automatic.page.locator("#notifications-panel").isHidden());
  await automatic.page.click("#notifications");
  await automatic.page
    .getByRole("button", { name: "Open saved copy", exact: true })
    .waitFor();
  assert.equal((await automatic.api("recovery_list")).checkpoints.length, 0);
  const files = fs.readdirSync(path.join(auto, "Documents/Autosaved"));
  assert(files.some((n) => n.startsWith("Recovered-")));
  await automatic.page.screenshot({
    path: path.join(out, "notifications-recovered.png"),
  });
  await automatic.page
    .getByRole("button", { name: "Open saved copy", exact: true })
    .click();
  await automatic.page.waitForTimeout(500);
  assert.equal(
    (await automatic.api("events", { id: "1" })).events[0].note,
    "notification recovery fixture",
  );
  check(
    "Automatic recovery copies remain automatic and are available from a quiet saved-copy notification",
    { files },
  );
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  for (const p of servers) p.kill();
}
