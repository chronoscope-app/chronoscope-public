# Independent clawcomp baseline result

Received through the connected device chat **Launch latest chronoscope report**.
This tests the previously published Next main at `ed38f72`, independently of the
new Mac MCP additions. Paths below refer to clawcomp's filesystem. Results are
preserved as reported; this is not a passing Linux release certification.

+Independent clawcomp validation completed for **`ed38f728e450c9537476cedcdfb57e8de0ebef15`**. **Overall: not fully passing.** No tracked changes, pushes, Public promotion or hosted workflows.

- **Standard validation:** all 18 stages passed, including 402 Rust tests, 29 frontend tests, production frontend build, core/native Clippy, Linux desktop build and desktop CLI/MCP smoke. Two Rust tests remained explicitly ignored. Python checks passed: runner 8, publication 10, distribution 23, packaging 34 and download validation 36.
- **Targeted browser checks:** 9/12 passed, plus integration smoke and Welcome.
- **Native Linux:** 13 terrain checks passed. Balanced loaded from the staged app’s own resource directory: **21600×10800, EGM96**, verified archive checksum.
- **GPU:** native WebKit used **Radeon 550X / amdgpu, PCI `0000:3a:00.0`**, with advancing graphics counters. No new GPU kernel errors observed.
- **Capture/navigation:** whole-app PNG **1920×985** and map PNG **1306×938** worked. Recorder `start/status/stop` each returned **UNAVAILABLE**, as documented for Linux; no MP4 created. Across **320 native rendered frames and 48 pan/zoom actions**, zero blank-flash candidates, provider replacements, empty-ground frames or readback errors were detected.

Three preserved browser failures:

1. **Antarctic terrain:** never satisfied readiness/idle. Diagnostic repeat had 75 samples with `tilesLoaded=false`; its tail retained 95 rendered tiles and 42 low-priority queued tiles.
2. **View sync:** initial Map-source run returned four null footprint projections. Diagnostic repeat progressed further, then failed at 80°N with a corner outside the viewport.
3. **SwiftShader playback throughput:** **11 updates/3.5 seconds**, below the unchanged minimum of 20.

Evidence, exact commands and limitations:

- [Full report](/home/claw/Documents/Codex/chronoscope-next/.qa/clawcomp-next-ed38f72-2026-10-25/README.md)
- [Structured results](/home/claw/Documents/Codex/chronoscope-next/.qa/clawcomp-next-ed38f72-2026-10-25/results.json)
- Native evidence: `/home/claw/Documents/Codex/chronoscope-next/.qa/clawcomp-next-ed38f72-2026-10-25/native/`

Limitations: staged **debug ELF**, not an AppImage/release package; host GTK/WebKit required. Native launch used the documented DMA-BUF workaround. Frame observations cover the map framebuffer, not compositor video. The disposable app remains running as PID **60400**.
