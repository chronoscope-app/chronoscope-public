# Mac Codex handoff: renderer performance and the next trail/stem step

Prepared 2026-10-28 for `chronoscope-app/chronoscope-next`. The completed runtime
is on `main` through `12d9052`; this documentation may have a later commit.
The [Mac profiling follow-up](../performance/MAC_TRAIL_STEM_PROFILING_2026-10-28.md)
records local Chrome/Metal and WKWebView validation, retained adverse results and
refresh-scoped coordinate sharing enabled only in native macOS. Trail/stem
topology, run/chunk reuse and GPU time transforms are **not implemented**.

Start with the [Next performance report](../performance/NEXT_PERFORMANCE_REPORT.md).
It records the three completed phases, measurements, adverse/noisy observations,
memory costs, correctness fallbacks, source entry points and acceptance criteria.

## Scope and source

Develop and validate locally in Next. Keep workflows manual-only; do not dispatch
GitHub Actions or publish/promote to `chronoscope-public` without a new user
instruction. Preserve existing local edits and saved user work.

From the Mac's Next checkout, inspect before updating:

```sh
git status --short
git remote -v
git fetch origin
git log -6 --oneline origin/main
git branch -r --no-merged origin/main
```

When clean and on `main`, fast-forward with `git pull --ff-only origin main`.
Do not reset a dirty checkout or omit pending completed work. On October 28 the
unmerged remote names were `backup/pre-public-sync-20261023t165257z`,
`codex/intel-pacing-bounded` and `codex/retire-apple-si-chat`; this is a historical
inventory, not an instruction to merge them. Check current contents/ancestry.

Relevant checkpoints:

- `3ddc015` and `6cf4ac1`: marker/stem reuse, selection optimization and QA fixes.
- `c664af5`: track styling/visibility caching and bloom-worker independence.
- `45ef153`: bounded incremental playback markers and small-packet fallback.
- `982e38e`: reproducible native trail/stem stage accounting and profiling harness.
- `12d9052`: reuse current marker coordinates during Mac native trail/stem refreshes;
  preserve canonical conversion elsewhere after adverse Chrome measurements.

For native playback before/after attribution, `c664af5` → `45ef153` isolates the
latest playback change. Use separate clean checkouts/build artifacts as needed;
do not overwrite the current checkout or reuse a stale app bundle. Older report
baselines differ by phase. The Linux `.qa` bundles, profiles and screenshots were
ignored local artifacts and did not travel with the Git push; rebuild on the Mac.

## First validate the committed code on the Mac

Use the existing local toolchain and [Mac build guide](../MAC_HANDOFF.md).
Install frontend dependencies if needed:

```sh
npm --prefix frontend ci
```

The following uses visible Chrome/Metal and a release CLI. It runs serially under
the resource guard; no hosted runner is involved. Set `CHRONOSCOPE_CHROMIUM` if
Chrome is not at the standard `/Applications/Google Chrome.app` location.

```sh
CHRONOSCOPE_QA_HARDWARE=1 CHRONOSCOPE_QA_HEADLESS=0 \
python3 scripts/guarded_run.py -- python3 scripts/validate_local.py \
  --release-cli --browser-jobs 1 \
  --suite renderer-reuse --suite track-style --suite playback-reuse \
  --suite playback-transitions --suite cesium-parity --suite cesium-context \
  --suite cesium-effects-pixels --suite cesium-globe-time \
  --rust-test display_lod --rust-test playback_display --rust-test map_presets \
  --report .qa/mac-renderer-performance/report.json
```

Inspect actual renderer strings and receipts; a Metal launch flag alone is not
proof of hardware acceleration. A closed browser or timeout is an incomplete
run. Do not substitute software results for hardware acceptance. The hardware
playback-control test retains its ≥20 presentations / <180 ms median interval
criteria at 1600 × 1000. Software control runs use 1100 × 700, record cadence and
assert functionality rather than hardware throughput.

For interleaved 10k/100k comparison of reuse and canonical rebuilding in the same
warmed browser, after the release CLI/frontend build above:

