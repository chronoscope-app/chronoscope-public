import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Real Rust engine + two browser windows + a deterministic mock SI service.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../.."),
  out = path.resolve(
    process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/si-rich-chat"),
  );
fs.mkdirSync(out, { recursive: true });
const report = {
  passed: false,
  checks: [],
  errors: [],
  publicRequests: 0,
  chatCesiumRequests: 0,
  serviceCalls: 0,
  nativeMacTested: false,
};
let releaseFirst;
const firstGate = new Promise((resolve) => (releaseFirst = resolve));
let releaseCancel;
const cancelGate = new Promise((resolve) => (releaseCancel = resolve));
const tool = (name, args) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tool-" + report.serviceCalls,
            type: "function",
            function: {
              name: "chronoscope_" + name,
              arguments: JSON.stringify(args),
            },
          },
        ],
      },
    },
  ],
});
const answer = (text) => ({
  choices: [{ message: { role: "assistant", content: text } }],
});
const service = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const request = JSON.parse(raw);
  report.serviceCalls++;
  assert(!JSON.stringify(request.messages).includes("data:image/png"));
  let reply;
  switch (report.serviceCalls) {
    case 1:
      await firstGate;
      reply = tool("analytics_run", {
        plan: {
          capability: "group",
          scope: "all",
          parameters: {
            group_by: ["year_utc"],
            field: "attribute:max_wind_kt",
          },
        },
      });
      break;
    case 2: {
      const last = JSON.parse(request.messages.at(-1).content);
      assert.equal(last.input_count, 1604);
      reply = tool("present_result", {
        kind: "analysis",
        result_id: last.result_id,
        chart: "bar",
        x: "group_0",
        y: "mean",
        title: "Annual hurricane wind measurements",
      });
      break;
    }
    case 3:
      reply = answer(
        "## Atlantic hurricane activity\n\nRust evaluated **1,604 Events** across five UTC years. Each measurement is one track position.\n\n| Scope | Method |\n| --- | --- |\n| All Events | Annual comparison |\n\nThe chart shows the **mean recorded wind speed** by year. This does not establish a climate trend.\n\n[NOAA source](https://www.nhc.noaa.gov/data/)\n\n$$\n\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i\n$$\n\n",
      );
      break;
    case 4:
      reply = tool("analytics_run", {
        plan: {
          capability: "outliers",
          scope: "all",
          parameters: {
            field: "attribute:max_wind_kt",
            method: "zscore",
            threshold: 1.5,
          },
        },
      });
      break;
    case 5:
      reply = answer(
        "### High wind candidates\n\nThese are **candidates**, not errors. Select a result row to inspect its Event in the workspace.",
      );
      break;
    case 6:
      await cancelGate;
      reply = answer("Cancelled response must not appear.");
      break;
    default:
      throw Error("Unexpected service request " + report.serviceCalls);
  }
  if (!res.destroyed) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  }
});
await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  cli,
  [
    "--data-dir",
    path.join(out, "profile"),
    "--project",
    path.join(root, "samples/atlantic-hurricanes-2021-2025-tracks.chronoscope"),
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
  const url = await localServerUrl(server);
  const api = createApi(url, token);
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      theme: "dark",
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
    },
  });
  await api("si_configure", {
    url: `http://127.0.0.1:${service.address().port}/v1`,
    model: "deterministic-qa",
  });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
  });
  const csp = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")),
  ).app.security.csp;
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    } else await route.continue();
  });
  const track = (page) => {
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => report.errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(url))
        report.publicRequests++;
      if (
        page.url().includes("si.html") &&
        /\/cesium\/|\/assets\/cesium-|streets-/.test(r.url())
      )
        report.chatCesiumRequests++;
    });
  };
  context.on("page", track);
  const main = await context.newPage();
  await main.goto(url + "/#token=" + token);
  await main.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 1604 &&
      !window.__chronoscope.busy,
  );
  await main.click("#si");
  await main.fill("#si-prompt", "Preserve this draft across windows.");
  let pending = context.waitForEvent("page");
  await main.click("#si-popout");
  let popup = await pending;
  await popup.waitForSelector("#si-prompt");
  await popup.waitForFunction(
    () =>
      document.querySelector("#si-prompt").value ===
      "Preserve this draft across windows.",
  );
  assert(await main.locator("#si-chat").isHidden());
  await popup.click("#si-popout");
  await main.waitForSelector("#si-chat:not([hidden])");
  assert.equal(
    await main.inputValue("#si-prompt"),
    "Preserve this draft across windows.",
  );
  report.checks.push(
    "Pop out and dock preserve the draft and share one Rust conversation",
  );
  await main.fill(
    "#si-prompt",
    "Compare Atlantic hurricane wind measurements by UTC year.",
  );
  // Deliver an old idle poll only after Send has queued the new worker.
  let releaseIdlePoll, idlePollCaptured, idlePollDelivered;
  const idleGate = new Promise((r) => (releaseIdlePoll = r));
  const captured = new Promise((r) => (idlePollCaptured = r));
  const delivered = new Promise((r) => (idlePollDelivered = r));
  let heldIdle = false;
  await main.route("**/api/invoke", async (route) => {
    const command = route.request().postDataJSON()?.command;
    if (command !== "si_chat_state" || heldIdle) return route.continue();
    heldIdle = true;
    const response = await route.fetch();
    idlePollCaptured();
    await idleGate;
    await route.fulfill({ response });
    idlePollDelivered();
  });
  await captured;
  await main.click("#si-send");
  await main.waitForFunction(
    () => !document.querySelector("#si-prompt").disabled,
  );
  await main.evaluate(() => {
    window.__idleDuringRequest = false;
    const progress = document.querySelector("#si-progress");
    window.__progressObserver = new MutationObserver(() => {
      if (progress.textContent === "Ready") window.__idleDuringRequest = true;
    });
    window.__progressObserver.observe(progress, {
      childList: true,
      subtree: true,
    });
  });
  releaseIdlePoll();
  await delivered;
  await main.waitForFunction(
    () =>
      !!document.querySelector("#si-stop") &&
      !document.querySelector("#si-stop").hidden,
  );
  assert.equal(await main.evaluate(() => window.__idleDuringRequest), false);
  await main.evaluate(() => window.__progressObserver.disconnect());
  await main.unroute("**/api/invoke");
  report.checks.push(
    "A stale idle poll cannot overwrite a newly submitted request's working state",
  );
  pending = context.waitForEvent("page");
  await main.click("#si-popout");
  popup = await pending;
  await popup.waitForFunction(
    () =>
      !!document.querySelector("#si-stop") &&
      !document.querySelector("#si-stop").hidden,
  );
  await popup.reload();
  await popup.waitForFunction(
    () =>
      !!document.querySelector("#si-stop") &&
      !document.querySelector("#si-stop").hidden,
  );
  await popup.close();
  await main.waitForSelector("#si-chat:not([hidden])");
  await main.waitForFunction(
    () =>
      !!document.querySelector("#si-stop") &&
      !document.querySelector("#si-stop").hidden,
  );
  pending = context.waitForEvent("page");
  await main.click("#si-popout");
  popup = await pending;
  await popup.waitForSelector("#si-prompt");
  releaseFirst();
  await popup.waitForSelector(".si-message-assistant .si-result-chart canvas");
  await popup.waitForFunction(
    () => !document.querySelector("#si-send").disabled,
  );
  assert.equal(await popup.locator(".si-message-assistant").count(), 1);
  assert.equal(await popup.locator(".si-result-card").count(), 1);
  assert.equal(report.serviceCalls, 3);
  assert.equal(await popup.locator(".si-markdown h2").count(), 1);
  assert.equal(await popup.locator(".si-markdown table").count(), 1);
  assert.equal(await popup.locator(".katex-display").count(), 1);
  assert.equal(
    await popup
      .locator(
        '.si-markdown img,.si-markdown script,.si-markdown a[href^="javascript:"]',
      )
      .count(),
    0,
  );
  assert.equal(await popup.evaluate(() => window.__unsafeChat), undefined);
  assert.equal(
    await popup.locator('.si-markdown a[href^="https:"]').getAttribute("rel"),
    "noopener noreferrer",
  );
  const markdownFile = fs
    .readdirSync(path.join(root, "frontend/dist/assets"))
    .find((name) => /^si-markdown-.*\.js$/.test(name));
  const security = await popup.evaluate(
    async (module) => {
      const { renderMarkdown } = await import(module);
      const node = renderMarkdown(
        '<img src="https://invalid.example/tracker" onerror="window.__unsafeChat=1"><script>window.__unsafeChat=1</script>\n\n![remote](https://invalid.example/pixel.png)\n\n[unsafe](javascript:window.__unsafeChat=1)',
      );
      document.body.append(node);
      await new Promise((r) => setTimeout(r, 100));
      const result = {
        blocked:
          node.querySelectorAll('img,script,[onerror],a[href^="javascript:"]')
            .length === 0,
        executed: window.__unsafeChat === 1,
      };
      node.remove();
      return result;
    },
    url + "/assets/" + markdownFile,
  );
  assert(security.blocked);
  assert(!security.executed);
  await popup.setViewportSize({ width: 1000, height: 1400 });
  await popup.screenshot({
    path: path.join(out, "detached-rich-results-dark.png"),
  });
  report.checks.push(
    "A running request survives pop out, page reload, close and reopen without duplicate SI requests; replies retain one typed inline chart",
  );
  report.checks.push(
    "Markdown headings, emphasis, tables, source links and equations render; raw HTML, scripts, JavaScript links and remote images are blocked",
  );
  await popup.click("#si-capture");
  await popup.waitForSelector(".si-map-picture");
  assert(
    await popup
      .locator(".si-map-picture")
      .evaluate((image) => image.complete && image.naturalWidth > 200),
  );
  await popup.locator(".si-map-picture").scrollIntoViewIfNeeded();
  await popup.screenshot({ path: path.join(out, "inline-map-snapshot.png") });
  report.checks.push(
    "Detached Capture map uses the original main renderer, stores a bounded PNG in Rust and displays it inline without sending pixels to the service",
  );
  await popup.fill("#si-prompt", "Find unusually high wind measurements.");
  await popup.click("#si-send");
  await popup.waitForSelector(".si-result-card tbody tr[tabindex]");
  await popup.waitForFunction(
    () => !document.querySelector("#si-send").disabled,
  );
  await popup.locator(".si-result-card tbody tr[tabindex]").first().click();
  let selection = [];
  for (let i = 0; i < 50; i++) {
    selection = (await api("snapshot", { compact: true })).selected;
    if (selection.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(selection.length, 1);
  report.checks.push(
    "An inline evidence row selects the exact source Event through the shared workspace",
  );
  await api("preferences", {
    preferences: { ...(await api("preferences")), theme: "light" },
  });
  await popup.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await popup.locator(".si-message-assistant").first().scrollIntoViewIfNeeded();
  await popup.screenshot({
    path: path.join(out, "detached-rich-results-light.png"),
  });
  await popup.click("#si-popout");
  await main.waitForSelector("#si-chat:not([hidden])");
  await main.waitForSelector(".si-map-picture");
  assert.equal(await main.locator(".si-message-assistant").count(), 2);
  assert.equal(report.serviceCalls, 5);
  report.checks.push(
    "Docking restores rich cards and snapshots from Rust without repeating calculations or service calls; both themes render",
  );
  await main.fill("#si-prompt", "A request to stop.");
  await main.click("#si-send");
  await main.waitForFunction(
    () =>
      !!document.querySelector("#si-stop") &&
      !document.querySelector("#si-stop").hidden,
  );
  for (let i = 0; i < 100 && report.serviceCalls < 6; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(report.serviceCalls, 6);
  await main.click("#si-stop");
  for (let i = 0; i < 100; i++) {
    if ((await api("si_chat_state")).active?.cancel_requested) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert((await api("si_chat_state")).active?.cancel_requested);
  releaseCancel();
  await main.waitForFunction(
    () => !document.querySelector("#si-send").disabled,
  );
  assert(
    !(await main.locator("#si-messages").textContent()).includes(
      "Cancelled response must not appear.",
    ),
  );
  assert.match(
    await main.locator("#si-messages").textContent(),
    /CANCELLED|cancelled/i,
  );
  report.checks.push(
    "Stop cancels the Rust-owned request and preserves earlier results",
  );
  const state = await api("si_chat_state");
  const image = state.messages
    .flatMap((m) => m.blocks || [])
    .find((b) => b.type === "image");
  await main.click("#si-new");
  await main.waitForFunction(
    () => document.querySelector("#si-messages").children.length === 0,
  );
  const oldImage = await fetch(url + "/api/invoke", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: "si_chat_image",
      args: { image_id: image.image_id },
    }),
  });
  assert(!oldImage.ok);
  assert.equal((await api("snapshot", { compact: true })).count, 1604);
  report.checks.push(
    "New chat clears session text, rich references, drafts and images without altering source Events",
  );
  assert.equal(report.chatCesiumRequests, 0);
  assert.equal(report.publicRequests, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  releaseFirst();
  releaseCancel();
  if (browser) await browser.close();
  server.kill("SIGTERM");
  service.closeAllConnections();
  await new Promise((resolve) => service.close(resolve));
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report, null, 2));
