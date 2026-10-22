// Opt-in macOS test: real Rust bridge, real Apple on-device model, no cloud service.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/apple-local"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenPath = path.join(out, "token");
fs.writeFileSync(tokenPath, token, { mode: 0o600 });
const cli =
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope");
const server = spawn(
  cli,
  [
    "--data-dir",
    path.join(out, "profile"),
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenPath,
    "--frontend",
    path.join(root, "frontend/dist"),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browser;
const report = {
  passed: false,
  provider: "actual Apple on-device Foundation Models",
  checks: [],
  errors: [],
  publicRequests: 0,
};
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    server.stderr.on("data", (d) => {
      log += d;
      const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (m) resolve(m[0]);
    });
    server.on("error", reject);
    setTimeout(() => reject(Error("Startup timeout")), 15000).unref();
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
    const data = await r.json();
    assert(r.ok, JSON.stringify(data));
    return data.result;
  };
  const availability = await api("si_apple_status");
  assert(availability.available, availability.reason);
  const preferences = await api("preferences");
  await api("preferences", {
    preferences: {
      ...preferences,
      basemap: "none",
      map: { ...preferences.map, enabled: false },
      map_layers: [],
    },
  });

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
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(url))
      report.publicRequests++;
  });
  await page.goto(url + "/#token=" + token);
  await page.waitForFunction(
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  await page.click("#si");
  await page.click("#si-settings");
  await page.selectOption("#si-provider", "apple-local");
  assert(await page.locator("#si-service-fields").isHidden());
  await page.click("#si-connect");
  await page.waitForFunction(
    () => !document.querySelector("#si-send").disabled,
  );
  assert.equal((await api("si_status")).provider, "apple-local");
  assert(await page.locator(".si-permissions").isVisible());
  assert(await page.locator(".si-file-permissions").isHidden());
  assert.equal(await page.locator("#si-connections").count(), 0);
  report.checks.push(
    "local provider needs no API key/file folder; workspace edit and granted external-action permissions remain available",
  );
  const send = async (text) => {
    const count = await page.locator(".si-message-assistant").count();
    await page.fill("#si-prompt", text);
    await page.click("#si-send");
    try {
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(".si-message-assistant").length > n &&
          !document.querySelector("#si-send").disabled,
        count,
      );
    } catch (error) {
      throw new Error(
        String(error) +
          "\nChat: " +
          (await page.locator("#si-messages").textContent()) +
          "\nStatus: " +
          (await page.locator("#si-progress").textContent()),
      );
    }
    return await page.locator(".si-message-assistant").last().textContent();
  };
  assert.equal(
    await page.locator("#si-prompt").getAttribute("maxlength"),
    null,
  );
  assert.equal(await page.locator("#si-local-ideas").count(), 0);
  assert.match(
    await send(
      "Write a friendly four-line poem about autumn leaves. Include the word cedar.",
    ),
    /cedar/i,
  );
  report.checks.push(
    "free-form creative chat replaces the analysis classifier; no local textarea character cap",
  );
  const longPrompt =
    "This is a free-form conversation test, rather than a workspace action. " +
    "The setting is an imaginary quiet forest beside a lake. ".repeat(9) +
    "For our fictional story, the spaceship is named Copper Lantern. Confirm its name.";
  assert(longPrompt.length > 400);
  assert.match(await send(longPrompt), /Copper Lantern/i);
  assert.match(
    await send("What is the spaceship called? Reply with its name."),
    /Copper Lantern/i,
  );
  const history = await api("si_history");
  assert.equal(history.limit_messages, null);
  assert.equal(history.limit_bytes, null);
  report.checks.push(
    "messages longer than 400 characters and multi-turn follow-up memory work through the real Rust provider",
  );
  assert.match(
    await send(
      "How many events are in the current workspace? Use the supplied workspace summary.",
    ),
    /192/,
  );
  report.checks.push(
    "free-form chat receives the current compact workspace summary",
  );
  await send(
    "Use discover_analytics and describe_analytics to choose quantiles, then run_analytics on field value with probabilities [0.5] across all Events. Do not calculate the median yourself.",
  );
  const artifacts = await api("analytics_list");
  assert(
    artifacts.results.some((r) => r.capability === "quantiles"),
    "Apple must execute a real Rust analytic plan",
  );
  assert(
    (await page
      .getByRole("button", { name: "Open analysis result", exact: true })
      .count()) > 0,
  );
  report.checks.push(
    "real Apple Foundation Models discovers, describes and runs Rust quantiles, producing a persistent result link",
  );
  await page.screenshot({ path: path.join(out, "free-form-chat.png") });
  await page.click("#si-new");
  await page.waitForFunction(
    () => document.querySelectorAll(".si-message").length === 0,
  );
  assert.deepEqual((await api("si_history")).messages, []);
  report.checks.push("New chat clears the UI and model conversation memory");
  // Verify actual tool evidence, not just a plausible model-written answer.
  const askWithTools = async (prompt, allowEdits = false) => {
    await api("si_clear");
    const result = await api("si_run", { prompt, allow_edits: allowEdits });
    assert(result.completed, JSON.stringify(result));
    assert(
      result.tool_calls?.some((t) => t.ok),
      "No successful tool calls: " + JSON.stringify(result),
    );
    report.checks.push({
      prompt,
      answer: result.answer,
      tools: result.tool_calls,
    });
    return result;
  };
  const query = await askWithTools(
    "Use query_events to read exactly two events from all records, with fields id, entity, time_utc and year_utc. Report their exact IDs and times. Do not just repeat workspace counts.",
  );
  assert(query.tool_calls.some((t) => /query/.test(t.tool) && t.ok));
  const expectedRows = (
    await api("query", {
      apply_filter: false,
      fields: ["id", "entity", "time_utc", "year_utc"],
      limit: 2,
    })
  ).events;
  for (const row of expectedRows)
    assert(query.answer.includes(row.id), query.answer);
  const expectedYears = await api("aggregate", {
    apply_filter: false,
    group_by: "year",
  });
  const years = await askWithTools(
    "Use summarize_events over all records grouped by UTC year. Report each exact year and event count; do not calculate counts from sampled rows.",
  );
  assert(years.tool_calls.some((t) => /aggregate/.test(t.tool) && t.ok));
  for (const group of expectedYears.groups) {
    assert(years.answer.includes(group.key), years.answer);
    assert(years.answer.includes(String(group.count)), years.answer);
  }
  const expectedStats = await api("statistics", {
    apply_filter: false,
    field: "lat",
    other_field: "lon",
  });
  const stats = await askWithTools(
    "Use numeric_statistics over all records with field lat and otherField lon. Explain the exact numeric count, missing count, mean latitude and Pearson correlation from Rust's result. Correlation alone does not establish causation.",
  );
  assert(stats.tool_calls.some((t) => /statistics/.test(t.tool) && t.ok));
  assert(
    stats.answer.includes(String(expectedStats.summary.count)),
    stats.answer,
  );
  report.expectedStatistics = expectedStats;
  // This exercises the generic discovery bridge, beyond its native shortcuts.
  const entity = expectedRows[0].entity;
  const selection = await askWithTools(
    `Discover and use the selection tool to replace the current selection with all events whose entity equals ${JSON.stringify(entity)}. Preserve the dataset.`,
  );
  assert(selection.tool_calls.some((t) => /select/.test(t.tool) && t.ok));
  const expectedCount = (
    await api("aggregate", { apply_filter: false, group_by: "entity" })
  ).groups.find((g) => g.key === entity).count;
  assert.equal(
    (await api("snapshot", { compact: true })).selected_count,
    expectedCount,
  );
  await askWithTools(
    "Discover and use the tag tool to add the tag AppleToolQA to the selected events. Record changes are permitted for this message.",
    true,
  );
  const tagged = await api("query", {
    selected_only: true,
    fields: ["id", "tags"],
    limit: 25,
  });
  assert(tagged.events.length > 0);
  assert(tagged.events.every((row) => row.tags.includes("AppleToolQA")));
  await api("undo");
  await api("si_clear");
  // Cancellation is cooperative in Rust and kills the separate native inference process.
  const job = await api("job_start", {
    command: "si_run",
    arguments: {
      prompt: "Write a long imaginative story about a forest adventure.",
    },
  });
  await api("job_cancel", { job_id: job.job_id });
  let cancelled;
  for (let i = 0; i < 100; i++) {
    cancelled = await api("job_result", { job_id: job.job_id });
    if (!["running", "queued"].includes(cancelled.status)) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(cancelled.status, "cancelled");
  await api("job_release", { job_id: job.job_id });
  report.checks.push("Stop cancels native conversational inference");
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill();
}
console.log(JSON.stringify(report, null, 2));
