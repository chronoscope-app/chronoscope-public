# Outbound MCP client and SI tools

Chronoscope 0.13 is both an MCP server and an MCP client. The existing server lets another agent drive Chronoscope. The new client lets built-in SI call tools offered by trusted local apps and remote services, alongside its Chronoscope tools.

## Connect and grant

Open SI chat → **Tools**, or Preferences → **Outbound MCP connections**.

- **Remote HTTP:** enter an MCP Streamable HTTP endpoint and optional bearer token. HTTPS is required except for localhost HTTP. Redirects, URL-embedded credentials, query strings and fragments are rejected. An ordinary website URL is not an MCP endpoint.
- **Local stdio:** select an absolute trusted executable, enter its arguments as a JSON string array, and optionally supply a JSON environment object. CLI configuration also accepts a working directory through `cwd`. This launches the program directly, without a shell. The program runs with your user permissions; tool grants do not sandbox it. Only essential system/proxy/TLS environment values and your explicit variables are inherited. Standard error is discarded to avoid leaking server secrets into app logs.

Connections, arguments, credentials and grants remain in memory. They are not written into a workspace or restored after restart. Disconnect terminates the managed local child; reconnect requires fresh grants. Save connection details separately if you need them again, keeping secrets in an appropriate local secret manager.

Discovery alone gives SI no access. Review tool descriptions, JSON schemas and hints, then assign:

| Grant | Behaviour |
| --- | --- |
| Off | SI cannot see or call the tool. |
| SI query | SI may use it on subsequent messages without a separate action checkbox. Choose this only after deciding the actual tool is appropriate for read access. |
| SI action | Available only for a message with **Allow granted external actions** checked. |

Server annotations are hints, not authorization. Definitions are SHA-256 fingerprinted and each connection has a random namespace. Reconnect clears grants; changed definitions discovered on reconnect require another review. The discovered catalogue is fixed for a connection; tool-list change notifications are not applied yet. Reconnect when a service changes its tools. The action checkbox resets after sending, as does the separate Chronoscope record-edit permission. SI is never offered tools to create connections or change grants.

SI may send data from a conversation or one tool into another approved tool. Grant only services you intend to exchange data with. External results are untrusted content. Chronoscope validates tool arguments and declared structured output schemas, but cannot guarantee a remote service's claims or a model's conclusions.

## CLI and other agents

All surfaces share the engine's strict command schemas. Run `chronoscope schema client_connect` (and the corresponding other command names) for the installed contracts. Use an attached CLI to manage the same session as the desktop:

```sh
chronoscope --attach call client_status
chronoscope --attach call client_connect --args-file connection.json
chronoscope --attach call client_tools --args '{"id":"records"}'
chronoscope --attach call client_grants --args-file reviewed-grants.json
chronoscope --attach call client_disconnect --args '{"id":"records"}'
```

Attached connection-management calls use a private local host route with a separate
credential in the user-only connection descriptor. The standard MCP transport
cannot invoke that route or advertise these controls. Rebuild and restart the
desktop together with the CLI when updating from a build without this support;
older descriptors still support ordinary workspace calls but report `UNAVAILABLE`
for attached connection management.

A connection file contains, for example:

```json
{"id":"records","name":"Records service","config":{"transport":"http","url":"https://service.example/mcp"}}
```

Use `client_tools` to obtain current names and fingerprints. Grant entries use `tool`, `fingerprint`, and `access` (`read` or `action`); `client_grants` takes `id` and `grants`. Replacing grants revokes any omitted tools. `client_call` takes `id`, `tool`, `fingerprint`, `arguments`, and optional `allow_actions`. Inspect returned `isError` as well as transport errors.

Inbound MCP exposes `client_status`, `client_tools` and explicitly granted `client_call`. It deliberately cannot connect/disconnect services or edit grants, directly or through jobs. Those controls require the local host UI/CLI. `job_start` supports `client_call` for cancellation. A standalone CLI process has its own session; use `--attach`, a persistent NDJSON session, or the running desktop to retain connections. `ask --allow-external-actions` is the CLI equivalent of the per-message external-action checkbox; `--allow-edits` remains separate.

External actions are outside Chronoscope Undo, its file-root restriction and workspace transactions. Cancellation, disconnect or timeout may occur after a service performed an action. Inspect the outcome before retrying. Neither SDK reconnection retries nor HTTP request retries are enabled for these calls.

## Protocol, bounds and current limitations

The client uses the [official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk), pinned to rmcp 3.5.1. It supports stdio and Streamable HTTP, current **2026-07-28** discovery plus compatibility initialization for older servers, including **2025-11-25**. A thin adapter bounds response allocation while leaving negotiation, sessions and protocol messages to the SDK. See the [MCP transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).

Connections are limited to 16. Discovery is limited to 16 pages, 256 tools and 2 MiB of tool definitions per server; responses and stdio frames are bounded to 2 MiB. Four calls per connection may be in flight, with at most two HTTP posts concurrently. Operations time out after 60 seconds. SI exposes at most 128 total functions/256 KiB of schemas, counting both Chronoscope and external tools, and retains its existing turn, call and context budgets. Excess data fails explicitly rather than silently executing an incomplete request. Connection/authentication errors avoid echoing credentials and server response bodies into the app log.

This release supports tool listing/calling, anonymous or bearer HTTP authentication, and local environment-based credentials. Remote OAuth browser login, client-certificate authentication for these MCP connections, sampling, interactive elicitation, resource browsing and prompt catalogues are not implemented. WMTS has its separate native PKI support. External records can inform SI; importing a service's exported CSV/Excel still uses Chronoscope's validated import workflow and appropriate file/edit permissions.

## WebMCP status

The extension-based browser bridge is **deactivated** in standard builds. There is no extension installation, pairing or browser connection interface, and its host commands are unavailable. Chronoscope does not currently access WebMCP websites directly. Configuring an external SI provider does not add browser capabilities by itself.

The intended future direction is extension-free website access driven by Chronoscope's SI, using an appropriate browser runtime and WebMCP agent integration. This is separate from ordinary remote MCP endpoints, which remain supported today. The earlier extension implementation is retained as developer research, excluded by default; see [archived bridge notes](../browser/README.md).

Local verification covers a real managed Chronoscope stdio child and synthetic HTTP MCP services: current discovery, legacy initialization/session headers, JSON/SSE results, bearer failure, grant revocation, action gating, size limits and invalid structured output. It does not imply compatibility with every third-party server or provider.
