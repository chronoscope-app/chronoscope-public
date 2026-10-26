import { Cartesian3, Matrix4, type Camera } from "cesium";
import type { SceneState } from "./types";
export type CesiumCameraState = NonNullable<SceneState["cesium_camera"]>;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Camera persistence has no terrain, imagery, appearance or data dependencies. */
export function captureCamera(camera: Camera): {
  renderer: "cesium";
  cesium_camera: CesiumCameraState;
} {
  const frustum = camera.frustum as {
    width?: number;
    left?: number;
    right?: number;
  };
  const width =
    frustum.width ??
    (typeof frustum.left === "number" && typeof frustum.right === "number"
      ? frustum.right - frustum.left
      : undefined);
  return {
    renderer: "cesium",
    cesium_camera: {
      position: [camera.position.x, camera.position.y, camera.position.z],
      direction: [camera.direction.x, camera.direction.y, camera.direction.z],
      up: [camera.up.x, camera.up.y, camera.up.z],
      ...(typeof width === "number" ? { frustum_width: width } : {}),
    },
  };
}
export function restoreCamera(
  camera: Camera,
  mode: string,
  scene: SceneState,
): boolean {
  const state = scene?.cesium_camera;
  if (
    scene?.renderer !== "cesium" ||
    !state ||
    ![state.position, state.direction, state.up].every(
      (v) => Array.isArray(v) && v.length === 3 && v.every(finite),
    )
  )
    return false;
  const direction = Cartesian3.unpack(state.direction),
    up = Cartesian3.unpack(state.up);
  if (
    Math.abs(Cartesian3.magnitude(direction) - 1) > 1e-5 ||
    Math.abs(Cartesian3.magnitude(up) - 1) > 1e-5 ||
    Math.abs(Cartesian3.dot(direction, up)) > 1e-5
  )
    return false;
  camera.lookAtTransform(Matrix4.IDENTITY);
  Cartesian3.unpack(state.position, 0, camera.position);
  Cartesian3.clone(direction, camera.direction);
  Cartesian3.clone(up, camera.up);
  Cartesian3.cross(direction, up, camera.right);
  if (
    mode === "map" &&
    finite(state.frustum_width) &&
    state.frustum_width > 0
  ) {
    const f = camera.frustum as {
      width?: number;
      left?: number;
      right?: number;
      top?: number;
      bottom?: number;
    };
    if (f.width !== undefined) f.width = state.frustum_width;
    else if (
      f.left !== undefined &&
      f.right !== undefined &&
      f.top !== undefined &&
      f.bottom !== undefined
    ) {
      const ratio = (f.top - f.bottom) / (f.right - f.left);
      f.left = -state.frustum_width / 2;
      f.right = state.frustum_width / 2;
      f.top = (state.frustum_width * ratio) / 2;
      f.bottom = (-state.frustum_width * ratio) / 2;
    }
  }
  return true;
}
