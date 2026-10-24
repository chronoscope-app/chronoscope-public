# Radeon performance investigation — 24 October 2026

Measurements were collected from working changes based on `97c7e4392d13727ad30f66d605b345b8042d2627` in `chronoscope-app/chronoscope-next`, before publication. No GitHub runners were used. Both workflows remain manual-only. See the [idle-render mechanism and upstream handoff](../../CESIUM-IDLE-RENDER.md) for the Cesium investigation and standalone reproduction.

## Machine and measurement scope

Intel Core i7-10810U (6 cores / 12 threads), 16 GiB RAM, Linux, AMD Radeon 550X (2 GiB), Mesa RADV / amdgpu. Intel UHD is the system default; the native app is explicitly offloaded with `DRI_PRIME=pci-0000_3a_00_0`. Native GPU identification comes from WebKit process DRM descriptors and advancing graphics-engine counters for PCI `0000:3a:00.0`. WebKit masks the WebGL renderer string, so that string alone is insufficient evidence.

Native timings use an optimized Rust build and the real Tauri/WebKitGTK/Cesium frontend. Frame callbacks measure browser cadence, not GPU elapsed time or physical presentation. Chrome results are recorded separately with its actual ANGLE/Vulkan renderer, viewport and release CLI profile. Offline basemaps exclude network latency. Functional software-renderer tests are not hardware performance measurements.

## Candidate change

Cesium camera heading/roll getters temporarily transform the camera and introduce approximately `1e-15` orientation roundoff. Its camera-change comparison can treat that roundoff as movement and keep redrawing an idle scene despite request-render mode. A public `preUpdate` hook restores the prior orientation only when position, transform and scene mode are identical and every orientation component differs by at most `1e-14`. Real camera movement is retained. The implementation does not depend on Cesium private fields.

Six unit cases cover repeated roundoff, real rotation, position/reference-frame/mode changes and invalid coordinates. Native comparisons rotate variant order, keep point budgets fixed and compare decoded RGBA pixels before timing (maximum one 8-bit channel step in at most 0.1% of pixels, with exact hashes and measured deltas retained). A position-cache prototype is tested separately without adding it to production.

## Validation scope

The local standard pass completed Rust formatting, vendored GLib integrity, Clippy, 384 Rust tests, generated contracts, CLI and native builds, and native CLI smoke checks. The candidate frontend production build and all 24 frontend test cases passed.

All 42 browser suites were exercised. Follow-up checks update stale time-rail/chart selectors and fixed-rail layout expectations, inspect the shared selection instead of culled viewport highlights, synchronize playback timestamps with animation frames, and gate mock AI responses until cancellation is acknowledged. The display-fade check submits a frame synchronously before its short lifetime can expire on a software renderer. Rendering, data-count and playback-throughput thresholds are retained.

The first software-rendered playback-transition run missed its throughput gate (14 updates in 3.5 seconds; minimum 20). This failed run is preserved rather than relabeled as passing. The release/Radeon rerun passed with 66 live updates, a 50.5 ms median interval and 215 sampled frames, with at most two bloom layers, no render errors, one settled atlas after Pause and no redundant full-range filtering. Hardware results are recorded below. The original full invocation remains failed; across the main pass and targeted candidate reruns, 41 software-rendered browser suites passed, and the remaining throughput suite passed in the separate release/Radeon configuration.

A baseline native workflow smoke pass completed 20 checks with nine captures across hurricanes (3,568 Events), storks (6,090) and elephant seals (15,501), all three map modes, linked selection, full-scope charts, portable save/reopen and playback.

The first strict native image comparison stopped on 36 of 1,187,154 pixels differing by exactly one channel step. Four baseline-only captures repeated exactly. The camera correction can change subpixel antialiasing, so subsequent runs explicitly allow only the narrow tolerance above; they do not claim byte-identical output. The failed strict run remains in local evidence.

The first full-100,000-marker comparison also stopped on stale camera-dependent track geometry. A baseline-only repeat after the navigation/refresh sequence matched the candidate exactly and differed from the original baseline in the same 1,744 pixels (maximum channel delta 24). Resetting geometry before every variant resolved that mismatch without changing the image tolerance. This harness correction is separate from the production change.

## Native results

The primary comparisons used X11 with DMA-BUF disabled: three repeated rounds at 1306 × 909, resolution scale 1. CPU is summed across the app process tree, with 100% representing one core. GPU work uses the Radeon DRM graphics-engine counter, not a WebGL renderer label.

| Workload | Displayed markers | Idle frames / 4 s, baseline → candidate | Idle CPU, baseline → candidate | Radeon graphics work / 4 s, baseline → candidate |
| --- | ---: | ---: | ---: | ---: |
| Hurricanes | 3,568 | 24 → 0 | 19.16% → 3.75% | 592 ms → 0 ms |
| Synthetic 100k, standard budget | 20,000 | 41 → 0 | 24.00% → 3.50% | 1,113 ms → 0 ms |
| Synthetic 100k, full budget | 100,000 | 36 → 0 | 20.64% → 3.50% | 1,395 ms → 0 ms |

