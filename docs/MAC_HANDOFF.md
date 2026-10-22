# Chronoscope on a Mac

Chronoscope uses CesiumJS WebGL2 for its geographic views. The installed app is
**Chronoscope.app**, with bundle identifier `org.chronoscope.desktop`.

## Build locally

Install Xcode 27 or newer, Rust 1.90 or newer and Node.js 22 or newer. From this
repository:

```sh
npm --prefix frontend ci
cargo build --locked -p chronoscope --bin chronoscope
node scripts/generate_contracts.mjs --check
npm --prefix frontend run tauri -- build --bundles app,dmg
```

Install `target/release/bundle/macos/Chronoscope.app` in `~/Applications`.
The installed app needs neither Rust nor Node. Signing/notarization uses your
Apple identity; local unsigned builds follow normal macOS trust behavior.
Run verification locally. GitHub Actions remains manual-only.

CesiumJS workers, assets, styles, codecs and license notices ship locally.
No CDN or ion account is required. WMTS requests, native certificate handling
and caching use the Rust pipeline. Provider credits remain accessible through
the map attribution control and exported screenshots.

## Settings and automatic document copies

| Platform | Default data directory |
| --- | --- |
| macOS | `~/Library/Application Support/org.Chronoscope.Chronoscope` |
| Linux | `$XDG_DATA_HOME/chronoscope`, normally `~/.local/share/chronoscope` |
| Windows | `%LOCALAPPDATA%\Chronoscope\Chronoscope\data` |

Automatic document copies use `Documents/Chronoscope/Autosaved`.
On first launch, existing settings, recovery checkpoints, assets and automatic
copies from the former Chronoscope Cesium folders are imported once. Close the
earlier app first. Migration stages a complete copy before publishing it and
keeps the earlier folders for saved absolute asset references. If an older
original-renderer profile already occupies the destination, it is moved to an
adjacent `Chronoscope-previous-*` directory. Later launches retain current edits.
Explicit `--data-dir DIR` profiles are never migrated or renamed.

## CLI and live MCP

The app executable is also the CLI/MCP launcher. No separate CLI download,
admin installation or shell PATH change is required:

```sh
"$HOME/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop" agent enable
"$HOME/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop" agent status
"$HOME/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop" agent config
"$HOME/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop" --attach call snapshot --args '{"compact":true}'
```

Preferences → MCP setup generates client JSON and a
`codex mcp add chronoscope -- ... mcp --attach` command using the actual installed
executable. MCP initialization identifies the server as `chronoscope`.
Tool names (`chronoscope_query`, etc.), resource URIs (`chronoscope://workspace`)
and portable `.chronoscope` files retain their existing contracts.
Regenerate earlier `chronoscope-cesium` client registrations after installing the
new app; their old executable/profile arguments are not rewritten in other apps.
The desktop regenerates its session-only connection descriptor automatically.
`--connect DESCRIPTOR` and `--data-dir DIR` remain explicit connection choices.

## Native verification

Check packaged WebKit/WebGL rendering, all-view navigation, file dialogs,
local DTED/imagery, autosave/recovery, SI and generated MCP setup on the rebuilt
app. Real WMTS smartcard/PIN behavior requires the user's card and middleware.
See [CLI/MCP](CLI-MCP.md), [renderer scope](CESIUM-PARITY.md) and the local
validation reports for the specific checks completed.
