// Rebuild checked-in desktop icons with the project's existing Tauri CLI.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const icons = path.join(root, "src-tauri/icons");
const cli = path.join(root, "frontend/node_modules/@tauri-apps/cli/tauri.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "chronoscope-icons-"));
try {
  for (const appearance of ["light", "dark"]) {
    const output = path.join(work, appearance);
    execFileSync(
      process.execPath,
      [
        cli,
        "icon",
        path.join(icons, `icon-${appearance}.svg`),
        "--output",
        output,
      ],
      { stdio: "inherit" },
    );
    fs.copyFileSync(
      path.join(output, "icon.png"),
      path.join(icons, `icon-${appearance}.png`),
    );
    // macOS icons include ~10% canvas insets, matching the apparent size of
    // installed system/ChatGPT icons. Keep Windows/Linux artwork full-sized.
    const macSvg = path.join(icons, `icon-macos-${appearance}.svg`);
    const source = fs.readFileSync(
      path.join(icons, `icon-${appearance}.svg`),
      "utf8",
    );
    const start = source.indexOf(">") + 1;
    const end = source.lastIndexOf("</svg>");
    const scale = 412 / 496; // 50 px inset and 412 px body on a 512 px canvas.
    fs.writeFileSync(
      macSvg,
      source.slice(0, start) +
        `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
        source.slice(start, end) +
        "</g></svg>\n",
    );
    const macOutput = path.join(work, `${appearance}-macos`);
    execFileSync(
      process.execPath,
      [cli, "icon", macSvg, "--output", macOutput],
      { stdio: "inherit" },
    );
    fs.copyFileSync(
      path.join(macOutput, "icon.png"),
      path.join(icons, `icon-macos-${appearance}.png`),
    );
    if (appearance === "light") {
      for (const file of [
        "32x32.png",
        "128x128.png",
        "128x128@2x.png",
        "icon.png",
        "icon.ico",
      ])
        fs.copyFileSync(path.join(output, file), path.join(icons, file));
      fs.copyFileSync(
        path.join(macOutput, "icon.icns"),
        path.join(icons, "icon.icns"),
      );
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
