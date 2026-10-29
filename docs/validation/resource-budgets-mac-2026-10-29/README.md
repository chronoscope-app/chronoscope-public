# Next 0.16.8: automatic memory and graphics budgets

Application source: `032ccfff0259abc2b44ec2dc559153f680abb94d`. This work stays
in Next; Public source remains 0.16.7 and downloads remain 0.16.4. No hosted
workflow was started. The [policy](../../performance/AUTOMATIC_RESOURCE_BUDGETS_2026-10-29.md)
documents thresholds, budgets, recovery and practical limits.

The first two targets are framebuffer/map working sets and retained Event
geometry, including marker/stem/track inputs and playback afterimages. The app
samples OS availability and swap use every five seconds, observes draw/cadence
and geometry cost, and lowers transient budgets. Recovery requires 45 healthy
seconds per step. There is no new tuning preference, persisted quality profile
or source-data reduction. Existing saved budgets remain upper bounds.

## Local correctness and resource observations

The [source receipt](local-verification.json) records the working tree committed
as the application source above. Formatting, all-target core Clippy, production
frontend/CLI builds, generated contracts, **18 focused Rust tests**, **161 frontend
tests**, and four browser journeys passed: automatic pressure, playback reuse,
continuous fade and renderer recovery. The [additional receipt](extra-verification.json)
records **71 core-library tests**, publication/distribution/packaging checks and
a fresh RustSec audit with zero vulnerabilities. Six maintenance warnings and
one existing yanked-package warning remain recorded.

The new journey injects an 8 GiB/200 MiB-available sample through the actual
browser bridge. It does not exhaust physical RAM. Actual renderer resources
changed as follows on the 12,000-record synthetic fixture:

| Resource | Healthy | Critical |
| --- | ---: | ---: |
| Allocated marker slots | 12,000 | 2,000 |
| Stem segments | 12,000 | 2,000 |
| Framebuffer | 826 × 884 | 413 × 442 |
| Track vertices | 160 | 160 |

This is an 83% reduction in marker/stem counts and 75% fewer framebuffer pixels,
not a measured GPU-byte or process-RSS reduction. The straight paths were already
simplified, so their track vertex count stayed unchanged. Exact queries still
returned all 12,000 records, both selected records remained selected, and filters,
preferences and saved display/Fade/budget choices stayed unchanged. Playback
remained available, with zero decorative afterimages at critical pressure and
zero render errors. [Measurements](injected-pressure-measurements.json) ·
[critical display](injected-critical.png).

Unit cases cover 4/8 GiB capacity, memory/swap pressure, recognized Intel hints,
masked renderer names plus expensive geometry, genuinely slow active cadence,
idle gaps, missing/stale sensors, continuous recovery holds and pixel caps.
The Rust tests prove transient packet ceilings do not change source scope,
selection, saved scenes or revisions, and normal packets return after removing
the transient ceiling.

## Installed Mac build

The optimized release app is installed at `~/Applications/Chronoscope.app`, the
only Chronoscope copy there. Bundle/build labels and CLI report 0.16.8. The built
and installed executable hashes match, and strict ad hoc signature verification
passed. [Installation receipt](installed-app.json). The installed executable
passed real headless CLI/agent/stdio MCP smoke checks, generated-contract checks,
and [OS sampler checks](installed-sampler.json).

Native app MCP confirmed real OS sampling and automatic-governor diagnostics,
and captured near/far light-mode frames while the screen was locked.
[Capture receipt](native-capture.json) · [native frame](native-light-near.png).
The engine connects before the frontend listener is ready: a first read-only
status request expired, and the second succeeded. The harness now bounds this
readiness retry rather than retrying navigation/playback mutations.

The separate [native animation attempt](native-animation-attempt.json) did not
advance its time filter during its two-second interval in the locked session;
its old subtraction of null bounds produced a harness TypeError. That attempt
is retained as a failure, and the harness now reports missing advancement
explicitly. This is not native Mac playback acceptance. Browser playback checks
are separate evidence; the successful native capture-only run makes no animation
claim. No normal user workspace or appearance preference was changed.

## Clawcomp: real Intel graphics and cooperative load checks

The connected validation host reports **14.72 GiB usable total RAM**, rather than
an 8 GiB physical configuration. Driver counters confirmed **Intel UHD/i915**;
WebKit's masked “Apple GPU” string was not treated as hardware identification.
Testing waited while OpenClaw was active, then used low-priority, single-worker
builds and runtime load/pressure monitoring. No physical memory exhaustion or
system/GPU setting change was performed. Owned app/browser-server processes
were stopped afterward, with both checkouts clean.

An optimized before/after comparison used 0.16.7 source `96c5734` and the exact
0.16.8 application source above:

| Observed metric | 0.16.7 | 0.16.8 |
| --- | ---: | ---: |
| Flights median zoom time | 1,213.63 ms | 460.16 ms |
| Flights rendered markers / stems, each | 88,018 | 20,000 |
| Peak combined app/WebKit RSS | 1,633.65 MiB | 1,537.19 MiB |
| First Starlink open/readiness | 5.237 s | 15.024 s |
| Initial Starlink RSS | 805.70 MiB | 1,071.05 MiB |

The slower Starlink sample is retained. A fresh-profile, reversed-order repeat
(new first, old second) measured 0.16.8 at 2.170 s engine open + 2.435 s UI
readiness = **4.605 s**; 0.16.7 took 3.537 + 2.179 = **5.715 s**. These trials do
not establish a stable startup gain or a repeatable regression. The RSS sums
are not unique physical footprints or direct GPU-byte measurements, and one
paired trial does not establish universal latency/memory improvements.

Each dataset then completed over 40 seconds of sliding-window playback and
navigation. Starlink adapted full → balanced. Flights reached reduced following
**344 ms** geometry work, with **5,000 markers/stems** and a **979 × 681**
framebuffer. It recovered to balanced at about 50 seconds after demand ended,
and full at about 95 seconds. Exact source/query counts, selections and saved
choices were preserved. The corrected sustained run had **zero render errors,
navigation conflicts or retries**.

Both focused Rust tests and two browser checks passed on clawcomp. The browser
pressure sample was explicitly injected. An earlier overlapping-navigation
revision conflict is retained with unknown camera outcome; relative navigation
must not be blindly retried after such a conflict.
[Reported measurements, exact binary hashes and raw evidence paths](clawcomp-summary.json).
The full raw receipts remain on clawcomp at the paths recorded there.

## Dependency scope

Only `sysinfo` 0.40.0 and its two new platform dependencies were introduced.
Existing registry package versions and dependency edges were preserved.
The sampler enables only `system`, performs no process enumeration, and invokes
no external programs. [Archive checksum and notice receipt](new-dependency-notices.json).
Native GPU-byte accounting, a hard process memory quota, native reference-layer
cache control, and memory limits for arbitrary analysis jobs are outside these
first two targets.
