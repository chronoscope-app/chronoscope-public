# Built-in SI (Super Intelligence) and event aggregation

## Connect a service

1. Open **SI chat** at the top of the app.
2. Enter an **OpenAI-compatible Chat Completions** service base URL (usually ending in `/v1`), the model name, and an API key if the service requires one. A complete `/chat/completions` URL also works.
3. Choose **Connect**. Setup closes and opens **SI chat** in the lower-right inspector, beside the scene. Send a message there; the first message verifies service compatibility. Enter sends, Shift+Enter adds a line break. Close/reopen chat without losing this session’s conversation. Connection settings and Disconnect are available from the chat gear button.

The service/model must support function tools. OpenAI and compatible gateways/local servers use this protocol. Other providers' native protocols, including native Anthropic Messages and Gemini, need an OpenAI-compatible gateway. Custom Azure query-string deployments/Responses-only endpoints are not supported. HTTPS is required except for localhost services. Credentials in the URL, query strings, URL fragments and redirects are rejected. Official OpenAI requests use `max_completion_tokens`; compatible services use `max_tokens`. Each response has a 2048-token allowance; model/context/pricing compatibility depends on your service. No live paid provider was used during validation; a localhost scripted HTTP fixture verified real tool execution.

The key stays in process memory until disconnect or app exit. It is never written into the local configuration, logs or `.chronoscope` files. Reconnect after restarting the app. Endpoint and model are stored only on this computer. Conversation history stays in memory: at most 32 messages and 96 KiB, evicting oldest complete turns. Long answers are explicitly truncated in history. Only user messages and final answers are remembered, not full tool results. Every turn receives current workspace metadata and can re-query evidence. **New chat**, reconnecting, disconnecting or app exit clears the conversation. Failed/cancelled turns are not added to provider history; completed actions can still remain. Conversation and keys never enter projects, logs or recovery files.

Your prompt and requested tool results are sent to the service, which may retain data or charge for usage according to its terms. Keep private datasets on an approved/local service. This is a functional data-sharing choice, not a blanket promise about provider privacy.

## User certificates and CAC/PIV authentication

HTTPS SI services use native client-certificate authentication by default on macOS and Windows. Enter the API address/model and connect normally; the first chat request can trigger a TLS certificate challenge. The OS selects an eligible identity, with a certificate chooser on macOS if needed; the OS/card provider handles PIN access. SI uses the same native authentication mechanisms as WMTS, with its own session and no map cache. API-key authorization remains available alongside client certificates.

**SI settings → Client certificate** offers an optional specific identity or a no-client-certificate override. On Linux, automatic token selection is not implemented: protected endpoints need a PKCS#11 certificate URI and compatible installed curl/provider/card middleware with GUI-capable PIN handling, as for WMTS. Select **Specific identity** and enter a URI such as `pkcs11:token=My%20Card;id=%01;type=cert`. Windows overrides use `CurrentUser\MY\` plus the 40-hex certificate thumbprint; macOS overrides use the unique Keychain certificate subject name. Reader/middleware and trusted issuer chains must already be installed. The authentication certificate must be usable for TLS client authentication.

Overrides are bound to the exact HTTPS scheme, host and port, stored only in local SI connection settings, and excluded from projects. Changing the service origin clears an existing override in the UI. Reconnect or disconnect to discard the SI session's native certificate choices. Private keys and PINs stay with the OS/card provider. Chat data and bearer tokens are passed to native transports through bounded pipes rather than process arguments or files. Requests retain the 1 MiB response bound, timeouts, cancellation and no automatic retries; SI never follows redirects or falls back to anonymous access after native authentication fails. Server TLS verification remains enabled. A browser-based SAML/OAuth portal is not an API TLS certificate challenge and is not supported by this feature. On macOS, `CHRONOSCOPE_SI_NO_UI=1` disables Chronoscope's multiple-certificate chooser; card middleware may still require PIN interaction.

