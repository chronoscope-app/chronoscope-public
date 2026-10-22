import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";

const knockoutPath =
  /[/\\]@cesium[/\\]widgets[/\\]Source[/\\]ThirdParty[/\\]knockout-3\.5\.1\.js$/;
function cspSafeKnockout(code: string) {
  // The pinned UMD bundle discovers its global using eval under strict ESM.
  // globalThis supplies the same object without weakening the desktop CSP.
  const original = 'this||(0,eval)("this")';
  if (code.split(original).length !== 2)
    throw new Error(
      "Review Cesium Knockout CSP compatibility after dependency update",
    );
  return code.replace(original, "globalThis");
}
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "cesium-knockout-csp-global",
      enforce: "pre",
      transform(code, id) {
        if (!knockoutPath.test(id)) return;
        return { code: cspSafeKnockout(code), map: null };
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "cesium-knockout-csp-global",
          setup(build) {
            build.onLoad({ filter: knockoutPath }, async ({ path }) => ({
              contents: cspSafeKnockout(await readFile(path, "utf8")),
              loader: "js",
            }));
          },
        },
      ],
    },
  },
  define: { CESIUM_BASE_URL: JSON.stringify("./cesium/") },
  build: {
    rollupOptions: {
      input: { main: "index.html", si: "si.html" },
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (
            id.includes("vite/preload-helper") ||
            id.includes("commonjsHelpers")
          )
            return "runtime-helpers";
          if (
            id.includes("/node_modules/@cesium/") ||
            id.includes("/node_modules/cesium/")
          )
            return "cesium";
        },
      },
    },
  },
});
