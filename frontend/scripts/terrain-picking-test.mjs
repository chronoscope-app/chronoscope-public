import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyTerrainPickerPatch,
  patchTerrainPickerSource,
  terrainPickerSha256,
  TERRAIN_PICKER_PATCH,
  TERRAIN_PICKER_EDITS,
} from "./patches/terrain-picker.mjs";

const engineCore = new URL(
  "../node_modules/@cesium/engine/Source/Core/",
  import.meta.url,
);
let upstream = fs.readFileSync(new URL("TerrainPicker.js", engineCore), "utf8");
if (terrainPickerSha256(upstream) === TERRAIN_PICKER_PATCH.patchedSha256)
  for (const [before, after] of TERRAIN_PICKER_EDITS)
    upstream = upstream.replace(after, before);
assert.equal(
  terrainPickerSha256(upstream),
  TERRAIN_PICKER_PATCH.originalSha256,
);
const { TaskProcessor, Ray, Cartesian3, Matrix4, SceneMode } = await import(
  new URL("../node_modules/cesium/Source/Cesium.js", import.meta.url)
);

// Load both reviewed versions in isolation; npm test must not rewrite a
// dependency while other test processes may be importing it after npm ci.
// Both versions use the real Cesium geometry and worker scheduler.
async function loadPicker(source) {
  const resolved = source.replace(/from "([^"]+)"/g, (_, specifier) => {
    const url =
      specifier === "@cesium/core"
        ? new URL("../node_modules/@cesium/core/index.js", import.meta.url)
        : new URL(specifier, engineCore);
    return "from " + JSON.stringify(url.href);
  });
  return (
    await import(
      "data:text/javascript;base64," + Buffer.from(resolved).toString("base64")
    )
  ).default;
}
const OriginalPicker = await loadPicker(upstream);
const TerrainPicker = await loadPicker(patchTerrainPickerSource(upstream));
const partition = () => ({
  intersectingTrianglesArrays: Array.from(
    { length: 4 },
    () => new Uint32Array([0]).buffer,
  ),
});
const turn = () => new Promise((resolve) => setImmediate(resolve));
function fixture(Picker = TerrainPicker) {
  const picker = new Picker(
    new Float64Array([-0.25, -0.25, 0, 0.25, -0.25, 0, 0, 0.25, 0]),
    new Uint16Array([0, 1, 2]),
    {
      getExaggeratedPosition(buffer, index, result) {
        return Cartesian3.fromArray(buffer, index * 3, result);
      },
    },
  );
  const ray = new Ray(new Cartesian3(0, 0, 1), new Cartesian3(0, 0, -1));
  return {
    picker,
    pick: () =>
      picker.rayIntersect(ray, Matrix4.IDENTITY, false, SceneMode.SCENE3D),
  };
}
const hit = (value) => assert.deepEqual(value, new Cartesian3(0, 0, 0));
async function withSchedule(schedule, run) {
  const original = TaskProcessor.prototype.scheduleTask;
  TaskProcessor.prototype.scheduleTask = schedule;
  try {
    await run();
  } finally {
    TaskProcessor.prototype.scheduleTask = original;
  }
}

test("an old terrain partition worker cannot erase a rebuilt pick tree", async () => {
  const pending = [];
  await withSchedule(
    () => new Promise((resolve) => pending.push(resolve)),
    async () => {
      for (const Picker of [OriginalPicker, TerrainPicker]) {
        const { picker, pick } = fixture(Picker);
        hit(pick());
        const staleWorker = pending.at(-1);
        // TerrainMesh invalidates this cache on projection/exaggeration changes.
        picker.needsRebuild = true;
        hit(pick());
        const currentWorker = pending.at(-1);
        staleWorker(partition());
        await turn();
        if (Picker === OriginalPicker)
          assert.equal(
            pick(),
            undefined,
            "negative control reproduces lost triangles",
          );
        else {
          hit(pick());
          currentWorker(partition());
          await turn();
          hit(pick());
        }
      }
    },
  );
});

