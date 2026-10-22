# Field roles and chart navigation validation

Based on `716e2af301f2701721cf7b44df260546b3b01c48`. See [Charts documentation](../../CHARTS.md).

Users can assign Measurement, Category, Identifier, Date/time, Coordinate, Currency/unit or Exclude roles through Charts → Field roles. Automatic removes an override. The searchable editor initially renders at most 100 matching fields and applies changes atomically. Tabs are ordered Views, Charts, Inspect, Patterns.

Roles guide chart starters; they do not rewrite values, remap the canonical Event clock, convert units, or change an existing chart's configured fields. Numeric eligibility remains based on actual stored values. Roles are portable project metadata, support undo/redo and are exposed through CLI/MCP schema discovery and `field_roles_set`. SI requires edit permission to change them. Conflicting edits to the same field are disclosed rather than overwritten.

## Verification

- **61 Rust tests passed**: field roles (2), library including SI edit permissions (44), charts (9), and field profiles (6).
- **15 browser check groups passed**: field-role workflows (6) and existing chart compatibility (9). Reports are included alongside this document.
- The field-role fixture uses 24 Events and 134 imported columns, including leading-zero identifiers, misleading numeric names, entirely text fields and an HTML-like column name. Checks cover bounded/searchable controls, escaped names, starter choices, unchanged source records, cancel, Escape, reset, undo/redo, concurrent conflicts and portable save/open followed by a genuine page reload.
- Existing chart checks cover exact statistics, native brush source selection, source-table linking, presets and playback caching.
- Production CLI and TypeScript/Vite builds, generated-contract checks, Rust/frontend formatting and diff whitespace checks passed.

Browser checks used Linux Chromium/SwiftShader with the real Rust engine. No public map requests, GitHub runners or billed SI services were used. Native Apple model inference, macOS/Tauri behavior and hardware-GPU performance were not tested. Strict Clippy remains blocked by the existing unrelated `too_many_arguments` warning at `src/pattern_scan.rs:236`.

## Reproduce

```sh
cargo build --locked -p chronoscope --bin chronoscope
cargo test --locked -p chronoscope --lib
cargo test --locked -p chronoscope --test field_roles
cargo test --locked -p chronoscope --test charts
cargo test --locked -p chronoscope --test field_profile
npm --prefix frontend run build
npm --prefix frontend run test:field-roles
npm --prefix frontend run test:charts
node scripts/generate_contracts.mjs --check
cargo fmt --check
git diff --check
```

Browser scripts accept `CHRONOSCOPE_CLI`, `CHRONOSCOPE_CHROMIUM` and `CHRONOSCOPE_QA_DATA_DIR` for isolated local execution.

[Current screenshot gallery](../../screenshots/current/README.md)

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
