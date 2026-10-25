# MCP video recording: Mac validation, 2026-10-25

Added `chronoscope_view_recording` with start/status/stop actions. The attached
macOS app records its own window through ScreenCaptureKit to H.264 MP4, without
audio. Recording continues while MCP navigation or normal input operates.
Output paths stay within the MCP file root, cannot overwrite existing files,
and are published after finalization. Recording is bounded by duration, file
size, dimensions and one active capture. macOS 15+ is required.

The rebuilt and signed app was tested locally on this arm64 Mac running
macOS 27.0.1. Each view used the public wildlife demo, Streets imagery and the
bundled Balanced terrain, with 24 geographic pan steps and 16 zoom steps.

| View | Decoded frames | Video interval | Longest frame interval | Flash candidates |
| --- | ---: | ---: | ---: | ---: |
| Map | 336 | 5.923 s | 36.7 ms | 0 |
| Globe | 338 | 5.965 s | 35.0 ms | 0 |
| Space-time | 340 | 5.957 s | 30.0 ms | 0 |

All 1,014 encoded frames were analyzed. Each clip covers the movement sequence,
has changing camera poses, and has no rendering errors or terrain-provider
replacements during navigation. Contact sheets were also inspected. Synthetic
H.264 controls with medium and bright backgrounds both correctly identified
the injected single black and white frames. These checks detect broad blank
ground and abrupt frame discontinuities; they do not prove the absence of every
small visual artifact, or flashes between captured frames.

Recorder checks cover discovery, asynchronous start, active-recording conflict,
automatic stop, repeatable stop, no overwrite, root scope, argument validation,
headless failure and video resource links. Final byte count and duration are
checked against the finished MP4. The first smoke run exposed a watchdog
cancellation bug; review also caught ScreenCaptureKit's live counters lagging
the finalized file. Both were fixed before this final three-view run.

The local validation runner passed 403 Rust tests (one intentional ignored
test), 29 frontend tests, 8 runner tests, both browser smoke suites, core/native
Clippy, formatting, generated contracts, native build/signature/CLI checks and
13 native terrain GUI checks. After the final Swift metadata correction the
app was rebuilt, relaunched and the complete recording test repeated. No GitHub
runners were used. This is focused Mac validation, not a full release sweep or
verification on other operating systems.

Commands, with the local toolchain and QA Python environment loaded:

```sh
python scripts/validate_local.py --browser --native-video --report .qa/video-recording/validation.json
bash script/build_and_run.sh --verify
python scripts/native_video_qa.py --cli target/debug/bundle/macos/Chronoscope.app/Contents/MacOS/chronoscope-desktop --data-dir .qa/video-recording/runs/20261025T123435Z-f624dfcc/native-profile --output .qa/video-recording/final-three-views
```

[report.json](report.json) contains measurements, source/binary/video hashes and
the validation run ID. Videos, every-frame metrics, navigation traces and contact
sheets remain under `.qa/video-recording/final-three-views/` on this Mac. Large
video files are not checked into Git.
