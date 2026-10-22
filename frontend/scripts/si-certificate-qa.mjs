// Real SI settings against Rust schemas, offline; no identity/PIN/key is used.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../..");
const dir =
  process.env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa/si-certificates/ui");
fs.mkdirSync(dir, { recursive: true });
const profile = fs.mkdtempSync(path.join(dir, "profile-"));
const token = randomBytes(32).toString("hex"),
  tokenFile = path.join(profile, "token");
fs.writeFileSync(tokenFile, token, { mode: 0o600 });
const server = spawn(
  process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
  [
    "--data-dir",
    profile,
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
const report = { passed: false, checks: [], errors: [], publicRequests: 0 };
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS", name);
};
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log)), 20000);
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
      basemap: "none",
      map: { ...prefs.map, enabled: false },
      map_layers: [],
      terrain_path: null,
    },
  });
  browser = await chromium.launch({
    executablePath: process.env.CHRONOSCOPE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 950 },
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
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
    () =>
      window.__chronoscope?.snapshot?.count === 192 &&
      !window.__chronoscope.busy,
  );
  await page.click("#si");
  const open = async () => {
    await page.click("#si-settings");
    await page.waitForSelector("#si-certificate-settings");
  };
  const close = () =>
    page.locator(".si-settings-dialog > footer [data-close]").click();
  await open();
  assert.equal(
    await page.locator("#si-certificate-mode").inputValue(),
    "automatic",
  );
  await page.locator("#si-certificate-settings summary").click();
  assert(await page.locator("#si-certificate-identity-field").isHidden());
  const kind = (await api("si_status")).client_certificate_kind;
  const identity =
    kind === "pkcs11"
      ? "pkcs11:token=Fixture%20Card;id=%01;type=cert"
      : kind === "windows-store"
        ? "CurrentUser\\MY\\" + "A".repeat(40)
        : "Fixture authentication";
  await page.selectOption("#si-certificate-mode", "identity");
  assert(await page.locator("#si-certificate-identity-field").isVisible());
  await page.fill("#si-url", "https://si.example.test/v1");
  await page.fill("#si-model", "fixture");
  await page.fill("#si-certificate-identity", identity);
  await page.click("#si-connect");
  await page.waitForSelector(".si-settings-dialog", { state: "detached" });
  let status = await api("si_status");
  assert.deepEqual(status.client_certificate, {
    origin: "https://si.example.test",
    kind,
    identity,
  });
  assert.equal(status.key_present, false);
  pass(
    "SI Connect accepts a platform certificate identity without an API key or network login probe",
  );
  await open();
  await page.locator("#si-certificate-settings summary").click();
  assert.equal(await page.inputValue("#si-certificate-identity"), identity);
  await page.screenshot({ path: path.join(dir, "si-client-certificate.png") });
  await page.fill("#si-url", "https://other.example.test/v1");
  assert.equal(await page.inputValue("#si-certificate-mode"), "automatic");
  assert.equal(await page.inputValue("#si-certificate-identity"), "");
  assert(await page.locator("#si-certificate-identity-field").isHidden());
  pass(
    "Changing service origin clears the prior server's selected certificate",
  );
  await close();
  await api("si_configure", {
    url: "https://si.example.test/v1",
    model: "fixture",
    client_certificate: {
      origin: "https://si.example.test",
      kind: "disabled",
      identity: "",
    },
  });
  await open();
  await page.locator("#si-certificate-settings summary").click();
  assert.equal(await page.inputValue("#si-certificate-mode"), "disabled");
  assert(await page.locator("#si-certificate-identity-field").isHidden());
  await page.selectOption("#si-certificate-mode", "automatic");
  await page.click("#si-connect");
  await page.waitForSelector(".si-settings-dialog", { state: "detached" });
  assert.equal((await api("si_status")).client_certificate, null);
  pass(
    "Explicit no-certificate override restores, and returning to default removes it",
  );
  await open();
  await page.locator("#si-certificate-settings summary").click();
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.locator("#si-connect").scrollIntoViewIfNeeded();
  assert(await page.locator("#si-connect").isVisible());
  await page.screenshot({
    path: path.join(dir, "si-certificates-small-window.png"),
  });
  pass(
    "Certificate controls and Connect remain reachable in a small settings window",
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.publicRequests, 0);
  report.passed = true;
} finally {
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
