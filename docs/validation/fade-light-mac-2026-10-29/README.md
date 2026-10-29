# Next 0.16.7: light markers and continuous playback fade

Application source: `d01b0bc` on `chronoscope-next/main`. Tauri remains pinned to
2.12.5. All verification is local; no hosted workflow or Public promotion ran.

Ordinary light-mode point glyphs, outgoing markers, WKT points and unselected
clusters no longer use a white outline. Selected markers retain their thin amber
edge. Dark-mode styling, point sizes and display budgets are unchanged.

The playback popup now has a keyboard-accessible Fade slider from 0 to 100,
with Linger and Faster endpoints and a numeric readout. Lower values retain more
played history and lengthen departure fades; higher values shorten both. At
100, the history window targets roughly three recent distinct timestamps,
preserving concurrent entities at those times, with a 120 ms departure fade.
The estimate uses the latest installed packet's cadence, so irregular timestamps
and LOD do not imply a strict global count. Zero keeps played history until the
loop wraps. Fifty preserves the previous moving window and 800 ms departure.
Reduced motion continues to suppress animation; existing ghost/cohort budgets
remain bounded.

Visible history uses the ordinary exact time filter, so the table and query
scope agree with the retained evidence. Original records remain unchanged.
Pause/resume retains the original history scale. Slider changes do not rebuild
the scene, and cadence calculation uses constant storage outside animation.

Saved views and portable workspaces persist `playback_fade_amount`. Legacy
`playback_fade: false/true` restores as 0/50; an explicit numeric amount wins.
MCP `view_playback configure` accepts `fade_amount`, and the installed CLI
supports `chronoscope --attach view fade 75`. Scene schemas, generated contracts,
diagnostics, built-in help and API documentation describe the new control.

## Local verification

The [final source receipt](local-verification.json) records the precommit working
tree subsequently committed unchanged as `d01b0bc`: Rust formatting, all-target
Clippy, six playback/persistence tests, CLI and production frontend builds,
generated contracts, 154 frontend unit tests, and both browser journeys passed.
The new fade journey checks actual slider keyboard input, marker outlines,
concurrent entities, exact table counts, pause/resume and portable persistence.
The table journey checks docked/detached Event/GIS scroll, retained hover/control
identity, and closing during playback. Earlier runs intermittently failed its
initial detached-table scroll setup; a scope-handshake wait was added, and the
final run passed all five scenarios. This is not evidence of a native table
performance improvement.

Navigation/preferences, playback speed, playback transitions and display recovery
also passed on the preceding candidate. The final source rerun focused on the
changed fade behavior and adjacent table playback. These checks do not establish
Windows/Linux native behavior or a measured memory/CPU improvement.

## Installed Mac bundle and locked-session limitation

The optimized release bundle is installed at `~/Applications/Chronoscope.app`,
the only Chronoscope copy in that directory. Bundle/build metadata and the
installed CLI all report **0.16.7**. Its executable SHA-256 matches the built
bundle, and strict ad hoc signature verification passed.
[Installation receipt](installed-app.json).

The installed desktop binary passed the display-independent CLI/MCP smoke:
help, agent enable/config/disable, paths with spaces, and real stdio MCP
initialization/discovery/query. An additional
[installed numeric fade check](installed-mcp-fade.json) verified advertised live
and scene schemas, persisted 75%, rejected 101 without changing that scene,
and mapped legacy `false` to zero. These checks do not exercise a live frontend.

Native MCP connected to the isolated app's engine, but the first candidate
attempt timed out at navigation. A readiness-first attempt timed out at the
initial `view_status`, before fixture changes. An unchanged **0.16.5** native
control app also timed out at that initial request in the same locked session.
All three attempts closed their transport and terminated only their own app PID.
No computer-use input was performed and the normal workspace was not opened.
[Native attempts](native-attempts.json).

Consequently, fresh native near/far captures and native playback assertions are
**not verified** in this session. The control result suggests a locked-session
restriction, but does not prove the mechanism or certify native correctness.
The [headless browser report](browser-fade-report.json) and
[slider screenshot](fade-slider-light.png) are separate frontend evidence.

## Reproduction

Run heavy commands sequentially under `scripts/guarded_run.py`, sourcing the local
toolchain environment on this Mac:

```sh
python3 scripts/guarded_run.py -- python3 scripts/validate_local.py \
  --suite playback-fade-qa.mjs --suite table-playback-qa.mjs \
  --rust-test playback_display --report .qa/fade-validation.json
python3 scripts/guarded_run.py -- bash script/build_and_run.sh --build-only
python3 scripts/guarded_run.py -- python3 scripts/native_fade_qa.py \
  --app "$HOME/Applications/Chronoscope.app" --label local-fade
```

The native harness creates a disposable profile and two concurrent tracks (202
records), captures near/far light-mode app frames through MCP, exercises numeric
CLI/MCP fade controls, and terminates only its own app process. It requires no
computer-use input and leaves the normal workspace and appearance preference
untouched.
