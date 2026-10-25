import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Offline integration: actual Rust bridge + browser renderer + local SI fixture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dir =
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/assistant/data");
const out =
  process.env.CHRONOSCOPE_QA_SCREENSHOTS ||
  path.join(root, ".qa/assistant/screenshots");
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
fs.writeFileSync(path.join(dir, "token"), token, { mode: 0o600 });
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  cli,
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
    process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser,
  mock,
  remote,
  siRequests = 0;
try {
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  await api("preferences", {
    preferences: {
      basemap: "none",
      map: { ...(await api("preferences")).map, enabled: false },
    },
  });
  const file = path.join(dir, "triangle-demo.csv");
  fs.writeFileSync(
    file,
    "entity,timestamp,latitude,longitude,label\n" +
      [
        "A,2026-01-01 00:00,43.25,-79.96,Located start",
        "A,2026-01-01 00:10,,,Radio report with unknown location",
        "A,2026-01-01 00:20,43.26,-79.94,Located midpoint",
        "A,2026-01-01 00:30,,,Time only report",
        "A,2026-01-01 00:40,43.265,-79.93,Located end",
        "A,2026-01-01 00:50,,,Unbracketed report",
      ].join("\n"),
  );
  const ticket = await api("import_preview", { path: file });
  await api("import_commit", { import_id: ticket.import_id });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1150 },
  });
  await page.addInitScript(() => {
    new MutationObserver(() =>
      document.querySelector("#unsaved-discard")?.click(),
    ).observe(document, { childList: true, subtree: true });
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "/?renderer=webgl#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.view.trianglePoints.length === 2 &&
      !window.__chronoscope.busy,
  );
  await page.evaluate(() => {
    const c = window.__chronoscope;
    c.view.fit();
    c.view.setFocus(0);
  });
  await page.waitForTimeout(300);
  const glyphs = await page.evaluate(() => {
    const v = window.__chronoscope.view;
    const triangle = v.triangles.get(0);
    const svg = new DOMParser().parseFromString(
      decodeURIComponent(String(triangle.image).split(",")[1]),
      "image/svg+xml",
    );
    return {
      engine: v.diagnostics().engine,
      circleCount: v.diagnostics().pointCount,
      triangleCount: v.diagnostics().triangleCount,
      trianglePath: svg.querySelector("path")?.getAttribute("d"),
      triangleWidth: triangle.width,
      triangleHeight: triangle.height,
      renderedCircleIds: Array.from(
        { length: v.glyphs.length },
        (_, i) => v.glyphs.get(i).id.id,
      ),
      renderedTriangleIds: Array.from(
        { length: v.triangles.length },
        (_, i) => v.triangles.get(i).id.id,
      ),
      inferredIds: v.trianglePoints.map((p) => p.id),
    };
  });
  assert.equal(glyphs.engine, "CesiumJS");
  assert.equal(
    glyphs.circleCount,
    3,
    "Only the three measured locations render as point circles",
  );
  assert.equal(
    glyphs.triangleCount,
    2,
    "Only bracketed time-only reports render as triangles",
  );
  assert.equal(
    glyphs.trianglePath,
    "M12 2 23 22H1Z",
    "The actual GPU billboard image has three corners",
  );
  assert.equal(glyphs.triangleWidth, glyphs.triangleHeight);
  assert.ok(glyphs.triangleWidth > 0);
  assert.deepEqual(glyphs.renderedTriangleIds, glyphs.inferredIds);
  assert.ok(
    glyphs.renderedCircleIds.every((id) => !glyphs.inferredIds.includes(id)),
  );
  await page.screenshot({ path: path.join(out, "time-only-triangles.png") });
  const target = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      p = v.trianglePoints[0],
      pixel = v.projectEvent(p.id);
    if (!pixel) throw Error("Time-only triangle is not projectable");
    v.viewer.render();
    const picked = v.viewer.scene
      .drillPick(pixel, 16, 7, 7)
      .map((hit) => hit.id)
      .find((id) => id?.kind === "event" && id.id === p.id);
    const rect = v.host.getBoundingClientRect();
    return { x: rect.x + pixel.x, y: rect.y + pixel.y, id: p.id, picked };
  });
  assert.equal(
    target.picked?.kind,
    "event",
    "Native Cesium GPU picking identifies the triangle: " +
      JSON.stringify(target),
  );
  assert.equal(target.picked?.id, target.id);
  await page.mouse.move(target.x, target.y);
  await page.waitForFunction(() =>
    /location unknown/i.test(window.__chronoscope.view.tooltip.textContent),
  );
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector("#edit-lat");
  assert.equal(await page.inputValue("#edit-lat"), "");
  assert.equal((await api("events", { id: target.id })).events[0].lat, null);
  console.log(
    "Native time-only rendering, GPU picking, tooltip, and null-coordinate editing passed.",
  );
  for (const mode of ["map", "globe", "space-time"]) {
    console.log("Testing time-only evidence mode:", mode);
    await page.click(`[data-view="${mode}"]`);
    await page.waitForFunction(
      (mode) =>
        window.__chronoscope.view.mode === mode &&
        window.__chronoscope.view.diagnostics().triangleCount === 2,
      mode,
    );
    if (mode === "map" || mode === "globe") {
      await page.click('[data-tab="views"]');
      await page.click("#display-bloom");
      await page.waitForFunction(() => {
        const v = window.__chronoscope.view;
        return (
          v.display.bloom &&
          v.diagnostics().triangleCount === 2 &&
          Array.from({ length: v.triangles.length }, (_, i) =>
            v.triangles.get(i),
          ).every((glyph) => glyph.show) &&
          !v.displayLayer.diagnostics.pending &&
          v.displayLayer.diagnostics.atlasLayers === 1
        );
      });
      console.log("Ground bloom loaded with triangles visible in", mode);
      const bloomEvidence = await page.evaluate(() => {
        const v = window.__chronoscope.view;
        const inferredIds = new Set(v.trianglePoints.map((p) => p.id));
        return {
          groundOnly: v.displayLayer.diagnostics.groundOnly,
          bloomIsolation: v.displayLayer.diagnostics.bloomIsolation,
          effectError: v.displayLayer.diagnostics.error,
          measuredCount: v.displayLayer.packet.count,
          inferredSamples: v.displayLayer.packet.bins.filter((b) =>
            inferredIds.has(b.sample_id),
          ).length,
          sceneBloom: v.viewer.scene.postProcessStages.bloom.enabled,
        };
      });
      assert.equal(bloomEvidence.groundOnly, true);
      assert.equal(bloomEvidence.bloomIsolation, "event-layer-only");
      assert.equal(bloomEvidence.effectError, "");
      assert.equal(
        bloomEvidence.measuredCount,
        3,
        "Unknown locations never enter the geographic bloom input",
      );
      assert.equal(
        bloomEvidence.inferredSamples,
        0,
        "Inferred triangles do not emit ground bloom",
      );
      assert.equal(
        bloomEvidence.sceneBloom,
        false,
        "Bloom never includes evidence triangles or the base imagery",
      );
      await page.click('[data-tab="views"]');
      await page.click("#display-bloom");
      await page.waitForFunction(
        () => !window.__chronoscope.view.display.bloom,
      );
    }
  }
  let externalCalls = 0,
    externalWrites = 0;
  const externalTools = [
    {
      name: "lookup_records",
      description: "Read a local fixture event",
      inputSchema: {
        type: "object",
        properties: { area: { type: "string" } },
        required: ["area"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { records: { type: "array" } },
        required: ["records"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "write_note",
      description: "Write a note in the fixture (counter only)",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
  ];
  remote = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer fixture-remote-token") {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    const legacy = req.url === "/legacy";
    let bytes = "";
    for await (const chunk of req) bytes += chunk;
    const message = JSON.parse(bytes);
    const method = message.method;
    console.log("Local MCP fixture:", legacy ? "legacy" : "modern", method);
    if (req.url === "/oversized") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("x".repeat(2 * 1024 * 1024 + 4096));
      return;
    }
    if (legacy && method === "server/discover") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Legacy server" },
        }),
      );
      return;
    }
    if (method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (!legacy)
      assert.equal(req.headers["mcp-protocol-version"], "2026-07-28");
    if (legacy && !["server/discover", "initialize"].includes(method))
      assert.equal(req.headers["mcp-session-id"], "fixture-session");
    let result;
    if (method === "initialize")
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "Legacy fixture", version: "1" },
      };
    else if (method === "server/discover")
      result = {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: "private",
      };
    else if (method === "tools/list")
      result = {
        resultType: "complete",
        tools:
          req.url === "/many-tools"
            ? Array.from({ length: 128 }, (_, i) => ({
                ...externalTools[0],
                name: `lookup_${i}`,
              }))
            : externalTools,
        ttlMs: 0,
        cacheScope: "private",
      };
    else if (method === "tools/call") {
      externalCalls++;
      if (message.params.name === "write_note") {
        externalWrites++;
        result = {
          resultType: "complete",
          content: [{ type: "text", text: "Fixture note written" }],
          isError: false,
        };
      } else {
        assert.equal(message.params.arguments.area, "demo");
        result = {
          resultType: "complete",
          content: [{ type: "text", text: "One fixture event" }],
          structuredContent: {
            records: [
              {
                id: "remote-1",
                timestamp: "2026-01-01 00:00",
                latitude: 43.25,
                longitude: -79.95,
              },
            ],
          },
          isError: false,
        };
      }
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Unknown method" },
        }),
      );
      return;
    }
    if (legacy)
      for (const key of ["resultType", "ttlMs", "cacheScope"])
        delete result[key];
    if (req.url === "/bad-result" && method === "tools/call")
      result.structuredContent = { wrong: true };
    const reply = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
    if (method === "tools/call") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: message\ndata: ${reply}\n\n`);
    } else {
      res.writeHead(200, {
        "Content-Type": "application/json",
        ...(legacy ? { "Mcp-Session-Id": "fixture-session" } : {}),
      });
      res.end(reply);
    }
  });
  await new Promise((r) => remote.listen(0, "127.0.0.1", r));
  // The test service issues actual engine operations, then reads their outcomes.
  mock = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    siRequests++;
    assert.equal(req.headers.authorization, "Bearer qa-only-key");
    assert.ok(
      !JSON.stringify(input.tools).includes("chronoscope_si_configure"),
    );
    const hasTool = input.messages.some((m) => m.role === "tool");
    const followup = input.messages.at(-1).content === "What did you just do?";
    if (followup) {
      assert.ok(
        input.messages.some(
          (m) =>
            m.role === "assistant" &&
            m.content.includes("coordinates remain unknown"),
        ),
      );
      assert.ok(
        input.messages.some(
          (m) => m.role === "user" && m.content.startsWith("Select the first"),
        ),
      );
    }
    const lastUser = input.messages
      .filter((m) => m.role === "user")
      .at(-1)?.content;
    const externalQuestion = [
      "Fetch a connected event",
      "Write a fixture note",
    ].includes(lastUser);
    let externalMessage;
    if (externalQuestion) {
      if (hasTool) {
        assert.ok(
          input.messages
            .at(-1)
            .content.includes(
              lastUser.startsWith("Fetch")
                ? "remote-1"
                : "Fixture note written",
            ),
        );
        externalMessage = {
          role: "assistant",
          content: lastUser.startsWith("Fetch")
            ? "Fetched one external fixture event."
            : "Wrote the external fixture note.",
        };
      } else {
        const write = lastUser.startsWith("Write");
        const tool = input.tools.find(
          (t) =>
            t.function.name.startsWith("external_") &&
            t.function.description.includes(
              write ? "write_note" : "lookup_records",
            ),
        );
        assert.ok(tool, "Granted external tool should be offered to SI");
        assert.ok(
          !input.tools.some(
            (t) => t.function.name === "chronoscope_client_connect",
          ),
        );
        if (!write)
          assert.ok(
            !input.tools.some((t) =>
              t.function.description.includes("write_note"),
            ),
          );
        externalMessage = {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "external-call",
              type: "function",
              function: {
                name: tool.function.name,
                arguments: JSON.stringify(
                  write ? { note: "fixture" } : { area: "demo" },
                ),
              },
            },
          ],
        };
      }
    }
    const message =
      externalMessage ||
      (followup
        ? {
            role: "assistant",
            content:
              "I selected the time-only report; its coordinates are still unknown.",
          }
        : hasTool
          ? {
              role: "assistant",
              content:
                "Selected the time-only report and switched to 2D map. Its actual coordinates remain unknown.",
            }
          : {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "pick",
                  type: "function",
                  function: {
                    name: "chronoscope_select",
                    arguments: JSON.stringify({ ids: [target.id] }),
                  },
                },
                {
                  id: "map",
                  type: "function",
                  function: {
                    name: "chronoscope_view_set",
                    arguments: JSON.stringify({ mode: "map", fit: true }),
                  },
                },
              ],
            });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  assert.equal((await page.locator("#si").textContent()).trim(), "AI");
  assert.equal((await api("si_status")).connected, false);
  await page.click("#si");
  await page.waitForSelector("#si-chat:not([hidden])");
  assert.equal(
    await page.locator(".modal").count(),
    0,
    "Disconnected SI opens the chat pane, not connection setup",
  );
  assert.equal(await page.locator("#si").getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() =>
    document.querySelector("#si-progress").textContent.includes("settings"),
  );
  assert.match(await page.textContent("#si-progress"), /settings.*connect/);
  const settingsButton = await page.locator("#si-settings").boundingBox();
  assert(settingsButton.width <= 32 && settingsButton.height <= 32);
  assert.equal(await page.locator("#si-connections").count(), 0);
  await page.click("#si-settings");
  await page.waitForSelector("#client-list");
  assert.equal(
    await page.locator(".si-settings-tabs,[data-si-section]").count(),
    0,
  );
  assert.equal(await page.locator("#si-url").count(), 1);
  await page.fill("#si-url", `http://127.0.0.1:${mock.address().port}/v1`);
  await page.fill("#si-model", "local-test-fixture");
  await page.fill("#si-key", "qa-only-key");
  await page.click("#si-connect");
  await page.waitForFunction(
    () =>
      !document.querySelector("#si-send").disabled &&
      /Connected|Ready/.test(
        document.querySelector("#si-progress").textContent,
      ),
  );
  assert.equal((await api("si_status")).connected, true);
  assert.equal(await page.locator(".modal").count(), 0);
  assert.equal(await page.locator("#si-key").count(), 0);
  assert.equal(await page.locator("#si-root-choose").count(), 0);
  const chatLayout = await page.evaluate(() => {
    const chat = document.querySelector("#si-chat").getBoundingClientRect();
    const scene = document.querySelector("#scene").getBoundingClientRect();
    return {
      chatWidth: chat.width,
      chatHeight: chat.height,
      sceneWidth: scene.width,
      noOverlap: chat.left >= scene.right,
    };
  });
  assert.ok(
    chatLayout.chatWidth >= 240 &&
      chatLayout.chatHeight >= 280 &&
      chatLayout.sceneWidth > 700 &&
      chatLayout.noOverlap,
    JSON.stringify(chatLayout),
  );
  await page.fill(
    "#si-prompt",
    "Select the first time-only report and switch to 2D map.",
  );
  await page.click("#si-send");
  await page.waitForFunction(
    () => document.querySelector("#si-progress").textContent === "Ready",
  );
  assert.match(
    await page.textContent("#si-messages"),
    /coordinates remain unknown/,
  );
  assert.equal(siRequests, 2);
  assert.equal((await api("snapshot")).scene.mode, "map");
  assert.equal(
    await page.evaluate(() => window.__chronoscope.view.mode),
    "map",
  );
  await page.screenshot({ path: path.join(out, "assistant-tool-results.png") });
  await page.fill("#si-prompt", "What did you just do?");
  await page.press("#si-prompt", "Enter");
  await page.waitForFunction(() =>
    document
      .querySelector("#si-messages")
      .textContent.includes("still unknown"),
  );
  assert.equal(siRequests, 3);
  await page.click("#theme");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.waitForTimeout(1200); // Allow software compositor to finish theme transitions.
  await page.screenshot({
    path: path.join(out, "si-chat-light.png"),
    animations: "disabled",
  });
  await page.click("#theme");
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(out, "si-chat-dark.png"),
    animations: "disabled",
  });
  await page.click("#si-close");
  await page.click("#si");
  await page.waitForFunction(() =>
    document
      .querySelector("#si-messages")
      .textContent.includes("What did you just do"),
  );
  assert.match(await page.textContent("#si-messages"), /What did you just do/);
  await page.click("#si-new");
  await page.waitForFunction(
    () => document.querySelector("#si-messages").children.length === 0,
  );
  assert.deepEqual((await api("si_history")).messages, []);
  await page.click("#si-close");
  // Configure an outbound connection and explicit tool grants through actual host UI.
  await page.click("#si");
  await page.click("#si-settings");
  await page.fill("#client-name", "External fixture");
  await page.fill(
    "#client-url",
    `http://127.0.0.1:${remote.address().port}/mcp`,
  );
  await page.fill("#client-token", "fixture-remote-token");
  await page.click("#client-connect");
  await page.waitForSelector("[data-client-tool]").catch(async (error) => {
    throw new Error(
      String(error) +
        " " +
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll(".toast")].map((e) => e.textContent),
          ),
        ),
    );
  });
  assert.equal(await page.locator("[data-client-tool]").count(), 2);
  const connectionID = (await api("client_status")).connections[0].id;
  await page
    .locator("[data-client-tool]")
    .filter({ hasText: "lookup_records" })
    .locator("select")
    .selectOption("read");
  await page.click("#client-grants-save");
  await page.waitForFunction(
    () =>
      document.querySelector("#client-grants-status").textContent === "Saved",
  );
  await page.locator(".modal [data-close]").first().click();
  await page.fill("#si-prompt", "Fetch a connected event");
  await page.click("#si-send");
  await page.waitForFunction(() =>
    document
      .querySelector("#si-messages")
      .textContent.includes("Fetched one external fixture event"),
  );
  assert.equal(externalCalls, 1);
  assert.equal(externalWrites, 0);
  await page.click("#si-settings");
  await page.click("[data-client-tools]");
  await page
    .locator("[data-client-tool]")
    .filter({ hasText: "write_note" })
    .locator("select")
    .selectOption("action");
  await page.screenshot({ path: path.join(out, "mcp-tool-grants.png") });
  await page.click("#client-grants-save");
  await page.waitForFunction(
    () =>
      document.querySelector("#client-grants-status").textContent === "Saved",
  );
  await page.locator(".modal [data-close]").first().click();
  await page.locator(".si-permissions summary").click();
  await page.check("#si-external-actions");
  await page.fill("#si-prompt", "Write a fixture note");
  await page.click("#si-send");
  await page.waitForFunction(() =>
    document
      .querySelector("#si-messages")
      .textContent.includes("Wrote the external fixture note"),
  );
  assert.equal(externalCalls, 2);
  assert.equal(externalWrites, 1);
  assert.equal(await page.isChecked("#si-external-actions"), false);
  await page.screenshot({ path: path.join(out, "si-external-mcp.png") });
  await api("client_grants", { id: connectionID, grants: [] });
  await api("client_disconnect", { id: connectionID });
  assert.deepEqual((await api("client_status")).connections, []);
  await page.click("#si-close");
  // Remote compatibility, bounded responses, authentication failure and output schemas.
  const connectRemote = (id, path, token = "fixture-remote-token") =>
    api("client_connect", {
      id,
      name: id,
      config: {
        transport: "http",
        url: `http://127.0.0.1:${remote.address().port}${path}`,
        token,
      },
    });
  await assert.rejects(() => connectRemote("denied", "/mcp", "bad-token"));
  await assert.rejects(() => connectRemote("large", "/oversized"));
  await connectRemote("legacy", "/legacy");
  const legacyTool = (await api("client_tools", { id: "legacy" })).tools.find(
    (t) => t.definition.name === "lookup_records",
  );
  await api("client_grants", {
    id: "legacy",
    grants: [
      {
        tool: "lookup_records",
        fingerprint: legacyTool.fingerprint,
        access: "read",
      },
    ],
  });
  assert.equal(
    (
      await api("client_call", {
        id: "legacy",
        tool: "lookup_records",
        fingerprint: legacyTool.fingerprint,
        arguments: { area: "demo" },
      })
    ).structuredContent.records[0].id,
    "remote-1",
  );
  await api("client_disconnect", { id: "legacy" });
  await connectRemote("invalid-output", "/bad-result");
  const invalidTool = (
    await api("client_tools", { id: "invalid-output" })
  ).tools.find((t) => t.definition.name === "lookup_records");
  await api("client_grants", {
    id: "invalid-output",
    grants: [
      {
        tool: "lookup_records",
        fingerprint: invalidTool.fingerprint,
        access: "read",
      },
    ],
  });
  await assert.rejects(() =>
    api("client_call", {
      id: "invalid-output",
      tool: "lookup_records",
      fingerprint: invalidTool.fingerprint,
      arguments: { area: "demo" },
    }),
  );
  await api("client_disconnect", { id: "invalid-output" });
  // The provider's function budget includes domain and external tools together.
  await connectRemote("many", "/many-tools");
  const manyTools = (await api("client_tools", { id: "many" })).tools;
  await api("client_grants", {
    id: "many",
    grants: manyTools.map((t) => ({
      tool: t.definition.name,
      fingerprint: t.fingerprint,
      access: "read",
    })),
  });
  const requestsBeforeBudget = siRequests;
  await assert.rejects(
    () => api("si_run", { prompt: "Inspect the connected services" }),
    /128 total tools/,
  );
  assert.equal(
    siRequests,
    requestsBeforeBudget,
    "Reject excessive schemas before contacting the provider",
  );
  await api("client_disconnect", { id: "many" });
  // Real scene picking reveals a selected record beyond the table's first page.
  const linked = path.join(dir, "linked-selection.csv");
  fs.writeFileSync(
    linked,
    "entity,timestamp,latitude,longitude,label\n" +
      Array.from(
        { length: 70 },
        (_, i) =>
          `Linked,2026-01-02 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")},${43.24 + (i % 10) * 0.002},${-79.97 + Math.floor(i / 10) * 0.004},Linked ${i}`,
      ).join("\n"),
  );
  const linkedPreview = await api("import_preview", { path: linked });
  await api("import_commit", { import_id: linkedPreview.import_id });
  await page.evaluate(async () => {
    const c = window.__chronoscope;
    await c.refresh();
    await c.openAttributes(null);
    c.view.fit();
  });
  await page.waitForTimeout(300);
  const linkedID = (await api("query", { limit: 100 })).events.find(
    (e) => e.label === "Linked 58",
  ).id;
  const linkedTarget = await page.evaluate((id) => {
    const v = window.__chronoscope.view,
      point = v.points.find((p) => p.id === id),
      pixel = v.projectEvent(id);
    if (!point || !pixel) throw Error("Linked event is not visible in Cesium");
    v.viewer.render();
    const picked = v.viewer.scene
      .drillPick(pixel, 16, 7, 7)
      .map((hit) => hit.id)
      .find((hit) => hit?.kind === "event" && hit.id === id);
    const rect = v.host.getBoundingClientRect();
    return { id: point.id, x: rect.x + pixel.x, y: rect.y + pixel.y, picked };
  }, linkedID);
  assert.equal(
    linkedTarget.picked?.kind,
    "event",
    "Linked-table test uses native Cesium picking",
  );
  assert.equal(linkedTarget.picked?.id, linkedID);
  await page.mouse.click(linkedTarget.x, linkedTarget.y);
  await page.waitForSelector(
    `#table-body tr[data-event="${linkedTarget.id}"].selected`,
  );
  assert.match(await page.textContent("#table-count"), /^70 events/);
  assert(
    (await page.locator(".table-scroll").evaluate((e) => e.scrollTop)) > 0,
  );
  const anotherRow = page.locator("#table-body tr[data-event]").first();
  const otherID = await anotherRow.getAttribute("data-event");
  await anotherRow.click();
  await page.waitForFunction(
    (id) => window.__chronoscope.view.selected.has(id),
    otherID,
  );
  assert.equal(await anotherRow.getAttribute("aria-selected"), "true");
  await page.screenshot({ path: path.join(out, "linked-selection.png") });
  await page.click("#close-table");
  // Actual import control reduces retained events, then workspace aggregation
  // requires an exact preview and explicit replacement review.
  const busy = path.join(dir, "busy.csv");
  fs.writeFileSync(
    busy,
    "entity,timestamp,latitude,longitude,value\n" +
      Array.from(
        { length: 100 },
        (_, i) => `B,2026-01-01 01:01,43.26,-79.94,${i}`,
      ).join("\n"),
  );
  page.once("dialog", (d) => d.accept(busy));
  await page.click("#open");
  await page.click("#import-next");
  await page.waitForSelector("#import-aggregate", { state: "attached" });
  await page
    .locator("summary")
    .filter({ hasText: "Aggregate during import" })
    .click();
  await page.check("#import-aggregate");
  await page.click("#review-import");
  await page.click("#commit-import");
  await page.waitForFunction(
    () =>
      window.__chronoscope.snapshot.count === 1 && !window.__chronoscope.busy,
  );
  assert.equal(
    (await api("query")).events[0].attrs["chronoscope.aggregate.count"],
    "100",
  );
  // Restore source fixture, then show a normal exact preview and apply/undo.
  const again = await api("import_preview", { path: file });
  await api("import_commit", { import_id: again.import_id });
  await page.evaluate(() => window.__chronoscope.refresh());
  await page.click("#aggregate-events");
  assert.equal(await page.isDisabled("#aggregate-apply"), true);
  await page.click("#aggregate-preview");
  await page.waitForFunction(() =>
    document
      .querySelector("#aggregate-result")
      .textContent.includes("6 input records"),
  );
  await page.check("#aggregate-review");
  assert.equal(await page.isDisabled("#aggregate-apply"), false);
  await page.fill("#aggregate-radius", "101");
  assert.equal(await page.isDisabled("#aggregate-apply"), true);
  await page.click("#aggregate-preview");
  await page.waitForFunction(
    () => !document.querySelector("#aggregate-apply").disabled,
  );
  await page.screenshot({ path: path.join(out, "aggregation-preview.png") });
  await page.click("#aggregate-apply");
  await page.waitForSelector("#aggregate-apply", { state: "detached" });
  await api("undo");
  assert.equal((await api("snapshot")).count, 6);
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        glyphs,
        siRequests,
        externalCalls,
        externalWrites,
        externalCompatibility:
          "2025-11-25 initialize/session fallback, bearer failure, 2 MiB response bound, output-schema rejection",
        externalProtocol:
          "2026-07-28 / Streamable HTTP JSON discovery + SSE tool results",
        errors,
        publicWmtsRequests: 0,
        provider: "localhost scripted fixture; no live model used",
      },
      null,
      2,
    ),
  );
  console.log(
    "Assistant, import aggregation, exact preview/apply/undo, triangle rendering and picking passed; 0 public WMTS requests.",
  );
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage
      .screenshot({ path: path.join(out, "failure.png") })
      .catch(() => {});
    const state = await failedPage
      .evaluate(() => {
        const c = window.__chronoscope;
        return {
          mode: c?.view.mode,
          display: c?.view.display,
          diagnostics: c?.view.diagnostics(),
          effects: c?.view.displayLayer.diagnostics,
          tooltip: c?.view.tooltip.textContent,
          toast: [...document.querySelectorAll(".toast")].map(
            (el) => el.textContent,
          ),
          dialog: document.querySelector(".modal h2")?.textContent,
        };
      })
      .catch(() => null);
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify({ error: String(error), state }, null, 2),
    );
  }
  throw error;
} finally {
  await browser?.close();
  if (mock) await new Promise((r) => mock.close(r));
  if (remote) await new Promise((r) => remote.close(r));
  server.kill();
}
