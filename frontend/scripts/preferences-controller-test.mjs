import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("Preferences renders current values after a delayed status reply", async () => {
  const module = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/preferences-controller.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    loader: { ".css": "empty" },
    external: ["@tauri-apps/api/*"],
    plugins: [
      {
        name: "controlled-bridge",
        setup(b) {
          b.onResolve({ filter: /^\.\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const native=false; export const call=(...args)=>globalThis.__preferencesTestBridge.call(...args); export const chooseFile=async()=>null;",
          }));
        },
      },
    ],
  });
  const { createPreferencesController } = await import(
    "data:text/javascript;base64," +
      Buffer.from(module.outputFiles[0].text).toString("base64")
  );
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  globalThis.__preferencesTestBridge = {
    call(command) {
      assert.equal(command, "workspace_status");
      return pending;
    },
  };
  let preferences = {
    theme: "light",
    coordinates: "dd",
    date_format: "system",
    time_format: "system",
  };
  let budget = 20000;
  const rendered = Error("rendered");
  const settings = createPreferencesController({
    preferences: () => preferences,
    budget: () => budget,
    save: async () => {},
    $: () => {},
    input: () => "",
    check: () => false,
    on: () => {},
    closeModal: () => {},
    head: () => "",
    toast: () => {},
    modal(html) {
      assert.match(html, /value="dark" selected/);
      assert.match(html, /value="100000" selected/);
      throw rendered;
    },
  });
  try {
    const opening = settings();
    preferences = { ...preferences, theme: "dark" };
    budget = 100000;
    release({ auto_save_unsaved: true });
    await assert.rejects(opening, (error) => error === rendered);
  } finally {
    delete globalThis.__preferencesTestBridge;
  }
});
