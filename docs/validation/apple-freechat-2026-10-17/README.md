# Apple Intelligence free-form chat — 2026-10-17

Built and verified locally on macOS 27.0.1. No hosted workflows were dispatched.

The on-device provider now uses a normal Foundation Models conversational session. Analysis-only routing, the 400-character UI limit, 220-token explanations, forced greedy generation, and fixed local turn/excerpt limits are removed. Requests carry actual user/assistant transcript turns and a compact live workspace summary. The native model's reported context capacity is used instead of a hard-coded 4,096. This Mac reported 8,192 tokens.

Older complete turns and optional workspace context are omitted as needed to fit the model; the current prompt is never excerpted. Generation uses Apple's default output length. Transport memory bounds, cancellation, platform availability and Apple's own model constraints remain. Local chat has no action tools or cloud fallback; deterministic analyses and App Intents remain available outside conversational inference. The hosted provider retains its existing permissions and history behavior.

Verification passed:

- 25 targeted Rust checks for local history, assistant permissions/history/cancellation and deterministic analysis helpers.
- Seven actual native bridge cases: availability, creative chat, follow-up memory, input over 400 characters, a 458-word answer, context rollover retaining the latest turn, and an oversized prompt reported against the actual Apple token capacity.
- Six SI interface groups with the real Rust bridge and Apple model: gear setup, general creative chat, longer input and follow-ups, workspace context, New chat and Stop. Zero public requests and zero browser errors.
- Release macOS bundle built and ad hoc signature verified. Attached CLI chat accepted a 20,931-character prompt, remembered a follow-up and cleared its memory. The native SI pane is open and connected, with an empty focused input for user testing. The Atlantic hurricane workspace remains loaded.

Windows/Linux Apple model execution was not tested; the provider remains unavailable there. No GitHub release assets were replaced.
