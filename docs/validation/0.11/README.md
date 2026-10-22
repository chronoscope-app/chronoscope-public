# 0.11 local validation

`validation.json` records the final 16-check run. `source-files.json` hashes the implementation and tests; logs are retained in `logs/`. The SI browser script subsequently received only longer compositor waits / disabled screenshot animations; it was rerun successfully, with its final log retained. This does not change the built application. Provider and WMTS fixtures are local, not live external services. Screenshots use software WebGL2; UI QA also covers software WebGPU/fallback. Native build/smoke checks apply to Linux only.
