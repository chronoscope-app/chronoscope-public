// Shared test infrastructure only. Product behavior stays in the feature suites.
import { chromium as playwrightChromium } from "playwright";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { browserOptions, runPaths } from "./qa-config.mjs";

export const root = path.resolve(import.meta.dirname, "../..");
const name = path.basename(process.argv[1] || "browser", ".mjs");
const runId = process.env.CHRONOSCOPE_QA_RUN_ID || randomUUID();
export const qaPaths = runPaths(root, name, {
  ...process.env,
  CHRONOSCOPE_QA_OUT:
    process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa", name, runId),
});
for (const p of Object.values(qaPaths)) fs.mkdirSync(p, { recursive: true });
process.env.CHRONOSCOPE_QA_DATA_DIR ||= qaPaths.data;
process.env.CHRONOSCOPE_QA_OUT ||= qaPaths.out;
process.env.CHRONOSCOPE_QA_SCREENSHOTS ||= qaPaths.screenshots;
const children = new Set();
const browsers = new Set();
const metadata = {
  run_id: runId,
  source_revision: process.env.CHRONOSCOPE_QA_SOURCE_REVISION || null,
  suite: name,
  started: new Date().toISOString(),
  platform: process.platform,
  paths: qaPaths,
  browser_launches: [],
  child_processes: [],
};
const publish = () =>
  fs.writeFileSync(
    path.join(qaPaths.out, "runtime.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
publish();

export function spawn(command, args, options) {
  const child = nodeSpawn(command, args, options);
  children.add(child);
  metadata.child_processes.push({
    executable: command,
    pid: child.pid,
    profile: args?.includes("--data-dir")
      ? args[args.indexOf("--data-dir") + 1]
      : null,
  });
  child.once("error", (error) => {
    child.qaStartupError = error;
  });
  child.once("exit", () => children.delete(child));
  publish();
  return child;
}

export function localServerUrl(server, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let log = "";
    const finish = (error, url) => {
      clearTimeout(timer);
      server.stderr.off("data", read);
      server.off("error", fail);
      server.off("exit", exited);
      server.stderr.resume();
      if (error) reject(error);
      else resolve(url);
    };
    const read = (data) => {
      log = (log + data).slice(-8192);
      const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) finish(null, match[0]);
    };
    const fail = (error) => finish(error);
    const exited = (code) =>
      finish(Error(`Local server exited (${code}): ${log}`));
    const timer = setTimeout(() => {
      server.kill();
      fail(Error(`Local server startup timed out: ${log}`));
    }, timeout);
    server.stderr.on("data", read);
    server.once("error", fail);
    server.once("exit", exited);
    if (server.qaStartupError) fail(server.qaStartupError);
    if (server.exitCode !== null) exited(server.exitCode);
  });
}

export function createApi(url, token) {
  return async (command, args = {}) => {
    const response = await fetch(url + "/api/invoke", {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await response.json();
    if (!response.ok) throw Error(`${command}: ${JSON.stringify(body)}`);
    return body.result;
  };
}

function launchOptions(options, hardware) {
  const base = browserOptions(process.env, process.platform, { hardware });
  return { ...base, ...options, args: [...base.args, ...(options.args || [])] };
}
function recordBrowser(resource, resolved, profile = null) {
  browsers.add(resource);
  resource.once(profile ? "close" : "disconnected", () =>
    browsers.delete(resource),
  );
  metadata.browser_launches.push({
    executable: resolved.executablePath || "Playwright Chromium",
    version: (profile ? resource.browser() : resource)?.version(),
    headless: resolved.headless !== false,
    angle: resolved.args
      .find((a) => a.startsWith("--use-angle="))
      ?.split("=")[1],
    ...(profile ? { persistent_profile: profile } : {}),
  });
  publish();
  return resource;
}
export const chromium = {
  async launch(options = {}) {
    const resolved = launchOptions(options);
    return recordBrowser(await playwrightChromium.launch(resolved), resolved);
  },
  async launchHardware(options = {}) {
    const resolved = launchOptions(options, true);
    return recordBrowser(await playwrightChromium.launch(resolved), resolved);
  },
  async launchPersistentContext(profile, options = {}) {
    const resolved = launchOptions(options);
    return recordBrowser(
      await playwrightChromium.launchPersistentContext(profile, resolved),
      resolved,
      profile,
    );
  },
};

process.once("exit", (code) => {
  for (const child of children) child.kill();
  metadata.exit_code = code;
  metadata.finished = new Date().toISOString();
  publish();
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    for (const child of children) child.kill();
    const force = setTimeout(() => process.exit(1), 2000);
    force.unref();
    await Promise.allSettled([...browsers].map((b) => b.close()));
    process.exit(1);
  });
