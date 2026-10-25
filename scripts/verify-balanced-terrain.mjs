import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export async function verifyBalancedTerrain(root) {
  const folder = path.join(root, "assets/terrain");
  const pack = path.join(folder, "balanced.cterrain");
  const receipt = JSON.parse(fs.readFileSync(path.join(folder, "balanced.json"), "utf8"));
  if (fs.lstatSync(pack).isSymbolicLink() || !fs.statSync(pack).isFile())
    throw new Error("Bundled Balanced terrain must be a regular file");
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(pack)) digest.update(chunk);
  if (receipt.sha256 !== digest.digest("hex") || receipt.bytes !== fs.statSync(pack).size ||
      receipt.source_md5 !== "5b6c47502ae8d03b8718349655d5cd95")
    throw new Error("Bundled Balanced terrain does not match its source and measured receipt");
  console.log(`Verified Balanced terrain: ${receipt.bytes.toLocaleString("en-US")} compressed bytes`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await verifyBalancedTerrain(process.argv[2] || path.resolve(import.meta.dirname, ".."));
