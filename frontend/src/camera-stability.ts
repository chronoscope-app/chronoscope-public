import type { Camera } from "cesium";

type PoseCamera = Pick<
  Camera,
  "position" | "direction" | "up" | "right" | "transform"
>;
const axes = ["direction", "up", "right"] as const;
const coordinates = ["x", "y", "z"] as const;

/** Cesium's heading/roll getters temporarily transform the camera, including
 * during its own changed-event check. Roundoff from that round trip can exceed
 * its stationary-camera comparison and defeat requestRenderMode. Retain the
 * last orientation only when position, reference frame and scene mode are
 * identical and all nine basis components differ by at most 1e-14. */
export function cameraStabilizer(camera: PoseCamera) {
  let mode: number | undefined;
  let position: number[] = [];
  let transform: number[] = [];
  let orientation: number[] = [];
  return (sceneMode: number) => {
    const stationary =
      mode === sceneMode &&
      coordinates.every((axis, i) => camera.position[axis] === position[i]) &&
      transform.every((value, i) => camera.transform[i] === value) &&
      axes.every((axis, i) =>
        coordinates.every(
          (component, j) =>
            Math.abs(camera[axis][component] - orientation[i * 3 + j]) <= 1e-14,
        ),
      );
    if (stationary) {
      for (let i = 0; i < axes.length; i++)
        for (let j = 0; j < coordinates.length; j++)
          camera[axes[i]][coordinates[j]] = orientation[i * 3 + j];
    } else {
      mode = sceneMode;
      position = coordinates.map((axis) => camera.position[axis]);
      transform = Array.from({ length: 16 }, (_, i) => camera.transform[i]);
      orientation = axes.flatMap((axis) =>
        coordinates.map((component) => camera[axis][component]),
      );
    }
  };
}
