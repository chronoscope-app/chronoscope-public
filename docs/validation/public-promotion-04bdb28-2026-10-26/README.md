# Single-window import grid source promotion

Owner-authorized promotion of the installed and accepted Next version `04bdb2826b66e2d8ad23d258b63afef41f3c86d6` onto Public `c6021f0be22704a8784463b9ff9a272089222d26`.

The import interface is one scrollable field grid, with green sample-validated mappings, light red missing/invalid fields, neutral optional fields, automatic feedback updates, and an inline full-file check before import. Worksheet drafts, append mode, source previews, aggregation and explicit rejection acceptance/export are retained. The [feature validation receipt](../import-field-grid-2026-10-26/README.md) describes behavior and sample/full-file limits.

All 3,145 tracked Next files retain identical bytes and modes. Public's independent parent history and 16 Public-only promotion files are preserved. This commit has only the previous Public head as its parent.

Recorded local validation passes 427 Rust tests (one existing full demo matrix ignored), 70 frontend unit tests, eight import-grid browser journeys, nine guided-workflow journeys and three integration journeys. Strict core Clippy, formatting, generated contracts and the production frontend build pass. The exact version was built, signature-verified, installed and opened on the owner's Mac; the owner accepted it before requesting promotion. Fresh Linux/Windows validation of this import redesign has not been run.

The final tracked candidate requires a local Gitleaks scan and canary check before push, with existing checksum matches independently verified. No unresolved credentials are allowed.

Workflows remain manual-only. This is a source promotion: no hosted runners, new binary release, version/tag change or replacement of existing downloads. See [structured receipt](report.json).
