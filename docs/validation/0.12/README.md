# 0.12 local validation

`validation.json` records the release's local checks; `logs/` retains their output. `source-files.json` hashes implementation, build inputs and tests. Browser fixtures run the actual Rust bridge and renderer, with no live model or public WMTS traffic. Native checks apply to Linux only; software WebGPU/WebGL2 does not establish physical GPU performance or Mac/Windows runtime behavior. No GitHub runners were used.

`si-client.json` records current and legacy HTTP MCP interoperability, action gating and error handling. Rust integration tests use an actual managed Chronoscope stdio child and verify grant revocation, session-only state, private connection controls and shutdown. The SI browser also rejects 128 external grants plus domain tools before contacting its scripted model, enforcing the combined provider-function budget.

`wkt-wmts.json` records all 64 planned fixture tiles, cache/offline reuse, two independently configured sources, alpha/opacity blending, automatic zoom handoff, portable save/reopen, and view-centre zoom at the dateline. It also verifies a combined imagery texture on real bundled DTED and clearing imagery while preserving terrain, through GUI and agent-style terrain reconciliation paths.

Screenshots:

- `multi-server-layer-settings.png`: per-layer controls and zoom rules.
- `multi-server-dted-drape.png`: **synthetic WMTS tile colours** draped over real bundled public DTED, at 4× vertical exaggeration. This checks placement/compositing, not real street-map detail.
- `mcp-tool-grants.png`: explicit query/action tool grants.
- `si-external-mcp.png`: SI using the scripted external service.

Earlier verification exposed an obsolete single-map error-message assertion, an async map-load timing assumption, an incorrect world-sized capture frame, a missing clear on the terrain reconciliation path, and a test helper that obscured structured errors. Those were corrected before the retained final release checks. A final review also added explicit managed-child termination at desktop exit and a combined local/external function budget. During overlapping map loads/cancellation, the development HTTP bridge can log `NOT_FOUND` for an already released page job; these caught cleanup races do not surface as UI failures. No native macOS/Windows, hardware smartcard, paid model, signing or notarization result is claimed.
