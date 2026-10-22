// The authored help module is also plain JavaScript; keep shipped docs in sync.
import fs from "node:fs";
const code = fs.readFileSync(
  new URL("../frontend/src/help.ts", import.meta.url),
  "utf8",
);
const { guide, shortcuts } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const markdown = (text) =>
  text
    .replace(/<code>(.*?)<\/code>/g, "`$1`")
    .replace(/<b>(.*?)<\/b>/g, "**$1**")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]*>/g, "");
let out = `# Chronoscope ${JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version} user guide\n\nThe same guide is available offline from **Help → Full user guide** in the app.\n\n`;
for (const [title, body] of guide)
  out += "## " + title + "\n\n" + markdown(body);
out +=
  "## Keyboard shortcuts\n\n| Shortcut | Action |\n| --- | --- |\n" +
  shortcuts.map(([key, text]) => `| ${key} | ${text} |`).join("\n") +
  "\n";
fs.writeFileSync(new URL("../docs/USER-GUIDE.md", import.meta.url), out);
