# Local security checks

Run these locally before publication and after relevant source/dependency changes. Keep GitHub Actions manual-only; these commands do not require hosted runners. Use a clean authenticated clone with all intended launch branches/tags fetched. Keep reports redacted, outside the checkout and out of support attachments unless reviewed.

## Secrets

Tested with Gitleaks **8.30.1**, downloaded from its official release and checked against that release's SHA-256 list:

```sh
gitleaks git . --config=.gitleaks.toml --log-opts=--all --redact=100 \
  --max-archive-depth=3 --max-decode-depth=3 \
  --report-format=json --report-path=/tmp/chronoscope-history-scan.json
gitleaks dir . --config=.gitleaks.toml --redact=100 \
  --max-archive-depth=3 --max-decode-depth=3 \
  --report-format=json --report-path=/tmp/chronoscope-current-scan.json
```

This clean repository has one fresh source-snapshot commit, not the development repository's history. Earlier scan counts and private audit receipts do not describe its Git object graph. Re-run scans against the exact final snapshot and inspect every reachable object, generated source archive and publication-facing asset. The configuration extends default rules and narrowly permits reviewed checksum-manifest lines; it is not a general file or commit exclusion. Test a synthetic canary before relying on a scanner configuration.

Do not widen the allowlist to hide a new finding. Review it, rotate/revoke a real credential if present, and obtain separate approval for any historical removal. No scanner proves that all private data is absent; visually review screenshots, projects, archives and binary metadata, and consider GitHub-managed logs/assets and objects outside fetched refs.

## Dependency advisories

```sh
cargo audit --file Cargo.lock
npm --prefix frontend audit --package-lock-only
# Legacy promo composition retired; no video npm dependencies remain.
```

Use the official RustSec cargo-audit tool separately from the application dependencies. These tools need access to their advisory services; they do not need app-provider credentials. Preserve lockfiles and review every proposed update rather than running a broad automatic fix.

The 2026-10-21 follow-up used **cargo-audit 0.22.2**, RustSec database commit `4b587f00996ebe5c05a73eaef105ef241e876414`, and npm **12.2.0**. After the source updates, RustSec reported **zero vulnerability entries** and both npm lockfile audits reported **zero vulnerabilities**. Source updates cover Rand 0.8.6, Calamine 0.37.0/Quick-XML 0.42, ZIP 9.0.5, Rustls 0.23.46, rustls-webpki 0.103.16 and webpki-root-certs 1.0.10. The ZIP migration explicitly handles fallible names and optional stored-data offsets while preserving package path/symlink/size validation. These are dated source results, not a fresh audit of this snapshot. No earlier executable is included here. The maintained [GLib backport](../vendor/glib/BACKPORT.md) requires advisory-specific review; unchanged crate versions can still trigger alerts.

Six unmaintained-package warnings remain visible in the full lockfile inventory: `paste` 1.0.15, `proc-macro-error` 1.0.4, `ttf-parser` 0.25.1, `zbus_names` 4.3.4, `zvariant` 5.15.0 and `zvariant_derive` 5.15.0. `paste` is reached through argmin/linfa-linear in the core graph; the other warnings require their target/optional dependency graphs to be considered. Plan maintained upstream migrations with their own compatibility tests. An unmaintained warning is not equivalent to a confirmed exploitable vulnerability, and a zero-vulnerability result does not erase it.

## Verify the change

Run appropriate locked local tests and format/lint checks. Include archive traversal/resource limits, portable project/KMZ round trips, Excel imports, TLS/certificate configuration and analytics reproducibility when changing these dependencies. Record actual results in the pull request. A core suite does not certify a final signed desktop package, Windows GUI, Linux runtime or physical smartcard behavior. See [release gates](RELEASE-CHECKLIST.md), [platform status](INSTALLATION.md) and [publication status](PUBLICATION-STATUS.md).
