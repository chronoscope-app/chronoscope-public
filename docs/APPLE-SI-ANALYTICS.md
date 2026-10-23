# Focused AI assistance

Apple Intelligence is available through **Explain result** and **Suggest tags…**, independently of SI Chat. SI Chat continues to accept connected OpenAI-compatible model services only. Native App Intents remain separate.

## Explain result

Choose **Explain result** on a completed Patterns finding or in **Results**. Select **Apple Intelligence · On this Mac** or the explicitly connected SI model, then generate. The dialog shows an indeterminate spinner, a live AI status, and **Cancel AI** while running. It displays the explanation as AI-generated prose beside expandable engine evidence. Computation, counts, methods and source revisions remain the engine's responsibility. Generated wording can still be wrong; verify it against the recorded evidence.

Patterns must still match their captured data/filter scope. Saved analyses retain their source version and exclusions; the dialog identifies explanations of earlier results. The model receives one bounded result, without chat history, tools, or a workflow-planning task. Large summaries are explicitly excerpted and labelled; oversized evidence fails instead of silently overflowing model context.

## Suggest tags

Select **1–25 Events**, open **Inspect → Suggest tags…**, and choose Analyst note, Event label or an imported text/mixed field. Choose the provider and generate. Inputs are explicit IDs at the captured revision; no records are silently sampled. Each source text is limited to 4,000 UTF-8 bytes. Missing/blank text is skipped, and overlong text produces a clear error. Each Event is processed independently to avoid mixing topics across records.

Review each source record and its editable comma-separated suggestions. Uncheck unwanted rows, then **Apply accepted tags**. Tags are normalized, bounded and deduplicated; existing tags are preserved. All accepted additions commit atomically as one undoable operation. Workspace changes or stale revisions reject the apply. Generation and cancellation never edit records.

The Apple path uses Foundation Models guided generation and the content-tagging model, with fresh sessions and at most three suggested topics. Connected models receive simple, tool-free requests and must return a validated JSON object. Provider failure never triggers a silent cloud/local fallback. Disconnecting or changing the connected SI session invalidates its pending response. Cancelling a connected request stops waiting immediately; the already-sent service request can finish within its transport timeout, and no result is applied.

## Shared CLI/MCP interface

- `assist_status {}` lists actual providers, availability and the 25-Event batch limit.
- `assist_explain {provider,source:{kind:"pattern",scan_id,finding_id}}` explains one cached finding; use `source:{kind:"analysis",result_id}` for a saved analysis.
- `assist_tags {provider,ids,field,expected_revision,expected_workspace}` generates reviewable suggestions. `field` is `note`, `label` or `attribute:EXACT_NAME`.
- `assist_tags_apply {items:[{id,tags}],expected_revision,expected_workspace}` adds reviewed tags, preserving existing ones.
- Use `job_start` with `assist_explain` or `assist_tags`, followed by `job_status`, `job_result`, `job_cancel` and `job_release` for asynchronous progress and cancellation.

`provider` is explicitly `apple-local` or `connected`. Neither task enters SI Chat history or obtains record-edit/external tools. Credentials remain in the existing session-only SI connection.

The attached native desktop additionally supports `assist_ui` with the fixed actions `open-explain`, `open-tags`, `generate`, `cancel`, `status` and `close`. Opening an explanation requires `source:{result_id}` or `source:{scan_id,finding_id}`; generation requires an explicit `provider` and can choose a tag `field`. Status reports the actual dialog's busy indicator, explanation and review-row count. It accepts no arbitrary DOM selectors or scripts. Use `view_capture` to inspect the actual native window, and `assist_tags_apply` separately for reviewed edits.

## Local verification

`cargo test --test focused_ai` covers provider isolation, blank inputs, bounded/validated output, additive/atomic apply, stale revisions, workspace conflicts, Undo and prompt cancellation. `npm --prefix frontend run test:focused-ai` uses the real Rust engine and a loopback model fixture to exercise actual controls, processing indicators, review, cancellation, evidence and stale-preview protection. Native MCP checks separately exercise the actual Apple model and WebView. Fixture success does not establish a hosted model's reasoning quality.

Historical `docs/validation/apple-*` reports refer to earlier integrations. Develop and validate in `chronoscope-app/chronoscope-next`; promote to `chronoscope-app/chronoscope-public` only after explicit user authorization.

For a real on-device check, launch a local debug build with a disposable `CHRONOSCOPE_DATA_DIR`, enable that profile's agent connection, then run:

```sh
CHRONOSCOPE_CLI=target/debug/chronoscope python3 scripts/native_focused_ai_qa.py --data-dir .qa/focused-ai/native-profile
```

The script replaces the QA workspace with the bundled hurricane demo and synthetic analyst notes. It uses actual stdio MCP, Apple inference and native WebView captures, verifies additive apply/Undo, and drives busy/cancel states through `assist_ui`. Reports and PNGs are saved under `.qa/focused-ai/native/`. Use a dedicated QA profile, not personal data.
