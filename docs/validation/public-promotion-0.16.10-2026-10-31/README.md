# Public 0.16.10 release candidate — 2026-10-31

Owner-authorized promotion from Next/main `034270e7657b6ba0c7cf60342c7aeab4dbba0374` onto Public/main `6bcd11debd9032c1deb61abb02ea7984acbae1f9`.
All 3,408 tracked Next files are byte-identical. Historical Public-only promotion receipts are retained; private Next Git ancestry and ignored profiles/stress fixtures are excluded.

Includes prepared-graphics recovery and upload/navigation improvements, the complete usable IDF UAV dataset, the AI/SI toolbar preference, and demo catalog cleanup. Vite is patched to 6.4.5 for GHSA-8g5g-mxqh-grgj; the exact-package notice gate now checks the reviewed 1,540-file inventory. [Changes](../../../CHANGELOG.md) and [promotion receipt](report.json).

The frozen clean Next source passed 489 Rust tests (one existing optional matrix ignored), 175 frontend tests, Clippy, formatting, and the source/packaging checks. Both dependency audits report zero vulnerabilities; six unmaintained and one yanked Rust advisory warnings are retained. The source scan has no unresolved credentials; four existing checksum/commit matches were independently verified. Local native Mac IDF Altitude, Time Height and Ground Tracks had already passed on the same application code before the version/dev-tool update. These checks do not establish exhaustive UI/GPU, fresh-download installer, minimum-OS or production acceptance.

The owner also authorized manual public standard Windows x64 and Apple Silicon macOS builds, exact-package hosted native validation and a new experimental prerelease after successful validation. All workflows remain manual-only and historical releases/tags/assets are preserved. Builds run one platform at a time within the existing zero-dollar hard-stop budgets and the 500,000,000-byte Actions storage plan. Source promotion alone does not establish package acceptance. Release-specific source/package hashes and validation receipts will accompany the downloads.
