# WMTS HTTPS client certificates and smartcards (0.8)

Automatic authentication is the default on macOS and Windows. Enter the WMTS URL normally; there is no required per-server certificate configuration. A **TLS client-certificate request** triggers native certificate selection. A missing/locked card is handled by the OS/card provider; Chronoscope has no PIN entry field and never reads, records, exports or persists a private key or PIN.

The SI service now uses these same platform mechanisms for HTTPS Chat Completions POSTs, with its own connection/session and server-bound overrides. See [SI user certificates](SI-AGGREGATION.md#user-certificates-and-cacpiv-authentication).

## Platform behavior

- **macOS:** a small bundled Swift helper uses URLSession, Security/Keychain and CryptoTokenKit. It enumerates OS identities only after a TLS certificate challenge. Security's client SSL policy checks validity, client-auth usage and the locally trusted chain, without network chain discovery. The server's acceptable CA names are matched against the certificate's issuer/built chain. A unique eligible identity is selected automatically; multiple eligible identities produce a native chooser identifying the requesting origin. The OS/card middleware handles private-key access and PIN prompts. Choices and TLS connections are reused within this helper's session, not saved to a project or global browser profile. The app/CLI embeds and extracts the compiled helper to a private, temporary executable, so no separate Swift installation is needed by the user.
- **Windows:** system curl with Schannel uses `--ssl-auto-client-cert`, selecting an eligible identity from the OS store when TLS requests one. Smartcard signing/PIN behavior belongs to the installed card/minidriver/CSP/KSP. This is Schannel selection, not an implementation or import of Chrome's enterprise selection policies. The system curl/Schannel capability is checked at runtime.
- **Linux:** public WMTS continues to use Rust HTTPS. Browser-style automatic token selection is **not implemented**. A protected service requires an explicit PKCS#11 certificate URI, `/usr/bin/curl` built with compatible OpenSSL/GnuTLS support, and working PKCS#11 provider/engine/card middleware. PIN entry must be provided by that middleware or reader; terminal-only PIN prompting will not work from the GUI. Chronoscope does not accept `pin-value`, `pin-source`, module paths, providers, key files or passwords in an identity URI. This is an explicit compatibility limitation, not plug-and-play Linux smartcard support.

The card/reader middleware and organizational trust anchors must already be installed. Chronoscope itself does not need administrator privileges to authenticate. Normal TLS server-certificate validation remains enabled. A card may have separate authentication, signing and encryption certificates; use an authentication identity valid for client TLS. macOS currently requires a chain that Security can build locally; missing intermediates need to be installed in Keychain. Chrome's saved choices, cookies, extensions, enterprise policies and SSO sessions are not imported. OAuth/SAML/browser-login portals are outside this feature.

## Optional local overrides

**Map servers → Authentication** offers the automatic default, a specific identity, and an anonymous/no-client-certificate override. An override is bound to an exact HTTPS scheme/host/port; changing a port or host changes the origin. The default mode needs no profile. Use an override only when selecting among several certificates, working with Linux PKCS#11, or disabling certificate use for a particular origin.

Specific identities are:

- macOS: the unique certificate subject name displayed by Security. Duplicate names require automatic selection/chooser instead of a name override.
- Windows: `CurrentUser\MY\` followed by the certificate's 40 hexadecimal SHA-1 thumbprint. This thumbprint is a store identifier, not a choice of cryptographic signing hash.
- Linux: e.g. `pkcs11:token=My%20Card;id=%01;type=cert`.

References are written atomically to the local `wmts-auth.json`, under the app's user-data directory. They are not preferences embedded in `.chronoscope` files. POSIX settings files are mode 0600 and the map cache is mode 0700; Windows inherits the user profile's access controls. There are no PIN/private-key settings. Profile updates use a file lock across processes and rotate the private cache namespace. Malformed/unreadable settings fail closed.

**Forget session choices** terminates the macOS TLS helper. It does not delete overrides, lock a card, clear middleware PIN caches, invalidate server sessions, or delete previously cached imagery. Windows curl currently creates a fresh connection for each network fetch, and its provider may retain PIN authorization independently. Cached authorized imagery may still be viewed without a card, as with a browser cache. Private map data remains on disk until cache expiry/eviction or removal of the cache directory.

## Request boundaries and limits

The direct cache and globally bounded concurrent scheduler apply to capabilities and imagery. Normal loading has no imposed delay; optional pacing and HTTP 429 cooldowns apply. Automatic native authentication uses a fresh private scope on each online process launch and session reset. Explicit identity profiles use separate scoped namespaces. Offline mode reuses the last scope so already authorized imagery remains available locally; switching back online rotates it. Confirmed-anonymous macOS responses can reuse a persistent public namespace. Windows automatic responses remain conservatively session-scoped. Removing a card or resetting authentication does not erase downloaded imagery; clear the disk cache to remove it. No credentials are written into downloaded capabilities, map URLs, portable project manifests or diagnostic logs.

macOS follows at most three same-origin HTTPS redirects; cross-origin redirects and TLS downgrades are refused. Windows/Linux authenticated curl follows no redirects. Point the app at the final HTTPS URL if necessary. Capabilities may advertise tiles on another host; that host's TLS challenge is handled independently, never by forwarding an identity selected for the first host. Optional overrides must be set separately for each host/port.

Bodies and IPC frames are bounded, both process output pipes are drained, and the Rust parent enforces an independent deadline/cancellation. The macOS helper applies a sixty-second cooldown after native authentication failure or HTTP 401/403, suppressing queued requests from repeatedly prompting. Resetting session choices clears that cooldown. Requests are never automatically retried after PIN cancellation/authentication failure, to avoid repeated prompts or card lockouts. Raw provider/curl error text is not recorded; errors report a bounded category/OS code. `SSLKEYLOGFILE` is removed from child environments. The curl transport ignores curlrc and never enables insecure verification, shell expansion, a PIN argument or a private-key file.

## CLI and MCP

All interfaces share the engine transport, including an MCP server attached to the desktop. Native challenges can display a certificate/PIN UI; do not assume a protected fetch can run unattended. On macOS, set `CHRONOSCOPE_WMTS_NO_UI=1` to suppress Chronoscope's multiple-certificate chooser. A unique eligible certificate can still be used, and hardware middleware may require its own PIN interaction.

```sh
chronoscope call wmts_auth_status
chronoscope call wmts_auth_reset
chronoscope call wmts_auth_remove --args '{"origin":"https://maps.example.org"}'
chronoscope call wmts_auth_set --args '{"profile":{"origin":"https://maps.example.org","kind":"disabled","identity":""}}'
```

Use `--attach` with the desktop's CLI connection to change its live authentication settings/session. Available MCP tools are `chronoscope_wmts_auth_status`, `chronoscope_wmts_auth_set`, `chronoscope_wmts_auth_remove` and `chronoscope_wmts_auth_reset`. Schemas reject PIN/password/key-file/module-path fields. Status reports the platform/backend and configured local references, not key material. Overrides can authorize client-certificate use for a host: configure only intended services.

## Verification

Core tests cover profile validation, HTTPS origin isolation, rejection of secrets/module paths, atomic local storage, corrupt-settings failure, cache namespace rotation, portable-project exclusion, enforced CLI/MCP schemas, subprocess output bounds and deadline termination. The normal UI suite exercises the authentication menu with anonymous/automatic overrides without contacting public servers.

The opt-in local `scripts/test_native_pki.py` generates a throwaway software CA and TLS client identity, temporarily installs them in the test machine's OS stores, starts a localhost server that **requires** a client certificate, and fetches WMTS capabilities and an SI Chat Completions response without an identity override. It cleans up the test identities/trust afterward. This is a software-certificate test, **not** a PIV/CAC/smartcard PIN or physical-reader test. Native card access, PIN cancellation/retry, multiple real card certificates, and organizational middleware still require testing with the user's hardware.

Historically, an Apple Silicon software-certificate handshake passed in CI without an override; its job subsequently failed during test CA cleanup. Windows actual TLS/PIN behavior and the latest CI cleanup/import fixes are not yet verified. The latest rerun was blocked by GitHub account billing/Actions spending restrictions before any jobs started; see [validation status](VALIDATION.md). No hardware claim or new packaged Mac build is made from that blocked run.

No GitHub-hosted runners are used for this release. Native software-certificate tests modify the local user trust/identity stores temporarily and should be run deliberately on a test machine. Physical cards and PIN behavior remain unverified here.
