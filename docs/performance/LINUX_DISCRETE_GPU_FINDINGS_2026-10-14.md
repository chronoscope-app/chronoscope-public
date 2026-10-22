> AI implementers: see [tested code-change specification](AI_PERFORMANCE_CHANGE_SPEC_2026-10-14.md). Historical technical findings are retained; identifying host/workflow receipts were removed before publication.

> Historical measurements refer to earlier development revisions, whose Git objects are not included in this clean snapshot. Source links now browse the current snapshot only; line ranges and historical measured code are not asserted to match. Earlier source IDs remain contextual labels, not retrievable commits here.

# Linux build and discrete-GPU findings — 2026-10-14

**Reading guide:** [measured Radeon continuation](#post-reboot-continuation--verified-native-radeon-measurements) · [full-stack recommendation roadmap](#full-stack-performance-roadmap--recommendations-added-2026-10-14) · [ordered milestones](#ordered-milestones-and-dependencies). The roadmap is recommendations only; measured facts and reproducers below are preserved.

## Executive summary

**Real optimized Linux desktop and CLI builds succeeded. The initial Radeon test was blocked by a kernel runtime-power error; after the owner-authorized reboot, Radeon-only initialization and the actual native-app hardware gate passed, and repeated Radeon measurements completed. Default 20k space-time submitted 55.7–57.0 FPS; 100k geometry stress 31.1–31.2 FPS. Submission cadence is not physical-presented FPS. Historical Intel controls remain explicitly separate.**

Completed: 96 passing Rust tests, strict core Clippy, formatting, production TypeScript/Vite build, both documented browser QA suites, native desktop execution/pixel checks, repeated native **Intel-only controls**, and an exact one-million-row engine/storage benchmark. Production source and locked dependencies are unchanged. Only findings and small reversible measurement reproducers are committed. The post-reboot continuation below adds verified Radeon normal/expanded/workflow/DTED/startup/idle results.

## List of findings and priorities

1. **Historical P0 / host blocker — Radeon unusable before reboot; now recovered.** Before reboot, RADV reported “Could not open device /dev/dri/renderD129: Invalid argument (VK_ERROR_INCOMPATIBLE_DRIVER)” and ERROR_INITIALIZATION_FAILED. Pre-reboot sysfs runtime state was **error**. The kernel logged a VCE suspend timeout at 07:03:58; three explicit Radeon-only enumeration retries failed. PCI presence and readable nodes do not prove usable graphics. At the initial measurement stage, operator-authorized driver/power recovery or reboot was needed and no privileged recovery had been attempted. Subsequent owner-authorized wake failed; a single reboot then recovered initialization (see continuation). This is not proof that Chronoscope caused the failure.
2. **P1 / correctness — rapid timeline movement loses the latest input.** Reproduced **3/3** in native IPC: set FROM to 20%, wait for filtered geometry and two animation frames, then immediately set 40%. After one second the slider had reverted to **199/1000**, with **152 observations** rather than the independently queried **116** expected at 40%. Separating changes by 400 ms avoided it. Details/source/reproducer below.
3. **P1 / responsiveness — million-row first summaries and persistence are long waits.** First snapshot **3.883 s**, save **29.363 s**, reopen **29.503 s**, import **126.789 s**. Cached snapshot **0.089 ms**, cached next page **0.584 ms**. Prioritize progress/cancellation and first-summary/cache work; these are backend, not GPU timings.
4. **P2 / rendering scale — density and canvas area matter in the Intel control.** Default-budget 20k space-time markers submitted around **60 FPS** at 1062×676, but **46.5 FPS** at 1920×756. A deliberately above-default 100k geometry stress case fell to **35.2 / 28.2 FPS**. Preserve representative LOD; investigate viewport/density LOD, stems/overdraw and render-target area before increasing budgets. These figures do not predict Radeon performance.
5. **P2 / diagnostics — native GPU labels are insufficient.** WebKit reported **Apple GPU / Apple Inc.** on Linux, while the app's DRM client proved active **Intel i915** rendering. That masked/normalized string and DRI_PRIME alone cannot satisfy a hardware gate. Expose selected device/driver and requested-versus-actual fallback explicitly.
6. **P2 / startup and footprint — distinguish native from CLI costs.** Fresh task-local-cache startup-to-ready: **1.602 / 1.610 / 1.866 s**; paired warm cache: **1.608 / 1.610 / 1.612 s**. These are bounded readiness observations, not disk-cache-flushed cold starts. Settled native process-tree summed RSS was about **480 MiB**; stress peaks **718–720 MiB**. Summed RSS double-counts shared pages; no unique-memory or leak claim follows.
7. **Positive — bounded engine memory and event-driven drawing work.** Settled native idle produced **zero renderer calls in ten seconds**, about **2.42% of one CPU core** across the process tree. The million-row engine benchmark peaked at **122.70 MiB process RSS**, retained exact counts, and generated the default 20k representative packet. Meaningful pixels/marker counts were checked; empty rendering was not accepted.

## Baseline and environment

- Trusted main baseline **ef351b02d8e3b4b5ac39518dd5c934bdbc7097ab**, Chronoscope 0.5.1.
- Measured isolated worktree **<isolated-checkout>**, branch **perf/linux-discrete-gpu-20261014**. Primary checkout untouched.
- Documentation publication branch **docs/linux-performance-20261014** is based on refreshed main **db0eb4b2d2b14310c86f289fe118f78642db0dd3**. Main advanced after measurement; its interface changes were not benchmarked. All source line references, binaries and results in this report refer to the measured **ef351b0** baseline, not publication-branch HEAD.
- Ubuntu **24.04.5**, Linux **7.0.0-38-generic**, x86_64; Intel Core i7-10810U, 6 cores / 12 threads, approximately 15 GiB RAM. Shared machine with existing desktop/OpenClaw processes; not thermal/power isolated.
- Rust/Cargo **1.98.0**, Node **v24.21.0**, Vite **6.4.4**. Locked npm installation and Cargo **--locked**. Normal release **thin LTO, codegen-units=1, strip=true**, no benchmark profile overrides.
- WebKitGTK **2.52.6**, GTK **3.24.41**, Mesa **25.2.8-0ubuntu0.24.04.4**. Chrome **154.0.8037.97** was used only for separate browser correctness QA.
- Missing GTK/WebKit development prerequisites were recovered with a **task-local SDK**: apt simulation, download 95 Ubuntu packages (27.3 MB), dpkg-deb extraction under the artifact directory, relocated pkg-config paths and development links to installed runtimes. **No sudo/system package installation, driver reset, Gateway change or shared Chrome configuration change.**
- Primary application is **Tauri/WebKitGTK + bundled TypeScript/Three.js**, with native IPC. The shared-engine CLI is separate. The optional obsolete legacy egui frontend was not benchmarked.

### Release artifacts and validation

| Artifact | Verified local path | SHA-256 |
|---|---|---|
| Production native desktop | target/release/chronoscope-desktop | 4823815ea8c63202bcfd329b1b5f268eb5dc90a02d5697de2758c2a04c2b8141 |
| Production CLI | target/release/chronoscope | 95bbce51f9e4d1ec6e33b2f8247a10aec79401879d9403c91e820e66ff2ac4d9 |
| Separate instrumented release | /tmp/openclaw/chronoscope-perf-20261014/chronoscope-desktop-instrumented | cb3784e453f15bb8ad256fa3c4ed9a6a461030efff76ea71498f5cb2017ef607 |

Desktop: **18,685,152 bytes**, successfully linked and alive after ten seconds in the **unmodified-production** native smoke. CLI reports 0.5.1. Standalone native executable built; **no AppImage produced**. Its normal GTK/WebKitGTK runtime prerequisites remain required.

- **96 Rust tests passed**, zero failures; formatting and strict core all-targets Clippy passed.
- Optimized locked CLI/native builds and production frontend TypeScript/Vite build passed. Existing frontend warnings: GPU chunk **769.34 kB / 210.68 kB gzip**, static/dynamic import overlap.
- Documented **test:ui** and **test:gis** passed: authenticated loopback bridge, imports/edits/persistence/terrain, independent GIS oracles, actual pixels, forced WebGPU-loss recovery. The checked-in browser runner deliberately uses **SwiftShader**; it supplies correctness evidence, **not physical-GPU measurements**. Public WMTS was not enabled.
- Native bundled production assets, IPC, cameras, modes, time filtering and real DTED were exercised. Twelve native canvas PNGs passed >30 sampled-color checks; demo/stress/globe frames were visually inspected.
- Native desktop Clippy, AppImage packaging, Windows/macOS execution and long-duration leak testing were not performed here.

Cargo.lock SHA-256: **5862e5f2e9220387b227ac24d3b2b1d6afd60ad1309d15dbda6a86d83f6e4221**. Frontend package-lock: **d1b3878c22260764b10a0ad742557c5bd0ac4356d9a3a48cc1d51b242d95000c**.

## Initial hardware gate: pre-reboot evidence

Radeon PCI **0000:3a:00.0**, **1002:6987**, amdgpu, Lexa 540X/550X-class, **2 GiB VRAM**, **/dev/dri/renderD129**. Integrated Comet Lake Intel is **8086:9bca**, **renderD128**.

Original native smoke logged Radeon selection and opened its FDs, but **FD presence was not accepted as successfully rendered AMD frames**. The existing physical Wayland desktop was locked and native animation-frame callbacks were suspended; it was not unlocked or persistently reconfigured.

An isolated Xvfb display enabled native application rendering without touching that desktop. App-descendant DRM FD sampling established **i915, PCI 0000:00:02.0**: its render-engine counter advanced by **83.021 GPU-engine seconds** across a 154.87-second control session. Those clients had no Radeon node. The “Apple GPU” WebGL string therefore was not used to identify hardware. Radeon global busy/VRAM values were not treated as app-performance metrics.

DRI_PRIME, WebKit render-device/GBM variants and a private headless GL compositor did not prove AMD rendering. A local Zink/Radeon-only attempt failed during Vulkan device enumeration. The kernel at **07:03:58** recorded:

> amdgpu: suspend of IP block vce_v3_0 failed -110
> can't suspend (amdgpu_pmops_runtime_suspend returned -110)

Pre-reboot runtime state: **error**. Radeon-only RADV enumeration fails **VK_ERROR_INCOMPATIBLE_DRIVER / ERROR_INITIALIZATION_FAILED**, repeated three times; default enumeration lists Intel and llvmpipe, not a usable Radeon. At that stage recovery needed fresh operator authorization. **No initial measurement was accepted as discrete-GPU evidence.** Later Radeon submission measurements and bounded per-client memory evidence are in the post-reboot section; no direct per-frame GPU timing is claimed.

## Post-reboot continuation — verified native Radeon measurements

### Recovery and driver verification

After an owner-authorized reboot, Radeon initialization recovered. No further privileged recovery or persistent configuration changes were part of these measurements.

Current by-path mapping: AMD **card0/renderD129**, Intel **card1/renderD128**. The kernel initialized amdgpu POLARIS12, UVD and VCE successfully. One boot-time ATRM ACPI warning remained, but Radeon-only RADV enumeration succeeded before and again after the tests: **AMD Radeon 550X Series (RADV POLARIS12), 1002:6987, discrete GPU**, Mesa 25.2.8. Normal runtime suspend/resume worked; idle **suspended** is not the former latched **error**.


Production desktop, CLI and instrumentation hashes still match the artifact table. Measured production source and lockfiles remain unchanged. These are still **ef351b0** measurements; the publication branch was based on **db0eb4b**, which was not benchmarked. During final remote verification, upstream main advanced to **a811315e65e49a104b957fc8c667f8e09fd40281**; that revision was not benchmarked either. The published docs branch was retained without rebase/force-push, and main was not changed by this task.

### Actual native hardware gate and methods

The actual Tauri/WebKitGTK/Three.js app ran on the now-unlocked physical desktop, without unlocking it or changing its configuration. DRI_PRIME=pci-0000_3a_00_0 selected Radeon. The WebKit renderer string remained **Apple GPU**, so the string-only guard was explicitly bypassed; that alone does **not** certify hardware. Retained app-descendant DRM fdinfo instead proved **amdgpu, PCI 0000:3a:00.0**, advancing graphics-engine counters during **every recorded render sample**, meaningful pixels and retained exact 20k/100k geometry.

The native app amdgpu client advanced **37.120 graphics-engine seconds**; its WebKit child client advanced **43.408 seconds**. Sampled Intel clients advanced **zero render-engine seconds**. These counters establish active device use; they are not per-frame GPU timings and are not summed as utilization.

Normal canvas **1382×622**, expanded **1920×622**, DPR 1; physical eDP display **1920×1080 at 59.96 Hz**. Observed native window geometry produced these dimensions, which differ from the earlier Intel/Xvfb controls. **No AMD-vs-Intel speedup/regression ratio is claimed.** FPS remains renderer-submission cadence, not independently measured physical presents. Other desktop applications and the compositor stayed running on the shared hybrid-GPU machine. No direct GPU timer-query result, thermal isolation or power-limit attribution is available.

Three approximately five-second repeats per scenario. Rounded interval ranges below are across repeats; percentiles describe renderer-start spacing, not GPU frame time.

| Scenario | Submission FPS r1 / r2 / r3 | p50 interval ms | p95 interval ms | p99 interval ms | >50 ms intervals total |
|---|---|---|---|---|---|
| Demo | 59.8 / 58.1 / 58.3 | 17 | 17–19 | 18–22 | 3 |
| Space-time 20k | 56.2 / 55.7 / 57.0 | 17 | 18–20 | 22–68 | 8 |
| Map pan/zoom 20k | 57.3 / 57.1 / 58.8 | 17 | 17–19 | 20–49 | 4 |
| Calendar 20k | 57.1 / 57.6 / 56.5 | 17 | 18–21 | 34–54 | 6 |
| Whole globe 20k | 58.9 / 58.8 / 59.0 | 17 | 17 | 20–26 | 3 |
| Space-time stress 100k | 31.2 / 31.2 / 31.1 | 32–33 | 34 | 35–39 | 0 |
| Whole globe stress 100k | 54.1 / 54.5 / 54.8 | 18 | 18 | 48–65 | 7 |
| DTED + 144 study points | 59.2 / 59.5 / 58.9 | 17 | 17–18 | 19–21 | 3 |
| Expanded demo | 59.3 / 58.8 / 58.8 | 17 | 17–18 | 20–36 | 4 |
| Expanded space-time 20k | 58.0 / 56.1 / 57.3 | 17 | 18–20 | 22–59 | 8 |
| Expanded space-time 100k | 30.9 / 30.8 / 30.9 | 33 | 34 | 34–38 | 1 |

**Rendering finding:** default 20k space-time submits **55.7–57.0 FPS**, expanded **56.1–58.0 FPS**. Above-budget 100k space-time submits **31.1–31.2 FPS**, expanded **30.8–30.9 FPS**. Default 20k had eight >50 ms intervals across three repeats, with p99 up to **68 ms**: average FPS hides intermittent long intervals. This experiment does not isolate CPU/GPU/compositor contributions. Preserve representative LOD and profile density/stems/submission/presentation separately.

**Timeline correctness persists on Radeon:** rapid 20%→40% input lost the latest change **3/3**, leaving slider 199/1000 and **152 rows**, versus independently expected **116**. Settled full-suite timeline mean latencies **226.4 / 219.0 / 218.8 ms**; workflow means **235.6 / 223.2 / 216.8 ms**, individual observations **212–250 ms**. These include 150 ms debounce, <=25 ms polling and two rAF callbacks; deliberate 400 ms input separation is outside timing. Real DTED **129×129** terrain plus 144 points passed three render repeats and pixel checks.

Paired startup-to-ready, fresh task-local caches: **1.886 / 1.879 / 1.885 s**; warm paired caches: **1.883 / 1.895 / 1.887 s**. These are not flushed-disk cold starts; readiness is observed at approximately 250 ms polling resolution. Full-suite first launch was 2.699 s and expanded 2.208 s; those are not the paired-cache experiment.

Summed process-tree RSS peaked at **737.0 MiB** full and **693.3 MiB** expanded; whole-suite sampled CPU means **41.1% / 40.7% of one core**, mixing startup/construction/render/idle. Shared pages are double-counted. Maximum resident VRAM observed for one app DRM client: **463,916 KiB (~453 MiB)**, not deduplicated whole-app VRAM. Global Radeon busy peaked at 100% but includes other clients and is not claimed as Chronoscope utilization.

Settled idle, each after 12 s settling: **zero renderer calls in all three ten-second repeats**; mean CPU **2.27% / 2.31% / 2.41%** of one core; median summed RSS **461.2 / 462.5 / 462.1 MiB**. No long-duration leak claim follows.

### Postboot reproduction and evidence

Use the supplied instrumentation patch/preserved binary against **ef351b0**, the inspected real desktop environment, unique labels and paired cache directories. The runner now reads AMD global metrics by stable PCI path rather than obsolete card2. CHRONOSCOPE_PERF_ALLOW_INTEGRATED=1 here only bypassed a misleading masked renderer string: **validate every sample's amdgpu client/counter advancement and meaningful geometry independently before claiming Radeon**. It is not permission to use an integrated fallback.

~~~sh
# Use the current graphical session and its XDG_RUNTIME_DIR; do not hard-code another user/display.
export XAUTHORITY="$(systemctl --user show-environment | sed -n 's/^XAUTHORITY=//p')"
export CHRONOSCOPE_PERF_REPO=/path/to/isolated-ef351b0-checkout
export CHRONOSCOPE_PERF_ALLOW_INTEGRATED=1 CHRONOSCOPE_PERF_CACHE=unique-radeon-cache
python3 docs/performance/repro_2026-10-14/run-native.py unique-radeon-full
CHRONOSCOPE_PERF_EXPANDED=1 python3 docs/performance/repro_2026-10-14/run-native.py unique-radeon-expanded
CHRONOSCOPE_PERF_WORKFLOW_ONLY=1 python3 docs/performance/repro_2026-10-14/run-native.py unique-radeon-workflow
~~~

Local evidence under the artifact root: **postboot-summary.json/.txt**, **postboot-visual-checks.json** (13 PNG checks, >30 sampled colors each), **postboot-radeon-full/**, **postboot-radeon-expanded/**, **postboot-radeon-workflow/**, **postboot-radeon-idle{,-2,-3}/**, **postboot-radeon-startup-{fresh,warm}-{1,2,3}/**. Demo, 20k, 100k, globe and terrain frames were also visually inspected. Durable copy: **<artifact-root>/**; driver verification records are under its **postboot/** directory.

The preliminary 60-second **postboot-radeon-physical/** run deliberately stopped before the full suite completed; its partial results are excluded from the table. All later full/expanded/workflow/idle/startup runs completed. Earlier Intel controls and million-row backend findings remain historical baseline results, not reclassified as Radeon. Temporary benchmark app process groups exited.

## Methods and limitations

- Native controls use unchanged optimized frontend/engine plus a separate release test binary adding only a private JS evaluation hook and NDJSON reporter. The supplied patch is reversible; production Rust source and preserved production binary were restored/hash-checked.
- Camera orbit uses actual OrbitControls/event-driven draw; Map pans/zooms. **FPS is renderer-submission cadence under requestAnimationFrame**, not independently measured compositor presentation, uncapped throughput, input-to-photon latency or physical-display smoothness. Xvfb has no physical vsync. WebKit clocks are approximately 1 ms quantized.
- Each render scenario has **three approximately five-second repeats** after construction/settling. Construction numbers include two animation frames and **100 ms deliberate settling**: upper-bound observations, not pure CPU construction time.
- WebKit exposed no EXT_disjoint_timer_query_webgl2. Direct GPU frame-time percentiles/VRAM attribution are unavailable. CPU renderer-submit timing excludes other frame/compositor/GPU work.
- Normal default packet: **20k representative points**. The **100k geometry-only stress** bypasses backend LOD; it is not an end-to-end 100k UI import or justification to raise the budget. Synthetic Ontario geometry uses 20 contiguous tracks and a 48-slot time pattern. Marker counts were retained.
- Whole-globe view concentrates these regional points into a small on-screen area; its cadence is **not an equivalent-density comparison** to space-time.
- Terrain: repository's real public **n43.dt0**, synthetic **144-row terrain-study.csv**, **129×129** mesh, no remote imagery requests.
- CPU/RAM: ~250 ms /proc sampling of app descendants only; 100% CPU = one core; summed RSS double-counts shared pages. Initial idle CPU samples are excluded because temporary injection was still active; a separate settled run waited until it stopped.
- Cold = fresh task-local application/driver-cache directory, **not flushed OS page cache**. Warm reused its paired directory. Compilation and browser QA ended before recorded performance runs; existing background desktop services remained.

## Native Intel-only controls — not Radeon

Default viewport **1600×973**, canvas **1062×676**, DPR 1. Expanded viewport **1920×1053**, canvas **1920×756**, DPR 1. Interval percentiles are renderer-start spacing, **not GPU frame time**. Full p50/p95/p99, maxima, >33 ms counts and CPU submission statistics remain in raw JSON.

| Scenario | FPS r1 / r2 / r3 | p95 interval (ms) | p99 interval (ms) | >50 ms intervals |
|---|---|---|---|---|
| Demo, 192 observations | 59.9 / 60.0 / 60.2 | 18 | 18 | 0 |
| Space-time 20k | 60.0 / 59.9 / 59.9 | 18 | 19–20 | 0 |
| Map pan/zoom 20k | 60.1 / 60.1 / 60.1 | 17 | 18 | 0 |
| Calendar 20k | 60.0 / 60.0 / 60.0 | 17 | 18 | 0 |
| Whole globe 20k | 60.0 / 60.0 / 60.1 | 17–18 | 18–19 | 0 |
| Space-time stress 100k | 35.2 / 35.2 / 35.2 | 30–31 | 31–32 | 0 |
| Whole globe stress 100k | 58.0 / 58.2 / 56.6 | 23–24 | 25 | 0 |
| DTED + 144 study points | 59.9 / 60.1 / 60.1 | 17 | 18 | 0 |
| Expanded demo | 53.2 / 53.3 / 54.3 | 24–25 | 25 | 0 |
| Expanded space-time 20k | 46.5 / 46.8 / 46.5 | 28–29 | 29–30 | 0 |
| Expanded space-time 100k | 28.3 / 28.2 / 28.1 | 37–38 | 38–40 | 0 |


Median (p50) renderer-start intervals: demo **17–17 ms**, 20k space-time **17–17 ms**, 100k space-time **28–29 ms**, 100k globe **16–16 ms**, expanded 20k **21–21 ms**, expanded 100k **35–36 ms**.

CPU renderer-submit p95: default 20k space-time **3–5 ms**, default 100k **4 ms**, whole-globe 100k **7 ms**. No leak conclusion follows from these short repeats.

Default construction observations (ms, includes settling): space-time 20k **216 / 186 / 196**, map **179 / 172 / 173**, calendar **180 / 178 / 182**, globe 20k **303 / 196 / 204**, space-time 100k **385 / 361 / 347**, globe 100k **404 / 356 / 375**. First-globe image/shader work is included in r1.

Settled timeline response on the 192-row demo: repeat means **224 / 220 / 233 ms**, observed range **214–234 ms**. Includes intentional **150 ms debounce**, <=25 ms polling and two animation frames: an upper bound to prepared scene, not exact presented-frame latency. The 400 ms input separation is outside the timed interval. Rapid overwritten transitions are a correctness finding, not slow-success timing.

## Exact backend/storage benchmark

Normal thin-LTO release examples/scale, seven-column CSV, 100 tracks, long labels, indexed storage, no public network. Assertions verified accepted/exact filtered counts, cached cursors, representative packet, save/reopen, exact selection, dry-run rollback and full export.

| Operation | 100k r1 / r2 / r3 | One million (one run only) |
|---|---|---|
| Import | 8.442 / 8.489 / 8.910 s | 126.789 s |
| First filtered/sorted query | 62.46 / 56.19 / 57.78 ms | 695.97 ms |
| Cached next page | 0.378 / 0.320 / 0.343 ms | 0.584 ms |
| Backend 20k packet | 223.34 / 215.26 / 217.08 ms | 1203.45 ms |
| Aggregate | 131.99 / 145.69 / 134.15 ms | 1483.95 ms |
| First snapshot | 310.40 / 326.74 / 312.42 ms | 3882.80 ms |
| Cached snapshot | 0.072 / 0.057 / 0.057 ms | 0.089 ms |
| Save | 1.734 / 2.020 / 1.765 s | 29.363 s |
| Reopen | 2.459 / 2.502 / 2.372 s | 29.503 s |
| Full CSV export | 0.545 / 0.490 / 0.491 s | 5.509 s |
| Peak process RSS | 86.57 / 87.04 / 86.79 MiB | 122.70 MiB |

100k CSV: **15,067,847 bytes**, workspace **237,260,800 bytes**. Million-row CSV: **151,677,947 bytes**, workspace **2,393,919,488 bytes** (~15.8× CSV), with additional working/history/backup space needed. Small-RAM ingestion does not imply small disk consumption. Million-row result has **one repeat**, no p95/p99 or cold/warm claim.

Separate sparse 100k in-memory proximity microbenchmark: **164.63 / 172.50 / 169.26 ms**, zero findings, no truncation; text filter **8.40 / 8.97 / 9.11 ms**, exactly 55k matches. Not a dense-neighbor worst case or GPU test.

## Source-linked recommendations

- **Timeline input ownership first.** frontend/src/main.ts **161–169** writes sliders during refresh; **1353–1362** debounces then reads current DOM value; **1612** schedules observer refresh after 180 ms. A prior engine notification can reset a newer DOM value before its 150 ms handler reads it. Capture requested fractions at input time or separate pending input from observer-restored state; regression-test 20%→40%, dragging and playback. This explanation is supported by native results/source but should be confirmed with event tracing before a fix. Minute normalization at src/engine.rs **1001–1003** was accounted for, and is not the lost-update defect.
- **Profile density without raising budgets.** frontend/src/main.ts **178** requests 20k; frontend/src/view.ts **502–720** rebuilds markers/trails/stems/groups; **1169–1182** performs event-driven rendering. Area/density sensitivity is measured, but fill rate, overdraw, stems, CPU and compositor contributions are not isolated. Profile separately, then consider viewport LOD, stem visibility and static/dynamic group reuse.
- **First summaries/persistence UX and profiling.** examples/scale.rs reproduces the exact cases; src/engine.rs, src/store.rs and src/project.rs own query/cache and save/open. Cached access is already excellent. Profile first scans/attribute discovery and integrity/copy/vacuum stages; preserve integrity checks rather than deleting them for benchmark speed.
- **Trustworthy adapter diagnostics.** frontend/src/view.ts **124–129** labels only WebGPU/WebGL2; src-tauri/src/main.rs is the native boundary. Add actual device/backend/software fallback and requested-versus-selected reporting, including unavailable metrics.
- **Radeon follow-up completed:** actual-app amdgpu/1002:6987 clients and meaningful frames passed; normal/expanded, terrain, startup, timeline and stress were repeated. Independent presented-frame/GPU timing and matched-density Intel comparison remain unmeasured.

## Reproduction

Reproduce against the measured baseline **ef351b02d8e3b4b5ac39518dd5c934bdbc7097ab**, not publication-branch HEAD. Create an isolated checkout at that SHA, copy the supplied `docs/performance/repro_2026-10-14/` directory into it, and run the commands there. Use documented OS prerequisites or the retained task-local SDK:

~~~sh
npm --prefix frontend ci
npm run build
export PKG_CONFIG_PATH=/tmp/openclaw/chronoscope-perf-20261014/sdk/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/openclaw/chronoscope-perf-20261014/sdk/usr/share/pkgconfig
cargo build --locked --release -p chronoscope-desktop -p chronoscope
cargo test --locked -p chronoscope
cargo build --locked --release -p chronoscope --examples
/usr/bin/time -v target/release/examples/scale 100000
/usr/bin/time -v target/release/examples/scale 1000000
target/release/examples/benchmark 100000
~~~

Native reproducers: **docs/performance/repro_2026-10-14/**. The patch adds private runtime test hooks only. Do not publish a patched production build; preserve original binary, apply/check, build separately, reverse only this patch and restore:

~~~sh
export CHRONOSCOPE_PERF_ROOT=/tmp/openclaw/chronoscope-perf-20261014
export CHRONOSCOPE_PERF_REPO="$PWD"
repro=docs/performance/repro_2026-10-14
mkdir -p "$CHRONOSCOPE_PERF_ROOT"
cp target/release/chronoscope-desktop "$CHRONOSCOPE_PERF_ROOT/chronoscope-desktop-production"
git apply --check "$repro/native-instrumentation.patch"
git apply "$repro/native-instrumentation.patch"
cargo build --locked --release -p chronoscope-desktop
cp target/release/chronoscope-desktop "$CHRONOSCOPE_PERF_ROOT/chronoscope-desktop-instrumented"
git apply -R "$repro/native-instrumentation.patch"
cp "$CHRONOSCOPE_PERF_ROOT/chronoscope-desktop-production" target/release/chronoscope-desktop

# Choose an unused PRIVATE display; do not replace the user's display.
Xvfb :87 -screen 0 1920x1080x24 -nolisten tcp & displaypid=$!
# Explicitly allows INTEGRATED CONTROLS, not Radeon certification.
DISPLAY=:87 CHRONOSCOPE_PERF_ALLOW_INTEGRATED=1 python3 "$repro/run-native.py" control
DISPLAY=:87 CHRONOSCOPE_PERF_ALLOW_INTEGRATED=1 CHRONOSCOPE_PERF_EXPANDED=1 python3 "$repro/run-native.py" expanded
DISPLAY=:87 CHRONOSCOPE_PERF_ALLOW_INTEGRATED=1 CHRONOSCOPE_PERF_WORKFLOW_ONLY=1 python3 "$repro/run-native.py" workflow
# Quick: CHRONOSCOPE_PERF_QUICK=1. Pair CHRONOSCOPE_PERF_CACHE values for warm
# launches; distinct new values are fresh cache. Settled idle script override:
# CHRONOSCOPE_PERF_SCRIPT_SOURCE="$PWD/$repro/native-idle.js"
kill "$displaypid"
~~~

Runner uses isolated data/cache/config, writes native NDJSON/PNG plus process/DRM samples, and terminates only its launched app process group. Default renderer-string gate is conservative; **ALLOW_INTEGRATED relaxes it, and external DRM verification remains mandatory for hardware claims**. Reusing a label overwrites its event/output files; retain old evidence using new labels. Check display availability and runtime prerequisites on another host.

Read-only current discrete preflight:

~~~sh
cat /sys/bus/pci/devices/0000:3a:00.0/power/runtime_status
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.json /tmp/openclaw/chronoscope-perf-20261014/vulkan-tools/usr/bin/vulkaninfo --summary
~~~

Even successful standalone Vulkan enumeration requires proving the **Chronoscope process** uses that device. DRI_PRIME, a Chrome tab or PCI presence is insufficient.

## Evidence and outstanding work

Local artifact root: **/tmp/openclaw/chronoscope-perf-20261014/**. Large/raw files are deliberately not in Git; these are local paths, not uploaded attachments.

- SUMMARY.json, visual-checks.json, RADEON_BLOCKER.txt, radeon-vulkan-summary.txt.
- release-build-sdk.log, frontend-build.log, rust-tests.log, fmt-check.log, core-clippy.log, desktop-ldd.txt, binary-sha256.txt.
- baseline-smoke/proof.json and stderr; native-intel-control/, native-expanded-control/, native-rapid-timeline-control/, native-settled-idle/: events.json, resources.json, run.json and PNGs.
- startup-cold-{1,2,3}/ and startup-warm-{1,2,3}/ paired-cache evidence.
- scale-100k-r{1,2,3}.json/.log/.time, scale-1m.json/.log/.time, core-100k-r{1,2,3}.txt.
- browser-qa.log, gis-qa.log, browser-qa/: separate correctness-only evidence.

The first full native control ended with a harness readiness timeout because its initial expected timestamp omitted the engine’s minute normalization; its already completed render samples remain valid. After correcting that harness expectation, the separate rapid-input overwrite was reproduced 3/3, and settled workflow runs completed. Neither timeout is treated as a successful latency measurement. All app process groups/private displays were stopped. No unrelated profiles/history/credentials were cleaned up or committed.

**Completed after reboot:** Radeon initialization, passed actual-app hardware gate, repeated native discrete submission measurements, and docs-only publication. **Still unmeasured:** independent physical presented-frame counts, direct per-frame GPU time/deduplicated whole-app VRAM, matched-density Intel comparison, stronger thermal/power isolation, three million-row repeats and a long-duration leak test. No application optimization/feature fix was made.

## Full-stack performance roadmap — recommendations added 2026-10-14

### Scope, evidence and newer-main comparison

This section synthesizes three independent read-only reviews of rendering/frontend, engine/storage, and scheduling/IPC. **Recommendations only: no application optimization, new GPU test or measured speedup was produced.** Existing measurements, reproducers and driver history above remain the baseline. **M** means retained measurement; **S** means inspected source/derived arithmetic; **H** means an unmeasured proposal. The two additional defect candidates below are source deductions, not runtime-confirmed corruption and not explanations for orbit FPS.

All baseline application-source links in this section pin **ef351b02d8e3b4b5ac39518dd5c934bdbc7097ab**; the later checked-in harness link separately pins its published documentation commit **875351a5e4f49db8766ee45ea6165b6894873af4**. A dated read-only comparison inspected newer main **1a3a72d71a04fe110f4ced99a817a3f0b1c3d5a9** (including ed243b8, 78d29c5, a811315, 637a7f2, 9261540 and 1a3a72d changes). **That main was neither benchmarked nor tested in this review.** It adds native macOS WMTS transport, TLS client authentication, bounded request/shutdown handling and UI copy changes; the inspected refresh/operation-gate paths and import/read-error hazards remain. Other recommendations audit the baseline, not an assertion that all newer code was reviewed.

In particular, current main's [WMTS fetch][new-wmts], [OS authentication subprocess][new-auth], [macOS IPC client][new-native] and [Swift URLSession transport][new-swift] already bound response bytes and waits: public HTTP timeout 40 s; OS-curl parent deadline 45 s; macOS parent deadline 90 s with cancellation checks, a 12 MiB response-frame bound and session teardown on error. Swift also limits response accumulation and uses 40 s request/resource timeouts. **Do not recommend “add any network bounds” as if absent.** A bounded wait can still hold the global workspace gate and block unrelated local work; isolating that wait remains a proposed architecture change. Preserve origin-scoped identity/cache keys, OS-owned PIN handling, redirects/trust restrictions, provider cooldown and request budgets.

### What the actual 100k view contained

**Yes—100,000 actual native octahedral marker instances were constructed and meaningful pixels checked.** It was one instanced mesh, **not 100k separate meshes or draw calls**. The synthetic harness directly calls setData, bypassing import/query/IPC and normal UI's 20k representative budget ([harness][harness], [refresh][refresh], [geometry][geometry]). It does not establish a full 100k UI-import benchmark.

- **S:** the 20-track, 48-slot space-time fixture submits **800,000 marker triangles**; locked Three.js r180's non-indexed octahedron has 24 vertex entries, hence **2,400,000 marker vertex entries** across 100k instances. There are also **100,000 stems** and **99,980 trail segments** (100k minus the first row of each of 20 tracks), plus ground/grid/axes.
- **S:** dynamic matrices/colors/stem/trail attributes total about **14.11 MiB logical arrays**, excluding Point objects, temporary arrays, base geometry, selection, textures, renderer targets and driver copies. This is not measured VRAM. Actual per-pass draw calls were not recorded; drawable-object count is not a draw-call measurement.
- Instantiated does not mean individually unoccluded every orbit frame. Whole-mesh bounds admit the instanced draw; GPU clipping/depth/overlap determine pixels. A reviewer's CPU camera reconstruction placed all marker centers inside the initial fitted frustum, **not a live per-frame visibility census**.
- Orbit retains the uploaded geometry; it **does not rebuild 100k instance matrices every frame**. Existing event-driven rendering and zero settled draws are strengths. Changed data/time-height/terrain rebuilds are separate interaction costs.
- **M:** Radeon 100k space-time submitted roughly 31 FPS; renderer-call CPU p95 was 3 ms versus start-spacing p95 34 ms. The CPU span excludes controls, CSS2D, picking, GC, DOM, GPU and compositor. It **does not prove** GPU time, stem/overdraw dominance or a presentation threshold. GPU timer queries were unavailable; global busy includes other clients. Earlier Intel canvas/display conditions differ.

### Current data path and where costs enter

~~~text
CSV bounded stream + existing ingestion SAVEPOINT
  -> mapping / coordinate-time validation / Event encoding
  -> SQLite canonical columns + JSON payload + attribute EAV + FTS + RTree
  -> exact filtered ordering materialized in TEMP cache (indexed positions)
  -> located representatives + selected-evidence reserve
  -> 32-byte little-endian records + base64 + decimal IDs/entity dictionary
  -> native Tauri IPC (shared JSON command API; NOT full observation JSON)
  -> atob / byte copy / DataView -> Point objects
  -> instance matrices + RGB + stems/trails -> Three.js/WebKit GPU submission
Separate exact queries, aggregate, selection, export and analysis remain backend-owned.
~~~

Sources: [stream ingest][ingest], [storage schema][schema-store]/[insertion][insert], [ordered cache][ordered], [render packing][packet], [decode][decode], [geometry][geometry], [native dispatch][native-dispatch]. CSV is already bounded/out of core and uses one ingestion savepoint; Tauri already uses spawn_blocking; jobs already exist; markers are already instanced and unlit. None is a missing feature to “add” generically.

**Proposed target:** captured latest intent -> one revision-coherent view request -> cheap metadata + scene packet -> first correct points; visible exact charts/table and cached terrain/imagery arrive independently for the **same owned revision/generation**. Serialized writes keep atomicity; optional network and eventually immutable read snapshots stop occupying the entire workspace gate. This is a control-flow improvement, not a broad Rust/Tauri/Three.js/SQLite rewrite.

### Priority / benefit / effort / risk decision table

Benefits are qualitative hypotheses. S/M confidence describes evidence for the opportunity, **not confidence in an unmeasured speedup**. Small = localized change; medium = several interfaces/invalidation tests; large = architectural or format work, not a delivery-time promise.

| Priority / work | Expected benefit / affected cost | Effort / risk | Confidence and deciding experiment / acceptance |
|---|---|---|---|
| P0 correctness gates | Prevent stale view/state loss/ID replacement before tuning | Small–medium / high consequence if wrong | M latest-input loss; S two candidates. Exact latest state, failed-read invariance and reject-boundary uniqueness tests below |
| P1 coherent refresh + points-first | Less duplicate/obsolete work; shorter input-to-correct-view | Medium / revision consistency | S sequential dependencies. One owned revision; no old panel/raster overwrites; trace committed refresh count |
| P1 lazy summary + split caches | Avoid discarded/cold full-corpus scans | Small–medium / cache invalidation | S compact computes then drops histogram; M cold/warm gap. Exact differential outputs; zero discarded sections |
| P1 retained scene/resources | Lower filter/time-height/theme/selection rebuild/allocation stalls | Medium / GIS and resource ownership | S repeated rebuild paths. Same geometry/pixels, static uploads/disposals absent; **not settled-orbit FPS** |
| P1 phase tracing + existing jobs in UI | Timely queue/progress/cancel feedback; identify real cost | Small–medium / honest commit point | S existing jobs/gate. Responsive status; terminal cancel/commit receipts and bounded handles |
| P2 semantic SQL/order tuning | Faster selective cold query/first page without weakening exactness | Medium / predicate/cursor semantics | S expression-heavy filters; small host-plan observations only. Bundled million-row plans + ordered-ID oracle |
| P2 import encode/statement reuse | Less per-row CPU/allocations | Medium / validation/ID/provenance | S >=3 full serializations/row. Same accepted/stored rows, bounded memory, phase CPU comparison |
| P2 causal render ablations / indexed glyph | Identify sustained-orbit cost; potential vertex/fragment reduction | Small prototype–medium / visual depth quality | M 100k cadence, cause unresolved. Full-count equivalence and per-pass counters; controlled matrix below |
| P2 compact typed buffers / conditional binary | Less transport/decode/build allocation, not uploaded-scene orbit | Medium / protocol/GIS/platform | S expansion sites. Compare identical base64/object, typed-array and native-binary paths |
| P2 append/persistence staging | Avoid old-row reinsert/repeated copying; cancellable long waits | Medium–large / atomicity/privacy/undo | S algorithms, M ~29 s save/open. Phase bytes, exact round-trip, crash/cancel/disk-full tests |
| P2 geography service isolation | Remove network/terrain head-of-line blocking | Medium / stale resource/auth generations | S shared gate; network latency not measured. Delayed local WMTS + interactive exact queries, no fetch storm |
| P3 writer actor + WAL read snapshots | Better under-load responsiveness and bounded scheduling | Large / transactions/TEMP caches/WAL pinning | S serialization; prioritize only after queue traces and correctness gates |
| P3 explicit spatial LOD / schema / WebGPU compute | Larger-corpus/display headroom where evidence justifies cost | Large / format/evidence/precision/fallback | H conditional. Quantify semantic/quality tradeoffs; never relabel fewer markers as full-100k speedup |

### 1. Correctness and request ownership are the first performance work

**Latest intent (M/S):** the rapid 20%->40% case fails 3/3 with 152 rather than expected 116 rows. [Refresh][refresh] restores sliders before the [150 ms callback][timeline] reads their DOM values; local mutation completion and observer notifications can both refresh. Capture requested fractions immediately, retain pending intent separately from committed normalized filter, and coalesce only replaceable navigation—not edits, undo or distinct agent mutations.

Make one refresh owner with an in-flight request and replaceable newest desired state. Carry workspace/store identity, request ID and data/filter/selection/resource generations; verify response ownership after **every await**, including inspector/table/terrain/raster/selection. Snapshot and packet must match a coherent revision; current serial guards do not make separate backend calls an atomic read. A section-selective read-only view_snapshot bundle is preferable to Promise.all-ing commands behind the same mutex. Coalesce observer echoes of already-applied local revisions, retaining external CLI/MCP refreshes. Camera scene_sync revision alone is not a geometry-cache key; selected-evidence reserve can change representatives.

**Acceptance:** trace input->command->commit revision->snapshot/packet->applied scene; artificial out-of-order delays, search+timeline, playback, external open/edit/selection and stale terrain responses must end at latest normalized intent and independently exact counts/IDs. Mark old geometry “updating”; do not silently describe stale summaries as current. Reduce/adapt debounce **after** this passes; its existing 150 ms delay already consumes a proposed sub-150 ms warm-interaction budget.

**Rejected-batch ID candidate (S, still present in inspected main):** [batch first_id][ingest] advances by accepted rows, while [convert][convert] assigns IDs using raw row index, and [insert][insert] removes an existing ID before replacement. First batch rejects its first row and accepts 999: IDs 2..1000; next batch begins at 1+999=1000, so its first valid row can replace old ID 1000. All-valid scale tests do not cover this. Not runtime-reproduced here; test before faster ingest. Allocate IDs by a consistent consumed-position or acceptance-only policy, use duplicate-failing append-only inserts, and retain source_row independently.

**Regression cases:** >1000 rows with rejects before/at/after row and 4 MiB boundaries, Excel slices, accepted reject review, append and near-u64 limits. Require stored_count==accepted, unique stable IDs, no previous-row replacement, exact provenance, export/reopen/undo equality and cancel rollback.

**Failed-read metadata candidate (S, still present in inspected main):** [invoke][invoke] uses an empty Project before-image for nonmutations at lines 397–407, then unconditionally restores it on execution error at 538–555. A stale cursor failure inside invoke_raw or cancelled read may reset metadata/filter/selection while observations remain in the separate store. Schema rejection before this path is different. Restore only genuinely staged mutation state from real before-images; failed reads must be invariant. This is not measured corruption or the timeline's proven cause.

**Regression cases:** nondefault name/filter/selection/groups/views/recipes/scene, then stale cursor, execution-time invalid field, failed terrain/map read and cancelled query. Compare metadata/revision, exact rows/counts and selection TEMP state before/after; preserve failed-mutation rollback/dry-run behavior. Both candidates remain in main because inspected engine changes are WMTS-only and import/stream/store have no baseline-to-main diff; [main invoke][new-invoke] pins that check.

### 2. Shorten the correct-view critical path; cache by real dependencies

[Refresh][refresh] waits for snapshot, inspector and open table before render_data. [Snapshot][snapshot-source] calls full summary before compact mode discards fields; [summary][summary] constructs time ordering, global groups, histogram/selected histogram, exact median ordering and another stable-variance pass. M first million-row compact snapshot is 3.883 s; cached 0.089 ms. These are engine timings, not native end-to-end latency and not additive to GPU tests.

Request sections explicitly: cheap identity/count/filter/time bounds first, scene packet next, visible exact charts/table later. Cache global groups/schema/time bounds by data revision; filtered histogram/stats by data+filter; selected overlays by selection **and** their filter/data dependencies. Do not merely remove selection_revision from the entire key: selected histogram and selected_only still depend on it. Maintain change-aware summaries transactionally; deleting extrema or changing values requires valid invalidation. Retain exact median rank and numerically stable Welford/mergeable variance—no unannounced approximate sketch or unstable sum-of-squares.

Test indexed scalar MIN(time) and MAX(t_end) separately rather than [one combined aggregate][bounds-source]. Review EXPLAIN on a retained **192-row fixture using host Python SQLite 3.45.1** showed scan versus separate covering-index endpoints; that is **not** a bundled-engine/million-row plan or timing. Four ordered-result caches already use LRU; four-entry summary clearing can cause churn. Instrument hits, eviction, temp bytes and component timings before changing policies.

**Acceptance:** compact performs no discarded histogram work; selection-only does not recompute data-wide groups; scene-only does not invalidate data summaries. Differential full/compact/chart outputs after filter/edit/selection/undo/replacement must retain bin boundaries, NULL behavior, exact median and agreed variance tolerances. Measure first-correct-points and final-exact-panel readiness separately at 100k/1m, table closed/open; no multiplier is established.

### 3. Query tuning must preserve the domain, not merely look indexed

[Storage predicates][predicates] wrap canonical fields in COALESCE/CAST/functions and use correlated attribute lookups; existing B-tree, FTS trigram and RTree indexes are not automatically used by every expression. Compile direct canonical comparisons or indexed attribute candidate sets where semantically equivalent; measure broad and selective compound cases before adding composite indexes. Evaluate ANALYZE/PRAGMA optimize after staging, including their import cost, rather than assume missing statistics caused a measured slowdown.

[Domain predicates][domain] distinguish case-sensitive equality, Unicode contains, absent attrs as empty strings, trimmed IsEmpty, nonnumeric NotEquals, NULLs and exact u64 ranges. attributes.num parses trimmed text while Greater/Less parses raw text; replacing predicates with num comparisons can change whitespace semantics. Preserve FTS escape/short-substring behavior, numeric/string formatting, interval overlap and exact spatial rechecks after float-expanded RTree candidates (including dateline).

[Ordered cache][ordered] materializes all exact matching positions on first sort, then provides fast indexed page access (M million-row cached next page 0.584 ms). Conditional keyset first-page queries may help index-compatible orders; retain stable ID tie-breaks, NULL order, exact counts, query rank and revision-bound cursor identity. Random positional access can still lazily materialize the existing ordering. More indexes trade disk/import cost for query benefit and require bundled-SQLite realistic plans.

**Acceptance:** exact ordered IDs/counts/pages/cursors against the old implementation and independent small oracle; missing/Unicode/whitespace/scientific/±0/NULL values, intervals, selected_only, source and polar/dateline fixtures. Record bundled version, EXPLAIN, VM steps/fullscan/sort counters and TEMP bytes on million rows; the small host-plan observations above are only a lead, not proof.

### 4. Retain resources and compact geometry for interaction latency

[Changed-data rebuild][rebuild] disposes root/axes/stems/rasters/globe atlas/terrain; refresh setData can then call setTerrain and rebuild again ([terrain setter][terrain-setter]). [Time-height input][height] also rebuilds and reapplies raster. Split retained geographic frame/ground/grid/terrain, imagery, markers/trails/stems, selection and labels/focus into dependency-keyed lifetimes. Time height should update temporal positions/stem endpoints; theme updates colors; focus moves a retained plane; unchanged selection is a no-op. Geographic bounds/mode/terrain changes legitimately invalidate more.

Reuse capacity-managed instance/line buffers, active count/drawRange, palette colors, scratch vectors and precomputed terrain frame/latitude factors; bound spare capacity. Avoid ordinary JS arrays then duplicate Float32 allocations where profiles show cost. Cache terrain by catalog content/bounds/resolution/projection/exaggeration and imagery by provider/auth/tile/viewport identity. Preserve async generation guards and explicit shared material/texture ownership; existing disposal is real, not evidence of a leak.

Keep packed numeric arrays and ID mappings instead of expanded Point objects where practical. [Decode][decode] currently does atob->Uint8Array copy->DataView->objects; [geometry][geometry] then expands translation into 16 floats plus RGB. A compact local-origin XYZ (or local XY/relative time/base height) attribute + uniform time-height + palette index can reduce build/upload bytes without changing octahedra. It does **not** remove 800k triangles or line fragments.

**Precision/semantic gate:** subtract origins in Float64 before Float32 GPU data; never directly quantize global longitude/epoch time. Match Mercator secant height, terrain triangle interpolation/voids, WGS84 globe, UTC calendar, dateline/polar controls and device-loss fallback. Deltas require base revision/dictionary/slot-ID identity, deletions and full-resync fallback; representative resampling can change most slots, so full replacement sometimes wins.

A future view mount/unmount lifecycle should retain/disconnect ResizeObserver and controls/listeners, cancel queued rAF, invalidate asynchronous loads and dispose owned renderer/textures exactly once. The current singleton's short RSS peak is not a demonstrated leak; reuse introduces shared-resource ownership risks that lifecycle tests must cover.

**Acceptance:** equivalent IDs/order/shape/color/depth/terrain/GIS oracle positions and screenshots; no static buffer/atlas reload on temporal-only changes; no geometry upload on orbit; record builder CPU, allocation/GC, first upload and resource counts separately. These changes target interaction stalls, not an assumed improvement to unchanged settled-orbit FPS.

### 5. Diagnose the sustained 100k render cost with causal ablations

Instancing, line batching and opaque unlit marker materials already exist ([geometry][geometry]). A low-risk prototype is an indexed octahedron with six shared positions and 24 indices, retaining eight triangles/winding/silhouette. It may reduce vertex fetch/transforms, **not triangle count or overdraw**; fourfold fewer unique positions is not a fourfold FPS promise. Measure actual driver/cache behavior.

Hold source/binary, actual native adapter, backend, data/order, camera, backing dimensions/DPR, quality, warm-up and sampling duration fixed. Use angle-versus-**elapsed-time** trajectories; the existing frame-index angle advances more slowly when frames are slower. Randomize/interleave baselines, repeat >=3, retain percentiles/tails and meaningful pixels. Collect actual per-pass draw/primitives counters, not memory.geometries as a proxy.

| Ablation | Isolated question | Equivalence / acceptance caution |
|---|---|---|
| Full markers+stems+trails | Reference 100k/100k/99,980 geometry | Retain counts, shape, camera and pixels; not an empty fast frame |
| Markers only; then +stems / +trails / both | Line coverage, blending and interaction costs | Diagnostic omissions, not full-feature speedups; globe is not this ablation |
| Backing scale 1/.75/.5, same CSS viewport | Raster/resolve/composition area sensitivity | Explicit resolution-quality tradeoff; correct picking and restored exports |
| MSAA on/off, new renderer initialization | Multisample and resolve cost | Record actual samples/targets; requested antialias flag alone insufficient |
| Line blend/depthWrite; flat-plane sidedness/single pass | Depth/blend/DoubleSide pass behavior | Can change occlusion/visibility; preserve intended faces, do not ship silently |
| Six-position indexed vs 24-entry non-indexed glyph | Vertex/data-layout cost with same triangles | Full-100k visual equivalence; no predicted FPS factor |
| Fixed-camera forced submit vs time-based orbit | Controls/CSS2D/JS vs resubmit cost | Idle-no-draw remains a separate case; capture whole-frame CPU |
| WebGPU vs WebGL2 only if natively supported | Backend/compiler/submission behavior | Re-prove device, precision, quality and fallback; no automatic density cure |

Stems/trails currently rely on Three.js depth defaults and object-level transparent sorting. Changing opacity/depth writes/order can alter evidence. Optional interaction render-scale/line-quality modes may be useful, but disclose them, restore on release and report full-detail baseline separately. GPU/compositor timing remains unknown until supported queries/fences/platform traces; do not insert gl.finish into every production frame to manufacture synchrony.

### 6. Transport, picking and DOM: target measured main-thread work

[Render packet][packet] is already 32-byte binary inside base64, with decimal-string u64 IDs/dictionaries—not full observation JSON. At 20k the numeric payload is 640,000 bytes / 853,336 base64 chars; at 100k **3,200,000 bytes / 4,266,668 chars**, exceeding the [4 MiB MCP structured-result cap][mcp-cap] before IDs/metadata. Native Tauri transport and job/MCP result budgets are distinct; don't raise all caps or assume an MCP job can carry this stress packet.

First add packet identity/conditional reuse and typed-array ownership. If delivery/decode is material, prototype supported native binary/ArrayBuffer transport with versioned stride/count/byte order/length and workspace/dictionary generations; retain base64 JSON for CLI/MCP/browser/fallback. A JSON array of byte numbers is not binary IPC. Validate lengths, finite coordinates/time, dictionary indices and budgets before GPU allocation. Keep IDs as decimal strings or tested two-u32/BigUint64—not JS Number. Native binary removes base64 expansion, **not proven zero-copy**. Validate WebKitGTK/WKWebView/WebView2 and existing CSP/auth.

[Picking][picking] already caches screen-space buckets; first hover after camera invalidation rebuilds O(n) projections synchronously, outside renderer-call timing. Reuse world/projected arrays, coalesce pointer events and key caches by camera/geometry revision. Worker/hierarchy or GPU-ID picking is conditional on measured latency; account for readback stalls, nearest-screen-center/depth tie-breaking, CSS pixels/DPR and globe hemisphere rejection. Box selection targets displayed representatives; exhaustive selection remains backend exact.

[Table][table-source] already paginates 50 rows and guards latest table response; there is no million-row DOM to virtualize. Wide 512-attribute pages can still produce many cells: project visible columns, lazy coordinate_formats and targeted horizontal virtualization if traces justify it. Update changed sidebar/histogram/legend regions; profile pathological layer counts rather than rewrite all UI. Table identity includes revision/source/filter/order/page, not merely serial.

**Acceptance:** compare identical base64+objects, base64+typed arrays and native-binary+typed arrays through pack/delivery/decode/project/build/upload, bytes/GC/PSS; correct ID/picking oracle and fallback. Wide-table keyboard/selection/external-edit tests and first-hover/box timings must stay correct. One active worker plus replaceable pending decode and byte-bounded transfers avoids a new stale-work queue; incomplete chunked geometry must be visibly incomplete, never counted as done.

### 7. Import CPU/index work and append scaling

[CSV ingest][ingest] already rereads bounded 1000-row/4 MiB batches under one ingestion transaction; preview is bounded and source size/mtime checked. [Convert][convert] validates Events, [insert][insert] validates again then serializes, and [Event validation][event-validation] serializes for size checking: **at least three full serializations per row**. Compile mappings/shared column metadata once; create a private checked/encoded representation reused by insertion; reuse record/batch buffers and prepared event/search/spatial statements. Do not skip validation on untrusted loads/edits.

After ID tests, compare incremental secondary-index maintenance with bulk creation in an unpublished staging store. Maintain uniqueness, FTS normalization/RTree completeness, hard byte/record budgets and rollback; disclose index-build tail/temp disk/cancellation. Bounded producer conversion workers only if CPU profiles justify them, preserving deterministic source order/IDs/reject reasons and byte-limited channels. Do not disable live journaling/synchronous safeguards or discard original attrs to win a benchmark. True streaming Excel is a later separate project; current bounded workbook materialization is not CSV's bottleneck.

[Rejected-review/append][import-engine] drops a fully ingested staged store when reject acceptance is needed, then reimports on acceptance. A leased staged result keyed by ticket/source fingerprint/exact mapping can avoid that repetition with release/expiry/disk validation. Append currently decodes/validates/reinserts **all old rows** via [copy_into][copy-source]; repeated fixed-size appends imply accumulated quadratic old-row work, **not measured append timings**. Try staged page-level clone plus only new inserts before a larger versioned delta-merge design; retain exact source, IDs, atomic swap and undo/redo.

**Acceptance:** parser/convert/validation/JSON/statement/B-tree/FTS/RTree/checkpoint phase CPU and bytes; >=3 1m runs plus long/wide/quoted/malformed CSV, DD/UTM/MGRS/ambiguous time, reject boundaries, file changes/disk-full/cancel during index build. Ten-appends series at 100k/1m: old rows unchanged, new IDs unique, stored==accepted, exact attrs/provenance/reopen/undo, old rows processed and retained disk reported.

### 8. Save/open, disk amplification and honest cancellation

M million-row save/open each takes about 29 s, but phase shares are unknown. [Save][save-source] checkpoints/backs up, embeds resources, sanitizes history, optimizes FTS, VACUUMs the destination, syncs and atomically replaces. [Open][open-source] rejects hostile schemas, quick_checks, copies to a fresh working file, verifies canonical/JSON consistency and embedded resources. These are safeguards, **not removable overhead by default**; DELETE-destination-before-WAL optimization already exists.

Instrument backup/pages, secure-history deletion/FTS/compaction, JSON validation, resource hashing/extraction, fsync and rename separately. Test bounded-step incremental backup/progress/cancel and content-hash resource reuse; transactionally maintained payload totals can avoid repeated format-choice scans. Preflight disk for staging, old retained stores, compaction/WAL/resources—not only final file. Three replacement stores and row-history budgets are different; a 128 MiB row-history threshold does not cap all retained-store disk.

Compare constructing a clean portable destination without history against backup->delete->VACUUM, preserving sanitization and live undo. Removing VACUUM alone can retain deleted payloads in a shared file. A fast internal checkpoint versus clean portable export is an **explicit versioned product proposal**, not a quiet weakening of .chronoscope. Live SQLite is WAL+synchronous=NORMAL, not FULL; file sync/atomic persist do not by themselves certify all power-loss durability, and parent-directory fsync is not explicit in the reviewed save functions.

Define a cancellation commit point. Current [invoke][invoke] checks cancellation after invoke_raw, so source inspection suggests a save can be persisted then reported cancelled; **not runtime-reproduced here**. Before commit cancel/clean staging; after commit return a completed receipt rather than imply rollback. Backup/compaction/OS calls need honest progress and bounded stop semantics; dropping a Promise isn't cancellation.

M workspace size is ~15.8x CSV for this fixture. [Schema/insertion][schema-store] duplicate canonical columns/JSON, EAV/raw attrs, multiple indexes, contentful FTS and spatial data, but **per-index blame is unmeasured**. On disposable copies measure dbstat/per-object pages, FTS components, WAL/TEMP/freelist and I/O across 7/50/512 columns/cardinality/label lengths before dictionary/compressed authoritative attrs or typed columnar read caches. Version migrations, keep raw strings and edited-canonical separation, exact substring search and full-u64 identity/order.

**Acceptance:** >=3 1m save/open repeats with phase CPU/I/O/fsync/temp peaks; every row/context/resource round-trips, sanitized deleted/history bytes absent while live undo works. Disposable process kills at staging/compaction/sync/rename plus disk-full/cancel/corrupt schema/resources must yield old-or-new complete files. Distinguish process crash from actual power-loss guarantees; no new durability or cancellation result is claimed.

### 9. Scheduling, geography and a conditional concurrency redesign

[Native dispatch][native-dispatch] already uses spawn_blocking and [jobs][jobs-source] offer progress/status/result/cancel/release outside [operation gate][invoke]. But jobs share one workspace/SQLite connection; up to 16 spawned workers are **not 16-way throughput**. UI should use existing job handles for long import/save/open/analysis with queued/running/staging/commit/terminal states, duplicate prevention and result release. Diagnostics currently start their clock after acquiring the gate, omitting queue wait. Trace admission/lock hold separately; bounded cancellable admission is preferable to many blocked threads, and cache serialized result sizes rather than recompute under registry locks.

Points-first independent reads still need revision coherence; Promise.all behind the same gate doesn't parallelize backend execution. Keep current scene/camera responsive and label its revision while long backend work runs. Stage imports/open validation outside live state where safe, then publish with identity/revision-checked swap; append must resolve base-revision conflicts, not quietly merge into another workspace.

Separate optional WMTS scheduler and terrain/cache work from workspace serialization using immutable captured config/catalog/bounds and request generation. Current main already bounds authenticated requests (comparison above), yet [main operation gate][new-invoke] still encloses map commands. Preserve **one in-flight / >=1 s starts / 16-tile budget / cache TTLs / 429 no-retry** and current auth-scoped cache privacy. Progressive verified tiles may arrive late into cache, but never attach to a newer viewport. No provider flood/speculative dataset-region fetch; public network was not part of measured suites.

[Terrain][terrain-source] has four decoded-tile LRU and up to 257² grid sampling. A >4-tile row-major viewport may repeatedly evict/decode; this is **unmeasured**, not established by the single-tile test. Test tile-grouped sampling/scatter or byte-budgeted cache and revisioned mesh reuse, preserving checksum/void/finer-overlap/bilinear/placement semantics. Add per-row/tile cancellation where needed. Local delayed/429/malformed WMTS fixtures—not public load—test interaction independence and stale-response rejection.

Only after error-invariance and queue measurements, consider a single writer/database-owner actor with bounded immutable versioned WAL read connections for query/analysis/export/backup. Reads currently create TEMP ordered/selection caches and use connection-local mutable state: replacing Mutex with RwLock is not sufficient. Preserve expected_revision, dry-run/batch, idempotency, undo and one coherent commit event. Bound read lifetime/bytes because long snapshots pin WAL; handle replacement/cursor invalidation/fairness and stale analysis explicitly. This is medium-term large work, not the first fix.

**Acceptance:** slow read/save/analysis+interactive filters+external edits/cancel, no torn snapshots, lost undo, stale cursor acceptance, partial commit or unbounded WAL/threads. Status acknowledgement and correct-view latency are separate from operation completion. Local WMTS delayed-auth/rate-limit cases retain existing deadlines/origin safety, local query responsiveness and strict network budgets.

### 10. Analysis, exact large selections and longer-term scale

[Analysis][analysis-source] currently loads an earliest time prefix (default 200k), reports input_limited and caps dense comparisons/findings. M sparse 100k proximity's zero findings do **not** prove dense throughput. Build tracks only for track patterns, union parents only for Clusters; separately meter visited candidates versus qualifying geodesic evaluations, since same-entity skips can still do much bucket work. Check cancellation within long tracks. Preserve conservative ECEF candidates and exact WGS84 distance; no spherical shortcut that drops threshold/polar/dateline evidence.

Streaming Gaps/Speed can carry adjacent entity/time/ID across pages; Stationary needs episode evidence spill; proximity needs a bounded active time window/spatial buckets; clusters need persistent cross-window components and exact evidence. Spatial/time partitions require halos and deterministic deduplication. Keep partial/capped outputs visibly partial. [Exact selections][selection-source] currently materialize matching IDs into Vec/BTreeSet/TEMP structures; out-of-core rows don't make all selections bounded-memory. SQL exact-bin selection and eventual disk-backed selection handles can reduce payload/ID expansion while retaining unlocated rows, saved groups and undo.

Hierarchical spatial/time LOD can allocate projected-error/density budgets with deterministic representatives, hysteresis, selected-evidence pinning and exact bounds metadata. Chunk culling trades fewer offscreen primitives for more draw calls/bounds maintenance. Keep full-corpus query/count/selection/export independent; aggregate proxies carry count/extent, **not an observation ID**. Trail refinement must preserve entity/time continuity, dateline exclusions and boundary segments; displayed arcs are interpolated links, not measured routes. Report located/rendered/omitted/aggregate counts and drill-down semantics.

WebGPU compute/indirect compaction, hierarchical out-of-core rendering and a columnar schema/read cache remain conditional long-term options: price disk/migration/index maintenance, precision, memory, native-webview support and WebGL2/device-loss fallback. Keep Rust/Tauri/Three.js/SQLite first. A framework rewrite, more threads or silent quality reduction lacks a measured case here; LOD rendering fewer points is not faster equivalent full-100k rendering.

**Acceptance:** dense coincident multi/single-entity cases, many entities, long tracks/intervals, selected off-sample evidence/unlocated rows, rare clusters, partition boundaries and polar/dateline fixtures; independent brute-force small analysis/selection oracle. Record candidate visits/geodesics/window/evidence memory, truncation and exact results under every LOD; no “complete million-row analysis” claim from a fast prefix.

### 11. Measurement contract, true end-to-end test and release gates

Attach privacy-safe trace IDs and revisions to input capture, debounce, native enqueue, gate acquisition, SQL/order/summary/cache, pack/serialization, IPC receipt/decode, projection/build/upload, submit and presentation **where available**. Use local monotonic spans; do not subtract unsynchronized cross-process timestamps. Capture whole rAF/control/CSS2D/picking/GC/DOM/layout CPU, not only renderer.render. Counters: submitted instances/triangles/lines/draws, upload ranges/bytes, rebuild/dispose, queue wait, cache hit/miss, SQL VM/temp, I/O/fsync and retained-store/WAL peaks.

Re-prove actual app adapter/client engine advancement and meaningful pixels in each render comparison. Collect PSS/private bytes rather than summed RSS for unique memory; per-client GPU counters/memory are distinct from global busy. Record clocks/thermals/background clients and matched canvas/DPR; supported nonblocking GPU queries or presentation traces may improve attribution, otherwise explicitly unavailable. A matched Intel environment is required before an adapter speedup claim.

**Proposed benchmark A:** real native 100k accepted/located-row CSV preview->mapping->commit->backend->IPC->view at unchanged normal 20k LOD. Verify stored/exact/located=100k, rendered=20k, IDs/provenance/selected reserve and exact omitted-row selection. Report preview, confirmation-excluded commit, first-correct-view and final table/charts/terrain separately. This is 100k capacity/default-view, **not 100k displayed**.

**Proposed benchmark B:** same imported fixture, task-local explicit supported native max_points=100k ([baseline schema permits it][schema-budget]), not synthetic setData, cap bypass or production budget/config change. Assert packet IDs/rendered_count/pointMesh.count=100k for nonpolar fixture, numeric bytes=3,200,000, stable order/ID checksum, 100k stems and expected fixture-specific trails plus meaningful pixels. Use native route, not MCP's insufficient result cap. Instantiated/submitted/frustum-visible/unoccluded are separate quantities.

**Startup/diagnostics experiment:** split native process launch, engine/database initialization, asset/module parse, renderer/context creation, first shader/texture work and first meaningful frame. Profile before lazy-loading help/charts or changing bundle chunks; preserve early usability and fallback. The roughly 1.9 s Radeon readiness samples have polling/cache limits, not an attribution. Surface requested-versus-actual backend/device and unavailable metrics; a masked “Apple GPU” label cannot certify Linux hardware.

**Proposed scale suite:** >=3 independent million-row runs with paired warm/fresh task-local caches (not claimed OS-cache-cold), 10x append, wide CSV/table, dense/spread points, many entities/trails, select-all, terrain+imagery, DPR1/2, calendar/globe/near/far/polar/dateline, cancel/disk-full/external edits and long leak/resource lifecycle loops. Repeated filter/theme/mode/terrain/device-loss must plateau in resources/PSS after quiescence; current short peaks do not prove a leak. Hour-scale runs and crash/atomic round-trips complement short timing samples.

Goals, **not achieved results**: workload-specific p95 sub-150 ms correct warm interaction, timely progress/cancel acknowledgement and a 16.7 ms total-frame budget for 60 Hz. Long exact import/save must show honest progress rather than pretend to fit that budget. Three long-operation repeats do not establish reliable p99; report raw distributions/ranges, frame tails, correctness and uncertainty. Faster stale/incomplete/empty/less-durable output fails release.

### Ordered milestones and dependencies

1. **M0 — correctness + instrumentation:** latest-intent ownership; isolated ID-reject/read-error regression cases; cancellation commit semantics; trace baseline phases/queue. Preserve unchanged release hashes and exact/GIS tests. Gate: invariants pass before ingest/concurrency changes.
2. **M1 — remove avoidable critical-path work:** coherent section-selective refresh, observer coalescing, lazy summary/dependency caches, points-first panels, existing UI job lifecycle and retained static scene resources. Gate: same revision/exact outputs; measured time-to-first-correct-view, builder allocations and no obsolete resource installs.
3. **M2 — independent low-risk experiments:** bundled SQL/endpoints/predicate/order plans, checked encode/statement reuse, indexed-marker and full render ablations, typed buffers/picking/wide DOM. Gate: candidate-vs-baseline matched workload traces + equivalent IDs/GIS/pixels, no unmeasured speedup language.
4. **M3 — structural bottlenecks only where measured:** append staging/page clone, incremental backup/clean portable destination, terrain/network isolation, bounded job admission; then writer actor/read snapshots if queue pressure persists. Gate: crash/cancel/disk-full/undo/dry-run/idempotency/auth tests, bounded WAL/disk/threads and portable sanitization.
5. **M4 — conditional scale/product changes:** disclosed hierarchical LOD/full-detail modes, disk-backed selection/streaming exact analysis, versioned storage cache/schema and optional WebGPU compute. Gate: migrations, full-corpus oracles/evidence semantics, compatibility/fallback and quantified memory/disk/quality tradeoffs.

**Recommended first investment:** correct newest intent and coherent state, instrument real phases, avoid cold/discarded summary and duplicate refresh/rebuild work. In parallel, investigate sustained 100k orbit with controlled full-count ablations. Import/save architecture and display cadence are different problems; none of these proposals has yet been optimized or benchmarked.

<!-- Historical source ledger: links browse current source only, not the original measured revisions. -->
[refresh]: ../../frontend/src/main.ts
[timeline]: ../../frontend/src/main.ts
[height]: ../../frontend/src/main.ts
[table-source]: ../../frontend/src/main.ts
[harness]: repro_2026-10-14/native-harness.js
[decode]: ../../frontend/src/types.ts
[geometry]: ../../frontend/src/view.ts
[rebuild]: ../../frontend/src/view.ts
[terrain-setter]: ../../frontend/src/view.ts
[picking]: ../../frontend/src/view.ts
[native-dispatch]: ../../src-tauri/src/main.rs
[invoke]: ../../src/engine.rs
[snapshot-source]: ../../src/engine.rs
[packet]: ../../src/engine.rs
[selection-source]: ../../src/engine.rs
[import-engine]: ../../src/engine.rs
[ingest]: ../../src/stream_import.rs
[convert]: ../../src/import.rs
[event-validation]: ../../src/model.rs
[domain]: ../../src/model.rs
[schema-store]: ../../src/store.rs
[insert]: ../../src/store.rs
[bounds-source]: ../../src/store.rs
[predicates]: ../../src/store.rs
[ordered]: ../../src/store.rs
[open-source]: ../../src/store.rs
[save-source]: ../../src/store.rs
[copy-source]: ../../src/store.rs
[summary]: ../../src/store.rs
[jobs-source]: ../../src/jobs.rs
[schema-budget]: ../../src/schema.rs
[mcp-cap]: ../../src/mcp.rs
[terrain-source]: ../../src/terrain.rs
[analysis-source]: ../../src/analysis.rs
[new-invoke]: ../../src/engine.rs
[new-wmts]: ../../src/wmts.rs
[new-auth]: ../../src/wmts_auth.rs
[new-native]: ../../src/wmts_native.rs
[new-swift]: ../../native/WmtsTransport.swift
