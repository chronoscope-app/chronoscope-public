# Apple SI Chat retirement — 2026-10-22

Developed in `chronoscope-app/chronoscope-next` from main `148cdb9`. No public-repository change or GitHub-hosted runner was used.

SI Chat now accepts connected OpenAI-compatible model services only. The settings UI, input/output schemas and capability discovery agree. Legacy Apple chat preferences open as unconfigured; rejected Apple configuration does not replace an existing service. The broad native chat/tool bridge and its obsolete inference suites were removed. The Apple availability diagnostic and separate App Intents remain.

Local verification passed: 80 targeted Rust checks; production TypeScript/Vite build; generated contracts; validation-suite inventory; connected SI/MCP browser regression; six SI settings checks; four certificate checks; nine rich-chat checks; native Mac debug app bundle and ad hoc signature verification. Browser fixtures made no public requests. The app bundle was not installed or launched, and no live hosted-model quality is claimed.

One initial settings run lost its detached popup before controls appeared. Its isolated rerun passed, and the separate rich-chat suite passed pop-out, reload, close and docking. Strict all-target Clippy encountered five existing warnings in unchanged `src/gis/vector.rs`; rerunning with only those four baseline lint categories exempted passed. No GIS parsing behavior was changed.

The proposed tagging entry is **Suggest tags…** beside the Event inspector's existing Tags / Add tag controls, followed by a per-record source-text review dialog. Tag suggestions are not implemented by this change.

See [structured results](report.json). Detailed local logs and browser screenshots are retained under `.qa/retire-apple-si-chat/` in the development checkout.
