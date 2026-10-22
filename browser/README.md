# Archived browser-extension bridge

This experimental implementation is deactivated at the user's request. Standard desktop and CLI builds do not compile the broker, register its commands, export an extension ZIP or expose any setup interface. Do not use the retained training video as current product instructions.

Direct, extension-free WebMCP website access is not implemented. The intended future integration will let Chronoscope's SI use website tools through an appropriate browser runtime, rather than requiring users to install this extension.

## Developer preservation

`src/webmcp.rs` and `browser/webmcp-extension/` are retained behind the non-default Cargo feature `experimental-browser-webmcp`. This is a developer research feature, not a user preference. No desktop or CLI build script enables it, and the frontend has no browser setup interface even in a research build. To test the retained broker in isolation:

```sh
CARGO_PROFILE_TEST_DEBUG=0 cargo test --locked -p chronoscope --features experimental-browser-webmcp --test webmcp
```

The existing `frontend/scripts/webmcp-qa.mjs` protocol harness can be run with `npm --prefix frontend run test:webmcp:experimental` against a CLI explicitly built with that feature. Ordinary `test:webmcp` instead verifies that the bridge and its interface are unavailable. Do not regenerate the default frontend contracts from an experimental CLI.

## Historical implementation notes (inactive)

These describe the former 0.13.0 workflow, not current instructions:

**Browser WebMCP is implemented with a companion MV3 Chromium extension.** Open SI Tools → Browser WebMCP, save the ZIP, unzip, and Load unpacked in chrome://extensions (Developer mode). Start pairing, select the desired website tab and click the extension, paste the loopback address/code, then return to Discover and review tools. The extension sources are embedded in the app; no repository or Node runtime is needed to export them.

The adapter targets the [October 2026 Community Group draft](https://webmachinelearning.github.io/webmcp/): `document.modelContext.getTools({fromOrigins:[origin]})` and `executeTool(registeredTool, arguments, {signal})`. The external browser and website must support this API. Only the selected main document/origin is shared; iframe tools, older navigator APIs and generic scraping are not adapted. Tauri's embedded webview is not used. Website authentication stays in the browser; cookies are not sent to Chronoscope.

The broker binds an ephemeral 127.0.0.1 port. A 256-bit one-use pairing code expires in five minutes. Pairing binds an extension origin, browser document ID, origin and tool catalogue. A separate extension bearer can poll/return results but cannot invoke engine commands or use the internal MCP endpoint. The app agent bearer is never shared. Exact Host/Origin checks, bounded bodies/catalogues/results, at most four pending calls and timeouts apply. No credentials or grants enter projects. Navigation/reload/catalogue changes invalidate calls; reconnect and review grants. Cancellation forwards MCP notifications and aborts the page signal. External actions may already have completed.

Host-only commands in a persistent `chronoscope session`: `webmcp_start`, `webmcp_status`, `webmcp_connect`, `webmcp_stop`, and `webmcp_extension {"path":"/absolute/extension.zip","overwrite":false}`. They are excluded from SI, inbound MCP and jobs. After setup, granted tools use ordinary `client_tools`/`client_call` and SI namespacing. Stop closes the bridge and connection. A stale client can list old definitions until disconnected, but calls are rejected and reconnect clears grants.

Managed browser policy may require administrator deployment of the extension. This VM blocks unpacked extension installation and lacks the current native draft API. The local QA therefore runs the **shipped background/adapter scripts with Chrome API shims and an explicit protocol fixture in a real Chromium page**. It verifies transport, SDK negotiation, grants, cancellation and navigation, not native interoperability. Run `CHRONOSCOPE_TEST_EXTENSION=1 npm --prefix frontend run test:webmcp:experimental` on a machine permitting unpacked extensions for the actual MV3 path; the report distinguishes native draft versus fixture.