The Linux curl POST path is verified against a local server requiring a throwaway client certificate, without changing OS trust stores. Native macOS/Windows selection and real CAC/PIV reader/PIN behavior require verification on the target systems; Linux tests do not establish those platform/hardware results.

## What the assistant controls

By default: schema/record queries, exact aggregates, pattern analysis, coordinate conversion, filters, selections, views and selection groups. It can operate the app through the same shared Rust engine used by CLI and MCP. It does not spawn CLI processes or run shell commands itself. Host-configured outbound MCP servers can supply additional explicitly granted tools; local stdio servers are programs launched by the host after the user configures them. See [MCP client integration](MCP-CLIENT.md).

Enable **Allow record changes** for a request to permit editing, deletion, reassignment, undo/redo and workspace aggregation. Save a copy before changing valuable data. Expand **Permissions** in chat and choose **Allow folder…** only if you want to permit open/import/save/export and terrain loading inside that folder. The folder is checked by the same canonical path/scope rules as MCP. No folder means no SI file operations. The folder grant lasts for this connection; Remove access revokes it without resending an API key. Connecting never requires a folder. Assistant tools cannot change credentials, authentication profiles, their own permissions, or launch nested SI requests. Controls limit permitted operations; they do not guarantee that a model interprets a request or dataset correctly.

Requests have one active slot per engine, default 8 model steps (CLI maximum 16), 32 tool calls total, at most 8 parallel proposals executed sequentially per response, a 256 KiB conversation budget, 1 MiB service response cap, and bounded/truncated tool results. The app makes no automatic retries. A five-minute cooperative deadline cancels tools; network calls time out after at most 60 seconds. **Stop** prevents the next tool action and interrupts cooperative operations; an in-flight HTTP request can take up to its remaining timeout to return. Completed actions remain, and ordinary data edits can be undone. The tool outcome list records which operations completed. Granted external action tools additionally require `allow_external_actions:true`; the UI resets both change permissions after sending. External effects are outside app Undo and filesystem scope. A failed request may have completed earlier operations: inspect the workspace before retrying.

## Automation

These commands are discoverable with `chronoscope schema`, CLI `call`/`session`, and MCP `chronoscope_<name>` tools:

- `si_status`: nonsecret configuration, whether a session key is present, and running state.
- `si_configure`: `url`, `model`, optional `api_key`, optional filesystem `root`, optional `client_certificate` (`null` for automatic/default; otherwise `{origin, kind, identity}` with the same identity kinds as WMTS).
- `si_run`: `prompt`, optional `allow_edits` (false), optional `max_steps` (8).
- `si_permissions`: required `root` folder, or `null` to revoke; no reconnection needed.
- `si_history`: read bounded session messages; `si_clear`: forget conversation without undoing actions.
- `si_cancel` / `si_disconnect`: stop; disconnect also drops the session key and history.
- `space_time_aggregate`: read-only exact counts and bounded representatives.
- `aggregate_apply`: replaces the entire workspace with summaries of matched records; undoable, guarded with `expected_revision`.

For persistent CLI use, keep configure/run in the same `session` process, or use `--connect` to target a running desktop. A one-shot configure command exits and therefore forgets its key. Avoid placing keys in shell history or process arguments: pass protected input files or stdin to `session`, or use `call si_configure --args-file ...` when connected to the desktop. Keys are not included in output. MCP clients can configure/run within their persistent session. Enabling external desktop MCP access is separate from using the built-in SI chat. New discovery advertises `si_*` commands. Legacy `ai_status`, `ai_configure`, `ai_run`, `ai_cancel` and `ai_disconnect` spellings remain callable for compatibility, including through MCP and background jobs; new integrations should use SI. Proper provider names such as OpenAI and protocol roles such as `assistant` retain their standard spelling. Historical validation bundles preserve their original terminology and hashes.

Example request in a CLI session (with a previously configured connection):

```json
{"id":"ask","command":"si_run","args":{"prompt":"Select the events for entity A, then switch to the map","allow_edits":false}}
```

