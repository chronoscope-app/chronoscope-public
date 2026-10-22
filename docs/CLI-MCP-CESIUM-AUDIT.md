# CLI/MCP audit after the Cesium migration

The Rust command registry remains shared by CLI, MCP, desktop IPC and SI tools. Native GIS imports, portable assets, centroid Events and Globe time elevation were already exposed. Version 0.14.1 closes the following gaps.

| Finding | Result |
| --- | --- |
| Agents could change semantic views but lacked geographic camera navigation or GIS layer fitting | `view_navigate` and `chronoscope --attach view` support fit, fit-layer, WGS84 look-at, relative zoom and north-up. No private Cesium APIs or synthetic event coordinates. |
| Workspace snapshots described stored/intended scene state, without live rendering/loading evidence | `view_status` and `chronoscope://view` inspect the actual attached WebView, including camera, backend, WebGPU API exposure, loading and GIS readiness. Hardware acceleration remains explicitly unknown. |
| CLI screenshots required extracting base64 manually | `view capture --output capture.png` writes PNG atomically, refuses overwrite unless requested, and prints only file metadata. MCP retains native image content. |
| Partial display changes reset unrelated settings | `view_set.display` now merges supplied fields; null explicitly resets display overrides. Repeating the current mode preserves the camera; switching mode or requesting fit clears it. |
| Native reference selection accepted nonexistent source IDs | `gis_set.selected` validates and deduplicates exact IDs from `gis_table`. Multipart native objects retain their source feature identity even when Cesium generates suffixed object IDs. Every part highlights, and repeated samples do not duplicate the same highlight. |
| Large GIS attribute rows could shorten a response below its requested limit | `returned_count` and `next_offset` describe actual continuation; optional `expected_revision` rejects stale paging. |
| SI required record-edit permission even to show/select a GIS reference | SI can toggle GIS visibility and selection without record-edit permission. Its advertised schema and a separate runtime guard still block renaming, placement and scale changes unless edits are allowed. |
| Cesium default picking also ran alongside Chronoscope selection | Disabled the default left-click imagery picker, which used a 3D-only ray and could throw in Columbus/2D. Chronoscope retains native object picking and linked tables; camera input remains independent. |
| Removed layers left saved attribute-table references | Removal clears current/saved GIS table references; normal undo retains the original context. |
| Tool descriptions and the SI system prompt still said polygon coordinates remain null | Discovery and documentation now identify derived polygon-centroid coordinates and distinguish native reference presentation from Event analysis. |

Live view requests use a bounded request/reply channel without holding the workspace operation gate. Replies are schema-validated, limited to 512 KiB for status, and pending requests are capped at eight. Requests time out after 15 seconds and support cooperative cancellation; expired queued actions are rejected before execution. Navigation is presentation control, outside atomic batches and data undo. It does not accept dry-run, revision or idempotency controls. The frontend synchronizes the completed camera through the existing revision-guarded scene path. A timeout/cancellation can have an uncertain navigation outcome: inspect live status before repeating relative zoom.

Native reference geometry/properties remain immutable through these tools. Convert via `gis_import_preview` and the standard ticketed import workflow for indexed Event filters and analysis. There is no new remote GIS service connector, arbitrary CRS reprojection, glTF editor or GPU-performance guarantee. Standalone/headless engines expose the same schemas but return UNAVAILABLE for live navigation, status and screenshots; no scene is fabricated.

See [CLI/MCP examples](CLI-MCP.md) and [GIS formats and conversion](GIS-FILES.md).

[Verification and native CLI/MCP evidence](validation/cesium-agents-2026-10-16).
