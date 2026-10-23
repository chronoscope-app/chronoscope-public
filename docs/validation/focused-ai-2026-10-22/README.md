# Focused AI assistance — 2026-10-22

Developed and validated locally in `chronoscope-app/chronoscope-next` from main `148cdb9`. No GitHub-hosted runner was used. Public promotion remains explicitly gated by the user.

**Explain result** is available on current Patterns findings and saved Results. The model receives one bounded, completed result with engine-computed values, scope, preparation and caveats. For small models, the inference input omits revision/storage bookkeeping and labels common quantiles directly; the original engine evidence remains available in the dialog. AI prose does not replace the calculation.

**Suggest tags…** is beside Tags / Add tag in Inspect, for 1–25 selected Events. Users choose one source field and one provider, review editable suggestions against each source record, then explicitly apply accepted rows. Blank source text is skipped; overlong source text fails explicitly. Apply preserves existing tags, deduplicates additions, rejects stale revisions/workspaces, commits atomically and supports one Undo.

Both features offer explicit Apple-on-device or connected-provider selection, a generic spinner/live status, disabled generation controls while busy and Cancel AI. No silent fallback, chat history, action tools or automatic edits are involved. SI Chat remains available for connected model services.

Local verification passed:

- 92 targeted Rust tests: library 50, analytics engine 8, assistant aggregation 18, focused AI 4, pattern scan 6, SI chat 6. The focused tests were rerun after the final input/prompt refinement.
- Production TypeScript/Vite build, generated contracts/help consistency and validation-suite inventory.
- Five focused browser checks using the real Rust engine and a deterministic loopback model: processing/cancel, editable review/apply/Undo, explanations, evidence/chat isolation and stale-preview rejection. No public requests.
- Eight Patterns browser checks and nine connected SI Chat browser checks. The Patterns suite now opens the current time-range popover before using Full range.
- Five native checks using actual stdio MCP attached to the running Mac app, real Apple Intelligence and native WebView captures. Verified provider discovery, on-device tag generation, additive apply/Undo, explanation generation, busy state, cancellation and blank-record review. No computer control was used.
- Native debug app bundled, ad hoc signature verified and updated app launched with a disposable QA profile. It remains open for inspection.
- Clippy passed with only the four previously recorded lint categories in unchanged `src/gis/vector.rs` exempted. See the earlier [baseline record](../apple-chat-retirement-2026-10-22/README.md). No GIS behavior was changed.

The native test exercises a synthetic coastal-survey note in the bundled hurricane demo and a recorded median result. This is a functional and bounded quality check, not a guarantee of model wording for every dataset. Connected-provider validation uses a local fixture; no live paid service was required.

See [structured results](report.json). Local logs and screenshots are under `.qa/focused-ai/`; the reproducible native script is `scripts/native_focused_ai_qa.py` and its setup is described in [the feature guide](../../APPLE-SI-ANALYTICS.md).
