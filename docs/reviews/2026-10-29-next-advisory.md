# Next advisory review — 2026-10-29

A read-only GPT-6 Astra review at high reasoning effort examined Next at
`f12ddd1`. The primary agent reproduced both findings, accepted both and
implemented the changes. The advisor did not edit code or run builds/tests.

## Accepted recommendations

1. **Recheck streaming import tickets against the current filesystem root.**
   A CSV preview made with broader access could later be validated or committed
   under a narrower MCP root, including through a background job. Move the
   existing review-only check into `PendingImport::check`, shared by validation,
   review and ingest. Already-loaded, bounded GIS/Excel samples retain their
   existing behavior. Denial preserves the ticket and workspace, allowing a
   subsequent authorized import.
2. **Pin detached analysis reads at a committed workspace boundary.**
   Field profiles, charts and pattern scans waited for the analytics worker
   without rechecking their inherited workspace. They could read a replacement
   project or pair tentative metadata with an older SQLite WAL view. Briefly
   acquire the operation gate, check workspace/revision and capture the read
   view while state is locked. Include cached pattern lookup and pattern
   evidence selection. Release both workspace locks before numerical work.
   Evidence selection retains its existing cache-key and final revision checks.

## Validation scope

The new regressions failed on the original implementation: narrowed-root
validation and background commit succeeded, and field analysis returned the
replacement workspace and crossed an active operation gate. The regression
suite covers authorized retry after denial, inherited workspace identity and
the operation boundary for fields, charts, patterns, cached patterns and pattern
evidence selection. Existing integration and headless browser suites exercise
normal chart, pattern, import and job behavior.

Local results: 70 core unit tests and 84 focused integration tests passed.
Headless analytics, charts, patterns and import-grid suites passed, along with
frontend unit tests, formatting, core Clippy and generated-contract checks.
The chart journey's obsolete `.scene-top-right` selector was replaced with a
check that navigation remains inside the map's top-right corner; no old canvas
tools or status text were restored. The machine-local validation receipt is
`.qa/astra-review-0.16.5-validation/final-report.json`.

The local debug macOS app built from `c4f4bf6` and replaced
`~/Applications/Chronoscope.app`. Bundle metadata and its executable both report
0.16.5; the installed executable matches the built copy and its strict ad hoc
signature check passed. It is the only Chronoscope app in that directory.
The installed binary passed headless CLI help, isolated agent setup and real
stdio MCP initialization, discovery and snapshot checks. Machine-local receipts:
`.qa/astra-review-0.16.5-installed-app.json` and
`.qa/astra-review-0.16.5-installed-cli.log`.

Version 0.16.5 is a Next development build. Public remains at 0.16.4; this review
and its fixes do not authorize promotion. Validation uses local processes only.
The locked desktop prevents native GUI verification; a successful build or
headless test does not establish native visual behavior or performance gains.
