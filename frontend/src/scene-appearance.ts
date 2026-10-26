import { Color, type Globe, type Scene } from "cesium";

type AppearanceTarget = Pick<Scene, "backgroundColor"> & {
  globe: Pick<Globe, "baseColor">;
};
/** Only colors are reachable here; camera and map providers are not inputs. */
export function applySceneAppearance(scene: AppearanceTarget, theme: string) {
  scene.backgroundColor = Color.fromCssColorString(
    theme === "light" ? "#e5e9ef" : "#0e1420",
  );
  scene.globe.baseColor = Color.fromCssColorString(
    theme === "light" ? "#c9d2df" : "#2f3c50",
  );
}
