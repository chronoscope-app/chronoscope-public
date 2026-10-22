# Compass and bloom verification — 15 October 2026

The compass now identifies its numeric value as **Heading** and rotates its cardinal dial. At **030° NE**, the view faces northeast and the north marker correctly points left. Globe controls use the local WGS84 frame rather than global scene azimuth and preserve the centre ground point. Saved views/workspaces retain camera orientation.

Bloom isolates emission from scene coverage and uses a separate camera/layer. Raw and blurred emission add light; HDR alpha cannot subtract background color. Exposure now uses the default 16-pixel footprint as its reference, giving luminous highlights instead of a dim red tint. Strength changes followed by camera switches retain an unchanged empty background. If postprocessing fails, raw footprints remain visible and the ordinary camera layer is restored. Heat map remains off by default.

[Current screenshot gallery](../current/README.md), [Current screenshot gallery](../current/README.md), [Current screenshot gallery](../current/README.md), [Current screenshot gallery](../current/README.md). These show 38 Atlantic hurricanes from the completed 2021–2025 seasons, with 1,604 original source observations. Bloom summarizes the current window on the ground; color/brightness does not measure storm intensity. Imagery comes from 24 cached NASA GIBS tiles, with zero public requests during these captures. These basin-scale pictures show raster imagery, without loaded DTED.

[Validation results](validation.json) record local Rust checks, independent geographic reference comparisons, 108 globe orientation cases on each rendering backend, map-pixel comparisons in both themes, repeated imagery/effect replacement, strength/mode switching, and rendering fallback. Tests use local fixtures; no GitHub runners were used. Chromium software rendering does not certify native Mac/Windows graphics or physical GPU performance.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
