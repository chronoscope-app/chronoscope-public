import { chromium, spawn, localServerUrl } from "./qa-runtime.mjs";
// Archived opt-in bridge QA. Requires a CLI built with experimental-browser-webmcp.
import { createServer } from "node:http";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../.."),
  dir = path.resolve(
    process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/webmcp"),
  );
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
let browser, fixture;
try {
  const url = await localServerUrl(server);
  const api = async (command, args = {}, success = true) => {
    const r = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const d = await r.json();
    assert.equal(r.ok, success, JSON.stringify(d));
    return success ? d.result : d.error;
  };
  const fixtureHtml = `<!doctype html><title>WebMCP protocol test fixture</title><h1>Local test data service</h1><p id="mode"></p><script>
 window.nativeDraft=!!document.modelContext?.getTools;
 // Explicit protocol fixture only when this Chromium lacks the current draft.
 if(!window.nativeDraft){const tools=[];const context=new EventTarget();context.registerTool=async t=>{tools.push(t);context.dispatchEvent(new Event('toolchange'));};context.getTools=async()=>tools.map(t=>({...t,window,origin:location.origin}));context.executeTool=async(t,args,{signal}={})=>JSON.stringify(await tools.find(x=>x.name===t.name).execute(args,{signal}));Object.defineProperty(document,'modelContext',{value:context});}
 document.querySelector('#mode').textContent=window.nativeDraft?'Native draft API':'Protocol fixture (not native browser WebMCP)';
 window.fixtureReady=(async()=>{
 await document.modelContext.registerTool({name:'records',description:'Read fixture events',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:10}},required:['limit'],additionalProperties:false},annotations:{readOnlyHint:true},execute:async a=>({records:Array.from({length:a.limit},(_,i)=>({id:i+1,lat:43.25,lon:-79.96}))})});
 await document.modelContext.registerTool({name:'action',description:'Test action',inputSchema:{type:'object'},execute:async()=>{window.actions=(window.actions||0)+1;return {actions:window.actions};}});
 await document.modelContext.registerTool({name:'slow',description:'Abortable test call',inputSchema:{type:'object'},execute:async(a,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{window.aborted=true;reject(Error('aborted'));},{once:true});})});
 })();<\/script>`;
  fixture = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fixtureHtml);
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const extension = path.join(root, "browser/webmcp-extension");
  let page, send, harnessMode;
  if (process.env.CHRONOSCOPE_TEST_EXTENSION === "1") {
    browser = await chromium.launchPersistentContext(
      path.join(dir, "profile"),
      {
        ignoreDefaultArgs: ["--disable-extensions"],
        args: ["--enable-unsafe-extension-debugging"],
      },
    );
    const cdp = await browser.browser().newBrowserCDPSession();
    await cdp.send("Extensions.loadUnpacked", { path: extension });
    const worker =
      browser.serviceWorkers()[0] ||
      (await browser.waitForEvent("serviceworker", { timeout: 15000 }));
    const extensionId = new URL(worker.url()).host;
    page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + fixture.address().port);
    await page.evaluate(() => window.fixtureReady);
    const popup = await browser.newPage();
    await popup.goto("chrome-extension://" + extensionId + "/popup.html");
    await page.bringToFront();
    send = (message) =>
      popup.evaluate((message) => chrome.runtime.sendMessage(message), message);
    harnessMode = "installed MV3 extension";
  } else {
    // Managed VM Chromium forbids extension installation. Exercise the shipped
    // background/adapter scripts using Chrome API shims and a REAL browser page.
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + fixture.address().port);
    await page.evaluate(() => window.fixtureReady);
    const { pageAdapter } = await import(
      "data:text/javascript;base64," +
        Buffer.from(
          fs.readFileSync(path.join(extension, "page-adapter.js"), "utf8"),
        ).toString("base64")
    );
    globalThis.__webmcpTestAdapter = pageAdapter;
    const extensionId = "abcdefghijklmnopabcdefghijklmnop",
      storage = {},
      listeners = {},
      event = (n) => ({ addListener: (f) => (listeners[n] ??= []).push(f) });
    let documentId = randomBytes(16).toString("hex");
    globalThis.chrome = {
      storage: {
        session: {
          get: async (k) => ({ [k]: storage[k] }),
          set: async (o) => Object.assign(storage, o),
          remove: async (k) => {
            delete storage[k];
          },
        },
      },
      scripting: {
        executeScript: async ({ target, func, args }) => {
          if (target.documentIds && target.documentIds[0] !== documentId)
            throw Error("Stale document");
          const result = await page.evaluate(
            ({ source, args }) => (0, eval)("(" + source + ")")(...args),
            { source: func.toString(), args },
          );
          return [{ documentId, result }];
        },
      },
      action: { setBadgeText: async () => {} },
      tabs: {
        query: async () => [{ id: 1 }],
        onUpdated: event("updated"),
        onRemoved: event("removed"),
      },
      alarms: { create: () => {}, onAlarm: event("alarm") },
      runtime: { id: extensionId, onMessage: event("message") },
    };
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        documentId = randomBytes(16).toString("hex");
        for (const f of listeners.updated || []) f(1, { status: "loading" });
      }
    });
    let background = fs
      .readFileSync(path.join(extension, "background.js"), "utf8")
      .replace(
        'import { pageAdapter } from "./page-adapter.js";',
        'const pageAdapter=globalThis.__webmcpTestAdapter;\nconst fetch=(url,options)=>globalThis.fetch(url,{...options,headers:{...options.headers,Origin:"chrome-extension://' +
          extensionId +
          '"}});',
      );
    await import(
      "data:text/javascript;base64," +
        Buffer.from(background).toString("base64")
    );
    send = (message) =>
      new Promise((resolve) =>
        listeners.message[0](message, { id: extensionId }, resolve),
      );
    harnessMode =
      "extension API harness with real Chromium page (managed policy blocks extension installation)";
  }
  let started = await api("webmcp_start");
  assert.equal(
    (
      await fetch(started.url + "/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_code: started.pairing_code }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(started.url + "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  const paired = await send({
    kind: "pair",
    url: started.url,
    code: started.pairing_code,
  });
  assert.equal(paired.connected, true, JSON.stringify(paired));
  assert.equal((await api("webmcp_status")).paired, true);
  const connected = await api("webmcp_connect");
  const id = connected.id;
  const tools = (await api("client_tools", { id })).tools;
  assert.equal(tools.length, 3);
  const records = tools.find((t) => t.definition.name === "records"),
    action = tools.find((t) => t.definition.name === "action"),
    slow = tools.find((t) => t.definition.name === "slow");
  const captures = path.resolve(
    process.env.CHRONOSCOPE_QA_SCREENSHOTS || path.join(dir, "screenshots"),
  );
  fs.mkdirSync(captures, { recursive: true });
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
    },
  });
  const app = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await app.goto(url + "/?renderer=webgl#token=" + token);
  await app.waitForFunction(() => !!window.__chronoscope?.snapshot);
  await app.click("#settings");
  await app.click("#external-connections");
  await app.screenshot({ path: path.join(captures, "webmcp-connections.png") });
  await app.click('[data-client-tools="browser-webmcp"]');
  await app.screenshot({ path: path.join(captures, "webmcp-grants.png") });
  const call = {
    id,
    tool: "records",
    fingerprint: records.fingerprint,
    arguments: { limit: 3 },
  };
  await api("client_call", call, false);
  await api("client_grants", {
    id,
    grants: [
      { tool: "records", fingerprint: records.fingerprint, access: "read" },
      { tool: "action", fingerprint: action.fingerprint, access: "action" },
      { tool: "slow", fingerprint: slow.fingerprint, access: "read" },
    ],
  });
  const result = await api("client_call", call);
  assert.equal(JSON.parse(result.content[0].text).records.length, 3);
  await api("client_call", { ...call, arguments: { limit: 100 } }, false);
  await api(
    "client_call",
    { id, tool: "action", fingerprint: action.fingerprint, arguments: {} },
    false,
  );
  assert.equal(
    JSON.parse(
      (
        await api("client_call", {
          id,
          tool: "action",
          fingerprint: action.fingerprint,
          arguments: {},
          allow_actions: true,
        })
      ).content[0].text,
    ).actions,
    1,
  );
  const job = await api("job_start", {
    command: "client_call",
    arguments: {
      id,
      tool: "slow",
      fingerprint: slow.fingerprint,
      arguments: {},
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  await api("job_cancel", { job_id: job.job_id });
  await page.waitForFunction(
    () => window.aborted === true,
    {},
    { timeout: 10000 },
  );
  const exported = path.join(dir, "browser-extension.zip");
  await api("webmcp_extension", { path: exported, overwrite: true });
  assert.ok(fs.statSync(exported).size > 2000);
  await page.reload();
  await page.evaluate(() => window.fixtureReady);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await api("webmcp_status")).paired, false);
  await api("client_call", call, false);
  // A new pairing must survive the previous long-poll's cancellation/error.
  started = await api("webmcp_start");
  const reconnected = await send({
    kind: "pair",
    url: started.url,
    code: started.pairing_code,
  });
  assert.equal(reconnected.connected, true, JSON.stringify(reconnected));
  await api("webmcp_connect");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await api("webmcp_status")).paired, true);
  assert.equal(
    (await api("client_tools", { id })).tools.every((t) => !t.access),
    true,
  );
  await api("client_call", call, false);
  assert.equal((await api("webmcp_stop")).running, false);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        browser_api: await page.evaluate(() =>
          window.nativeDraft
            ? "native draft"
            : "explicit local protocol fixture",
        ),
        extension_runtime: harnessMode,
        tests: [
          "shipped background and page-adapter round trip",
          "SDK discovery",
          "read grant",
          "action grant and per-call permission",
          "argument validation",
          "cancellation reaches browser AbortSignal",
          "unpaired rejection",
          "navigation revocation",
          "embedded extension export",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  fixture?.close();
  server.kill();
}