```sh
CHRONOSCOPE_CLI="$PWD/target/release/chronoscope" \
CHRONOSCOPE_QA_HARDWARE=1 CHRONOSCOPE_QA_HEADLESS=0 \
CHRONOSCOPE_PLAYBACK_PAIRED=1 \
CHRONOSCOPE_QA_OUT="$PWD/.qa/mac-playback-paired" \
python3 scripts/guarded_run.py -- node frontend/scripts/playback-reuse-qa.mjs
```

The paired script isolates marker installation/rendering; tracks are disabled in
that paired comparison. It cannot demonstrate a trail-enabled native FPS gain.
`CHRONOSCOPE_PLAYBACK_LOAD_ONLY=1` instead runs full 100k dataset-install checks;
`CHRONOSCOPE_PLAYBACK_VISUAL_ONLY=1` runs fresh controlled image/state checks.
Use distinct output directories for each run. Capture a baseline with matching
settings/dependencies when making before/after visual claims. Chrome on Metal is
still a different runtime from the native Tauri WKWebView.

### Optional real 100k dataset for native playback

The isolated reuse fixture installs synthetic points directly into the renderer.
For a SQLite-backed workload that can be reopened in the native app, the existing
[100k benchmark](../../frontend/scripts/performance-100k-qa.mjs) generates and
imports 100 entities × 1,000 Events and can save a portable project:

```sh
CHRONOSCOPE_CLI="$PWD/target/release/chronoscope" \
CHRONOSCOPE_QA_HARDWARE=1 CHRONOSCOPE_QA_HEADLESS=0 \
CHRONOSCOPE_PERF_OUT="$PWD/.qa/mac-100k-fixture" \
CHRONOSCOPE_PERF_PROJECT="$PWD/.qa/mac-100k-fixture/tracks-100k.chronoscope" \
python3 scripts/guarded_run.py -- node frontend/scripts/performance-100k-qa.mjs
```

This is an additional hardware benchmark, not a fixture-only command; retain its
report if it fails or closes. It saves the project before later benchmark view
changes, so explicitly restore/record the desired display settings and
`view_set.render_budget` (20k or 100k) when opening it in the disposable native
profile. Do not infer drawn counts from the file's 100k total. The benchmark's
CSV producer is also available for recreating the same data without carrying any
Linux profile or token to the Mac.

## Rebuild and profile native WKWebView separately

The installed older app does not acquire these source changes automatically.
Build this checkout's debug app into `target/debug/bundle/macos/Chronoscope.app`
and use a disposable profile:

```sh
mac_perf_profile="$PWD/.qa/mac-renderer-native-profile"
CHRONOSCOPE_DATA_DIR="$mac_perf_profile" bash script/build_and_run.sh --verify
mac_perf_binary="$PWD/target/debug/bundle/macos/Chronoscope.app/Contents/MacOS/chronoscope-desktop"
"$mac_perf_binary" --data-dir "$mac_perf_profile" agent enable
"$mac_perf_binary" --data-dir "$mac_perf_profile" --attach view status
```

The script stops/replaces only this checkout's running development app, uses
local ad hoc signing and launches the disposable profile. Keep personal work in
another installed copy/profile. This does not install a release, notarize or
publish anything. An unlocked desktop is needed for UI/capture checks.

Use [live MCP profiling/playback](../MCP-LIVE.md) and [CLI/MCP](../CLI-MCP.md) for
bounded `view_profile`, actual `view_playback`, captures and readiness. Discover
the running app's capabilities/schemas before scripting. `view_status` supplies
actual view/renderer state; `snapshot.scene` alone does not prove what rendered.
`scripts/profile_native.mjs` is a **WebKitGTK/Linux inspector harness**, not a
drop-in Mac WKWebView profiler.

Measure baseline and candidate with identical hardware, app profile type,
dataset, actual visible Event count, viewport/framebuffer, resolution scale,
camera, time window, tracks/stems/bloom, imagery, terrain and fade settings.
Record total Events and entities separately from visible markers. A 100k-Event
dataset playing a 25% window is not 100k simultaneously drawn markers.

