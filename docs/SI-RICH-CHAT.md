# Detachable SI chat and rich results

Open **SI** on the toolbar. **Pop out SI chat** (the ↗ control) moves the conversation into a separate desktop window; move or resize it like another app window. **Dock** returns it to the main inspector. Closing the detached window also restores docked chat. The conversation, draft and current request belong to the existing Rust engine. Changing windows or reloading the chat page does not replay a request or stop its worker. Closing the main application ends its session.

The detached entry is `si.html`; it does not create or load another Cesium viewer. The main window remains the sole map renderer. Chart and Markdown modules load on demand. Native windows use the same engine through Tauri IPC; browser preview uses the same authenticated Rust bridge and same-origin workspace messages.

## Inline content

- Assistant answers support Markdown headings, emphasis, lists, tables, code, HTTP(S) source links and display equations enclosed by `$$` on their own lines. Source links open in the system browser on desktop. Raw service HTML and remote Markdown images do not become app content.
- Rust analytic results appear as inline cards with counts, findings, warnings, tables, interactive bar/line/scatter charts and a link to the complete Results window. SI can choose a chart using actual result-column names. The model cannot supply chart code or replacement calculated values.
- Hover plots for values. Larger plots have a zoom slider; Ctrl-scroll zooms the plot while ordinary scrolling moves the conversation. Exact Event rows and plot points can select their source Event in the main workspace and attribute table. Staleness is rechecked before selection. Group/preparation rows have no invented Event identity.
- **Capture map** adds a snapshot of the current main view. SI can also request a map snapshot through its presentation tool when attached to a live desktop. Captions retain workspace, capture time and source revision; these are snapshots, not live map widgets. Images retain renderer/map credit text. They are reduced to at most 1600 × 1200 pixels for inline display.
- Existing query, aggregate, descriptive-statistics and pattern tools can attach compact read-only evidence previews. These previews show up to 20 rows. Large or wide previews are omitted explicitly; use projected queries or the original analysis tools for detail.

Pixels are stored in Rust, outside the model's conversation context. Showing a picture in chat does **not** give the configured model visual perception. Capturing a view does not send its pixels to the SI service. Requested source records/tool results still follow the existing provider and external-tool grants.

## Agent interface

`present_result` (`chronoscope_present_result` in MCP) is a public presentation operation, distinct from SI connection/session management. It accepts either an existing analytic result or a live map capture:

```json
{"kind":"analysis","result_id":"<64-character result ID>","chart":"bar","x":"group_0","y":"mean","title":"Annual measurements"}
```

```json
{"kind":"map","title":"Current Atlantic tracks"}
```

Analysis charts support `auto`, `table`, `bar`, `line` and `scatter`. Explicit chart types require actual `x`/`y` columns; scatter requires numeric coordinates. Empty, absent or unsuitable columns fail validation. Auto/table presentations use engine metadata and do not accept replacement axes. Map presentation requires an attached desktop renderer. Tool output carries a compact presentation reference, not raw image bytes. The same operation is discoverable by connected SI model services. Analytic runs attach their own result cards automatically.

To put a result in the running app from the CLI, use its attached engine: `chronoscope --attach call present_result --args '{"kind":"map","title":"Current view"}'`. A standalone CLI process has its own session and does not add cards to an unrelated desktop session. During an active chat request, explicit presentations are queued for its reply; completed cards remain available even if the service subsequently fails to write its explanation.

`si_chat_state`, `si_chat_send`, `si_chat_draft`, `si_chat_attach` and `si_chat_image` are internal UI/session endpoints. They are not advertised as model tools or MCP tools. In particular, SI cannot recursively submit chat requests, change its service connection, clear its own conversation or grant itself additional permissions. Existing `si_run` and CLI/MCP agent workflows remain available. Direct CLI SI conversation turns also appear in chat.

A send has a caller-generated request ID and is deduplicated by prompt/permission fingerprint. Reusing an ID for different content fails. Only one chat request is active. Worker completion records the result even with no chat window, then releases its transient job payload. An expected session prevents a queued request from using a subsequently changed connection or cleared conversation.

## Scope, lifetime and budgets

Chat remains session-only. **New chat**, changing/disconnecting the provider and app exit clear the applicable conversation. Initial connection preserves an unsent draft and pre-connection captures. Reopened chat windows retrieve messages and image references from Rust; messages are not stored in browser localStorage or a project file. Saved analytic artifacts still travel with `.chronoscope` projects independently of chat.

The UI retains up to 64 messages/2 MiB of display text and metadata, with explicit text excerpt markers. This display limit is separate from the provider's model-history/context rules. Each response attaches at most eight rich blocks. Image storage holds at most 12 PNG previews/32 MiB total and evicts the oldest if necessary. An expired image shows an unavailable notice rather than capturing a different scene under the old caption. Incoming images have encoded, pixel and decoder-allocation budgets; external URLs/SVGs are not accepted as snapshots.

Inline charts fetch at most 2,000 retained output rows, and tables preview at most 50 rows. The card labels this display subset and the Rust input/evaluated/excluded counts separately. Plot limits do not sample the calculation's input. Open the full result to page through retained output and inspect its parameters, scope and source revision. A removed result, different project or unavailable map renderer produces an explicit unavailable state.

Formatting uses Marked, DOMPurify and KaTeX. Charts use modular Apache ECharts with Canvas rendering and rich-text tooltips. Presentation specs are app-authored options built from validated field names; the model cannot inject executable options, HTML controls, script URLs or remote tracking images. Native chat navigation is restricted to the fixed bundled page (or configured development URL); source links use a separate HTTP(S)-only opener. Closing the chat window does not clear the renderer observer or shut down agent access.

## Verification

`cargo test --test si_chat` tests worker completion without a UI, request deduplication/conflicts, drafts, model-history isolation, job release, session changes, native map-request plumbing, PNG validation/thumbnail budgets, rich-result contracts and direct CLI turn visibility. The wider suite covers the shared SI permissions and engine behavior.

After building the CLI/frontend, `npm --prefix frontend run test:si-rich-chat` runs two actual browser windows against the Rust engine with a deterministic local mock service and bundled hurricane data. It exercises dock/pop-out/reload/close while work is running, rich results, equations and hostile formatting, live map capture, linked Event selection, both themes, cancellation and clearing. It applies the desktop content-security policy and asserts no public HTTP requests and no Cesium resources in the detached page.

Browser tests do not establish native macOS WindowServer behavior or a connected model’s planning quality. On a supported Mac, manually check native pop-out/dock, closing with unsaved project changes, moving to another display and system-browser links. Apple Intelligence is retired as an SI Chat provider.