For short tool timeouts, `job_start` accepts `command:"si_run"`; poll `job_status`, retrieve `job_result`, then `job_release`. Cancel with `job_cancel` or `si_cancel`.

## Aggregation semantics

In the import dialog, expand **Aggregate during import**, enable it and set window minutes/radius metres. CSV conversion streams bounded batches into disk-backed groups before the main record/attribute/search/spatial indexes are populated. Excel retains its existing workbook input limit. Aggregation reduces retained records and storage, not bytes read from the original file. Both source formats share the same grouping implementation.

On a loaded workspace, choose **Aggregate** above the canvas. Preview exact counts, review the replacement checkbox, then create summaries. This replaces *the entire current workspace* with summaries of the matched/visible records; hidden records, old selection, saved views and groups are excluded. Session undo restores the previous workspace, within replacement-history limits. Save the original as a separate workspace/source first.

Rules:

- Windows are half-open, UTC epoch-aligned buckets. A 15-minute window covers 10:00 through 10:14, then 10:15 through 10:29. Group membership uses start timestamps; an interval's end may extend beyond the bucket.
- Groups are separate for each entity, category and source layer.
- An event joins the earliest created anchor within the requested **WGS84 ellipsoidal** distance. This works at the dateline and poles. Every member is within the radius of the anchor; members can be up to twice the radius apart. Groups are not transitive clusters.
- Grouping depends on processing order: source file order during import, chronological order for a loaded workspace. The same rules do not guarantee identical groups with different orderings.
- Location, original attributes, tags, note and source row come from the first anchor. They are representative values, not claims shared by all members. `time` becomes earliest start, `end` latest constituent end, and `value` the arithmetic mean of nonempty numeric values.
- `chronoscope.aggregate.*` attributes store constituent/numeric counts, anchor time, window/radius and last source row. Individual raw member rows/IDs are discarded. Retain your source to recover them. Existing summaries are rejected as aggregation input to prevent silently counting summaries as raw events.
- Unknown locations are never assigned to spatial groups. They remain separate records. Cancellation/failure leaves the original workspace intact.

CLI/MCP import example: add `"aggregation":{"window_minutes":15,"radius_m":100}` to `import_commit` along with its preview ticket. The response separates `accepted` source rows, `retained` records and the reduction `aggregated`. `space_time_aggregate` accepts the same `aggregation` object plus normal `filter`, `apply_filter`, `source` and a bounded `limit` of representatives; counts cover all matches.

## Time-only triangles

Circles have observed coordinates. Triangles have time but **no observed coordinates**. When visible located events of the same entity and source bracket the timestamp, the app displays a triangle at the corresponding time fraction along the shortest WGS84 geodesic. The route and assumed speed are estimates, not a measured position. A tooltip and inspector explain this distinction; triangles have no observed-location ground stem.

Nearest anchors are looked up in the exact filtered data, independently of representative LOD points. Filters that hide needed anchors also hide the inferred marker. Events without both anchors, or with ambiguous antipodal routes, stay available in the table/timeline. Large scenes still use representative marker/trail budgets. Actual coordinates stay null in records, exports and saved workspaces, and are excluded from location-dependent analysis and spatial predicates. Renderer payload metadata identifies inferred IDs and bracketing events.

The CLI also supports `chronoscope --connect /path/to/agent-connection.json ask "your request" [--allow-edits] [--max-steps 8]` against the app's configured session. For a one-shot import, use:

```sh
chronoscope import busy.csv --aggregate-window-minutes 15 --aggregate-radius-m 100 --output summary.chronoscope
```

## Apple on-device tools and deterministic analytics

Apple SI now uses the same permitted workspace operations through native Foundation Models tool calling. Schema-aware Rust analytics calculates full-scope descriptive statistics and optional correlation; the model chooses operations and explains results. No Python runtime is required. See [Apple SI analytics](APPLE-SI-ANALYTICS.md) for operations, grants, limits and Mac checks. Hosted history limits in this document do not describe the Apple model’s context-based history.
