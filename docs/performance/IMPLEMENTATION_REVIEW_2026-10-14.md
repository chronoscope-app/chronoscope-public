# Performance follow-through: Chronoscope 0.9

The linked specification and its 119-entry bundle were accessible and passed the bundle's lightweight hash/link/source-anchor validation. Its measurements concern frozen 0.5.2, not current main. This follow-through starts at `5d4a51d` in a separate `perf/openclaw-20261014` worktree. Each accepted production change has its own commit and regression. No GitHub runners or public WMTS requests are involved.

## Adoption decisions

| Ticket | Decision on current code |
| --- | --- |
| C01 | Already fixed in 0.8; extended cancellation/context regression. |
| C02 | Reproduced accepted/store mismatch, fixed raw-row ID reservation and capacity arithmetic. |
| C03 | Capture debounce intent immediately; serialize and join latest-delta writes, retry bounded CAS conflicts, preserve pending controls through observer refreshes. Deterministic and browser regressions pass. |
| C04 | Adopt cached insert/search/spatial/lookup/replacement SQL; preserve validation, indexes, durability and source attributes. Matched current-code CPU evidence retained separately. |
| C05 | Adopt independently indexed endpoints and whitelisted exact canonical predicates. Original attribute text stays untrimmed; invalid numbers and signed zero have separate correctness tests. |
| C06 | Adopt versioned private coherent UI request under the existing operation gate, revision/store stamps, exact displayed/page membership and asynchronous publication guards. This uses the existing registry and validator cache; no new public MCP tool. Fine-grained unchanged-section responses remain an extension rather than a claimed result. |
| C07 | Adopt projected canonical pages, 32-field windows across all 512 original attributes, exact page membership, and an 8 MiB combined encoded summary-cache budget. The existing selection-statistics split remains; rejected lazy-cache patch is not shipped. Encoded size is not an RSS guarantee. |
| C08 | Adopt no-op only for explicitly immutable terrain snapshots; mutable inputs and changed exaggeration retain the rebuild fallback. Eighteen repeated immutable setters produce no rebuild. |
| C09 | Defer wholesale retained-scene ownership/dirty-graph replacement. Its required matched native tests are absent; preserve the full rebuild fallback while making narrow ownership/reuse fixes. Orbit already retains geometry. |
| C10 | Adopt membership/generation no-op, exact displayed-ID map and grow-only highlight capacity between scene rebuilds. No unselected-orbit FPS claim. |
| C11 | Adopt strict packet checks and indexed byte copy. Preserve JSON/base64 CLI/MCP/browser transport; defer native raw IPC until platform runtime evidence justifies enabling it. |
| C12 | Defer shader/local-attribute/SoA replacement of the production renderer. CPU concepts are plausible, but the specification requires native GIS/pixel/performance parity before promotion; no silent quality changes or untested shader rewrite. |
| C13 | Adopt explicit external-commit/cancellation outcome handling and bounded receipts; keep session-local retention limits. |
| C14 | Do not replace the gate with an actor in this pass. Sixteen admitted jobs already bound waiting workers; actor throughput/deadlock/shutdown advantages are unmeasured. This is an architectural experiment with a large correctness surface, not an established optimization. |
| C15 | Defer reader-owner/WAL snapshot architecture with C14. A mutex-to-RwLock substitution is incorrect. Store leases, TEMP ownership and bounded WAL need their own demonstrated concurrency case first. |
| C16 | Adopt staged persistence/privacy and fallible export safeguards; retain full portable-open validation. |
| C17 | Adopt clone-before-ingest staging into an empty private destination, preserving row IDs, review/cancellation, undo and provenance. Never substitute an empty-target backup into a nonempty append destination. No measured append-throughput claim; legacy append clears selection, undo restores it. |
| C18 | Adopt removal of unused per-pattern allocations and retain explicit input/candidate/finding limits. Full streaming is deferred with pinned-reader work; unsupported exhaustiveness is never implied. |
| C19 | Adopt exact-key, bounded immutable terrain mesh memoization; reject changed sources until reload and preserve existing sampling, voids and resolution. |
| C20 | Adopt explicit disposal, pending-callback guards, listener/observer/rAF cleanup and shared-resource disposal deduplication. Functional lifecycle tests do not establish long-run native PSS. |
| C21 | 0.8 already moves map/terrain I/O outside the workspace gate and cancels Rust HTTP waits. Extend stale publication checks and defer initial resource requests until the saved camera/mode is restored, retaining current configurable normal-app concurrency and existing auth/security bounds. The old 1/s/16-tile testing restrictions are not restored. |
| C22 | Retain full-quality defaults. Expose a portable 20k/100k marker budget in Preferences; do not ship hidden stems/MSAA/backing-scale reductions. Physical startup/GPU tracing and presentation remain hardware follow-up, not software-renderer proof. |
| C23 | Adopt a Float64 world-position picking cache, reused across camera changes and invalidated by geometry generation. Browser selection parity passes. Retained-terrain scaffold remains deferred with C09; no native hover/frame percentage claim. |
| C24 | Fix invalid numeric attribute binds separately. Preserve signed-zero lexical behavior through authoritative payloads for zero-valued canonical fields; numeric comparisons use REAL. No normalization or portable-format migration is necessary. |

