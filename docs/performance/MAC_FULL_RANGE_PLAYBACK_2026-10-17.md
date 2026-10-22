# Full-range native playback with 100,000 events

The native macOS app can redraw the full 100,000-event scene with bloom at approximately **60 FPS**. Play now preserves the selected time-window width instead of always replacing it with a 25% window. With Full range selected, the cursor and time-axis focus marker sweep through the dataset while every matching event remains drawn.

This is a different workload from the earlier [moving-window benchmark](MAC_NATIVE_PLAYBACK_2026-10-17.md): full-range event positions remain fixed, and no events enter or leave the filter. It does not claim that 100,000 new records are uploaded or repositioned every frame. Narrower windows still translate and retain their point fades.

## Comparison method

Base commit: `1887058953c16efff007d223d85278c4cb88222d`. The original Play handler cannot retain all 100,000 events, so the comparison baseline adapts only its window/cursor calculation to support Full range, keeping the renderer unchanged and retaining its redundant 250 ms filter/snapshot refreshes. The candidate skips those refreshes when the requested time bounds match the current filter. This isolates avoidable work in the newly supported full-range workload; it is not a claim that an unmodified baseline provided this playback mode.

Both use the same real SQLite-backed synthetic dataset: 100 entities with 1,000 records each. Native tests retain and draw **100,000 points**, **100,000 vertical trail segments**, and **200 track polylines**. The camera and scene extent are fixed. Canvas size is 1,062 × 737 CSS pixels, resolution scale 1.5, framebuffer 1,593 × 1,105. Antialiasing, point scale 1, track/trail opacity, trail simplification and all bloom settings remain unchanged: 512 × 512 raster, radius 0.1, strength 1.3, threshold 0.1. Both use the bundled Blue Marble floor with public imagery and terrain disabled. Automatic document saving is disabled during paired measurements and restored after testing.

Each paired native run takes four rolling-120-render-frame diagnostic observations eight seconds apart after an eight-second warmup, spanning more than a full 25-second cursor cycle. The additional normal-autosave run takes eight observations eight seconds apart in the already warmed app after changing the selection to make the document dirty again. Native FPS comes from WKWebView/Cesium post-render events, not a browser animation callback counter. CPU measurements use separate 15-second intervals of cumulative process CPU time, normalized to one core. No builds or other GPU tests run concurrently with native FPS or CPU measurements. All verification runs locally; no GitHub Actions or hosted runners are used.

## Measured results

| Native run | Median FPS | Median observed p95 frame interval | Median query | Median live status |
|---|---:|---:|---:|---:|
| Adapted baseline | 60.0 | 30 ms | 0.54 ms | 35.26 ms |
| Candidate | 60.0 | 18 ms | 0.86 ms | 2.44 ms |
| Final rebuild | 60.0 | 18 ms | 0.93 ms | 3.95 ms |
| Final, normal autosave enabled | 60.0 | 18 ms | 1.49 ms | not sampled |

Full-range playback was already at the display cadence with the existing renderer once its forced 25% narrowing was removed. This change improves frame pacing and removes unnecessary background work rather than claiming another large increase in average FPS. Rolling observations near 60 FPS do not mean every frame meets a strict 16.67 ms deadline. The normal-autosave run spans more than 30 seconds and includes the enabled automatic saving interval.

Separate CPU intervals measured app-process use at 59.0% of one core in the adapted baseline, 5.4% in the candidate and 5.6% in the final rebuild. Combined app, WebContent and GPU-process CPU fell from 100.4% to 55.2% of one core. GPU-process CPU increased from 13.6% to 23.6%, while WebContent changed from 27.8% to 26.0%; not every component became cheaper. These are short local interval observations, not a battery-life estimate or a guarantee for every GPU/OS. RSS observations are retained in the JSON but are not a controlled memory benchmark.

## Implementation

The selected interval determines playback width and available travel. A full-width interval stays at [0, 1], and its focus fraction advances continuously. Narrower intervals move through the available range without being silently resized. The geographic frame remains fixed.

Before enqueueing the next timed filter update, playback compares its requested UTC bounds with current filter intent. If nothing changed, there is no reason to serialize, decode and republish another identical 100k render packet or rebuild unrelated inspector/sidebar content. Other user actions and native engine events still trigger their normal refreshes. This does not lower the marker budget or alter any renderer, shader, effect, resolution, antialiasing or fade setting.

## Verification

[The accompanying JSON](mac-full-range-playback-20261017.json) records native FPS samples, process CPU intervals, exact visual settings, image comparisons and regression results. Matched native full-range captures are pixel-identical between the adapted baseline and final rebuild. Native bloom on/off changes 29,807 pixels, confirming that the effect is rendered. While playback continues, MCP selection resolves exactly three requested IDs and renders three selection markers while retaining all 100,000 points. Attached CLI snapshot reports 100,000 records, and CLI capture returns a nonblank PNG. Normal automatic saving is restored, and the final app remains open playing the full dataset with bloom.

The 33-check integration suite includes a full-range regression that retains the exact same IDs and geographic bounds while focus advances, with zero filter or render-snapshot requests during the sweep. It also checks that a 60% selected interval keeps that width during moving-window playback. The hardware 100k benchmark additionally checks drawn-marker and exact-visible counts on every sampled playback animation frame at both 20k and 100k budgets. The hardware benchmark passed all 36 workloads with zero render errors or public requests. Its three full-100k playback samples retained exactly 100,000 drawn and 100,000 visible events on every observed animation frame, measuring 58.4–58.7 FPS in Chromium/ANGLE Metal. These browser checks are separate from native FPS measurements.

The previously documented deeper terrain LOD/precision failure is outside this playback change; its renderer and thresholds are untouched. That deeper suite is not rerun here. Local terrain installation and imagery mode-transition checks remain part of the passing integration suite.

## Existing initial-autosave delay

Restoring normal automatic saving exposed one very slow first document copy: the engine recorded 101,830 ms, and an attached query exceeded the QA client's 45-second timeout while waiting for the workspace operation gate. The save completed successfully; it was not a permanent lockup. A repeat copy after a new selection change took 207 ms. The eight-observation normal-autosave repeat retained all 100,000 points and near-60 FPS, with successful data queries.

The engine diagnostic log also records a 161,545 ms autosave before this full-range playback change. Save, recovery, persistence and locking code are unmodified. This initial-save delay remains unresolved and is recorded explicitly rather than treating the successful repeat as proof that every save is fast. The current app has normal automatic saving enabled.
