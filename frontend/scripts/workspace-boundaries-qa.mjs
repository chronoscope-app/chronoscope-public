// Real Rust + browser regression for submitted drafts and document replacement.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-boundaries-"));
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(dir, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
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
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error("Bridge startup timeout")),
      20000,
    );
    server.on("error", reject);
    server.stderr.on("data", (data) => {
      log += data;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
  const api = async (command, args = {}) => {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await response.json();
    assert(response.ok, JSON.stringify(body));
    return body.result;
  };
  await api("preferences", {
    preferences: { basemap: "none", map_layers: [] },
  });
  await api("select", { ids: ["1"] });
  await api("edit", { id: "1", changes: { note: "Original saved note" } });
  const saved = path.join(dir, "replacement.chronoscope");
  await api("save", { path: saved });
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(() => window.__chronoscope?.snapshot?.count > 0);
  await page.click('[data-tab="inspect"]');
  await page.waitForSelector("#edit-note");
  const refresh = () =>
    page.evaluate(() => window.__chronoscope.refresh(false, false));
  await page.fill("#edit-note", "Submitted draft");
  await refresh();
  assert.equal(await page.inputValue("#edit-note"), "Submitted draft");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "edit-note",
  );
  console.log(
    "PASS ordinary inspector refresh preserves dirty form values without new controls",
  );

  let pending;
  await page.route("**/api/invoke", async (route) => {
    if (route.request().postDataJSON()?.command === "time_parse" && pending) {
      const hold = pending;
      const response = await route.fetch();
      hold.entered();
      await hold.release;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const holdParsing = () => {
    let entered, release;
    const arrived = new Promise((resolve) => {
      entered = resolve;
    });
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    pending = { entered, release: hold };
    return { arrived, release };
  };
  const editResponse = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/invoke") &&
        response.request().postDataJSON()?.command === "edit",
    );
  const first = holdParsing(),
    completed = editResponse();
  await page.click("#apply-edit");
  await first.arrived;
  await refresh();
  first.release();
  const response = await completed;
  assert.equal(response.status(), 200);
  await page.evaluate(() => window.__chronoscope.editorIdle());
  assert.equal(
    response.request().postDataJSON().args.changes.note,
    "Submitted draft",
  );
  assert.equal(
    (await api("events", { id: "1" })).events[0].note,
    "Submitted draft",
  );
  console.log(
    "PASS refresh during timestamp parsing cannot discard or rewrite submitted values",
  );

  await refresh();
  await page.fill("#edit-note", "Must not reach another document");
  const second = holdParsing(),
    rejected = editResponse();
  await page.click("#apply-edit");
  await second.arrived;
  // Deliberately leave the browser snapshot stale: enforcement must be in Rust.
  await api("open", { path: saved });
  second.release();
  const failure = await rejected;
  assert.equal(failure.status(), 400);
  assert.equal((await failure.json()).error.code, "CONFLICT");
  assert.equal(
    (await api("events", { id: "1" })).events[0].note,
    "Original saved note",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS replacement workspace rejects a stale submitted edit even before the UI refreshes",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
}
