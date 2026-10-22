// Opt-in real macOS Foundation Models regression. No mock model/cloud service.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/apple-discovery"),
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
  await api("open", {
    path: path.join(root, "samples/atlantic-hurricanes-2016-2025.chronoscope"),
  });
  async function ask(name, prompt, field = null, scope = "all") {
    const started = performance.now();
    const result = await api("si_run", { prompt });
    const check = {
      name,
      prompt,
      seconds: (performance.now() - started) / 1000,
      result,
    };
    report.checks.push(check);
    save();
    assert(result.completed, JSON.stringify(result));
    assert(
      !/no (?:built.in )?(?:tools|analytic capabilities)|toolkit lacks|no actual raw records exist/i.test(
        result.answer,
      ),
      result.answer,
    );
    if (field) {
      const expected = await api("field_profile", { fields: [field], scope });
      const evidence = result.tool_calls
        .filter((t) => t.ok)
        .map((t) => t.presentation?.summary)
        .find((s) => s?.profiles?.some((p) => p.field === field));
      assert(
        evidence,
        "No actual evidence for requested field: " + JSON.stringify(result),
      );
      const p = evidence.profiles.find((p) => p.field === field);
      for (const key of ["non_empty_count", "distinct_count", "null_count"])
        assert.equal(p[key], expected.profiles[0][key], key);
      assert.equal(evidence.input_count, expected.input_count);
    } else {
      // Capability advice can use the engine-generated inventory supplied with
      // every request; a data-result question below must call real tools.
      assert.match(result.answer, /query|summar|statistic|analytic/i);
    }
    check.passed = true;
    save();
    console.log("PASS " + name);
  }
  await ask(
    "dataset exploration ideas",
    "give me some ideas to examine this data that you can do",
  );
  await ask(
    "follow-up label field",
    "Look at the label column across all events. What is actually stored there? Show examples.",
    "label",
  );
  await ask(
    "follow-up category field",
    "Now inspect the category column across all events, not label or value. What values are there?",
    "category",
  );
  await api("select_query", {
    filter: {
      predicates: [{ field: "entity", op: "Equals", value: "Dorian 2019" }],
    },
    mode: "replace",
  });
  await ask(
    "selected field inspection",
    "Inspect label among selected events only. Describe actual stored values and their counts.",
    "label",
    "selected",
  );
  report.passed = true;
  save();
} catch (error) {
  report.error = String(error);
  save();
  throw error;
} finally {
  server.kill();
  fs.rmSync(tokenFile, { force: true });
}
