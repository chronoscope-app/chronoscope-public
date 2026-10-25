import path from "node:path";

export function browserOptions(
  env = process.env,
  platform = process.platform,
  { hardware = env.CHRONOSCOPE_QA_HARDWARE === "1" } = {},
) {
  const angle =
    env.CHRONOSCOPE_QA_ANGLE ||
    (platform === "darwin"
      ? "metal"
      : hardware
        ? platform === "win32"
          ? "d3d11"
          : "vulkan"
        : "swiftshader");
  if (!["metal", "swiftshader", "vulkan", "d3d11"].includes(angle))
    throw Error("Unsupported QA ANGLE backend");
  const requestedHeadless = env.CHRONOSCOPE_QA_HEADLESS;
  if (
    requestedHeadless !== undefined &&
    !["0", "1"].includes(requestedHeadless)
  )
    throw Error("CHRONOSCOPE_QA_HEADLESS must be 0 or 1");
  const executablePath =
    env.CHRONOSCOPE_CHROMIUM ||
    (platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : platform === "win32"
        ? undefined
        : "/usr/bin/chromium");
  return {
    ...(executablePath ? { executablePath } : {}),
    // Long Metal benchmark runs can close headless Chrome on this Mac. Keep
    // a real window for hardware measurements; ordinary correctness stays headless.
    headless:
      requestedHeadless === undefined
        ? !(hardware && platform === "darwin")
        : requestedHeadless === "1",
    args: [
      "--no-sandbox",
      `--use-angle=${angle}`,
      ...(angle === "swiftshader" ? ["--enable-unsafe-swiftshader"] : []),
      ...(angle === "vulkan"
        ? ["--use-vulkan=native", "--enable-features=Vulkan"]
        : []),
    ],
  };
}

export function runPaths(root, name, env = process.env) {
  const out = path.resolve(
    env.CHRONOSCOPE_QA_OUT || path.join(root, ".qa", name),
  );
  return {
    out,
    data: path.resolve(
      env.CHRONOSCOPE_QA_DATA_DIR || path.join(out, "profile"),
    ),
    screenshots: path.resolve(env.CHRONOSCOPE_QA_SCREENSHOTS || out),
  };
}
