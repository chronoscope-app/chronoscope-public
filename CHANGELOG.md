# Changelog

Chronoscope is experimental. Source versions and downloadable builds can differ; [installation status](docs/INSTALLATION.md) records current availability and verification limits. No production-ready release is currently advertised.

## 0.15.2 — unreleased

- Compact charts now float over the map, with readable small-chart axes and expandable chart notes. Widen chart restores editing controls.

- Preserve fractional-second timestamp bounds in the CLI/MCP snapshot output contract, including global earthquake catalogs.

- Replace uncertain/noncommercial media with public-domain Natural Earth shaded relief and generated synthetic GIS fixtures. Refresh the concise README with eight native Mac screenshots and per-capture credits; retire outdated promo compositions and imagery.
- Security: update Rand to 0.8.6, Calamine to 0.37.0, ZIP to 9.0.5 and locked TLS/certificate dependencies to patched releases. Archive names and stored-data offsets now handle the newer ZIP API explicitly, retaining path, symlink and size checks. Existing preview binaries are unchanged.
- Publication preparation: privacy documentation, guided bug and feature forms, a pull-request checklist, and explicit owner/publication gates.
- Current source includes export-pair/provenance fixes, updated distribution notices and the documented GLib security backport. Existing preview executables have not been rebuilt by these source changes.

## 0.15.1 — historical development previews (not included)

These historical builds are context only, not downloads in this clean repository. No earlier binaries, release attachments or source history are included. They were separate builds, not one matched cross-platform release:

| Build | Published | Application source | Status |
| --- | --- | --- | --- |
| macOS Apple Silicon | 2026-10-20 | `d9e6128908736e9777d5cf952c76beb2d7182f54` | Ad hoc signed; not notarized; fresh downloaded-app startup unverified. |
| Windows x64 | 2026-10-21 | `59a22e4af509bec70a3e184466fd6d546a65b5cc` | Unsigned; Wine console/engine checks; native installation and GUI unverified. |

Highlights include eight chart starters and persistent Rust-backed analytics, fractional-second Event timestamps, SI improvements, collapsible pane rails and expanded space-time mapping. The newer Windows build also includes SI HTTPS client-certificate integration and compass/time-rail changes. Neither executable contains all subsequent `main` changes.

## 0.14.1 — historical macOS development preview

Apple Silicon development build from `f5b30125944e3d11efe3cc7d558ad4e8ac1f5d18`. Packaging revision 2 repaired the local application identity, but fresh quarantined-download startup still stalled on the test Mac. It is historical and is not the recommended preview. Its original release notes and executable are not included here.

This is a curated release summary, not a reconstructed history of every earlier experiment. Future entries should name user-visible changes, exact source, supported platforms and known limitations without carrying test claims forward from a different binary.
