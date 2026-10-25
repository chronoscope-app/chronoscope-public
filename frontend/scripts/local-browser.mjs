import { chromium, spawn, localServerUrl, createApi } from "./qa-runtime.mjs";
// Isolated local Rust bridge + offline renderer, shared by focused developer tools.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
export const root = path.resolve(import.meta.dirname, "../..");
export async function withLocalApp(name, run, { demo = false } = {}) {
  const out = process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa", name);
  fs.mkdirSync(out, { recursive: true });
  const profile =
    process.env.CHRONOSCOPE_QA_DATA_DIR ||
    fs.mkdtempSync(path.join(out, "profile-"));
  fs.mkdirSync(profile, { recursive: true });
  const token = randomBytes(32).toString("hex"),
    tokenFile = path.join(profile, "token");
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  const server = spawn(
    process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
    [
      "--data-dir",
      profile,
      ...(demo ? ["--demo-data"] : []),
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
  const errors = [],
    report = { passed: false, checks: [], publicRequests: 0, errors };
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
        terrain_path: null,
        terrain_builtin: false,
      },
    });
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    page.setDefaultTimeout(30000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (/^https?:/.test(u) && !u.startsWith(url + "/")) {
        report.publicRequests++;
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(url + "/#token=" + token);
    await page.waitForFunction(
      () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
    );
    const pass = (name) => {
      report.checks.push(name);
      console.log("PASS", name);
    };
    await run({ page, api, out, root, pass });
    assert.deepEqual(errors, []);
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
}
