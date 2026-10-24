// Real Rust jobs and UI; deterministic loopback model, no external requests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";
const root = path.resolve(import.meta.dirname, "../.."),
  out = path.resolve(
    process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/focused-ai/browser"),
  );
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    fs.mkdtempSync(path.join(out, "profile-")),
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
const report = {
  passed: false,
  checks: [],
  errors: [],
  publicRequests: 0,
  modelCalls: 0,
};
let pending = 0,
  browser;
let holdReplies = false;
const heldReplies = new Set();
const model = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const input = JSON.parse(body);
  assert(!input.tools);
  assert.equal(input.messages.length, 2);
  report.modelCalls++;
  pending++;
  if (holdReplies) await new Promise((resolve) => heldReplies.add(resolve));
  else await new Promise((r) => setTimeout(r, 750));
  const tags = input.messages[0].content.includes("topic labels");
  const content = tags
    ? { tags: ["coastal survey", "seabirds"] }
    : {
        text: "This finding summarizes the recorded values in the selected scope. It describes observations and does not establish a cause.",
      };
  const response = JSON.stringify({
    choices: [
      { message: { role: "assistant", content: JSON.stringify(content) } },
    ],
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(response);
  pending--;
});
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS " + name);
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
    server.on("error", reject);
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
  });
  const api = async (command, args = {}) => {
    const r = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const b = await r.json();
    assert(r.ok, JSON.stringify(b));
    return b.result;
  };
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
    },
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  await api("si_configure", {
    url: `http://127.0.0.1:${model.address().port}/v1`,
    model: "focused-fixture",
  });
  const ids = (await api("query", { limit: 3, fields: ["id"] })).events.map(
    (e) => e.id,
  );
  for (const [i, id] of ids.entries())
    await api("edit", {
      id,
      changes: {
        note:
          i < 2
            ? "Survey recorded nesting seabirds beside a rocky coastline."
            : "",
        tags: i === 0 ? ["reviewed"] : [],
      },
    });
  await api("select", { ids, mode: "replace" });
  await api("view_set", { inspector_tab: "inspect" });
  browser = await chromium.launch({
    executablePath:
      process.env.CHRONOSCOPE_CHROMIUM ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (r) => {
    const u = r.request().url();
    if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
      report.publicRequests++;
      return r.abort();
    }
    return r.continue();
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForSelector("#suggest-tags");
  const openTags = async () => {
    await page.click("#suggest-tags");
    await page.waitForFunction(
      () => !document.querySelector("#focused-ai-provider")?.disabled,
    );
    await page.selectOption("#focused-ai-provider", "connected");
  };
  await openTags();
  holdReplies = true;
  await page.click("#focused-ai-generate");
  await page.waitForSelector("#focused-ai-generate[aria-busy=true]");
  assert(await page.locator(".focused-ai-spinner").isVisible());
  assert.equal(await page.textContent("#focused-ai-cancel"), "Cancel AI");
  await page.screenshot({ path: path.join(out, "tags-processing.png") });
  holdReplies = false;
  for (const release of heldReplies) release();
  heldReplies.clear();
  await page.waitForSelector("#focused-ai-apply:visible");
  assert.equal(await page.locator("tr[data-event-id]").count(), 3);
  assert.equal(
    (await api("events", { id: ids[0] })).events[0].tags.join(","),
    "reviewed",
  );
  pass(
    "Generic AI indicator and Cancel AI are visible while generating; suggestions do not edit records",
  );
  const rows = page.locator("tr[data-event-id]");
  await rows.nth(0).locator("input[type=text]").fill("shore birds, survey");
  await rows.nth(1).locator("input[type=checkbox]").uncheck();
  assert(await rows.nth(2).locator("input[type=checkbox]").isDisabled());
  await page.screenshot({ path: path.join(out, "tags-review.png") });
  await page.click("#focused-ai-apply");
  await page.waitForSelector(".focused-ai-dialog", { state: "detached" });
  assert.deepEqual((await api("events", { id: ids[0] })).events[0].tags, [
    "reviewed",
    "shore birds",
    "survey",
  ]);
  assert.deepEqual((await api("events", { id: ids[1] })).events[0].tags, []);
  await api("undo");
  assert.deepEqual((await api("events", { id: ids[0] })).events[0].tags, [
    "reviewed",
  ]);
  pass(
    "Review supports editable tags, per-record acceptance, blank skipping, additive apply and one Undo",
  );
  await page.click("[data-tab=patterns]");
  await page.click("#find-patterns");
  await page.evaluate(() => window.__chronoscope.patternsIdle());
  await page.waitForSelector("[data-pattern-explain]");
  await page.locator("[data-pattern-explain]").first().click();
  await page.waitForFunction(
    () => !document.querySelector("#focused-ai-provider")?.disabled,
  );
  await page.selectOption("#focused-ai-provider", "connected");
  // Hold this fixture response until cancellation is acknowledged. Taking a
  // software-rendered screenshot can exceed a fixed model-response delay.
  holdReplies = true;
  await page.click("#focused-ai-generate");
  await page.waitForSelector("#focused-ai-generate[aria-busy=true]");
  await page.screenshot({ path: path.join(out, "explain-processing.png") });
  const cancellation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/invoke") &&
      response.request().postDataJSON()?.command === "job_cancel",
  );
  await page.click("#focused-ai-cancel");
  assert((await cancellation).ok());
  holdReplies = false;
  for (const release of heldReplies) release();
  heldReplies.clear();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#focused-ai-generate")
        ?.hasAttribute("aria-busy"),
  );
  assert.match(await page.textContent(".focused-ai-status"), /cancel/i);
  while (pending) await new Promise((r) => setTimeout(r, 50));
  pass(
    "Explain result has indeterminate AI progress and cancellation without edits",
  );
  await page.click("#focused-ai-generate");
  await page.waitForSelector(".focused-ai-answer");
  assert.match(
    await page.textContent(".focused-ai-answer"),
    /does not establish a cause/,
  );
  assert.match(await page.textContent(".focused-ai-result"), /Source evidence/);
  await page.screenshot({ path: path.join(out, "explain-result.png") });
  assert.equal((await api("si_history")).messages.length, 0);
  pass(
    "Pattern explanations show the engine evidence and do not enter SI Chat history",
  );
  await page.click("#focused-ai-cancel");
  await page.click("[data-tab=inspect]");
  await openTags();
  await page.click("#focused-ai-generate");
  await page.waitForSelector("#focused-ai-apply:visible");
  await api("edit", {
    id: ids[0],
    changes: { note: "Changed after the preview" },
  });
  await page.click("#focused-ai-apply");
  await page.waitForFunction(() =>
    document
      .querySelector(".focused-ai-status")
      ?.textContent.includes("CONFLICT"),
  );
  assert.deepEqual((await api("events", { id: ids[0] })).events[0].tags, [
    "reviewed",
  ]);
  pass("Stale tag previews fail safely instead of applying to changed records");
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  for (const release of heldReplies) release();
  heldReplies.clear();
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
  await new Promise((r) => model.close(r));
}
