# Playback speed — local verification, 2026-10-17

The rabbit menu immediately beside Play offers 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75× and 2×. Default is 1×; the choice stays active across pause/resume during the current app session. The menu supports arrow keys, Home/End, Enter/Space, Escape, outside dismissal and a selected checkmark.

Playback integrates elapsed time separately from the render and data-refresh cadence. A live rate change first integrates the previous rate up to the change time, retaining position and selected window width. Existing marker/trail fades and the single-in-flight data refresh remain unchanged.

Local checks:

- TypeScript/Vite production build.
- Exact clock checks for all eight rates and changes between render frames.
- Hardware-accelerated Chromium with the real Rust server and 3,568 hurricane events: observed quarter, normal and double rates; continuous live changes; pause/resume at 0.75×; full-range evidence retained; moving window width retained at 2×.
- Menu keyboard controls, outside dismissal and unobscured layout in light/dark themes at 1600×1000 and 1000×700.

Native build and UI verification are recorded in `native-report.json`. All verification runs locally; no GitHub Actions are started.