test("a refused terrain partition retains parent triangles and can retry", async () => {
  let refuse = true;
  await withSchedule(
    () => (refuse ? undefined : Promise.resolve(partition())),
    async () => {
      const original = fixture(OriginalPicker);
      hit(original.pick());
      assert.equal(
        original.pick(),
        undefined,
        "negative control reproduces empty child traversal",
      );
      const { pick } = fixture();
      hit(pick());
      hit(pick());
      refuse = false;
      hit(pick());
      await turn();
      hit(pick());
    },
  );
});

test("a rejected terrain partition is contained and picking can retry", async () => {
  let reject = true;
  await withSchedule(
    () =>
      reject
        ? Promise.reject(Error("worker unavailable"))
        : Promise.resolve(partition()),
    async () => {
      const { pick } = fixture();
      for (let i = 0; i < 3; i++) {
        hit(pick());
        await turn();
      }
      reject = false;
      hit(pick());
      await turn();
      hit(pick());
    },
  );
});

test("a synchronous worker construction failure retains triangles and can retry", async () => {
  let fail = true;
  await withSchedule(
    () => {
      if (fail) throw Error("Worker construction unavailable");
      return Promise.resolve(partition());
    },
    async () => {
      const { picker, pick } = fixture();
      hit(pick());
      hit(pick());
      await turn();
      assert.equal(picker._rootNode.buildingChildren, false);
      assert.equal(picker._rootNode.children.length, 0);
      fail = false;
      hit(pick());
      await turn();
      hit(pick());
    },
  );
});

test("the dependency patch is pinned, fail closed and idempotent", () => {
  const patched = patchTerrainPickerSource(upstream);
  assert.equal(
    terrainPickerSha256(patched),
    TERRAIN_PICKER_PATCH.patchedSha256,
  );
  assert.equal(patchTerrainPickerSource(patched), patched);
  assert.throws(() => patchTerrainPickerSource(upstream + "\n"), /Unreviewed/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terrain-patch-test-"));
  try {
    const engine = path.join(root, "node_modules/@cesium/engine");
    const cesium = path.join(root, "node_modules/cesium");
    const cache = path.join(root, "node_modules/.vite/cache");
    fs.mkdirSync(path.join(engine, "Source/Core"), { recursive: true });
    fs.mkdirSync(cesium, { recursive: true });
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, "old optimized bundle");
    const versionFile = path.join(engine, "package.json");
    fs.writeFileSync(
      versionFile,
      JSON.stringify({ version: TERRAIN_PICKER_PATCH.engineVersion }),
    );
    fs.writeFileSync(
      path.join(cesium, "package.json"),
      JSON.stringify({ version: TERRAIN_PICKER_PATCH.cesiumVersion }),
    );
    const target = path.join(engine, "Source/Core/TerrainPicker.js");
    fs.writeFileSync(target, upstream);
    assert.equal(applyTerrainPickerPatch(root).alreadyApplied, false);
    assert.equal(fs.readFileSync(target, "utf8"), patched);
    assert(
      !fs.existsSync(cache),
      "new patch invalidates Vite's generated dependency cache",
    );
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, "current optimized bundle");
    assert.equal(applyTerrainPickerPatch(root).alreadyApplied, true);
    assert(
      fs.existsSync(cache),
      "idempotent preparation retains the current Vite cache",
    );
    fs.writeFileSync(versionFile, JSON.stringify({ version: "unreviewed" }));
    assert.throws(() => applyTerrainPickerPatch(root), /Unreviewed.*version/);
    fs.writeFileSync(
      versionFile,
      JSON.stringify({ version: TERRAIN_PICKER_PATCH.engineVersion }),
    );
    fs.writeFileSync(target, patched + "\n");
    assert.throws(() => applyTerrainPickerPatch(root), /Unreviewed.*source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
