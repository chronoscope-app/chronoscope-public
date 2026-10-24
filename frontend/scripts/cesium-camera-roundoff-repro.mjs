// Opt-in, CPU-only upstream diagnostic. No Chronoscope engine, WebGL or network.
// Cesium private methods appear here to isolate its change detector; the app's
// production workaround uses only public camera vectors and scene events.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { Camera, SceneMode } from "@cesium/engine";
import { Cartesian3, Ellipsoid, GeographicProjection } from "@cesium/core";
import View from "@cesium/engine/Source/Scene/View.js";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/camera-stability.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { cameraStabilizer } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const iterations = 600;

function compare(changedListener, stabilized) {
  // Camera math needs a projection and canvas dimensions, not a WebGL Scene.
  const scene = {
    drawingBufferWidth: 1306,
    drawingBufferHeight: 909,
    mapProjection: new GeographicProjection(),
    ellipsoid: Ellipsoid.WGS84,
    cameraEventWaitTime: 500,
  };
  const camera = new Camera(scene);
  camera.setView({
    destination: Cartesian3.fromDegrees(-75, 30, 1000000),
    orientation: { heading: 0.3, pitch: -0.7, roll: 0 },
  });
  if (changedListener) camera.changed.addEventListener(() => {});
  for (let i = 0; i < 20; i++) camera._updateCameraChanged();

  const stabilize = cameraStabilizer(camera);
  stabilize(SceneMode.SCENE3D);
  const basis = () =>
    ["direction", "up", "right"].flatMap((key) =>
      ["x", "y", "z"].map((axis) => camera[key][axis]),
    );
  const initialBasis = basis();
  const initialPosition = Cartesian3.clone(camera.position);
  // Use the real detector without constructing its framebuffers.
  const view = {
    camera,
    _cameraClone: Camera.clone(camera),
    _cameraStartFired: false,
    _cameraMovedTime: undefined,
  };
  let falseCameraUpdates = 0;
  for (let i = 0; i < iterations; i++) {
    // Matches initializeFrame -> preUpdate -> change detection ordering.
    camera._updateCameraChanged();
    if (stabilized) stabilize(SceneMode.SCENE3D);
    if (View.prototype.checkForCameraUpdates.call(view, scene))
      falseCameraUpdates++;
  }
  return {
    changedListener,
    stabilized,
    iterations,
    falseCameraUpdates,
    positionUnchanged: Cartesian3.equals(initialPosition, camera.position),
    maximumFinalBasisDelta: Math.max(
      ...basis().map((value, i) => Math.abs(value - initialBasis[i])),
    ),
  };
}

const control = compare(false, false);
const baseline = compare(true, false);
const stabilized = compare(true, true);
assert.equal(control.falseCameraUpdates, 0, "Control camera must stay still");
assert.equal(
  stabilized.falseCameraUpdates,
  0,
  "Workaround must stop false updates",
);
assert(
  baseline.positionUnchanged,
  "This reproduction isolates orientation drift",
);
console.log(
  JSON.stringify(
    {
      cesium: require("cesium/package.json").version,
      engine: require("@cesium/engine/package.json").version,
      node: process.version,
      reproduced: baseline.falseCameraUpdates > 0,
      limitation:
        "Change-detector calls, not rendered frames or FPS. One 3D pose.",
      control,
      baseline,
      stabilized,
    },
    null,
    2,
  ),
);