Warm up, run several complete playback cycles and interleave baseline/candidate
observations. Include moving and growing windows (`playback_fade` on/off), reverse
scrub and large jumps, 10k/100k workloads and small control datasets. Run no other
GPU test or compilation concurrently. Record frame interval median/p95, visible
stalls, CPU install/submission time and buffer calls/bytes separately. Polling
native status can flush GUI work and alter FPS; use sparse observations or the
bounded profile trace, and document sampling cadence. CPU traces exclude
asynchronous GPU time. Collect OS/WebKit/Metal profiles separately from FPS runs.

The [October 17 native report](../performance/MAC_NATIVE_PLAYBACK_2026-10-17.md)
documents earlier `bufferSubData` copy/fence behavior and separate arrival
collections. Its FPS numbers do not validate October 28 code. Preserve that
arrival batching; do not merge fading markers back into a large static collection
without fresh native evidence.

## Then implement the next step if profiling supports it

Read the [completed Mac observations](../performance/MAC_TRAIL_STEM_PROFILING_2026-10-28.md)
before following the staged [trail/stem plan](../performance/NEXT_PERFORMANCE_REPORT.md#next-incremental-trails-and-stems):
profile stages; cache entity/time/ID topology; reuse unchanged runs/materials;
then introduce bounded chunks only where simplification, projection and draw
order remain valid. A GPU time transform is a later experiment, not the first
required change. Target full trail/stem-enabled playback, where the Linux sample
improved only about 7%.

Keep these safeguards:

- Screen-space Douglas–Peucker results can change throughout a run when its
  endpoints, camera, selected/inferred anchors or time projection change. Naive
  per-chunk or tail-only updates can change the visible evidence.
- Ground coordinates may stay fixed while the simplified ground edge sequence
  changes, because current edge selection uses projected Event positions.
- Preserve reversed/clamped time heights, timestamp precision, terrain datum and
  exaggeration, geometry/pick/culling agreement, gap rules and source IDs.
- Keep globe budgets shared across chunks and retain the current individual
  globe-layer rebuild fallback. Hidden geometry previously changed brightness
  and depth sorting; do not remove that fallback based on CPU timings alone.
- Keep the below-256 marker fallback and time-only opaque resident path unless
  native comparisons justify changing them. Stable bounded caching is welcome;
  the user explicitly considers the measured 20.4 MiB warmed-track cache useful.
- Verify seams, gaps, joins, selection/reentry, inferred points, fade expiry,
  reversed/empty windows, camera/height/terrain changes, recovery and source
  collectability. Repeated visible/hidden cycles must not accumulate memory.

## Return evidence and a reviewable result

Update the [Next report](../performance/NEXT_PERFORMANCE_REPORT.md) with a new
dated Mac report and portable JSON. Record commit/build IDs, actual renderer,
hardware/OS/runtime, viewport, visible counts, settings, raw observations and
failed/noisy runs. Separate Chrome/Metal, native WKWebView, CPU, GPU/presentation
and buffer accounting. Do not add gains from unrelated workloads or promise
million-entity rendering. Keep logs/profiles/tokens and disposable workspaces in
ignored `.qa`; commit concise evidence/sanitized captures where useful.

Integrate completed, locally verified work into Next/main; leave public promotion
to a separate user instruction. Report incomplete checks explicitly.

## Copy-ready brief for Mac Codex

> Work in chronoscope-app/chronoscope-next. Read AGENTS.md,
> docs/performance/NEXT_PERFORMANCE_REPORT.md and
> docs/handoffs/2026-10-28-renderer-performance-mac.md. Fetch and inspect Next/main
> and local/pending work; preserve edits. Completed runtime changes are through
> 12d9052. Read the dated Mac profiling follow-up and its portable JSON, including
> the Mac-only coordinate reuse and adverse Chrome results. Rebuild and validate
> current changes locally on Chrome/Metal and
> the native WKWebView with a disposable profile. Then profile full trail/stem-
> enabled playback and implement incremental trail/stem work if the measurements
> support it. Preserve simplification, gaps, selected/inferred anchors, globe
> order/budgets, fades, picking and bounded memory; retain useful rebuild
> fallbacks. Record comparable raw/native evidence and limitations, update the
> Next report, and integrate completed verified work into Next/main. Do not use
> hosted runners or promote to chronoscope-public.
