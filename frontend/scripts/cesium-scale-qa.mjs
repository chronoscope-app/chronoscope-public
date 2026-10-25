import { chromium, spawn, localServerUrl } from "./qa-runtime.mjs";
// Opt-in scale proof: a real million-row Rust import and bounded Cesium display.
// Inputs/private databases stay outside Git; no public services or paid APIs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { PNG } from "pngjs";
const root = path.resolve(import.meta.dirname, "../..");
const dir = path.resolve(
  process.env.CHRONOSCOPE_QA_DATA_DIR || path.join(root, ".qa/cesium-scale"),
);
const out = path.resolve(process.env.CHRONOSCOPE_QA_SCREENSHOTS || dir);
const count = Number(process.env.CHRONOSCOPE_SCALE_ROWS || 1000000);
assert(Number.isInteger(count) && count >= 10000 && count <= 1000000);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const free = () => {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
};
assert(
  free() > 2 * 1024 ** 3,
  "At least 2 GiB free space required for this opt-in run",
);
const report = {
  passed: false,
  rows: count,
  synthetic: true,
  rustBuildProfile: process.env.CHRONOSCOPE_QA_RUST_PROFILE || "unspecified",
  renderer: "CesiumJS WebGL2",
  softwareRenderer: true,
  publicRequests: 0,
  githubRunnersUsed: false,
  started: new Date().toISOString(),
  timingsSeconds: {},
  checks: [],
  errors: [],
  memory: {},
  disk: { initialFreeBytes: free() },
  limitations: [
    "Caller-selected Rust build; ingestion wall times include validation and persistence.",
    "SwiftShader software rendering is not dedicated-GPU FPS or native macOS/Windows validation.",
    "RSS sums can double-count shared pages; Chromium renderer RSS is reported separately.",
    "No map downloads, portable million-row copy, or arbitrary budget increases.",
  ],
};
let server, browser, page, monitor, forcedStop;
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const check = (name, evidence) => {
  report.checks.push({ name, evidence });
  save();
  console.log("PASS", name);
};
const timed = async (name, fn) => {
  const t = performance.now();
  const r = await fn();
  report.timingsSeconds[name] = Number(
    ((performance.now() - t) / 1000).toFixed(4),
  );
  save();
  return r;
};
const clockTicks =
  process.platform === "linux"
    ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim())
    : null;
