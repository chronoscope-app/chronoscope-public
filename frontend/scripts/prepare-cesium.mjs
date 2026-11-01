// Ship workers, imagery and runtime resources locally: no CDN or ion dependency.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { verifyBalancedTerrain } from "../../scripts/verify-balanced-terrain.mjs";
import { prepareNotices } from "../../scripts/package-notices.mjs";
import { applyTerrainPickerPatch } from "./patches/terrain-picker.mjs";
const root = path.resolve(import.meta.dirname, "..");
applyTerrainPickerPatch(root);
const python = process.env.CHRONOSCOPE_PYTHON || (process.platform === "win32" ? "python" : "python3");
const data = spawnSync(python, [path.resolve(root, "../scripts/fetch_data_assets.py")], { stdio: "inherit" });
if (data.error || data.status !== 0) throw new Error("Pinned build data could not be prepared", { cause: data.error });
await verifyBalancedTerrain(path.resolve(root, ".."));
const source = path.join(root, "node_modules/cesium/Build/Cesium");
const dest = path.join(root, "public/cesium");
fs.mkdirSync(dest, { recursive: true });
for (const name of ["Assets", "ThirdParty", "Workers", "Widgets"])
  fs.cpSync(path.join(source, name), path.join(dest, name), {
    recursive: true,
  });
for (const name of ["LICENSE.md", "CHANGES.md"])
  if (fs.existsSync(path.join(root, "node_modules/cesium", name)))
    fs.copyFileSync(
      path.join(root, "node_modules/cesium", name),
      path.join(dest, name),
    );
// Preserve repository-relative provenance links in the notice payload.
prepareNotices(path.resolve(root, ".."));
console.log(
  "Prepared local Cesium assets, workers and verified notice manifest",
);
