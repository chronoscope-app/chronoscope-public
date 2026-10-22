# Map presets and control refinements — 15 October 2026

Space-time rotation spheres now sit outside the cage with short tethers. Their clearance is 16% of the larger horizontal scene span, bounded to 0.35–0.7 scene units; geography and observation coordinates are unchanged. The compact compass is 40% opaque normally, rising to full opacity on hover, drag or keyboard focus; reduced-motion settings suppress its fade animation.

Entities and Categories use clickable **Name / Quantity** headers with direction indicators. Repeated clicks reverse the sort. Collapse and top-ten/show-all behavior remain available. The attribute-table close button is at the left. Double-clicking a data layer opens its source table; map, terrain and reference layers invoke their ellipsis settings. Checkbox/button double-clicks do not trigger an extra layer action.

## Built-in maps

**Map source → Built-in maps** offers NASA GIBS, USGS topographic and aerial imagery, EOX OpenStreetMap streets, EOX terrain, and Sentinel-2 2024/2025 mosaics. USGS offers its best detail in the United States. EOX's recent Sentinel mosaics are free for **non-commercial use only**, under CC BY-NC-SA 4.0; the menu displays that restriction, coverage and credit links.

Presets are compiled Rust metadata, discovered through `wmts_servers.presets` by both the interface and agents. The editable local library remains `servers`; existing connections and intentionally empty libraries are preserved. Selecting/saving a preset does not enable it in the workspace until Apply/Add selected layer. No extra providers are activated on startup. Known preset layers display linked credits, and canvas PNG/MCP captures append a credit footer. The verified built-in HTTPS providers use HTTPS tile transport even where their capabilities advertise legacy HTTP links. Custom server URLs retain their behavior.

See [map sources, coverage, licensing and use](../../MAP-LAYERS.md).

## Checks

[Consolidated validation](validation.json): **24 passing local checks**, including **198 Rust tests**, strict linting, generated contracts, frontend/unit checks, twelve browser suites and Linux desktop build/CLI-MCP smoke checks. The report preserves the initial run and focused rerun: moving the close button in markup first exposed older CSS that still anchored it right; that CSS is now corrected. No GitHub runners were used.

- [Interaction regression](controls.json): sorting in both directions, top-ten/collapse, left close location, data/reference/raster double-click actions, opacity on hover/focus, external handle clearance and dragging, continuous 24,000-row table, search, selection, live display settings and imagery transitions.
- [Provider regression](map-presets.json): built-ins remain discoverable with an empty saved library, layer selections match provider capabilities, licenses are visible, saving does not activate maps, and screenshot credits flow from real preferences through the interface and PNG capture.
- [Public samples](public-map-samples.json): one real 256-pixel tile from each of the six added choices decoded through the production Rust WMTS engine. One worker and 1.2-second pacing; capabilities were cached/shared. Tests do not impose limits on normal use. The archived provider capabilities underpin offline planning/HTTPS tests.
- [Native checks](native.json): strict desktop lint, final embedded-assets Linux build and CLI/MCP smoke checks. The broad Globe-return regression asserts actual software WebGPU and checks imagery pixels across both themes with bloom on/off.

These are software-renderer functional checks, not physical-GPU performance measurements. Native macOS and Windows UI execution were not performed in this Linux session.

## Screenshots

Forty **synthetic** Atlanta inspection observations over a real USGS topographic tile. This intentionally replays just one cached 256-pixel tile to avoid further public traffic; it does not demonstrate the app's normal multi-tile image resolution. No DTED is loaded in this capture. The left close button, sort headers, offset rotation handles and faded compass are visible:

[Current screenshot gallery](../../screenshots/current/README.md)

The source menu displays coverage and license information before applying a built-in choice:

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
