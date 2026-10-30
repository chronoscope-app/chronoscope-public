Next Smooth playback integration - Windows, 2026-10-30

Merge codex/smooth-vfx-local into Next while retaining the ordinary Chronoscope
application name, bundle identifier and profile/migration path. Smooth playback
is enabled by default, has a standard-renderer switch, and remembers its choice
on this computer. The original separate experimental app/profile is preserved.

Validation: 171 frontend unit tests, 78 Rust checks, 10 full-app checks,
10 extended renderer checks, four playback/bloom transition checks, five table
interaction checks, generated engine contracts and packaged notices. The
optimized Windows build passes 15 native checks with a disposable profile,
including 100k import and accelerated playback in Time, Map and Globe.

Public main, hosted workflow definitions, bundled sample assets and installed
user applications are unchanged. All verification ran locally. Earlier VFX
validation documents describe the experiment before this Next integration.

Known limits and exact source/build/check provenance are in report.json.
