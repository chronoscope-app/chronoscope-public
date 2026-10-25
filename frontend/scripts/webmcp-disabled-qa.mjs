import { chromium, spawn, localServerUrl } from "./qa-runtime.mjs";
// Standard-build regression: no extension bridge in the engine or app interface.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "../..");
fs.mkdirSync(path.join(root, ".qa"), { recursive: true });
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR ||
  fs.mkdtempSync(path.join(root, ".qa/webmcp-disabled-"));
fs.mkdirSync(dir, { recursive: true });
const token = randomBytes(32).toString("hex");
fs.writeFileSync(path.join(dir, "token"), token, { mode: 0o600 });
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
    path.join(dir, "token"),
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
try {
  const url = await localServerUrl(server);
  async function api(command, args = {}, success = true) {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await response.json();
    assert.equal(response.ok, success, JSON.stringify(body));
    return success ? body.result : body.error;
  }
  const caps = await api("capabilities");
  assert.equal(caps.mcp_client.browser_webmcp, false);
  assert.deepEqual(caps.mcp_client.transports, ["stdio", "streamable_http"]);
  assert(!caps.commands.some((name) => name.startsWith("webmcp_")));
  const exportPath = path.join(dir, "must-not-exist.zip");
  for (const command of [
    "webmcp_start",
    "webmcp_status",
    "webmcp_connect",
    "webmcp_stop",
    "webmcp_extension",
  ]) {
    await api(
      command,
      command === "webmcp_extension" ? { path: exportPath } : {},
      false,
    );
  }
  assert(!fs.existsSync(exportPath));
  assert.deepEqual((await api("client_status")).connections, []);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
    },
  });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.goto(url + "/?renderer=webgl#token=" + token);
  await page.waitForFunction(() => !!window.__chronoscope?.snapshot);
  await page.click("#si");
  await page.click("#si-settings");
  await page.locator("#client-connect").waitFor();
  assert.equal(await page.locator("#browser-webmcp").count(), 0);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /webmcp|browser extension|start.{0,5}pairing/i,
  );
  assert.deepEqual(
    await page
      .locator("#client-kind option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["http", "stdio"],
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("F1");
  await page.locator("#help-search").waitFor();
  assert.doesNotMatch(
    await page.locator(".help-guide").innerText(),
    /webmcp|browser extension|chrome:\/\/extensions/i,
  );
  console.log(
    JSON.stringify({
      passed: true,
      extension_bridge: "disabled",
      rejected_host_commands: 5,
      setup_interface: "absent",
      normal_mcp_transports: caps.mcp_client.transports,
    }),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
