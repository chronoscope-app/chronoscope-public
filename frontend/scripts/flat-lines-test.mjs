import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {
  Cartesian3,
  Geometry,
  GeometryInstance,
  GeometryPipeline,
} from "cesium";
const code = ts
  .transpileModule(
    fs.readFileSync(new URL("../src/flat-lines.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  )
  .outputText.replace(
    'from "cesium"',
    `from ${JSON.stringify(import.meta.resolve("cesium"))}`,
  );
const { flatLineGeometry } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
for (const lons of [
  [-106, 12],
  [-179, 179],
  [-80, -70],
]) {
  const positions = new Float64Array(
    lons.flatMap((lon) =>
      [2, 100000].flatMap((height) => {
        const p = Cartesian3.fromDegrees(lon, 30, height);
        return [p.x, p.y, p.z];
      }),
    ),
  );
  const instance = new GeometryInstance({
    geometry: flatLineGeometry(positions),
  });
  // This real Cesium pipeline threw for the old fading stem geometry across hemispheres.
  GeometryPipeline.splitLongitude(instance);
  let count = 0;
  for (const key of [
    "geometry",
    "westHemisphereGeometry",
    "eastHemisphereGeometry",
  ]) {
    if (instance[key]) count += Geometry.computeNumberOfVertices(instance[key]);
  }
  assert(count >= 4, "Longitude splitting preserves both vertical lines");
}
console.log(
  "PASS fading line geometry across both meridians and within one hemisphere",
);
