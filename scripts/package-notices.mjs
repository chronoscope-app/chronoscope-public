// Selected notices/provenance only: this manifest is not a complete SBOM or
// evidence that every linked native/transitive dependency has been cleared.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const requiredFiles = [
  "vendor/glib/LICENSE", "vendor/glib/COPYRIGHT", "vendor/glib/BACKPORT.md",
  "LICENSE", "THIRD_PARTY.md", "docs/DATA-ATTRIBUTION.md", "docs/DISTRIBUTION.md",
  "assets/NOTICE.md", "frontend/src/assets/egm96-15-NOTICE.txt",
  "assets/terrain/README.md",
  "samples/README.md", "samples/public/SOURCES.md",
  "samples/public/demo-provenance.json", "samples/public/wildlife-provenance.json",
  "docs/NOAA-HURRICANE-DEMO.md", "docs/REAL-WORLD-DEMOS.md", "docs/WILDLIFE-DEMOS.md",
];
const requiredTrees = ["assets/licenses", "frontend/public/licenses"];
const optionalFiles = [
  "NOTICE", "NOTICE.md", "docs/MEDIA-RIGHTS.json",
  "samples/public/animal-gps-black-rock-forest-2023-03.csv.attribution.json",
  "tests/fixtures/cesium/README.md",
  "tests/fixtures/gis/README.md", "tests/fixtures/terrain/README.md",
];
const optionalTrees = ["assets/provenance"];
export const manifestName = "NOTICE-MANIFEST.json";

export function safeName(name) {
  if (!name || path.posix.normalize(name) !== name || name.startsWith("/") ||
      /[\\:\x00-\x1f]/.test(name) || name.split("/").some(p => !p || p === "." || p === ".."))
    throw new Error("Unsafe notice path: " + JSON.stringify(name));
  return name;
}
function checkedPath(root, name) {
  let file = root;
  for (const part of safeName(name).split("/")) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Notice symlink refused: " + name);
  }
  return file;
}
function filesUnder(root, name) {
  const file = checkedPath(root, name);
  const info = fs.lstatSync(file);
  if (info.isFile()) return [name];
  if (!info.isDirectory()) throw new Error("Non-regular notice input: " + name);
  return fs.readdirSync(file).sort().flatMap(child => filesUnder(root, name + "/" + child));
}
function digest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}
function readRegular(root, name) {
  const file = checkedPath(root, name);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Not a regular notice: " + name);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function verifyNotices(directory) {
  const root = path.resolve(directory);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Notice directory is a symlink");
  const manifest = JSON.parse(readRegular(root, manifestName));
  if (manifest.format !== 1 || manifest.algorithm !== "SHA256") throw new Error("Unsupported notice manifest");
  const expected = new Set([manifestName]);
  const folded = new Set([manifestName.toLowerCase()]);
  for (const entry of manifest.files) {
    const name = safeName(entry.path);
    if (expected.has(name) || folded.has(name.toLowerCase())) throw new Error("Duplicate notice: " + name);
    expected.add(name); folded.add(name.toLowerCase());
    const content = readRegular(root, name);
    if (content.length !== entry.bytes || digest(content) !== entry.sha256) throw new Error("Notice hash mismatch: " + name);
  }
  const actual = fs.readdirSync(root).flatMap(name => filesUnder(root, name));
  if (actual.length !== expected.size || actual.some(name => !expected.has(name)))
    throw new Error("Missing or unmanifested notice file");
  for (const name of requiredFiles) if (!expected.has(name)) throw new Error("Required notice missing: " + name);
  for (const name of requiredTrees) if (![...expected].some(p => p.startsWith(name + "/")))
    throw new Error("Required notice tree empty: " + name);
  return manifest;
}

export function prepareNotices(repository) {
  const root = fs.realpathSync(repository);
  const parent = path.join(root, "frontend/public");
  checkedPath(root, "frontend/public");
  const dest = path.join(parent, "third-party");
  // lstat sees dangling links too (existsSync does not).
  try {
    const info = fs.lstatSync(dest);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Refusing non-directory notice destination");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const inputs = new Set(requiredFiles);
  for (const tree of requiredTrees) {
    const files = filesUnder(root, tree);
    if (!files.length) throw new Error("Required notice tree empty: " + tree);
    for (const file of files) inputs.add(file);
  }
  for (const file of [...optionalFiles, ...optionalTrees]) {
    try { checkedPath(root, file); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const child of filesUnder(root, file)) inputs.add(child);
  }
  const staged = fs.mkdtempSync(path.join(parent, ".third-party-notices-"));
  try {
    const manifest = { format: 1, algorithm: "SHA256",
      scope: "Selected license and provenance files; not a complete dependency or native-source compliance determination",
      files: [] };
    for (const name of [...inputs].sort()) {
      const content = readRegular(root, name);
      const output = path.join(staged, name);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, content);
      manifest.files.push({ path: name, bytes: content.length, sha256: digest(content) });
    }
    fs.writeFileSync(path.join(staged, manifestName), JSON.stringify(manifest, null, 2) + "\n");
    verifyNotices(staged);
    // This is a dedicated, generated directory. Never merge stale notices.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staged, dest);
    verifyNotices(dest);
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
  return dest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory] = process.argv.slice(2);
  if (!directory || !["--prepare", "--check"].includes(action))
    throw new Error("Usage: node scripts/package-notices.mjs --prepare REPOSITORY | --check NOTICE_DIRECTORY");
  if (action === "--prepare") console.log(prepareNotices(directory));
  else console.log("Verified " + verifyNotices(directory).files.length + " notice files");
}
