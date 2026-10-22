# SI service client certificates

HTTPS SI requests now use native certificate challenges by default on macOS (URLSession/Keychain/CryptoTokenKit) and Windows (Schannel). The service remains an OpenAI-compatible Chat Completions endpoint. A browser SSO portal is outside this feature. Linux retains the same explicit PKCS#11/middleware requirement as protected WMTS; automatic token discovery is not claimed.

SI owns an independent transport/session. Optional local certificate overrides are bound to the service's exact HTTPS origin, validated using the existing WMTS identity rules, and excluded from projects. Changing server origin clears a selected identity in the settings form. Reconnect discards the native SI session. Private keys/PINs stay with the OS/card provider; request JSON and bearer tokens reach native transports through bounded stdin/IPC, never command arguments or request files. SI POSTs never follow redirects or automatically retry/fall back after authentication failure. Response, timeout and cancellation bounds remain enforced.

Local Linux verification:

- Frontend production build and all 13 frontend unit test files pass.
- Rust library, SI aggregation/chat/certificate, WMTS authentication and hardening suites pass.
- `cargo test --locked --lib wmts_auth:: -- --include-ignored`: seven checks pass, including a real local server requiring a throwaway client certificate. It verifies exact JSON/bearer delivery, rejected missing identities, normal server trust validation, no redirect replay, 401 without retry, the 1 MiB response limit, timeout/cancellation and blocked stdin upload bounds. Trust files stay in the temporary fixture directory; OS trust stores are not modified.
- `frontend/scripts/si-certificate-qa.mjs`: four offline browser checks pass for configuration without an API key, origin changes, anonymous/default overrides and small-window reachability.
- Existing `si-settings-qa.mjs`: five checks pass for shared settings/tool grants, draft preservation, small windows and detached-chat settings.

The existing opt-in `scripts/test_native_pki.py` was extended to cover an automatically authenticated SI POST as well as WMTS GET on macOS/Windows. It was not run here: those platforms and real CAC/PIV reader/PIN interactions remain unverified. No GitHub Actions workflow or hosted runner was started.
