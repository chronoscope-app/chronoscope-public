import assert from "node:assert/strict";
import fs from "node:fs";
import { withLocalApp } from "./local-browser.mjs";
await withLocalApp("mcp-live", async ({ page, api, out, pass }) => {
  const request = (kind, args = {}) =>
    page.evaluate(
      ([kind, args]) => window.__chronoscope.liveViewRequest(kind, args),
      [kind, args],
    );
  await page.evaluate(() => window.__chronoscope.ready);
  await api("demo_open", { id: "local-wildlife" });
  await page.evaluate(() => window.__chronoscope.refresh());
  await request("view_wait", {
    timeout_ms: 10000,
    imagery: false,
    stable_ms: 50,
  });
  const source = await request("view_playback", { action: "status" });
  await request("view_playback", {
    action: "configure",
    speed: 0.5,
    increment_seconds: 1,
  });
  const target = await page.evaluate(
    () => window.__chronoscope.snapshot.time_bounds[0] + 10,
  );
  let playback = await request("view_playback", {
    action: "seek",
    time: target,
  });
  assert(Math.abs(playback.time - target) < 0.001);
  assert.equal(playback.playing, false);
  playback = await request("view_playback", { action: "step", steps: 3 });
  assert(Math.abs(playback.time - target - 3) < 0.001);
  assert.equal(
    (await request("view_playback", { action: "play" })).playing,
    true,
  );
  assert.equal(
    (await request("view_playback", { action: "play" })).playing,
    true,
  );
  await page.waitForTimeout(120);
  assert.equal(
    (await request("view_playback", { action: "pause" })).playing,
    false,
  );
  assert.equal(
    await page.locator("#playback-speed").getAttribute("aria-label"),
    "Playback speed: 0.5×",
  );
  // Two immediate UI clicks must not let an older pause overwrite the new Play state.
  await request("view_playback", { action: "play" });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    document.querySelector("#play").click();
    document.querySelector("#play").click();
  });
  await page.evaluate(() => window.__chronoscope.filterIdle());
  await page.waitForTimeout(50);
  assert.equal(
    (await request("view_playback", { action: "status" })).playing,
    true,
  );
  assert((await page.locator("#play").innerText()).includes("Pause"));
  await request("view_playback", { action: "pause" });
  pass("Real timeline seek/step/play/pause and visible speed control");
  const steps = [
    { command: "view_set", arguments: { mode: "map", fit: true } },
    { command: "view_wait", arguments: { imagery: false, timeout_ms: 10000 } },
    { command: "view_navigate", arguments: { action: "zoom", factor: 1.2 } },
    { command: "wait", arguments: { milliseconds: 300 } },
  ];
  const run = await request("view_scenario", {
    action: "run",
    name: "Map movement",
    steps,
    timeout_seconds: 15,
  });
  let result;
  for (let i = 0; i < 100; i++) {
    result = await request("view_scenario", { action: "status", id: run.id });
    if (result.state !== "running") break;
    await page.waitForTimeout(100);
  }
  assert.equal(result.state, "complete", JSON.stringify(result));
  assert.equal(result.completed_steps, 4);
  assert.equal(result.trace[0].mode, "map");
  const profile = await request("view_profile", {
    action: "status",
    id: result.profile_id,
  });
  assert.equal(profile.state, "complete");
  assert(profile.samples.length > 1);
  assert.equal(profile.columns.length, profile.samples[0].length);
  pass(
    "Asynchronous navigation scenario changes the actual view and retains frame telemetry",
  );
  const cancelled = await request("view_scenario", {
    action: "run",
    name: "Cancel",
    steps: [{ command: "wait", arguments: { milliseconds: 4000 } }],
  });
  await request("view_scenario", { action: "cancel", id: cancelled.id });
  await page.waitForTimeout(150);
  assert.equal(
    (await request("view_scenario", { action: "status", id: cancelled.id }))
      .state,
    "cancelled",
  );
  // Prepare the replacement before starting the guarded wait. Loading a demo
  // may legitimately exceed four seconds on software-rendered Linux; a scenario
  // completed before the workspace changes must retain its completed result.
  const previousWorkspace = await page.evaluate(
    () => window.__chronoscope.snapshot.workspace_id,
  );
  await api("demo_open", { id: "local-wildlife" });
  const replacement = await api("snapshot", { compact: true });
  assert.notEqual(replacement.workspace_id, previousWorkspace);
  assert.equal(
    await page.evaluate(() => window.__chronoscope.snapshot.workspace_id),
    previousWorkspace,
  );
  const changed = await page.evaluate(async () => {
    const app = window.__chronoscope;
    const run = await app.liveViewRequest("view_scenario", {
      action: "run",
      name: "Workspace guard",
      steps: [{ command: "wait", arguments: { milliseconds: 4000 } }],
    });
    await app.refresh();
    return run;
  });
  assert.equal(changed.state, "running");
  let guarded;
  for (let i = 0; i < 100; i++) {
    guarded = await request("view_scenario", {
      action: "status",
      id: changed.id,
    });
    if (guarded.state !== "running") break;
    await page.waitForTimeout(50);
  }
  assert.equal(guarded.state, "failed", JSON.stringify(guarded));
  assert.match(guarded.error, /CONFLICT: workspace changed/);
  assert.equal(guarded.completed_steps, 0);
  assert.equal(
    (await request("view_scenario", { action: "status", id: run.id })).state,
    "complete",
    "Changing workspaces must not invalidate a previously completed scenario",
  );
  const timeout = await request("view_scenario", {
    action: "run",
    name: "Deadline",
    timeout_seconds: 0.15,
    steps: [{ command: "wait", arguments: { milliseconds: 4000 } }],
  });
  await page.waitForTimeout(250);
  assert.equal(
    (await request("view_scenario", { action: "status", id: timeout.id }))
      .state,
    "failed",
  );
  pass(
    "Cancellation, deadlines and workspace isolation stop remaining scenario steps",
  );

  // Exercise the actual HTML resource in a sandbox with the published MCP Apps handshake.
  const html = fs.readFileSync(
    new URL("../../src/mcp/app.html", import.meta.url),
    "utf8",
  );
  const mount = async (chartMode = false) =>
    page.evaluate(
      async ([html, chartMode]) => {
        window.mcpCalls = [];
        const c = window.__chronoscope;
        const input = chartMode
          ? {
              config: {
                kind: "bar",
                x: "entity",
                aggregate: "count",
                limit: 8,
              },
            }
          : { fields: ["id", "label", "entity"], limit: 8 };
        const frame = document.createElement("iframe");
        frame.id = "mcp-explorer";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.style.cssText =
          "position:fixed;inset:40px;width:900px;height:650px;z-index:999999;background:white";
        window.addEventListener("message", async (event) => {
          if (event.source !== frame.contentWindow) return;
          const m = event.data,
            reply = (result) =>
              frame.contentWindow?.postMessage(
                { jsonrpc: "2.0", id: m.id, result },
                "*",
              );
          if (m.method === "ui/initialize") {
            window.mcpInit = m.params;
            reply({
              protocolVersion: "2026-01-26",
              hostContext: { theme: "light" },
              hostCapabilities: {},
            });
          }
          if (m.method === "ui/notifications/initialized") {
            frame.contentWindow?.postMessage(
              {
                jsonrpc: "2.0",
                method: "ui/notifications/tool-input",
                params: {
                  arguments: input,
                },
              },
              "*",
            );
            const data = await c.call(
              chartMode ? "chart_data" : "query",
              input,
            );
            if (!chartMode)
              data.events[0].label = "<img src=x onerror=alert(1)>";
            data.workspace_id = c.snapshot.workspace_id;
            frame.contentWindow?.postMessage(
              {
                jsonrpc: "2.0",
                method: "ui/notifications/tool-result",
                params: { structuredContent: data, content: [] },
              },
              "*",
            );
          }
          if (m.method === "tools/call") {
            window.mcpCalls.push(m.params);
            try {
              const name = m.params.name.replace("chronoscope_", ""),
                result = await c.call(name, m.params.arguments);
              if (name === "query") {
                await c.refresh();
                result.workspace_id = c.snapshot.workspace_id;
              }
              reply({ structuredContent: result, isError: false });
            } catch (error) {
              reply({
                structuredContent: { error: { message: String(error) } },
                isError: true,
              });
            }
          }
        });
        frame.srcdoc = html;
        document.body.append(frame);
      },
      [html, chartMode],
    );
  await mount();
  const frame = page.frameLocator("#mcp-explorer");
  await frame.locator("tbody tr").first().waitFor();
  assert.equal(
    (await page.evaluate(() => window.mcpInit)).protocolVersion,
    "2026-01-26",
  );
  assert.equal(await frame.locator("tbody tr").count(), 8);
  assert.equal(await frame.locator("img").count(), 0);
  assert(
    await frame
      .locator("tbody")
      .innerText()
      .then((t) => t.includes("<img src=x onerror=alert(1)>")),
  );
  await frame.getByRole("button", { name: "id", exact: true }).click();
  await frame
    .getByRole("button", { name: "Select", exact: true })
    .first()
    .click();
  await frame
    .locator("#status")
    .filter({ hasText: "Selected 1 Events" })
    .waitFor();
  const call = (await page.evaluate(() => window.mcpCalls)).at(-1);
  assert.equal(call.name, "chronoscope_select");
  assert(call.arguments.expected_workspace);
  assert(Number.isInteger(call.arguments.expected_revision));
  await frame.getByRole("button", { name: "Refresh", exact: true }).click();
  await frame.locator("#status").filter({ hasText: "total Events" }).waitFor();
  await frame
    .getByRole("button", { name: "Select", exact: true })
    .first()
    .waitFor({ state: "visible" });
  await page.evaluate(() =>
    document
      .querySelector("#mcp-explorer")
      .contentWindow.postMessage(
        { jsonrpc: "2.0", id: 100, method: "ui/resource-teardown" },
        "*",
      ),
  );
  pass(
    "Sandboxed MCP App initializes, displays/sorts exact rows, selects real Events and refreshes",
  );
  await page.evaluate(() => document.querySelector("#mcp-explorer").remove());
  await mount(true);
  await frame.locator("svg rect").first().waitFor();
  await frame
    .getByRole("button", { name: "Select", exact: true })
    .first()
    .click();
  await frame
    .locator("#status")
    .filter({ hasText: /Selected \d+ Events/ })
    .waitFor();
  const linked = (await page.evaluate(() => window.mcpCalls)).at(-1);
  assert.equal(linked.name, "chronoscope_select_query");
  assert(linked.arguments.config && linked.arguments.chart_marks.length === 1);
  pass(
    "MCP App renders a bar chart and selects its exact source Events; imported markup stays inert",
  );
  fs.writeFileSync(
    `${out}/report.json`,
    JSON.stringify(
      {
        scenario: result,
        profile_samples: profile.samples.length,
        playback_initial: source,
        passed: true,
      },
      null,
      2,
    ),
  );
});
