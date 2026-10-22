Current performance follow-through: [0.9 review and deferred architecture](performance/IMPLEMENTATION_REVIEW_2026-10-14.md). Historical evidence below retains its original version and limits.

# Version 0.8 review follow-through

The holistic review recommendations are implemented below. Native platform verification remains a separate evidence gap: Linux checks cannot establish Mac/Windows GUI, physical GPU, smartcard or distribution-signing behavior.

| Review finding | Change | Verification |
| --- | --- | --- |
| Failed reads could replace workspace metadata | Restore metadata only after mutations; preserve read failures verbatim | Invalid coordinate, terrain and query reads preserve the complete snapshot/revision |
| Nested SI file scopes could widen | Intersect canonical roots; select the narrower nested root and reject disjoint roots | Direct scope tests and real MCP-to-assistant HTTP tool fixture |
| Canonical records could disagree with derived SQLite indexes | Stream-validate attributes, FTS content/integrity, conservative RTree footprints and authored index definitions | Tampered attributes, FTS, RTree and index definitions fail open without changing source bytes |
| Unsaved work lacked guards/recovery | Dirty/source tracking, Save/Discard/Cancel, WAL metadata checkpoint, private recovery descriptor and lease | Browser Save/Discard/Cancel; real killed subprocess recovery; active-session lease exclusion; post-checkpoint deletion reconciliation |
| Map loading retained all images and blocked workspace work | Eight-tile async GUI pages, one 4096px viewport canvas, released tile images, global download bound, detached network I/O | All 64 local fixture tiles load, one raster mesh, repeat/offline cache reuse, slow network concurrent with snapshots, cancellation during body read |
| Dense proximity could perform uncapped skipped work | Count every candidate visit, exact single-entity short circuit, more inner-loop cancellation | Dense 20k single-entity input has zero pair work and exact empty result; existing brute-force GIS analysis oracle |
| Selection rebuilt full statistics | Separate dataset/selected histogram caches; skip statistics until requested | Cache-build counters remain stable on selection; compact snapshot omits statistics |
| Automatic certificate caches could reuse a previous identity | Rotate automatic online session scopes and reset metadata; explicit offline reuse; confirmed-anonymous Mac reuse | Scope restart/reset/offline tests; physical identity/PIN behavior still needs hardware |
| Agent contracts and IDs could drift | Authoritative command registry, structured errors, Rust-derived resource schemas, generated frontend contracts, nested job/batch validation, exact saved-context IDs | Compiler negative fixtures, schema drift check, typed error tests, output-contract validation, real CLI/MCP tests |
| Release verification depended on unavailable platforms/runners | Local cross-platform validation script, updated Mac handoff, manual-only workflows | Local core/frontend/browser/native Linux checks; no GitHub runner usage |

All four views support wheel zoom, +/− buttons and +/− keys. Close Globe zoom adjusts clipping and glyph size to altitude. Camera completion requests regional imagery/terrain and refines a bounded representative packet within the original filters. Browser QA demonstrates an event omitted from a 26,000-row overview becoming visible after zoom. This is regional refinement, not an exhaustive visual representation: backend query/selection remain the exact evidence interface.

The refactor creates focused modules for recovery, store validation/summaries, command/error identities, API DTOs/output schemas and raster streaming. The engine and frontend orchestration files remain substantial; further splitting should follow stable responsibilities and measured needs.

Remaining boundaries include memory-backed bounded Excel parsing, global terrain/tile pyramids, dateline-crossing WMTS viewports, general CRS reprojection and full-corpus streaming analysis. The 50-million-row ingest ceiling is a resource limit, not a tested workload. Recovery does not replace backups, and jobs/idempotency keys remain bounded session-local facilities. Legacy internal errors still use strings behind the structured adapter. Native signing/notarization and hardware checks require the appropriate OS and credentials; they are not certified by software-renderer tests.

See [validation evidence](VALIDATION.md), [architecture](ARCHITECTURE.md), [CLI/MCP](CLI-MCP.md), [map loading](MAPS-WKT.md), and [Mac handoff](../MAC_HANDOFF.txt).
