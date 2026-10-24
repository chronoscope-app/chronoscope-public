# Next source promotion — 24 October 2026

Owner-authorized promotion of `chronoscope-next/main` at `59a0e0b3516ab51e595d133fd50619804b506535` onto the existing `chronoscope-public/main` at `bcb8e8fb4f9beef7c07dfc75bde4d0b5d1ff32ba`.

Public's base tree was exactly the Next baseline tree at `97c7e4392d13727ad30f66d605b345b8042d2627`. Applying the two new Next commits' file changes produced the identical Next tree `397160697f72db25aa454bc73101501c21cfe543`. The final public tree adds only this README and its structured receipt. Every tracked Next file remains identical; public's independent commit history is retained, without importing private Next commit ancestry.

The promotion includes the idle-camera orientation stabilizer, six regression cases, current-control/timing QA repairs, the opt-in native profiler, the measured performance report and the standalone Cesium reproduction. The [Cesium handoff](../../CESIUM-IDLE-RENDER.md) explains the getter side effects, workaround limits and remaining work for an upstream PR. The [performance investigation](../radeon-performance-2026-10-24/README.md) retains the software-throughput failure, passing Radeon rerun and later driver power-management error.

Fresh local Linux checks passed: 24 frontend test cases, TypeScript/Vite production build, 34 tester-packaging tests, 23 distribution tests, 10 publication-cleanup tests, generated contracts and the validation-suite inventory. The CPU-only camera diagnostic again recorded 93 false movement detections over 600 stationary update checks, versus zero in the control and stabilized cases. This diagnostic counts change detections, not FPS.

Gitleaks 8.30.1 was downloaded from its official release and verified against the published SHA-256 checksum. A synthetic canary verified detection. The exact tracked source snapshot scanned without findings under the unchanged repository configuration. The final local public promotion history is scanned separately; this shallow clone does not re-audit older public history. No raw local profiles, tokens, binaries or screenshots from the private test workspace are included.

The maintained tester-packaging safeguards, Mac configuration, installation/download provenance and both manual-only workflows are unchanged. This is a source promotion: no hosted runner was used, no new executable release was created, and no existing release asset or tag was replaced. The existing Windows/macOS 0.15.2 previews still correspond to their documented earlier source, not this source promotion.

[Structured results](report.json).