The deferred items are not being treated as proven improvements. The report itself labels those designs untested and requires preserving the fallback until matched native tests pass. Current work can establish correctness and CPU behavior on Linux; it cannot supply physical Radeon/Metal/Windows frame-time, smartcard or presentation evidence.

## Current measurement notes

The adapted `performance_storage` example exercises the current API and excludes private host telemetry. Prebuilt variants are interleaved by `scripts/benchmark_storage.py`, using the same fixture, three repetitions, uncontrolled OS page cache and no GPU. Operation tail percentiles are not estimated from three samples. Source/binary/fixture identities and all timings are retained with the final results; unrelated regressions are disclosed rather than relabeled as gains.


## Delivered behavior and remaining work

The implementation keeps full validation on portable open, exact query semantics, minute precision, u64 string IDs, terrain registration and original attributes. It adds no hidden quality reduction, authentication bypass, public-server testing traffic or mandatory server process. Summary-cache limits describe encoded retained values, not total process memory. Mesh-cache diagnostics distinguish a reused mesh from newly decoded tiles.

The coherent GUI operation is private; public CLI/MCP contracts remain available independently. Jobs expose typed progress and bounded commit receipts. A cancel after an external atomic rename reports a committed outcome; a cancel before rename preserves the old destination. Save builds a private destination backup without changing the live workspace's resources. CSV row failures abort instead of silently skipping data.

A complete actor/reader-owner design, retained scene graph, SoA/shader replacement, raw native IPC, and streaming analytical rows remain separate engineering projects. Their proposed performance benefits are unproven on current code. Each requires independent correctness and matched native measurements before replacing the existing fallback.


## Matched CPU results on current architecture

These are three-run medians from release executables on this shared Linux VM. Source-stage descriptions and binary/fixture hashes are retained in [the prepared-statement experiment](current-0.9/prepared-100k.json) and [the indexed-query experiment](current-0.9/indexed-100k.json). They are separate experiments with separate baselines; percentages must not be compounded into an end-to-end app claim.

| Targeted operation, 100k rows | Baseline | Variant | Median reduction |
| --- | ---: | ---: | ---: |
| C04 ingest | 8.095 s | 6.248 s | 22.8% |
| C04 copy | 7.704 s | 6.310 s | 18.1% |
| C05 endpoints only | 38.725 ms | 0.071 ms | 99.8% |
| C05 sorted category | 57.716 ms | 46.027 ms | 20.3% |
| C05 sorted numeric | 54.896 ms | 52.253 ms | 4.8% |

Untargeted operations varied: the C04-only category/numeric medians were 8.2%/13.8% slower; C05 ingest was 4.1% slower than its prepared baseline. These small shared-VM experiments cannot establish statistical significance or tail latency. The new numeric result does not reproduce the frozen report's 38% gain at 100k. The sorted numeric query still uses `events_time` and a temporary ordering structure; its separate count-only VM-step reduction is not evidence that the sorted scan disappeared.

The full 100k harness includes save/open/copy/render-packet CPU work, not renderer FPS. The million-row experiment uses storage-only mode to fit local disk: no copy, save, reopen or render. Peak RSS, when present, is the fresh benchmark process maximum, not the full desktop process tree, VRAM or unique PSS.


[Million-row matched results](current-0.9/storage-million.json), three fresh processes per variant:

| Operation | Baseline median | Current median | Reduction |
| --- | ---: | ---: | ---: |
| Ingest | 101.668 s | 85.299 s | 16.1% |
| Indexed endpoints only | 342.468 ms | 0.087 ms | 99.97% |
| Sorted category | 502.631 ms | 405.495 ms | 19.3% |
| Sorted numeric | 539.006 ms | 334.311 ms | 38.0% |
| Peak child RSS | 52.4 MiB | 61.7 MiB | **17.7% increase** |

The current build uses approximately 9.3 MiB more peak process memory in this fixture; the experiment does not isolate which individual change accounts for that increase. No promise is made that these ratios hold on another machine, schema or distribution. This comparison includes both prepared statements and canonical predicate/endpoints changes; it does not isolate their individual million-row effects. Both variants wrote identical-size 2,502,946,816-byte working databases and checked accepted/stored rows, representative identities/provenance and exact query counts. A shared build-cache collision was detected by identical executable hashes before measurement; both executables were rebuilt independently and verified distinct before these retained runs. No measurements from the invalid build attempt are reported.


## Final verification

[All local checks and retained logs](current-0.9/validation.json) pass: 161 Rust tests, strict core/native Clippy, formatting, contract generation, frontend build, both focused JavaScript suites, all five browser suites and a Linux native debug build. The [source-file hashes](current-0.9/source-files.json) identify the tested implementation including the version manifests. [Hardening browser results](current-0.9/hardening-browser.json) cover immutable terrain, selection capacity, exact cached picking, disposal, wide field windows, marker budget and navigation. [WMTS results](current-0.9/wkt-wmts-browser.json) retain all 64 local tiles, peak concurrency eight and offline reuse; public requests were zero.

The first final pass exposed an old exact scene fixture missing the new additive fields, then a redundant startup request before saved-camera restoration. The fixture now checks nondefault portable fields and legacy defaults; startup requests wait for the final camera. The complete final rerun passed after both corrections. Software WebGPU/WebGL2 pixel and fallback tests are functional evidence, not physical-GPU FPS. No native Mac/Windows runtime, signing, smartcard or long-run native-memory guarantee is implied.
