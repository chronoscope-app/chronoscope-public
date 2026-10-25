import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { browserOptions, runPaths } from "./qa-config.mjs";

test("One platform policy chooses Metal on Mac and explicit software rendering elsewhere", () => {
  assert(browserOptions({}, "darwin").args.includes("--use-angle=metal"));
  assert.equal(browserOptions({}, "darwin").headless, true);
  assert(
    browserOptions({}, "linux").args.includes("--enable-unsafe-swiftshader"),
  );
  assert.equal(
    browserOptions({ CHRONOSCOPE_CHROMIUM: "/custom/chrome" }, "darwin")
      .executablePath,
    "/custom/chrome",
  );
  assert(
    browserOptions(
      { CHRONOSCOPE_QA_ANGLE: "swiftshader" },
      "darwin",
    ).args.includes("--use-angle=swiftshader"),
  );
  assert.throws(
    () => browserOptions({ CHRONOSCOPE_QA_ANGLE: "typo" }),
    /backend/,
  );
});
test("Hardware probes select a native backend and keep explicit overrides", () => {
  for (const [platform, backend] of [
    ["linux", "vulkan"],
    ["darwin", "metal"],
    ["win32", "d3d11"],
  ]) {
    const options = browserOptions({}, platform, { hardware: true });
    assert(options.args.includes(`--use-angle=${backend}`));
    assert(!options.args.includes("--enable-unsafe-swiftshader"));
    assert.equal(options.headless, platform !== "darwin");
  }
  assert.equal(
    browserOptions({ CHRONOSCOPE_QA_HEADLESS: "1" }, "darwin", {
      hardware: true,
    }).headless,
    true,
  );
  assert.equal(
    browserOptions({ CHRONOSCOPE_QA_HEADLESS: "0" }, "linux").headless,
    false,
  );
  assert.throws(
    () => browserOptions({ CHRONOSCOPE_QA_HEADLESS: "typo" }),
    /HEADLESS/,
  );
  assert(
    browserOptions({ CHRONOSCOPE_QA_HARDWARE: "1" }, "linux").args.includes(
      "--use-vulkan=native",
    ),
  );
  const overridden = browserOptions(
    { CHRONOSCOPE_QA_ANGLE: "swiftshader" },
    "linux",
    { hardware: true },
  );
  assert(overridden.args.includes("--use-angle=swiftshader"));
  assert(!overridden.args.includes("--use-vulkan=native"));
});
test("Explicit run directories win over old shared report locations", () => {
  const result = runPaths("/project", "navigation", {
    CHRONOSCOPE_QA_DATA_DIR: "/run/data",
    CHRONOSCOPE_QA_OUT: "/run/evidence",
    CHRONOSCOPE_QA_SCREENSHOTS: "/run/pixels",
  });
  assert.deepEqual(result, {
    data: path.resolve("/run/data"),
    out: path.resolve("/run/evidence"),
    screenshots: path.resolve("/run/pixels"),
  });
});
