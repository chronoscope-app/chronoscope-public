# Mac rendering and refresh performance

Baseline: `33bd5d0747b2a61d78fd6eb11d5f736a8e381a70`. Verification runs locally; GitHub workflows remain manual-only.

The production changes reuse unchanged display, selection/stem and track resources. Track invalidation includes the evidence generation, actual camera/projection matrices, viewport, selected anchors and track style. Display invalidation includes exact visual packet contents and spatial/style inputs; backend cache-hit and revision metadata alone do not change pixels. In-flight identical display requests join the existing rebuild. Changed data, terrain, modes, selection and styles retain the rebuild path. Playback updates an existing focus polyline.

No changes to evidence counts, marker/arc budgets, heat/bloom algorithms, terrain resolution, antialiasing, canvas resolution or screenshot support. On-demand rendering remains enabled. Bounded diagnostics in `view_status` expose render count, recent cadence and CPU render-submission time; idle gaps are excluded, and FPS is null when idle. CPU submission is not asynchronous GPU execution time.

## Reproduce locally

Build the release CLI and frontend, then run `npm --prefix frontend run test:performance`. Set `CHRONOSCOPE_CLI` to the release executable and `CHRONOSCOPE_CHROMIUM` if Chrome/Chromium is not at the platform default. `CHRONOSCOPE_PERF_OUT` selects a fresh output/profile folder. `CHRONOSCOPE_QA_FRONTEND` can select a separately built baseline frontend. Run baseline and candidate sequentially on the same machine, with identical settings; repeat in reverse order to expose scheduling/thermal variance.

The harness rejects software renderers. On this Mac it uses Chromium ANGLE Metal on Apple M5, an 1800×1100 CSS viewport, device scale 1, and the actual 1262×869 scene canvas. This establishes browser renderer/CPU performance, not native WebKit FPS or GPU timing. The release Rust engine serves bundled hurricane data (3,568 events, 83 entities). Public maps and autosave are disabled only in the isolated benchmark profile. Tests cover idle, unchanged refresh, changing filters, focus animation, camera orbit, actual Play/Pause, bloom refresh, exact queries, retained JS heap and a synthetic 20,000-point rendering workload. The synthetic workload asserts its point count throughout; it does not measure ingestion of a 20,000-row dataset.

Each workload has three samples. Compare sample medians and variance; small differences are not proof of an improvement. Initial exploratory synthetic runs were discarded after finding that startup installed a viewport callback after the test replaced it. The retained harness waits for complete initialization and verifies the stress point count. Earlier exploratory FPS values also included Pause cleanup; the retained harness measures animation cadence directly.

## Results

Three-sample medians from the controlled comparison:

| Operation | Baseline | Tuned |
| --- | ---: | ---: |
| Unchanged bloom refresh | 88.2 ms | 19.2 ms |
| Ordinary refresh | 21.4 ms | 16.3 ms |
| Changing filter + refresh | 15.2 ms | 11.6 ms |
| Playback browser CPU work, ~3 s animation | 614.6 ms | 517.4 ms |
| Hurricane animation cadence | ~60 FPS | ~60 FPS |
| 20,000-point orbit cadence | ~60 FPS | ~60 FPS |
| Retained JS heap after stress + forced GC | 34.93 MiB | 34.74 MiB |

The fixed-camera hurricane bloom framebuffer is pixel-for-pixel identical. Exact query medians were 2.04 versus 2.19 ms; the Rust query implementation is unchanged. Dense orbit CPU samples overlap, with a 6.9% higher candidate median in this run; dense focus missed one refresh in two trials (~59.7 versus 60 FPS), while p95/p99 stayed ~16.8 ms. These small scheduling differences are retained rather than described as universal improvements. The large refresh gains reproduced in exploratory reverse-order runs; their invalid synthetic portion is excluded from the controlled results.

The native instrumented baseline and tuned app both built and launched. Attached commands recovered immediately after macOS was unlocked. Both builds played hurricane data at approximately **60 FPS** at the same 1062×737 CSS viewport (1593×1105 canvas). Two plain playback series and one bloom series per build each sampled ten recent 120-frame windows. Plain medians were 59.96–60 FPS on baseline and 60 FPS on the candidate; bloom medians were 59.49 versus 59.99 FPS. MCP query medians remained below 1 ms, with zero render errors. These overlapping observations are not independent trials, and moving time windows contain varying point counts; no isolated native CPU speedup is claimed. CPU render-submission p95 medians were 2–3 ms in both builds.

Final native Globe → 2D → space-time transitions retained all 3,568 markers and imagery without render errors. Full time range and normal autosave were restored, and the tuned build was left running. Standalone release and bundled CLIs also queried all 3,568 hurricane records successfully (~0.2 s including process/project startup). Browser and native figures remain separately labeled.

Measured results, individual CPU/frame samples, source hashes and limitations are recorded in [`mac-render-reuse-20261016.json`](mac-render-reuse-20261016.json). The rendering integration suite covers resource reuse/invalidation, actual picking/selection, transitions, effects pixels and live scrubbing. Its new reuse check also fails against the prior frontend.
