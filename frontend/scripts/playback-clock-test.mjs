import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
// Bundle the real module's imports too: a data URL has no filesystem base for
// the tooltip dependency introduced by the playback controls.
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/playback-speed.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const code = bundled.outputFiles[0].text;
const { PlaybackClock, playbackSpeeds, playbackIncrements } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
for (const increment of playbackIncrements) {
  for (const rate of playbackSpeeds) {
    const clock = new PlaybackClock(rate, 0, increment);
    assert.equal(clock.seconds(1000), rate * increment);
  }
}
// Both live settings integrate the old rate up to the exact change instant.
const clock = new PlaybackClock(1, 0, 3600);
assert.equal(clock.seconds(500), 1800);
clock.setSpeed(0.25, 1000);
assert.equal(clock.seconds(2000), 4500);
clock.setIncrement(86400, 2500);
assert.equal(clock.seconds(3000), 15750);
clock.setSpeed(2, 3000);
clock.setIncrement(604800, 3000);
assert.equal(clock.seconds(4000), 1225350);
assert.equal(clock.seconds(3999), 1225350); // An older frame cannot reverse time.
assert.equal(clock.seconds(4000), 1225350);
console.log("PASS 24 speed/increment combinations and live rate continuity");
