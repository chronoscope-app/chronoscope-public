# Chronoscope branding — local verification, 17 October 2026

The desktop bundle, window/title, toolbar, About/help, CLI, generated MCP
registration and default profile/document paths now use Chronoscope. The macOS
bundle is `Chronoscope.app`, identifier `org.chronoscope.desktop`; the MCP server
and generated client registration are `chronoscope`. The UI package is
`chronoscope-ui`. Current installation and CLI documentation uses the main
historical development repository (not included in this clean snapshot) and the renamed app.

CesiumJS remains the renderer and is credited explicitly in About. CesiumJS,
other dependency licenses and provider/data credits remain packaged locally.
The legal inputs and icon assets were unchanged. Historical validation records
retain the names and paths used when their evidence was collected.

## Migration

Default-profile launches import the former Cesium profile and automatic document
copies once. A private staged copy is published only after completion; active
workspace leases prevent migration. Earlier destination data is moved aside,
old files remain available for absolute asset references, and session-only
connection descriptors are regenerated. App-owned agent scopes are rebased;
explicit `--data-dir` profiles remain unchanged. Existing external MCP clients
need regenerated setup because their executable path/registration has changed.

On this Mac, all three preferences/map-server/agent-settings file hashes matched
after migration, permissions remained private (agent settings 0600), and all 36
existing automatic documents were present at the new location. A subsequent
build/launch retained the migrated profile.

## Checks completed locally

- Strict TypeScript/Vite production build and macOS release bundle build/launch.
- Rust formatting and core Clippy checks; 28 library tests, 6 identity/agent
  integration tests and 4 autosave tests passed.
- All 33 Cesium workflow/rendering checks, 5 recovery-notification groups and
  5 map/provider/credit groups passed without public map requests.
- The actual bundled desktop executable passed headless CLI/MCP setup, argument
  quoting, discovery and query checks.
- Live native MCP initialized as `chronoscope`, discovered 86 tools, queried the
  192-event workspace, read view status and captured its canvas through the CLI.
- Native UI inspection confirmed the app/window/menu names, toolbar, canonical
  autosave folder, generated MCP JSON/command, and About's CesiumJS license text.

Native verification here is macOS; Windows/Linux native packaging was not run.
GitHub Actions remains manual-only; no hosted workflows were dispatched.
