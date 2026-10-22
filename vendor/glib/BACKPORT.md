# Maintained GLib 0.18.5 security backport

Upstream crate: https://crates.io/crates/glib/0.18.5
Archive SHA-256: 233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5.
The complete crate archive contents are retained here, including LICENSE, COPYRIGHT, tests and Cargo.toml.orig. BACKPORT.md and BACKPORT-FILES.json are local additions; the ledger records every original file's byte length and hash and the patched file's hash. No other original file is changed.

Fix: https://github.com/gtk-rs/gtk-rs-core/pull/1343
Merged upstream commit: 05dff0ee696f9bcd8617cd48c4b812d046d440cb.
Advisories: https://rustsec.org/advisories/RUSTSEC-2024-0429.html and https://github.com/advisories/GHSA-wrw7-89jp-8q8g.
In src/variant_iter.rs::impl_get only, change the null pointer local to `let mut p` and pass `&mut p` rather than `&p` to variadic g_variant_get_child. This removes the unsound C write through a shared reference. It preserves GLib 0.18 API/dependency compatibility. The crate version intentionally remains 0.18.5, not an invented upstream fixed release.

Root workspace [patch.crates-io] selects this crate for all Linux desktop consumers. The isolated tests/glib-backport harness depends on this exact path and is excluded from the root workspace, so default CLI/MCP dependencies do not acquire GLib. On a prepared local GLib development environment, run both:

```sh
python3 scripts/build_portable.py test --offline --locked --manifest-path tests/glib-backport/Cargo.toml
python3 scripts/build_portable.py test --offline --locked --release --manifest-path tests/glib-backport/Cargo.toml
```

These seven synthetic tests cover all five affected iterator methods, UTF-8, collect, empty/exhausted/out-of-range and mixed-direction iteration. Static ledger/packaging tests are not substitutes for executing them. Linux desktop startup, menus, dialogs, WebView and snapshots require a separate authorized native smoke gate; macOS/Windows need their own release checks. No runtime pass is asserted by this record.

Maintenance owner: Chronoscope maintainer. Keep this advisory and patch tracked; version-based scanners may still flag 0.18.5 or fail to recognize local patches. Do not blanket-ignore/dismiss the advisory, falsify the version, or treat disappearance of an alert as runtime proof. Review this ledger, dependency selection and optimized regression tests whenever the native dependency stack changes.

Removal: only when a verified supported dependency graph no longer includes an affected unpatched GLib version (for example a coherent stable Tauri/GTK migration), followed by native compile/regression/smoke evidence. Updating Tauri alone is not sufficient: latest stable 2.12.5 still uses GTK 0.18. Until then retain LICENSE/COPYRIGHT and this modification record in selected notices, and all vendor files plus the ledger in source exports. This is an advisory-specific fix, not a general native dependency security or licensing clearance.
