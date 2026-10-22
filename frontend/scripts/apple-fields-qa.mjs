// Opt-in real macOS Foundation Models regression. No mock model/cloud service.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/apple-fields"),
);
fs.mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString("hex");
const tokenFile = path.join(out, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    path.join(out, "profile"),
    "--demo-data",
    "serve",
    "--listen",
    "127.0.0.1:0",
    "--token-file",
    tokenFile,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const report = {
  passed: false,
  provider: "actual Apple on-device Foundation Models",
  checks: [],
};
const selectedCases = new Set(
  (process.env.CHRONOSCOPE_FIELD_CASES || "").split(",").filter(Boolean),
);
if (selectedCases.size) report.caseFilter = [...selectedCases];
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error("Local bridge startup timeout")),
      15000,
    );
    server.stderr.on("data", (data) => {
      log += data;
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    server.on("error", reject);
  });
  async function api(command, args = {}) {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
      signal: AbortSignal.timeout(320000),
    });
    const body = await response.json();
    assert(response.ok, JSON.stringify(body));
    return body.result;
  }
  const availability = await api("si_apple_status");
  assert(availability.available, availability.reason);
  await api("si_configure", { provider: "apple-local" });
  async function ask(name, prompt, field, scope = "all", quoteExample = false) {
    if (selectedCases.size && !selectedCases.has(name)) return;
    await api("si_clear");
    const expected = await api("field_profile", { fields: [field], scope });
    const started = performance.now();
    const result = await api("si_run", { prompt });
    const check = {
      name,
      prompt,
      seconds: (performance.now() - started) / 1000,
      expected,
      result,
    };
    report.checks.push(check);
    save();
    assert(result.completed, JSON.stringify(result));
    const evidence = result.tool_calls
      .filter(
        (tool) =>
          tool.ok && tool.tool.replace(/^chronoscope_/, "") === "field_profile",
      )
      .map((tool) => tool.presentation?.summary)
      .find((summary) => summary?.profiles?.some((p) => p.field === field));
    assert(
      evidence,
      name +
        ": no successful field profile evidence: " +
        JSON.stringify(result),
    );
    assert.equal(
      evidence.input_count,
      expected.input_count,
      name + ": wrong count scope",
    );
    // With no filters, visible and all are equivalent. The filtered all/visible
    // cases below require distinct denominators and catch real scope mistakes.
    const equivalentUnfiltered =
      scope === "all" &&
      evidence.scope.mode === "visible" &&
      !evidence.scope.filter.search &&
      !evidence.scope.filter.start &&
      !evidence.scope.filter.end &&
      !evidence.scope.filter.bounds &&
      !evidence.scope.filter.selected_only &&
      !evidence.scope.filter.located_only &&
      [
        "hidden_entities",
        "hidden_categories",
        "hidden_sources",
        "predicates",
      ].every((key) => !evidence.scope.filter[key]?.length);
    assert(
      evidence.scope.mode === scope || equivalentUnfiltered,
      name + ": wrong scope",
    );
    const actual = evidence.profiles.find((profile) => profile.field === field);
    for (const key of [
      "present_count",
      "null_count",
      "empty_string_count",
      "empty_collection_count",
      "non_empty_count",
      "distinct_count",
      "finite_numeric_count",
    ])
      assert.equal(actual[key], expected.profiles[0][key], name + ": " + key);
    const plainAnswer = result.answer.replaceAll("*", "");
    if (/distinct|unique/i.test(plainAnswer)) {
      const distinct = expected.profiles[0].distinct_count;
      const quotedCount = new RegExp(
        `(?:\\b${distinct}\\b[^.\\n]{0,40}(?:distinct|unique)|(?:distinct|unique)[^.\\n]{0,40}\\b${distinct}\\b)`,
        "i",
      );
      assert(
        quotedCount.test(plainAnswer),
        name +
          ": explanation confused record and distinct-value counts: " +
          result.answer,
      );
    }
    if (quoteExample)
      assert(
        expected.profiles[0].examples.some(
          (example) =>
            typeof example.value === "string" &&
            example.value.length > 0 &&
            result.answer.toLowerCase().includes(example.value.toLowerCase()),
        ),
        name + ": answer did not cite a stored example",
      );
    check.passed = true;
    save();
    console.log("PASS " + name + " (" + check.seconds.toFixed(1) + "s)");
  }
  await ask(
    "canonical text",
    "Examine the label field across all events and tell me what kind of data I'm dealing with there. Show actual examples.",
    "label",
    "all",
    true,
  );
  await ask(
    "imported numeric text",
    "What kind of data is in the confidence column across all events? Is anything missing? Show examples.",
    "attribute:confidence",
    "all",
    true,
  );
  await ask(
    "numeric field",
    "Inspect the value field across all records. Is it numeric, and are there null or empty values? Show examples.",
    "value",
  );
  await ask(
    "empty strings",
    "Is the note field empty, null, or populated across all events? Check the data and distinguish those cases.",
    "note",
  );
  await ask(
    "collections",
    "What is stored in tags across all events? Are these null values, empty collections, or populated collections?",
    "tags",
  );
  await ask(
    "UTC dates",
    "What does time_utc contain across all events? Inspect its values and whether any are missing, with examples.",
    "time_utc",
  );
  await api("filter", {
    filter: { hidden_entities: ["Atlas", "Beacon", "Cedar", "Delta"] },
  });
  await ask(
    "empty visible scope",
    "Within the currently visible rows only, what label values are there? Keep the scope visible rather than all events.",
    "label",
    "visible",
  );
  await ask(
    "all despite hidden rows",
    "Inspect label across the entire dataset, including events hidden by the current filters. Show stored examples.",
    "label",
    "all",
    true,
  );
  await api("filter", { filter: {} });
  await api("select", { ids: ["1", "49"], mode: "replace" });
  await ask(
    "selected scope",
    "Inspect the category field among selected events only, with examples and missing/empty counts.",
    "category",
    "selected",
    true,
  );
  await api("edit", {
    id: "1",
    changes: { note: "Unusually long stored text. ".repeat(400) },
  });
  await ask(
    "omitted text",
    "Across all events, inspect note again. Distinguish empty strings from populated values and acknowledge any examples too long to display.",
    "note",
  );
  await api("si_clear");
  const creative = await api("si_run", {
    prompt:
      "Write a friendly two-line poem about autumn. Include the word cedar. This is creative writing; no dataset inspection is needed.",
  });
  assert.match(creative.answer, /cedar/i);
  assert.equal(
    creative.tool_calls.length,
    0,
    "Creative chat should not be routed into field inspection",
  );
  report.checks.push({
    name: "free-form chat",
    passed: true,
    result: creative,
  });
  report.passed = true;
  save();
  console.log("PASS free-form chat");
} catch (error) {
  report.error = String(error);
  save();
  throw error;
} finally {
  server.kill();
}
