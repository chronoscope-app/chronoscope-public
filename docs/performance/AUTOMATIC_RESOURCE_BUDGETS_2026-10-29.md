# Automatic memory and graphics budgets — Next 0.16.8

The first two targets are framebuffer/map working sets and retained Event
geometry: markers, tracks, stems, interpolated vertices and playback afterimages.
The desktop adjusts these automatically. No new preference, manual quality mode
or persisted hardware override is introduced. Existing render budgets remain an
upper bound; source records and exact analysis/query/selection scopes stay intact.

## Inputs and stability

One cached `sysinfo` sampler reads OS available/total RAM and swap use at most
once per five seconds. Linux cgroup memory limits further bound the sample when
available. It does not enumerate processes, query providers, identify GPUs or
start a subprocess. Unsupported sampling reports unknown availability rather than
pretending that zero bytes means pressure. Backend/CLI/MCP schemas expose the
same read-only `system_resources` result.

An 8 GiB system starts balanced; systems up to 4.5 GiB start reduced. Recognized
Intel integrated/software renderer hints also start balanced. Renderer names are
not authoritative: clawcomp's driver counters showed Intel UHD while WebKit
reported “Apple GPU.” The controller independently observes actual geometry
rebuild cost and active drawing/cadence. A geometry operation over 250 ms can
lower the budget immediately at the next sample; sustained slow drawing takes
three samples. Intentional idle gaps are excluded.

Available RAM below 20% or 1.5 GiB requests balanced, below 12% or 768 MiB requests
reduced, and below 6% or 384 MiB requests critical. New swap growth over 128 MiB
with less than 25% available also requests reduced. Previously used swap alone
does not trigger that rule. Pressure tightens on the next sample; recovery needs
45 continuous seconds above 25% and 1.75 GiB available, with inexpensive drawing,
and restores only one step at a time. Missing/stale samples cannot clear pressure.

## Transient caps

| Budget | Full | Balanced | Reduced | Critical |
| --- | ---: | ---: | ---: | ---: |
| Rendered observations, additionally capped by saved user maximum | 100,000 | 20,000 | 5,000 | 2,000 |
| Framebuffer pixels | 8,000,000 | 2,000,000 | 1,000,000 | 500,000 |
| Maximum resolution scale | 1.5 | 1 | 0.75 | 0.5 |
| Active update limit | Display cadence | 30 Hz | 24 Hz | 15 Hz |
| MSAA samples | 4 | 1 | 1 | 1 |
| Globe tile-cache target | 100 | 64 | 32 | 16 |
| Street raster canvases | 24 | 12 | 6 | 2 |
| Departing markers | 100,000 | 5,000 | 1,250 | 0 |
| Departing line segments / cohorts | 100,000 / 256 | 20,000 / 32 | 5,000 / 8 | 0 / 0 |
| Source geometry vertices / additional arc vertices per existing layer plan | 200,000 | 80,000 | 20,000 | 8,000 |

An idle scene retains the existing 10 Hz update limit. Active limits never raise
that idle rate. Pixel caps combine CSS viewport area, device scale and profile;
map detail is reduced through screen-space error rather than unloading geography.
Cesium tile-cache size is a soft target: tiles required by the current view may
exceed it. The hidden street rasterizer releases its vector cache at a safe job
boundary and recreates lazily, preserving already displayed Cesium imagery.

The coherent backend snapshot takes separate transient ceilings for observations
and geometry vertices, before decoding/allocating frontend packets. It retains
the saved user's budget and ordinary representative-LOD semantics. All records
remain in the indexed store. Source geometry is omitted by the existing bounded
packet rules when necessary, rather than silently modifying measured endpoints.
Lower afterimage budgets affect decorative departures, not the exact retained
time window or stored Fade percentage.

## Diagnostics and practical limits

`chronoscope call system_resources` reports OS bytes, scope and sample age.
Attached `chronoscope --attach view status` exposes `diagnostics.resourceGovernor`
with active limits, cause, transition count and sample freshness. Renderer
framebuffer dimensions, allocated marker slots, track/stem counts and measured
geometry cost remain separately visible. Limits are absent from saved scenes.

These are bounded rendering working sets, not a hard process-RSS or GPU-byte
quota. GPU allocation is not directly measured. Rapid allocation spikes between
samples, WebKit/driver overhead, native reference-layer caches and large analysis
jobs can still consume memory. Native acceptance and measured RSS/latency changes
must be recorded separately from injected-pressure correctness tests. No global
OS/GPU settings, other applications, user data, graphics drivers or source-data
limits are modified by the controller.
