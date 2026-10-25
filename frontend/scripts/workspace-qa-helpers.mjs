import assert from "node:assert/strict";

// Shared mechanics, with a complete persisted-config assertion. Each caller
// retains its type-specific pixel, control, title and exact-selection checks.
export async function roundTripChart(page, api, filename) {
  const scene = await page.evaluate(() => window.__chronoscope.captureScene());
  await api("save", { path: filename, scene });
  await api("open", { path: filename });
  await page.reload();
  await page.waitForFunction(
    () => window.__chronoscope?.snapshot && !window.__chronoscope.busy,
  );
  const restored = (await api("snapshot", { compact: true })).scene;
  assert.deepEqual(
    restored.chart,
    scene.chart,
    "Portable reopen preserves the complete chart configuration",
  );
  assert.deepEqual(
    restored.chart_presets,
    scene.chart_presets,
    "Portable reopen preserves every named chart preset",
  );
}
