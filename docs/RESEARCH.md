# Implementation notes

Chronoscope’s model, algorithms, interface, persistence format and synthetic examples were written independently. Open-source dependencies and public geographic data retain their licenses and attribution.

## Workspace capabilities

| Workflow | Chronoscope implementation | Boundary |
| --- | --- | --- |
| Space-time trails and map examination | Large Three.js volume, vertical time, stems, trails and focus plane; map/calendar | WMTS and DTED added in 0.2; split map remains in the optional legacy frontend |
| Filtering and linked selection | Unified IDs across rendered views, histogram, table and charts; time/attribute/entity/category/region filters | Selection stays local to this app |
| Selected-data pattern tools | Proximity, stationary, gaps, speed and single-link clustering | Explicit observed-sample semantics; no confirmed-meeting inference |
| Link exploration | Related-entity source mapping; depth expansion, shortest paths and graph view remain in the optional legacy frontend | No full graph-analysis suite |
| Numeric and temporal summaries | Value statistics, entity/category counts, weekday/hour matrix and histogram | No configurable pivot engine |
| Entity manipulation | Reassign selected events for merging/splitting; remove/edit events; undo/redo (manual creation remains in the legacy frontend) | Original source fields retained separately from canonical edits |
| Evidence organization | Event notes/tags, saved selection groups and named views | No freehand map drawings |
| Reporting | CSV event export and PNG canvas snapshots | No video, Office document generation or XLSX export |

Scope follows the user’s emphasis: desktop visualization, selection, analysis, manipulation, CSV/Excel input, and Rust across Mac/Linux/Windows. Hardware, sensors, live feeds, and live data feeds are excluded; WMTS/DTED were added at the user’s request in 0.2.
