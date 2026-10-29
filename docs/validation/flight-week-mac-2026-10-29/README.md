# Seven-day flight demo · local Mac validation

Code/data commit: `af4a21bf3161e6f00e57b8cab0339ae206ff4196`, Next version **0.16.9**. Replaces the London–Zurich sample with 175 original Philippine flights, six airports, March 1–7, 2026 UTC. Twenty-five departures per day, five per route; 11,018 retained observations from 57,788 source rows. The workspace is 346,849 bytes; workspace, two previews and credit together are **413,118 bytes**. [Source, license, interpretation and reproduction](../../ALTITUDE-DEMOS.md).

The first retained observation is March 1 at 00:07:24 UTC; the last is March 7 at 23:58:20. Full-week Altitude, Time Height and Ground views remain available. The additional 24-hour playback view starts at the first observation, avoiding clipping its width against the dataset boundary. Route colors and an oblique overview make the saved scenes easier to distinguish. Time Height uses display elevation; physical altitude remains approximate reported metres.

## Verification

- [Source verification](source-verification.json): every bundled timestamp, coordinate and altitude compared with its original source row across all 175 files; endpoints preserved. Only original-flight members used. The documented pinned-range download path was exercised and reproduced identical output hashes.
- [Rust tests](rust-tests.log): 12 passed, one existing full bundled-data matrix test intentionally ignored. Includes five-route coverage on all seven days, 175 distinct flights, exact CSV altitude/timestamp roundtrip, existing demo contracts and the Starlink bundle-size ceiling.
- [Browser playback](browser-playback.json): actual demo picker opens both preview images and the full seven-day range with 175 entities and all 11,018 observations. Real Day playback crosses a UTC date while retaining an exactly 24-hour window and nonempty data; [observed moving window](playback-window.json) retains 1,656 visible observations. No page errors or public network requests.
- [Altitude controls](altitude-controls.json): existing height selector, disabled altitude scale slider, altitude geometry, save/reopen and reset confirmation checks pass with the replacement sample. Both preview JPEGs were generated from actual offline saved scenes and visually inspected; hashes and camera state are in `frontend/public/demos/manifest.json`.
- [Installed Mac metadata](versions.json): optimized release build completed through `script/build_and_run.sh --build-only`; bundle and installed copy signatures verified by the build/installer. Installed executable matches the release artifact. Only `/Users/user/Applications/Chronoscope.app` remains in that directory, version 0.16.9. Installed [notice payload](notices.log) verifies 1,536 files, including the replacement flight credit. Third-party dependency lock entries are unchanged.

## Native scope and capture limit

[Native MCP checks](native-mcp.json) confirm installed version 0.16.9, all 175 flights, the exact seven-day bounds, 11,018 usable reported heights, Altitude/Time Height state and a saved 24-hour window with 1,581 observations. One initial read-only readiness request timed out; the second succeeded. No mutations were retried.

Native **visual** validation is unavailable in this locked-screen session. Whole-app capture returned DOM pixels with blank WebGL panels; [direct map capture](native-direct-capture-unavailable.json), which forces canvas rendering, timed out. macOS reported `CGSSessionScreenIsLocked=Yes`. These receipts do not establish successful native canvas rendering or animated native playback. Actual rendered imagery and moving-window playback were verified in headless Chrome. Disposable native profiles were used and only their app processes were closed; no computer-use tools were used.

## Local reproduction

```sh
python3 scripts/prepare_altitude_demos.py INPUT_DIRECTORY --download
python3 scripts/guarded_run.py -- cargo test --locked --test altitude --test real_demos --test space_demos
python3 scripts/guarded_run.py -- cargo build --locked --bin chronoscope
CHRONOSCOPE_DEMO_IDS=flight-altitude python3 scripts/guarded_run.py -- node frontend/scripts/capture-demo-thumbnails.mjs
python3 scripts/guarded_run.py -- npm --prefix frontend run build -- --configLoader runner
python3 scripts/guarded_run.py -- node frontend/scripts/flight-week-qa.mjs
python3 scripts/guarded_run.py -- node frontend/scripts/altitude-qa.mjs
bash script/build_and_run.sh --build-only
```

Pending Next branches were checked before building. `origin/codex/retire-apple-si-chat` is already squash-integrated by `ee83f5c`; no completed branch work was omitted. No workflows were dispatched, and workflows remain manual-only. Public source and published downloads are unchanged.
