# Privacy and connections

Chronoscope is a desktop application that processes workspace data locally in Rust and SQLite. Connecting a map provider, SI service or external MCP tool can send information to that service. Review these choices before opening a sensitive dataset.

## What stays on your computer

- Imported records, saved views, charts, analysis results and dataset provenance are stored in your workspace and local application files. A portable `.chronoscope` project can contain the underlying records and imported assets; treat it as sensitive when sharing.
- Preferences, recovery checkpoints, automatic document copies and downloaded map data can remain on disk. The default profile and automatic-copy locations are listed in [the platform guide](docs/MAC_HANDOFF.md#settings-and-automatic-document-copies). An explicit `--data-dir` uses a separate profile.
- The engine writes a bounded local diagnostic log containing command names, times, revisions, durations and success/failure. That logger excludes record values, command arguments, tokens and paths. Other platform or external-service logs have their own behavior; review any log before sharing it.
- SI API keys and external MCP connection credentials are held in process memory. The SI provider address, model and optional client-certificate reference are saved locally; SI file-access grants are not restored from that settings file. External MCP connections and grants are not restored after restart.

Local storage is not a promise of application-level encryption. Protect your device, account, backups and exported files using appropriate operating-system controls.

## When information leaves your computer

| Feature | Recipient and information |
| --- | --- |
| Online maps | The selected map service receives requests for capabilities, map tiles or other resources. Tile requests can reveal the geographic area being viewed; the provider can also observe the connecting IP address and any authentication used. Streets uses OpenFreeMap/OSM by default. Bundled NASA Blue Marble is a coarse offline reference. |
| Hosted SI | Your configured SI provider receives your prompts, bounded conversation context, tool definitions and tool results used to answer the request. Results can include dataset records, attributes, summaries and filenames. Selecting a hosted provider is not a guarantee that your workspace data stays on-device. Provider retention and use are governed by that service's terms and your account settings. |
| Focused AI assistance | Explain result and Suggest tags use the provider explicitly chosen in their dialog. Apple Intelligence inference stays on-device, with no cloud fallback. A connected SI model receives only the supplied text or bounded result evidence for this task, without chat history or action tools. Review suggestions before applying them. |
| External MCP tools | A configured remote service receives granted tool calls and their arguments. Results used by hosted SI can also be sent to the SI provider. Local stdio servers run as programs with your user permissions; a tool grant does not sandbox the program or prevent its own networking. |
| Sharing files and images | Saving locally does not publish a project. Sending a project, CSV, chart, screenshot or support attachment shares its contents with the recipient you choose. Review location histories, identifiers, visible chat, paths and map/data attribution first. |

Client-certificate authentication uses operating-system identity handling. Chronoscope stores identity references, not private keys or PINs. Previously authorized map imagery can remain in the disk cache after a card is removed or an authentication session is reset. [Certificate and cache details](docs/WMTS-AUTH.md).

## Practical controls

Use an offline map/reference when you do not want online map requests. Disconnect hosted SI and external MCP services when they are unnecessary. Grant the narrowest useful tools and file scope, and review each external-action permission. [External MCP behavior and limits](docs/MCP-CLIENT.md).

Clearing SI history, disconnecting a service or removing a card does not delete data already received by another service, saved exports, automatic copies, backups or map caches. Close Chronoscope before manually removing local profile/cache files; preserve any work you need first. Use your provider's own account controls for remote retention or deletion requests.

This document describes the reviewed source behavior. Historical preview downloads can differ; consult their [source and platform status](docs/INSTALLATION.md). For a suspected disclosure or vulnerability, follow [SECURITY.md](SECURITY.md). Do not attach private datasets or credentials to public issues.