These are medians of the three samples. The candidate reduces measured idle CPU by about 80–85% and eliminates measured idle graphics-engine work. It does not materially improve active cadence: hurricane focus/orbit remains about 30/28 FPS; full-density synthetic focus/orbit remains about 21/20 FPS. The 100,000-row native import took 5.8 seconds using disk storage.

The cache prototype reduces median track rebuild time from 28 to 25 ms at 20,000 markers and from 140 to 130 ms at 100,000 markers, relative to stabilization alone. Active FPS changes are small. It is deliberately **not included in production**: position results also depend on terrain, time bounds, mode and display scale, and broader invalidation coverage would be needed to justify the added cache.

Keep the small idle-camera fix and the QA updates for review. Do not advertise an active-FPS increase from this patch.

## Chrome hardware and scale results

The separate Chrome hardware comparison used ANGLE/Vulkan on the Radeon 550X, a release CLI and a 1186 × 1024 drawing buffer at resolution scale 1. Three rounds of each scenario passed for each build. Median idle draws fell from 13 to zero per two-second sample; Chrome task time during that sample fell from 79.9 to 40.9 ms. Active hurricane focus, orbit and playback remained approximately 60 FPS. This is a different runtime and viewport from the native measurements above.

The candidate-only 100,000-event hardware suite also passed all three rounds at both budgets, with bloom enabled:

| Displayed markers | Focus FPS | Orbit FPS | Playback FPS |
| ---: | ---: | ---: | ---: |
| 20,000 | 60.00 | 60.00 | 59.34 |
| 100,000 | 45.51 | 45.90 | 44.02 |

Every scene retained all 100,000 source Events, 100,000 visible Events and aggregate bins summing to 100,000. Playback retained the chosen marker budget and advanced focus. No public requests or renderer errors occurred. This stress run characterizes the candidate; it is not a baseline-versus-candidate FPS improvement claim.

The million-row scale proof passed all five checks using the release CLI and SwiftShader: exactly 1,000,000 imported rows, no rejected rows, exact bounded source/entity queries, cluster selection checked against independent source-coordinate enumeration, bounded native Cesium collections and a nonblank canvas. Import commit took 63.1 seconds, the exact source query 0.68 seconds and software-rendered browser startup 19.0 seconds. These are correctness/scale receipts, not dedicated-GPU FPS. The original software playback-throughput failure remains a limitation of the initial full validation invocation; the stricter Radeon rerun passed separately.

## Final compiled app and runtime limitation

The optimized candidate binary passed a fresh 20-check native workflow run with nine captures, covering all three view modes, linked selection, charts, save/reopen and playback. Its compiled camera fix also produced zero idle redraws in both Wayland and X11 checks. The Wayland check used a 986 × 898 drawing buffer and recorded approximately 42/36 FPS for focus/orbit; it does **not** establish a backend speedup over the larger X11 buffer.

After those tests, at 16:30:45 local time, the kernel reported:

```text
amdgpu 0000:3a:00.0: suspend of IP block <vce_v3_0> failed -110
amdgpu 0000:3a:00.0: can't suspend (amdgpu_pmops_runtime_suspend [amdgpu] returned -110)
```

The device's `power/runtime_status` became `error`, and opening its render node returned `EINVAL`. Fresh app launches then used Intel i915 despite the Radeon offload variable. This includes the final X11 check; it is recorded as an Intel fallback, not counted as a Radeon result. The earlier native benchmark and compiled Wayland runs recorded real amdgpu rendering with advancing graphics counters before this error.

The latest optimized app is left running on the normal user profile, currently using Intel because of that driver failure. Restoring Radeon requires administrator/OS recovery; this session has no passwordless administrator access. No driver rebind, PCI reset or reboot was attempted. The user's original empty workspace and revision are intact, agent access is restored to disabled, and the normal app has no remote inspector enabled. The GPU recovery issue remains open.

## Reproduction

Build the frontend with `npm --prefix frontend run build`; build the desktop locally with `cargo build --locked --release -p chronoscope-desktop --features tauri/devtools`. Launch only a disposable QA profile with a loopback WebKit inspector and the Radeon offload variable ([Mesa GPU selection documentation](https://docs.mesa3d.org/envvars.html#envvar-DRI_PRIME)). On this machine, `WEBKIT_DISABLE_DMABUF_RENDERER=1` was required on both tested backends to avoid stalled animation callbacks. This setting is part of the recorded runtime configuration, not an application default.

Run `node scripts/profile_native.mjs --pid <desktop-pid> --build-profile release --experiments --rounds 3 --duration 4000 --output .qa/native-performance`. `--rows 100000 --budget 20000 --position-cache` exercises the synthetic import and cache prototype; `--budget 100000` removes marker thinning. Use an unmodified baseline frontend when comparing injected variants. The tool requires loopback inspection and restores its temporary hooks on exit.

Raw profiles, tokens, binaries and screenshots remain in the ignored local `.qa/radeon-performance-2026-10-24` directory. The sanitized result summary alongside this document records the reviewable evidence.