function processMemory(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, "utf8"),
      stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
      fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return {
      cpuTimeSeconds: (Number(fields[11]) + Number(fields[12])) / clockTicks,
      rssBytes: Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024,
      peakRssBytes: Number(s.match(/^VmHWM:\s+(\d+)/m)?.[1] || 0) * 1024,
    };
  } catch {
    return null;
  }
}
try {
  save();
  const csv = path.join(dir, "million-events.csv");
  await timed("generateCsv", async () => {
    const stream = fs.createWriteStream(csv);
    stream.write("entity,timestamp,latitude,longitude,category\n");
    for (let start = 0; start < count; start += 10000) {
      let text = "";
      for (let i = start; i < Math.min(count, start + 10000); i++)
        text += `T${i % 100},${1735689600 + i * 60},${(33.3 + (i % 1000) / 2000).toFixed(4)},${(-84.5 + (Math.floor(i / 1000) % 1000) / 2000).toFixed(4)},C${i % 5}\n`;
      if (!stream.write(text)) await once(stream, "drain");
    }
    stream.end();
    await once(stream, "finish");
  });
  report.disk.inputBytes = fs.statSync(csv).size;
  const token = randomBytes(32).toString("hex"),
    tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  server = spawn(
    process.env.CHRONOSCOPE_CLI || path.join(root, "target/debug/chronoscope"),
    [
      "--data-dir",
      path.join(dir, "profile"),
      "--demo-data",
      "serve",
      "--listen",
      "127.0.0.1:0",
      "--token-file",
      tokenFile,
      "--frontend",
      process.env.CHRONOSCOPE_QA_FRONTEND || path.join(root, "frontend/dist"),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const url = await localServerUrl(server);
  report.memory.rustPeakObservedRssBytes = 0;
  report.disk.minimumFreeBytes = free();
  monitor = setInterval(() => {
    const m = processMemory(server.pid);
    if (m)
      report.memory.rustPeakObservedRssBytes = Math.max(
        report.memory.rustPeakObservedRssBytes,
        m.peakRssBytes,
        m.rssBytes,
      );
    report.disk.minimumFreeBytes = Math.min(
      report.disk.minimumFreeBytes,
      free(),
    );
    if (free() < 750 * 1024 ** 2) {
      forcedStop = "Stopped before disk exhaustion (<750 MiB free)";
      server.kill("SIGTERM");
    }
    save();
  }, 1000);
  const api = async (command, args = {}) => {
    if (forcedStop) throw Error(forcedStop);
    const r = await fetch(url + "/api/invoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command, args }),
    });
    const body = await r.json();
    assert(r.ok, JSON.stringify(body));
    return body.result;
  };
  const prefs = await api("preferences");
  await api("preferences", {
    preferences: {
      ...prefs,
      auto_save_unsaved: false,
      theme: "dark",
      map: { ...prefs.map, enabled: false },
      basemap: "none",
      map_layers: [],
      terrain_path: null,
      terrain_builtin: false,
    },
  });
  const preview = await timed("importPreview", () =>
    api("import_preview", { path: csv, storage: "disk" }),
  );
  const imported = await timed("importCommit", () =>
    api("import_commit", { import_id: preview.import_id }),
  );
  report.import = {
    count: imported.count,
    imported: imported.imported,
    rejected: imported.rejected,
  };
  const snapshot = await timed("exactSnapshot", () =>
    api("snapshot", { compact: true }),
  );
  assert.equal(snapshot.count, count);
  assert.equal(snapshot.visible, count);
  check("Import retains the exact source count", {
    count: snapshot.count,
    visible: snapshot.visible,
  });
  const all = await timed("exactSourceQuery", () =>
    api("query", { limit: 5, fields: ["id", "entity", "source"] }),
  );
  assert.equal(all.count, count);
  assert.equal(all.events.length, 5);
  const source = all.events[0].source;
  const bySource = await timed("exactNamedSourceQuery", () =>
    api("query", { source, limit: 5, fields: ["id", "entity"] }),
  );
  assert.equal(bySource.count, count);
  const entity = await timed("exactEntityQuery", () =>
    api("query", {
      filter: { predicates: [{ field: "entity", op: "Equals", value: "T0" }] },
      limit: 5,
      fields: ["id", "entity"],
    }),
  );
  assert.equal(entity.count, Math.ceil(count / 100));
  check("Bounded source/entity query pages retain exact dataset totals", {
    source,
    sourceCount: bySource.count,
    entityCount: entity.count,
    returned: all.events.length,
  });
  await api("view_set", {
    mode: "map",
    display: { mode: "auto", bloom: false },
  });
  const packet = await timed("displayGrid", () =>
    api("display_data", { flat: false, level: 18, max_cells: 4000 }),
  );
  assert.equal(packet.count, count);
  assert(packet.bins.length > 0 && packet.bins.length <= 4000);
  assert.equal(
    packet.bins.reduce((n, b) => n + b.count, 0),
    count,
  );
  const bin = packet.bins.find((b) => b.count > 1 && b.count < 10000);
  assert(bin, "Fixture should produce a selective nonempty grid cell");
  // Independent enumeration of the known synthetic coordinates, not another SQL count.
  const n = 2 ** bin.cell.level;
  let independentlyCounted = 0;
  for (let i = 0; i < count; i++) {
    const lat = 33.3 + (i % 1000) / 2000,
      lon = -84.5 + (Math.floor(i / 1000) % 1000) / 2000;
    const x = Math.floor(((lon + 180) / 360) * n),
      y = Math.floor(
        (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) * 0.5 * n,
      );
    if (x === bin.cell.x && y === bin.cell.y) independentlyCounted++;
  }
  assert.equal(bin.count, independentlyCounted);
  const members = await timed("exactClusterMemberQuery", () =>
    api("attribute_table", {
      display_cell: bin.cell,
      apply_filter: true,
      limit: 5,
      fields: ["id", "lat", "lon"],
    }),
  );
  assert.equal(members.count, independentlyCounted);
  const selected = await timed("exactClusterSelection", () =>
    api("select_query", { display_cell: bin.cell, mode: "replace" }),
  );
  const selection = await api("snapshot", { compact: true });
  assert.equal(selection.selected_count, independentlyCounted);
  await api("select", { ids: [] });
  check(
    "Bounded clusters and selection agree with independent source-coordinate enumeration",
    {
      cells: packet.bins.length,
      level: packet.level,
      sourceCount: packet.count,
      cellCount: bin.count,
      independentlyCounted,
      memberQueryCount: members.count,
      selectionCount: selection.selected_count,
    },
  );
  report.memory.rustAfterImportAndQueries = processMemory(server.pid);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await page.route("**/*", async (route) => {
    const target = route.request().url();
    if (/^https?:/.test(target) && !target.startsWith(url + "/")) {
      report.publicRequests++;
      await route.abort();
    } else await route.continue();
  });
  await timed("browserInitialDisplay", async () => {
    await page.goto(url + "/#token=" + token);
    await page.waitForFunction(
      (rows) =>
        window.__chronoscope?.snapshot?.count === rows &&
        !window.__chronoscope.busy &&
        window.__chronoscope.view.displayLayer.active,
      count,
      { timeout: 180000 },
    );
    await page.evaluate(async () => {
      const c = window.__chronoscope;
      await c.view.ready;
      c.view.onViewportChange = () => {};
      await c.refresh(true, false);
      c.view.fit();
    });
    await page.waitForFunction(
      () =>
        window.__chronoscope.view.displayLayer.diagnostics.clusterPoints > 0,
    );
  });
  const native = await page.evaluate(() => {
    const v = window.__chronoscope.view,
      p = v.displayLayer.packet,
      scene = v.viewer.scene;
    scene.requestRender();
    return {
      count: window.__chronoscope.snapshot.count,
      visible: window.__chronoscope.snapshot.visible,
      defaultMode: v.display.mode,
      actualMode: scene.mode,
      clusterCount: p.bins.length,
      packetCount: p.count,
      actualNativeClusterPoints: v.displayLayer.points.length,
      actualNativeClusterLabels: v.displayLayer.labels.length,
      displayDiagnostics: v.displayLayer.diagnostics,
      representativeEvents: v.points.length,
      cesiumEntities: v.viewer.entities.values.length,
      primitiveCollections: scene.primitives.length,
      canvasWidth: scene.canvas.width,
      canvasHeight: scene.canvas.height,
      webgl2: !!scene.canvas.getContext("webgl2"),
    };
  });
  assert.equal(native.defaultMode, "auto");
  assert.equal(native.count, count);
  assert.equal(native.packetCount, count);
  assert(native.clusterCount > 0 && native.clusterCount <= 4000);
  assert.equal(native.actualNativeClusterPoints, native.clusterCount);
  assert(native.cesiumEntities < 4000);
  assert(native.representativeEvents <= 20000);
  assert(native.webgl2);
  check(
    "Actual default Cesium display uses bounded native collections, not a million Entities",
    native,
  );
  const frame = async (show) =>
    page.evaluate(async (show) => {
      const v = window.__chronoscope.view;
      v.displayLayer.points.show = show;
      v.displayLayer.labels.show = show;
      v.viewer.scene.requestRender();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      v.requestRender();
      v.viewer.render();
      return v.viewer.canvas.toDataURL("image/png").split(",")[1];
    }, show);
  const hidden = PNG.sync.read(Buffer.from(await frame(false), "base64"));
  const shownBuffer = Buffer.from(await frame(true), "base64"),
    shown = PNG.sync.read(shownBuffer);
  let changed = 0,
    colored = 0;
  for (let i = 0; i < shown.data.length; i += 4) {
    if (
      Math.abs(shown.data[i] - hidden.data[i]) +
        Math.abs(shown.data[i + 1] - hidden.data[i + 1]) +
        Math.abs(shown.data[i + 2] - hidden.data[i + 2]) >
      60
    )
      changed++;
    if (
      Math.max(shown.data[i], shown.data[i + 1], shown.data[i + 2]) -
        Math.min(shown.data[i], shown.data[i + 1], shown.data[i + 2]) >
      50
    )
      colored++;
  }
  assert(
    changed > 300,
    `Cluster rendering should change visible canvas pixels; got ${changed}`,
  );
  fs.writeFileSync(path.join(out, "million-clusters-canvas.png"), shownBuffer);
  await page.screenshot({ path: path.join(out, "million-clusters-app.png") });
  check("Native cluster layer produces visible nonblank canvas pixels", {
    width: shown.width,
    height: shown.height,
    clusterChangedPixels: changed,
    coloredPixels: colored,
  });
  const cdp = await browser.newBrowserCDPSession(),
    processes = await cdp.send("SystemInfo.getProcessInfo");
  report.memory.chromiumProcesses = processes.processInfo.map((p) => ({
    type: p.type,
    pid: Number(p.id),
    ...processMemory(Number(p.id)),
    cpuTimeSeconds: p.cpuTime,
  }));
  report.memory.chromiumSummedRssBytes = report.memory.chromiumProcesses.reduce(
    (n, p) => n + (p.rssBytes || 0),
    0,
  );
  report.memory.rustEnd = processMemory(server.pid);
  assert.equal(report.publicRequests, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.failure = e.stack || String(e);
  console.error(report.failure);
  if (page)
    try {
      await page.screenshot({ path: path.join(out, "failure.png") });
    } catch {}
} finally {
  clearInterval(monitor);
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  report.disk.finalFreeBytes = free();
  report.disk.approximateConsumedBytes =
    report.disk.initialFreeBytes - report.disk.finalFreeBytes;
  report.finished = new Date().toISOString();
  save();
}
process.exitCode = report.passed ? 0 : 1;
