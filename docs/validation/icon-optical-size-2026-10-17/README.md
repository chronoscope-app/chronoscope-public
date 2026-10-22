# macOS icon optical size — 2026-10-17

The previous Chronoscope body occupied 496 of 512 pixels (96.875%). Locally installed ChatGPT and Apple Notes icons both have an 80.46875% body at the half-alpha boundary. Generated macOS variants now use a 412-pixel body on a 512-pixel canvas, with 50-pixel insets: the same proportion, approximately 17% smaller in each dimension than before. Artwork, background and corner radius scale together.

`scripts/generate_icons.mjs` derives macOS SVG/PNG variants from the existing canonical light/dark artwork and uses the padded light rendition for ICNS. The running macOS Dock adapter embeds the padded PNGs. Windows/Linux PNG/ICO assets retain their original sizing; their light/dark PNG bytes were verified unchanged. No privileges or OS preferences change.

Local checks passed desktop asset formats and background alpha bounds. Both macOS variants have half-alpha bounds 50…461 on each axis; dark retains opaque pure black. Five real AppKit Dock-image comparisons passed: system Light/Dark, app Light/Dark, and a system event opposite an explicit app preference. The native test changed no system preferences.

All verification ran locally. No hosted workflows were dispatched.
