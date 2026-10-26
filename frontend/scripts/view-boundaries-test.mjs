import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { Cartesian3, Matrix4 } from "cesium";
async function load(name) {
  const js = ts
    .transpileModule(
      fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replaceAll(
      '"cesium"',
      JSON.stringify(import.meta.resolve("cesium")),
    );
  return import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );
}
const { captureCamera, restoreCamera } = await load("cesium-camera-state");
const { applySceneAppearance } = await load("scene-appearance");
const { preferenceEffects } = await load("preference-effects");
const camera = (frustum = { width: 40 }) => ({
  position: new Cartesian3(1, 2, 3),
  direction: new Cartesian3(0, 0, -1),
  up: new Cartesian3(0, 1, 0),
  right: new Cartesian3(1, 0, 0),
  frustum,
  lookAtTransform(value) {
    assert.equal(value, Matrix4.IDENTITY);
  },
});

test("camera roundtrip preserves exact vectors and Map scale without touching providers", () => {
  for (const frustum of [
    { width: 40 },
    { left: -20, right: 20, top: 10, bottom: -10 },
  ]) {
    const source = camera(frustum),
      saved = captureCamera(source);
    source.position.x = 99;
    if (source.frustum.width) source.frustum.width = 100;
    else
      Object.assign(source.frustum, {
        left: -50,
        right: 50,
        top: 25,
        bottom: -25,
      });
    assert.equal(restoreCamera(source, "map", saved), true);
    assert.deepEqual(captureCamera(source), saved);
  }
});

test("invalid camera records are rejected before a valid camera is modified", () => {
  const target = camera(),
    before = captureCamera(target);
  for (const change of [
    { renderer: "other" },
    { cesium_camera: { ...before.cesium_camera, position: [NaN, 1, 2] } },
    { cesium_camera: { ...before.cesium_camera, direction: [2, 0, 0] } },
    { cesium_camera: { ...before.cesium_camera, up: [0, 0, -1] } },
  ]) {
    assert.equal(restoreCamera(target, "map", { ...before, ...change }), false);
    assert.deepEqual(captureCamera(target), before);
  }
  assert.equal(
    restoreCamera(target, "globe", {
      ...before,
      cesium_camera: { ...before.cesium_camera, frustum_width: null },
    }),
    true,
  );
});

test("appearance updates have no camera or provider side effects", () => {
  const scene = {
    globe: {},
    camera: Object.freeze({ retained: true }),
    terrainProvider: Object.freeze({ retained: true }),
  };
  const retained = { camera: scene.camera, provider: scene.terrainProvider };
  applySceneAppearance(scene, "light");
  assert.equal(scene.backgroundColor.toCssHexString(), "#e5e9ef");
  assert.equal(scene.globe.baseColor.toCssHexString(), "#c9d2df");
  applySceneAppearance(scene, "dark");
  assert.equal(scene.backgroundColor.toCssHexString(), "#0e1420");
  assert.equal(scene.camera, retained.camera);
  assert.equal(scene.terrainProvider, retained.provider);
});

const preferences = () => ({
  theme: "system",
  coordinates: "dd",
  date_format: "system",
  time_format: "system",
  auto_save_unsaved: true,
  basemap: "streets",
  map: {
    enabled: false,
    url: "",
    layer: "",
    matrix_set: "",
    style: "",
    format: "",
    time: "",
    level: null,
  },
  map_layers: null,
  terrain_path: null,
  terrain_builtin: true,
  terrain_exaggeration: 1,
  terrain_vertical_datum: "egm96",
});
test("display/workspace preferences cannot trigger resource replacement; resource changes can", () => {
  const previous = preferences();
  for (const [key, value] of Object.entries({
    theme: "dark",
    coordinates: "mgrs",
    date_format: "dmy",
    time_format: "12h",
    auto_save_unsaved: false,
  })) {
    assert.deepEqual(
      preferenceEffects(previous, { ...previous, [key]: value }),
      { resourcesChanged: false, pathChanged: false },
      key,
    );
  }
  for (const [key, value] of Object.entries({
    basemap: "none",
    map: { ...previous.map, enabled: true },
    map_layers: [],
    terrain_exaggeration: 2,
    terrain_vertical_datum: "ellipsoid",
  })) {
    assert.deepEqual(
      preferenceEffects(previous, { ...previous, [key]: value }),
      { resourcesChanged: true, pathChanged: false },
      key,
    );
  }
  for (const change of [
    { terrain_builtin: false },
    { terrain_path: "/custom/terrain" },
  ])
    assert.deepEqual(preferenceEffects(previous, { ...previous, ...change }), {
      resourcesChanged: true,
      pathChanged: true,
    });
  const reordered = {
    ...previous,
    map: Object.fromEntries(Object.entries(previous.map).reverse()),
  };
  assert.equal(
    preferenceEffects(previous, reordered).resourcesChanged,
    false,
    "JSON object key order is not a resource change",
  );
  const layer = {
    id: "a",
    config: previous.map,
    name: "A",
    server_name: "local",
    opacity: 1,
    min_zoom: 0,
    max_zoom: 30,
  };
  assert.equal(
    preferenceEffects(
      { ...previous, map_layers: [layer, { ...layer, id: "b" }] },
      { ...previous, map_layers: [{ ...layer, id: "b" }, layer] },
    ).resourcesChanged,
    true,
    "layer ordering is meaningful",
  );
});
