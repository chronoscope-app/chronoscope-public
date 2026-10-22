// Local asset/privilege checks. Optional argument: native QA output directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { PNG } = require("pngjs");
const icons = path.join(root, "src-tauri/icons");
const read = (file) => fs.readFileSync(file);
const sources = Object.fromEntries(
  ["Light", "Dark"].map((theme) => [
    theme,
    PNG.sync.read(read(path.join(icons, `icon-${theme.toLowerCase()}.png`))),
  ]),
);
const macSources = Object.fromEntries(
  ["Light", "Dark"].map((theme) => [
    theme,
    PNG.sync.read(
      read(path.join(icons, `icon-macos-${theme.toLowerCase()}.png`)),
    ),
  ]),
);
for (const image of [...Object.values(sources), ...Object.values(macSources)]) {
  assert.equal(image.width, 512);
  assert.equal(image.height, 512);
  assert.equal(image.data[3], 0, "Icon corners must be transparent");
}
assert(
  read(path.join(icons, "icon.png")).equals(
    read(path.join(icons, "icon-light.png")),
  ),
);
for (const [name, size] of [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
]) {
  const image = PNG.sync.read(read(path.join(icons, name)));
  assert.equal(image.width, size);
  assert.equal(image.height, size);
}
const ico = read(path.join(icons, "icon.ico"));
assert.equal(ico.readUInt16LE(2), 1);
assert(ico.readUInt16LE(4) >= 5, "Windows icon must include multiple sizes");
const icns = read(path.join(icons, "icon.icns"));
assert.equal(icns.subarray(0, 4).toString(), "icns");
assert.equal(icns.readUInt32BE(4), icns.length);
const base = JSON.parse(read(path.join(root, "src-tauri/tauri.conf.json")));
const windows = JSON.parse(
  read(path.join(root, "src-tauri/tauri.windows.conf.json")),
);
assert.equal(base.bundle.windows.nsis.installMode, "currentUser");
assert.deepEqual(windows.bundle.targets, ["nsis"]);
const manifest = read(
  path.join(root, "src-tauri/windows-app-manifest.xml"),
).toString();
assert.match(
  manifest,
  /requestedExecutionLevel level="asInvoker" uiAccess="false"/,
);
assert.match(manifest, /Microsoft.Windows.Common-Controls/);
assert.match(
  read(path.join(root, "src-tauri/build.rs")).toString(),
  /include_str!\("windows-app-manifest.xml"\)/,
);
console.log(
  "PASS desktop icon formats and current-user/asInvoker Windows packaging",
);

if (process.argv[2]) {
  const output = path.resolve(process.argv[2]);
  const report = JSON.parse(
    read(path.join(output, "icon-native-appearance.json")),
  );
  assert.equal(report.passed, true);
  assert.equal(report.system_preferences_changed, false);
  assert.equal(report.theme_events.length, 3);
  assert.notEqual(report.theme_events[0], report.theme_events[1]);
  assert.equal(report.theme_events[0], report.theme_events[2]);
  const error = (actual, expected) => {
    let sum = 0,
      count = 0;
    for (let y = 0; y < actual.height; y++)
      for (let x = 0; x < actual.width; x++) {
        const a = (y * actual.width + x) * 4;
        const e =
          (Math.floor((y * expected.height) / actual.height) * expected.width +
            Math.floor((x * expected.width) / actual.width)) *
          4;
        if (actual.data[a + 3] < 250 || expected.data[e + 3] < 250) continue;
        for (let c = 0; c < 3; c++)
          sum += Math.abs(actual.data[a + c] - expected.data[e + c]);
        count += 3;
      }
    assert(count > 100000, "Enough opaque icon pixels must be compared");
    return sum / count;
  };
  report.pixel_checks = [];
  const captures = [
    ["Light", "Light"],
    ["Dark", "Dark"],
  ];
  if (report.app_preference_sequence) {
    assert.deepEqual(report.app_preference_sequence, [
      "Dark",
      "Light",
      "System",
    ]);
    captures.push(
      ["Dark", "app-Dark"],
      ["Light", "app-Light"],
      ["Dark", "override-Dark"],
    );
  }
  for (const [theme, capture] of captures) {
    const png = path.join(output, `dock-${capture}.png`);
    // AppKit emits extended-range TIFF; sips performs the system color conversion.
    execFileSync("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      path.join(output, `dock-${capture}.tiff`),
      "--out",
      png,
    ]);
    const actual = PNG.sync.read(read(png));
    const correct = error(actual, macSources[theme]);
    const opposite = error(
      actual,
      macSources[theme === "Light" ? "Dark" : "Light"],
    );
    assert(
      correct < 10 && correct < opposite / 4,
      `Incorrect ${theme} Dock pixels: ${correct} versus ${opposite}`,
    );
    report.pixel_checks.push({
      theme,
      capture,
      mean_channel_error: correct,
      opposite_theme_error: opposite,
    });
  }
  report.dock_pixels_match = true;
  fs.writeFileSync(
    path.join(output, "icon-native-appearance.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    "PASS native macOS theme events and actual pearl/black Dock pixels",
  );
}
