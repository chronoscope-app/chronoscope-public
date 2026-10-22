# Fractional Event timestamps — 19 October 2026

Imported and edited Event start/end timestamps now retain seconds and fractions through the authoritative Rust model, indexed SQLite queries, analysis, CLI/MCP and Cesium packets. Unix-second API units and the 32-byte render record layout are retained. No dependencies were added.

## Precision and migration

- Canonical clock: finite IEEE 754 binary64 UTC Unix seconds, with approximately 0.24 microsecond spacing near 2026. Exact nanosecond distinctions are not guaranteed; original imported strings remain attributes. Excel serials have their own source rounding limits.
- Short analytical durations subtract canonical calendar parts using integer nanoseconds before converting to seconds. Whole-second inputs retain a fast path. Microsecond steps therefore do not acquire large-epoch subtraction noise in speed/encounter results.
- New files: version-6 metadata, SQLite schema v3 or ZIP/JSON v6. Older app builds reject these version gates. Old minute-aligned files open on a working copy without rescaling their saved instants or modifying the original file. Reimport original CSV/Excel to recover previously discarded detail; the app does not guess from potentially stale source attributes.
- Existing bundled example workspaces retain their previously saved timing. Import their corresponding `samples/public/*.csv` for the full source times. Future demo generation preserves fractional clocks.

## Verification

All checks ran locally; no GitHub Actions/runners or public map requests were used.

| Check | Result |
| --- | --- |
| `cargo test --locked -p chronoscope --tests --no-fail-fast -j 1 -- --test-threads=1` | 327 passed, 0 failed, 50 test binaries |
| Final `--lib --test subsecond_precision` regression run | 45 library + 5 precision tests passed |
| Final GIS/precision regression run | 7 GIS + 5 precision tests passed, including a fractional CZML offset spanning 400 years |
| `python3 scripts/test_subsecond_protocol.py` | Actual CLI and stdio MCP discovery, parsing, imports, precise queries, edits, save/reopen passed |
| `npm --prefix frontend run test:subsecond` | Six real browser checks passed, no page errors |
| Packet, time-axis and timeline-label unit scripts | Passed, including negative epochs, microsecond labels and subsecond ticks |
| `frontend/scripts/playback-transitions-qa.mjs` | Four checks passed; smooth day playback, bounded bloom crossfade, pause settling, no redundant full-range filtering |
| TypeScript/Vite production build | Passed; existing large-chunk advisory remains |
| `cargo check --locked --workspace` with local GTK sysroot | Linux Tauri desktop and core compile passed |
| `cargo check --locked -p chronoscope --features legacy` | Passed; existing unused serde import warning in the retained renderer |
| `cargo clippy --locked -p chronoscope -- -D warnings -A clippy::too_many_arguments` | Passed; exception is the existing ten-argument `pattern_scan::add` helper |
| Contract generation check, Rust formatting, diff whitespace | Passed |

Precision tests cover equivalent seconds/ms/us/ns epochs, negative fractions, custom/separate clocks, Excel dates, UTC offsets, minute-separated and microsecond-separated Events, exact ordering/filtering, interval validation, edits/undo/redo, packed rendering, CSV export/reimport, ZIP/SQLite save/reopen, unchanged legacy source files, subsecond encounter thresholds, fractional comparison windows and deterministic trajectory speeds.

Browser checks use three synthetic Atlanta Events within 750 milliseconds, with maps disabled. They verify precise Rust-parsed text filters, slider windows below one second, editing to six fractional digits, millisecond chart intervals and second-rate playback. Chromium uses software WebGL rendering here. Native macOS/Windows runtime behavior and Apple Intelligence execution require testing on those hosts.
