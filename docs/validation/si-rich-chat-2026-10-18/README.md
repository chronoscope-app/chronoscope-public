# SI rich chat validation — 2026-10-18

Local Linux verification, without GitHub runners or a physical GPU. The browser uses Chromium with SwiftShader. SI responses are deterministic localhost fixtures, not live Apple or hosted model responses. No public map services are requested.

- All 284 engine tests passed across the library and 40 integration targets; see `rust-report.json`. Targets were executed sequentially and completed test executables removed between targets to fit the workspace disk budget.
- `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`, generated-contract verification and the production TypeScript/Vite build passed.
- `si-rich-chat-report.json` records the two-window workflow: drafts, running request transfer, reload/close/reopen, stale-poll handling, rich formatting, hostile formatting, engine-backed charts, map snapshots, linked Event selection, cancellation, clear and both themes. The desktop content-security policy is applied during these tests. The detached page requests no Cesium resources.
- `assistant-report.json` covers existing SI tool use, external MCP grants and failures, import aggregation, picking, time-only markers and effects in the existing views.
- `analytics-report.json` covers the existing analytic Results UI and linked selection, including persisted results.

Reproduction after building the engine and frontend:

```sh
cargo test --lib
# Run each integration target listed in rust-report.json with cargo test --test TARGET.
cargo clippy --all-targets -- -D warnings
cargo fmt --check
node scripts/generate_contracts.mjs --check
npm --prefix frontend run build
npm --prefix frontend run test:si-rich-chat
npm --prefix frontend run test:assistant
npm --prefix frontend run test:analytics
```

Native desktop verification remains required on macOS. This Linux image lacks the GLib development libraries needed to compile Tauri; the engine checks above exclude that package. Browser tests establish shared engine and frontend behavior, not native WindowServer/WebView2 behavior or Foundation Models planning quality. On the Mac, test native pop-out/dock and close, an active request while moving chat between windows, closing the main app with unsaved changes, system-browser source links, multiple displays and the existing Apple-local integration workflow.
