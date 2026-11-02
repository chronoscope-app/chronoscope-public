import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(fs.readFileSync(new URL("../src/resource-governor.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ResourceGovernor, RESOURCE_LIMITS, resolutionFor, activeCadenceCost } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const GiB = 1024 ** 3;
const ram = (total, available, swap = 0) => ({ supported: true, total_bytes: total * GiB,
  available_bytes: available * GiB, swap_used_bytes: swap * GiB, sample_age_ms: 0 });
test("capacity starts 8 GiB shared systems conservatively; headroom can tighten immediately", () => {
  const g = new ResourceGovernor();
  g.update(ram(8, 5), null, 0); assert.equal(g.limits.name, "balanced");
  g.update(ram(8, .6), null, 5000); assert.equal(g.limits.name, "reduced");
  g.update(ram(8, .2), null, 10000); assert.equal(g.limits.name, "critical");
  assert.equal(g.limits.afterimages, 0);
  const low = new ResourceGovernor(); low.update(ram(4, 3), null, 0);
  assert.equal(low.limits.name, "reduced");
});
test("recovery requires continuous healthy headroom and steps up slowly to the capacity floor", () => {
  const g = new ResourceGovernor(); g.update(ram(8, .2), null, 0);
  g.update(ram(8, 4), null, 5000); g.update(ram(8, 4), null, 49999);
  assert.equal(g.level, 3); g.update(ram(8, 4), null, 50000); assert.equal(g.level, 2);
  g.update(ram(8, 4), null, 95000); assert.equal(g.level, 1);
  g.update(ram(8, 4), null, 1000000); assert.equal(g.level, 1);
});
test("a renewed pressure sample interrupts recovery, and missing or stale sensors cannot clear it", () => {
  const g = new ResourceGovernor(); g.update(ram(32, .2), null, 0);
  g.update(ram(32, 20), null, 5000); g.update(ram(32, 2), null, 45000);
  g.update(ram(32, 20), null, 50000); g.update(ram(32, 20), null, 94999); assert.equal(g.level, 3);
  g.update({ ...ram(32, 20), sample_age_ms: 20000 }, null, 100000); assert.equal(g.level, 3);
  g.update(null, null, 150000); assert.equal(g.level, 3);
  assert.equal(g.diagnostics(150000).memorySampleAgeMs, 55001);
});
test("render cost needs sustained active draw samples; intentional idle gaps are not slow rendering", () => {
  assert.equal(activeCadenceCost(10000, 0, undefined), 0);
  assert(activeCadenceCost(2000, 2, undefined) > 45);
  assert(activeCadenceCost(1000, 30, 30) < 45);
  const g = new ResourceGovernor(); const healthy = ram(32, 20);
  g.update(healthy, 60, 0); g.update(healthy, 60, 5000); assert.equal(g.level, 0);
  g.update(healthy, null, 10000); g.update(healthy, 60, 15000); g.update(healthy, 60, 20000);
  assert.equal(g.level, 0); g.update(healthy, 60, 25000); assert.equal(g.level, 1);
  assert.equal(g.reason, "sustained-render-cost");
});
test("new swap pressure can tighten limits; previously used swap alone cannot", () => {
  const g = new ResourceGovernor(); g.update(ram(16, 3, 4), null, 0); assert.equal(g.level, 1);
  g.update(ram(16, 3, 4.2), null, 5000); assert.equal(g.level, 2); assert.equal(g.reason, "swap-growth");
});
test("pixels and geometry budgets decrease together without changing caller data", () => {
  const pixels = RESOURCE_LIMITS.map(l => resolutionFor(3840, 2160, 2, l) ** 2 * 3840 * 2160);
  for (let i = 0; i < RESOURCE_LIMITS.length; i++) {
    assert(pixels[i] <= RESOURCE_LIMITS[i].maxPixels + .001);
    if (i) { assert(pixels[i] < pixels[i - 1]); assert(RESOURCE_LIMITS[i].maxPoints < RESOURCE_LIMITS[i - 1].maxPoints); }
  }
  assert(Number.isFinite(resolutionFor(0, 0, NaN, RESOURCE_LIMITS[0])));
});
test("hardware GPU names share full budgets and recover after measured pressure", () => {
  const renderers = [
    "Mesa Intel(R) UHD Graphics 620", "Intel(R) HD Graphics 630",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL)", "Intel Iris Pro",
    "Intel Arc A770", "Apple GPU", "AMD Radeon RX 6600", "NVIDIA GeForce RTX 3060",
  ];
  for (const renderer of renderers) {
    const g = new ResourceGovernor(), healthy = ram(16, 10);
    g.setGraphicsRenderer(renderer);
    assert.equal(g.limits.name, "full", renderer);
    g.update(healthy, 5, 0);
    assert.equal(g.reason, "healthy", renderer);
    assert.equal(g.limits.maxFps, undefined, renderer);
    assert.equal(g.limits.maxPoints, 100000, renderer);
    for (const now of [5000, 10000, 15000]) g.update(healthy, 60, now);
    assert.equal(g.limits.name, "balanced", renderer);
    assert.equal(g.reason, "sustained-render-cost", renderer);
    g.update(healthy, 5, 20000);
    g.update(healthy, 5, 65000);
    assert.equal(g.limits.name, "full", renderer);
    g.update(ram(16, .2), 5, 70000);
    assert.equal(g.limits.name, "critical", renderer);
  }
});
test("software rasterizers retain their balanced floor after healthy recovery", () => {
  for (const renderer of ["llvmpipe (LLVM 18.1.8)", "ANGLE (Google, Vulkan SwiftShader Device)", "Software Rasterizer"]) {
    const g = new ResourceGovernor();
    g.setGraphicsRenderer(renderer);
    g.update(ram(16, 10), 5, 0);
    assert.equal(g.limits.name, "balanced", renderer);
    assert.equal(g.reason, "software-graphics", renderer);
    g.update(ram(16, 1.2), 5, 5000);
    assert.equal(g.limits.name, "reduced", renderer);
    for (const now of [10000, 55000, 100000]) g.update(ram(16, 10), 5, now);
    assert.equal(g.limits.name, "balanced", renderer);
    assert.equal(g.reason, "software-graphics", renderer);
  }
});
test("expensive geometry work is measured for Intel and masked GPU names", () => {
  for (const renderer of ["Mesa Intel(R) UHD Graphics 620", "Apple GPU"]) {
    const g = new ResourceGovernor(); g.setGraphicsRenderer(renderer);
    g.update(ram(16, 10), null, 0, 300); assert.equal(g.level, 0);
    g.update(ram(16, 10), null, 5000, 300); assert.equal(g.level, 0);
    g.update(ram(16, 10), null, 10000, 300); assert.equal(g.level, 1);
    assert.equal(g.reason, "expensive-geometry-work");
  }
});

test("transient geometry spikes do not ratchet quality down and healthy gaps reset pressure", () => {
  const g = new ResourceGovernor(), healthy = ram(16, 8);
  for (const [now, work] of [[0, 400], [5000, 400], [10000, 0], [15000, 400], [20000, 400]])
    g.update(healthy, 5, now, work, 30);
  assert.equal(g.level, 0);
  g.update(healthy, 5, 25000, 400, 30);
  assert.equal(g.level, 1);
  assert.equal(g.reason, "expensive-geometry-work");
});

test("healthy playback recovers at each governor cap without requiring idle or exceeding the cap", () => {
  const g = new ResourceGovernor(), healthy = ram(16, 8);
  g.update(ram(16, 1.2), null, 0);
  assert.equal(g.level, 2);
  for (let now = 5000; now <= 95000; now += 5000) {
    const cap = g.limits.maxFps ?? 60;
    g.update(healthy, 5, now, 0, activeCadenceCost(1000, cap, cap));
  }
  assert.equal(g.level, 0);
});

test("missed cadence still reduces quality and sustained slow playback cannot recover", () => {
  const g = new ResourceGovernor(), healthy = ram(16, 8);
  for (const now of [0, 5000, 10000]) g.update(healthy, 5, now, 0, 60);
  assert.equal(g.level, 1);
  for (let now = 15000; now < 120000; now += 5000) g.update(healthy, 5, now, 0, 40);
  assert.equal(g.level, 1);
  g.update(ram(16, .2), 5, 120000, 0, 30);
  assert.equal(g.level, 3);
});
