# Live MCP automation and interactive results

These tools use the attached desktop on macOS, Windows and Linux. Native MP4
recording remains macOS 15+ only; telemetry, playback and scenarios do not require
video support. None of these tools provides arbitrary scripts, DOM access or
shell execution.

## Height selection and map reset

Use `chronoscope_view_set` with `mode:"globe", globe_altitude:true` for physical altitude, or `globe_time:true` and optional `globe_time_scale` for timestamp elevation. Each selection turns the other off; both false gives ground placement. Altitude leaves the Time Height slider visible but disabled and retains its scale. The CLI equivalents are `chronoscope --attach view height altitude`, `view height time --scale 2`, and `view height ground`.

`chronoscope_view_reset` requires `{"confirm":true}` and recreates map graphics while preserving Events, filters, selection, camera and saved workspace. The CLI equivalent is `chronoscope --attach view reset --confirm`. Missing/false confirmation is rejected, and no graphical modal appears after explicit API confirmation. Success returns `reset:true` and live status; failed recovery returns an error. Reloads may contact configured imagery providers. After a timeout inspect `view_status` before retrying; reset is intentionally excluded from saved recipes and atomic batches.

Altitude units/references, inspection fields, example demos and import/export contracts are described in the [CLI/MCP guide](CLI-MCP.md#globe-height-selection-and-altitude-0161). The tools/list contracts and generated frontend types share the Rust registry. Reconnect an existing MCP client after updating the executable to refresh its tool list.

## Performance traces

Start `chronoscope_view_profile` with `{"action":"start","max_seconds":30}`,
then use `{"action":"status","id":"…"}` or `{"action":"stop","id":"…"}`.
At most two traces run concurrently; eight sessions and 6,000 samples per trace
are retained. Completion removes the render listener. Samples include frame
intervals, CPU submission time, imagery/terrain loading, terrain-provider changes,
render errors and context recoveries. These are CPU measurements, not GPU timing.
Live `view_status` diagnostics also report `performance.updateRateLimitHz`: 10
after a scene settles, or null for full display cadence during interaction,
playback and loading. This describes update passes, not rendered FPS; rendering
remains on demand. CLI `--attach view status` exposes the same diagnostics.
Raw long intervals remain available and are included in the summary percentile.
Gaps over 250 ms are counted separately; they may be intentional request-render
idle periods or stalls. Correlate them with input and scenario timestamps.

Each MP4 automatically starts a companion trace and returns `profile_id` and
`profile_started_unix_ms`. Align trace samples with video using their Unix start
timestamps. A trace may cover startup/finalization around the video; it does not
claim a one-to-one match between Cesium renders and encoded compositor frames.
The video start timestamp uses ScreenCaptureKit's recording-start delegate,
rather than request time. Presentation alignment remains approximate and is
identified by `timestamp_basis`; it is not a hardware frame timestamp.

## Readiness and playback

`chronoscope_view_wait` waits for imagery, terrain, effects and enabled GIS layers
to settle. Defaults are a 10,000 ms deadline and 200 ms stable interval. Pass
`imagery:false`, `terrain:false`, `effects:false` or `gis:false` to exclude a
condition. Failure to settle is an error, not a successful visual assertion.

`chronoscope_view_playback` controls the actual UI clock. Actions are `status`,
`play`, `pause`, `configure` (speed and/or `increment_seconds`), `seek` (`time` in
UTC Unix seconds) and `step` (signed `steps`, from -100 to 100). Configure accepts
the same speed/increment choices as the visible menus. Seek/step pause first,
preserve the time-window width, and update the cursor; a seek outside dataset
time bounds is rejected. Repeated play or pause is harmless. These controls do
not edit Event values.

## Saved navigation recipes

`chronoscope_view_scenario` saves named recipes in the current app profile,
independently of datasets and data Undo. Example calls:

```json
{"action":"save","name":"Map zoom","steps":[{"command":"view_set","arguments":{"mode":"map","fit":true}},{"command":"view_wait","arguments":{"timeout_ms":10000}},{"command":"view_navigate","arguments":{"action":"zoom","factor":1.2}},{"command":"wait","arguments":{"milliseconds":500}}]}
{"action":"run","name":"Map zoom","timeout_seconds":30}
{"action":"status","id":"returned-run-id"}
{"action":"cancel","id":"returned-run-id"}
{"action":"list"}
{"action":"remove","name":"Map zoom"}
```

Recipes allow only `view_set`, `view_navigate`, `view_wait`, `view_playback` and
bounded waits. There are at most 16 recipes, 80 steps per recipe, a 512 KiB library,
and one active run lasting at most 120 seconds. Replacing a recipe requires
`overwrite:true`. List returns the saved steps for replay on another build.
Run returns immediately with a session-local ID and `profile_id`; terminal status
includes per-step timestamps, camera states and terrain/error diagnostics.
Workspace changes, cancellation and deadlines stop remaining steps; completed
navigation is not undone. A step already in flight can finish before cancellation
is noticed. Start video before running a recipe to capture the same movement.

## Resource subscriptions

Persistent stdio sessions (standalone or attached) support `resources/subscribe`
and `resources/unsubscribe` for `chronoscope://workspace`, `chronoscope://schema`,
`chronoscope://view`, `chronoscope://results` and `chronoscope://jobs`. Updates
arrive as `notifications/resources/updated`. A lightweight change token is checked
every 500 ms without acquiring the workspace operation gate. An initial
invalidation is sent, and later changes are coalesced; clients reread the resource
for current data. Notifications may invalidate several subscribed resources
together. They are not a frame stream, durable event log or guarantee of observing
every intermediate state. Subscriptions belong to one stdio connection and stop
on disconnect. The private attached HTTP hop does not itself expose SSE.

## Interactive external results

MCP Apps-capable clients can render `query` and `chart_data` using the static
`ui://chronoscope/explorer` resource (`text/html;profile=mcp-app`). Clients negotiate
`io.modelcontextprotocol/ui` with that MIME type during initialization; other
clients retain existing structured-data results without UI metadata. The viewer
sorts/searches the returned page, displays a bar-chart preview, and links row/mark
selection to real Chronoscope Events with workspace and revision guards. Other
chart kinds remain available as exact interactive tables.

The UI displays at most 1,000 rows/32 columns and previews 200 bar marks, with limits
disclosed; engine result counts/omissions remain authoritative. Imported text is
rendered as text. The viewer declares no external network/resource/frame domains,
uses the host's sandbox, and makes tool calls through the same MCP connection.
Actual rendering depends on host MCP Apps support. No report-package export is
added.

This implements the [MCP Apps interface](https://modelcontextprotocol.io/extensions/apps/overview)
and subscriptions for the server's negotiated 2025-era MCP protocol versions.

Playback Fade is an integer slider shared by UI, MCP and CLI: configure
`view_playback` with `fade_amount:0..100`, or run
`chronoscope --attach view fade 75`. Higher values retain less visible history
and shorten departing marker/track/stem afterimages. Maximum keeps roughly three
recent time slices while preserving simultaneous entities. Status returns
`fade_amount` and the compatible boolean `fade`; `view_set.playback_fade_amount`
stores the choice in scenes and saved views. Legacy false/true maps to 0/50,
and an explicit percentage wins if both are supplied.
