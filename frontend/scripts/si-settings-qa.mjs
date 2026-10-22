// One scrollable SI settings surface, real Rust MCP connections and explicit grants.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/si-settings"),
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
  toolExecutions: 0,
  unexpectedServiceConfigurations: 0,
  publicRequests: 0,
};
let browser;
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const pass = (name) => {
  report.checks.push(name);
  save();
  console.log("PASS " + name);
};
const tools = Array.from({ length: 8 }, (_, i) => ({
  name: i === 0 ? "lookup_records" : "tool_" + i,
  description: "Fixture permissions review. ".repeat(12),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: i === 0 },
}));
const remote = createServer(async (req, res) => {
  if (req.method === "DELETE") {
    res.writeHead(202);
    res.end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  assert(!body.includes("draft-secret"));
  if (req.url === "/denied") {
    res.writeHead(403);
    res.end();
    return;
  }
  const m = JSON.parse(body);
  let result;
  if (m.method === "server/discover")
    result = {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      ttlMs: 0,
      cacheScope: "private",
    };
  else if (m.method === "initialize")
    result = {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "Settings fixture", version: "1" },
    };
  else if (m.method === "notifications/initialized") {
    res.writeHead(202);
    res.end();
    return;
  } else if (m.method === "tools/list")
    result = { resultType: "complete", tools, ttlMs: 0, cacheScope: "private" };
  else if (m.method === "tools/call") {
    report.toolExecutions++;
    result = { content: [], isError: false };
  } else throw Error("Unexpected fixture method " + m.method);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
});
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 15000);
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
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
    },
  });
  await new Promise((resolve) => remote.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--ignore-gpu-blocklist",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 950 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.url().endsWith("/api/invoke") &&
      r.postDataJSON()?.command === "si_configure"
    )
      report.unexpectedServiceConfigurations++;
  });
  await context.route("**/*", async (route) => {
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
  await page.click("#si");
  await page.click("#si-settings");
  await page.waitForSelector("#client-list");
  assert.equal(await page.locator(".modal").count(), 1);
  assert.equal(
    await page.locator(".si-settings-tabs,[data-si-section]").count(),
    0,
  );
  assert.equal(await page.locator("#si-provider,#client-kind").count(), 2);
  const bounds = await page.locator(".si-settings-dialog").boundingBox(),
    close = await page
      .locator(".si-settings-dialog > .modal-head [data-close]")
      .boundingBox();
  async function stable() {
    assert.deepEqual(
      await page.locator(".si-settings-dialog").boundingBox(),
      bounds,
    );
    assert.deepEqual(
      await page
        .locator(".si-settings-dialog > .modal-head [data-close]")
        .boundingBox(),
      close,
    );
  }
  const appleEnabled = await page
    .locator("#si-provider option[value=apple-local]")
    .isEnabled();
  if (appleEnabled) {
    await page.selectOption("#si-provider", "apple-local");
    await stable();
    await page.selectOption("#si-provider", "openai-compatible");
  }
  await page.fill("#si-url", "http://127.0.0.1:7777/v1");
  await page.fill("#si-model", "unsaved-model-draft");
  await page.fill("#si-key", "draft-secret");
  await page.selectOption("#client-kind", "stdio");
  await stable();
  await page.selectOption("#client-kind", "http");
  await stable();
  const scroll = await page
    .locator(".si-settings-content")
    .evaluate((e) => ({ scroll: e.scrollHeight, height: e.clientHeight }));
  assert(scroll.scroll > scroll.height);
  pass(
    "Service and Tools share one fixed-size scrolling window; provider and transport changes keep close controls stationary",
  );
  await page.fill("#client-name", "Settings fixture");
  await page.fill(
    "#client-url",
    `http://127.0.0.1:${remote.address().port}/mcp`,
  );
  await page.click("#client-connect");
  await page.waitForSelector("[data-client-tool]");
  await stable();
  assert.equal(await page.locator("[data-client-tool]").count(), 8);
  assert.equal(await page.inputValue("#si-model"), "unsaved-model-draft");
  assert.equal(await page.inputValue("#si-key"), "draft-secret");
  assert.equal(await page.locator("#client-kind").count(), 1);
  const id = (await api("client_status")).connections[0].id;
  assert.equal((await api("client_status")).connections[0].granted, 0);
  await page
    .locator("[data-client-tool]")
    .first()
    .locator("select")
    .selectOption("read");
  await page.click("#client-grants-save");
  await page.waitForFunction(
    () =>
      document.querySelector("#client-grants-status").textContent === "Saved",
  );
  await stable();
  assert.equal((await api("client_status")).connections[0].granted, 1);
  assert.equal(await page.inputValue("#si-url"), "http://127.0.0.1:7777/v1");
  await page.screenshot({
    path: path.join(out, "combined-settings-grants.png"),
  });
  pass(
    "Real MCP discovery and inline grant saving preserve the service form, window bounds and explicit permissions",
  );
  await page.click("#client-back");
  await page.locator("[data-client-tools]").click();
  await page.waitForSelector("[data-client-tool]");
  assert.equal(
    await page
      .locator("[data-client-tool]")
      .first()
      .locator("select")
      .inputValue(),
    "read",
  );
  await stable();
  await page.locator("[data-client-disconnect]").click();
  await page.waitForFunction(
    () => document.querySelector("#client-tools-panel").hidden,
  );
  await stable();
  assert.equal((await api("client_status")).connections.length, 0);
  assert.equal(await page.inputValue("#si-model"), "unsaved-model-draft");
  await page.fill(
    "#client-url",
    `http://127.0.0.1:${remote.address().port}/denied`,
  );
  await page.click("#client-connect");
  await page.waitForFunction(
    () =>
      document.querySelector("#client-progress").textContent ===
      "Connection failed",
  );
  assert(await page.locator("#client-connect").isEnabled());
  await stable();
  pass(
    "Review, disconnect and failed discovery remain inline and retain service drafts",
  );
  await page.setViewportSize({ width: 800, height: 600 });
  const small = await page.locator(".si-settings-dialog").boundingBox();
  assert(
    small.x >= 0 && small.y >= 0 && small.width <= 800 && small.height <= 600,
  );
  await page.locator(".si-settings-dialog > footer [data-close]").click();
  assert.equal(await page.locator(".modal").count(), 0);
  pass(
    "Small windows scroll settings while keeping Done visible and clickable",
  );
  await page.setViewportSize({ width: 1400, height: 950 });
  const pending = context.waitForEvent("page");
  await page.click("#si-popout");
  const popup = await pending;
  await popup.waitForSelector("#si-settings");
  await popup.click("#si-settings");
  await page.waitForSelector(".si-settings-dialog #client-kind");
  assert.equal(await page.locator(".si-settings-dialog").count(), 1);
  assert.equal(await popup.locator(".modal").count(), 0);
  await page.locator(".modal-head [data-close]").click();
  await popup.click("#si-popout");
  pass(
    "Detached chat gear opens the same combined settings in the main workspace",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.toolExecutions, 0);
  assert.equal(report.unexpectedServiceConfigurations, 0);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} catch (e) {
  report.error = String(e);
  throw e;
} finally {
  save();
  await browser?.close();
  server.kill();
  await new Promise((resolve) => remote.close(resolve));
}
