// Reviewed local fix for Cesium's asynchronous terrain-picking tree lifecycle.
// Keep the original upstream notices. Refuse dependency drift until reviewed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const TERRAIN_PICKER_PATCH = Object.freeze({
  cesiumVersion: "1.146.0",
  engineVersion: "26.4.0",
  originalSha256:
    "24907bf36a1e67500aaf5213a59ef02f74941c920928bbc7ab134db7beaa55cc",
  patchedSha256:
    "198f7ed298ee6e97f6e1a625f12f8b8391079c859a0f929c63d20bcaf7385568",
});

export const TERRAIN_PICKER_EDITS = Object.freeze([
  [
    `  const incrementallyBuildTerrainPickerPromise =
    incrementallyBuildTerrainPickerTaskProcessor.scheduleTask(
      parameters,
      transferableObjects,
    );`,
    `  let incrementallyBuildTerrainPickerPromise;
  try {
    incrementallyBuildTerrainPickerPromise =
      incrementallyBuildTerrainPickerTaskProcessor.scheduleTask(
        parameters,
        transferableObjects,
      );
  } catch {
    // Worker construction can throw before returning a promise. Keep the
    // same valid parent fallback used for refused or rejected partitions.
    node.children.length = 0;
    node.buildingChildren = false;
    return;
  }`,
  ],
  [
    "// @ts-check\n",
    "// @ts-check\n// Modified by Chronoscope: terrain picker lifecycle fixes.\n// See frontend/scripts/patches/terrain-picker.mjs for pinned upstream provenance.\n",
  ],
  [
    `  terrainPicker._rootNode.intersectingTriangles = intersectingTriangles;
  terrainPicker._rootNode.children.length = 0;`,
    `  // Older partition workers retain their old node. Never let their
  // completion clear or repartition the new projection/exaggeration tree.
  terrainPicker._rootNode = new TerrainPickerNode();
  terrainPicker._rootNode.intersectingTriangles = intersectingTriangles;`,
  ],
  [
    `    // Failed to schedule task, retry on next pick
    node.buildingChildren = false;`,
    `    // Retain the parent's triangles as the fallback and retry next pick.
    // Empty children would hide that fallback from ray traversal.
    node.children.length = 0;
    node.buildingChildren = false;`,
  ],
  [
    `  const result = /** @type {{intersectingTrianglesArrays: ArrayBuffer[]}} */ (
    await incrementallyBuildTerrainPickerPromise
  );`,
    `  /** @type {{intersectingTrianglesArrays: ArrayBuffer[]}} */
  let result;
  try {
    result = await incrementallyBuildTerrainPickerPromise;
  } catch {
    // A failed optimization must not remove valid source triangles or leave
    // an unhandled rejection. A later pick can retry worker partitioning.
    node.children.length = 0;
    node.buildingChildren = false;
    return;
  }`,
  ],
]);

export const terrainPickerSha256 = (source) =>
  crypto.createHash("sha256").update(source).digest("hex");

export function patchTerrainPickerSource(source) {
  const hash = terrainPickerSha256(source);
  if (hash === TERRAIN_PICKER_PATCH.patchedSha256) return source;
  if (hash !== TERRAIN_PICKER_PATCH.originalSha256)
    throw Error(`Unreviewed Cesium TerrainPicker source: ${hash}`);
  let patched = source;
  for (const [before, after] of TERRAIN_PICKER_EDITS) {
    if (patched.split(before).length !== 2)
      throw Error("TerrainPicker patch context must occur exactly once");
    patched = patched.replace(before, after);
  }
  if (terrainPickerSha256(patched) !== TERRAIN_PICKER_PATCH.patchedSha256)
    throw Error("TerrainPicker patched checksum differs from reviewed source");
  return patched;
}

export function applyTerrainPickerPatch(
  frontendRoot = path.resolve(import.meta.dirname, "../.."),
) {
  const modules = path.join(frontendRoot, "node_modules");
  for (const [name, version] of [
    ["cesium", TERRAIN_PICKER_PATCH.cesiumVersion],
    ["@cesium/engine", TERRAIN_PICKER_PATCH.engineVersion],
  ]) {
    const actual = JSON.parse(
      fs.readFileSync(path.join(modules, name, "package.json"), "utf8"),
    ).version;
    if (actual !== version)
      throw Error(`Unreviewed ${name} version: ${actual}; expected ${version}`);
  }
  const target = path.join(
    modules,
    "@cesium/engine/Source/Core/TerrainPicker.js",
  );
  const original = fs.readFileSync(target, "utf8");
  const patched = patchTerrainPickerSource(original);
  if (patched !== original) {
    fs.writeFileSync(target, patched);
    // A source patch leaves the lockfile unchanged. Rebuild Vite's optimized
    // development dependencies once, instead of serving the original picker.
    fs.rmSync(path.join(modules, ".vite"), { recursive: true, force: true });
  }
  return { ...TERRAIN_PICKER_PATCH, alreadyApplied: patched === original };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(applyTerrainPickerPatch(), null, 2));
