# Public source promotion — housekeeping

Promotes reviewed Next main `3e9060b` onto Public main, preserving Public's
independent history and its existing promotion receipts. Every Next tracked file
is byte-identical. No private Git ancestry, ignored profiles or local build
workspaces are imported.

The [housekeeping report](../housekeeping-mac-2026-10-25/report.json) records the
passing local checks and limits. This includes the two previously reported
hosted-test failures: Windows path spelling now uses filesystem identity, and
the portable workspace fixture verifies an explicit saved Fade setting. Native
Windows/Linux acceptance and new hosted build results remain separate.

The workflows remain manual-only. This is source promotion, not a new release,
version bump, tag or replacement of existing 0.15.2 downloads.

[Promotion inputs](report.json). The exact resulting commit and secret-scan
receipt are retained by the promotion coordinator; an embedded commit cannot
name its own hash.
