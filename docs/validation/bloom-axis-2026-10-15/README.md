# Bloom/Event visibility and adaptive time-axis regression

Two findings from local Mac testing were confirmed in the prototype. Bloom made the frontend treat the ground overlay as a replacement for event markers. In Map and Globe the coherent backend snapshot also returned selected-only event packets. Bloom now preserves bounded event representatives in all geographic views; the Events toggle still controls their visibility. The marker budget still applies. Enabled vertical trails use the same replacement-versus-overlay distinction.

The time axis previously used six unconditional full timestamp labels. It now clips the actual axis to the camera frustum, chooses bounded UTC-aligned ticks by visible pixel density, deduplicates overview dates and adds hours/minutes only when magnified. Camera and viewport changes recalculate the labels. This changes presentation, not event timestamps or coordinates.

Local verification:

- Production TypeScript/Vite build passed.
- Ten Rust tests passed (`display_lod`, `cesium_scene`). The added regression failed against the old backend (Map/Points returned only the one selected event). It now verifies Points/Automatic modes in Map, Globe and Space-time, preserving unselected events from a 6,000-event dataset within a 100-marker request budget.
- Time-axis math checks cover UTC midnight, multi-year overviews, detail at high magnification, duplicate dates, hidden/behind-camera axes, near-plane crossings and single-instant ranges.
- Real Chromium/SwiftShader framebuffer checks verify all 3,000 unselected markers over bloom in each geographic view, selection changes, Events off, actual changed marker pixels, heat/bloom ground pixels and unchanged ground bloom when time height changes. Camera overview/detail labels and screenshots are captured after font/render warm-up.
- No external map requests were made. The data and effect footprints are synthetic. These are Linux software-WebGL tests; the updated Mac build still needs local verification.

See `report.json`, `rust-tests.log`, `time-axis-tests.log` and the PNG captures alongside this file.
