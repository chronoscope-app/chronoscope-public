# Expanded offline demos — 26 October 2026

The catalog contains 13 offline examples with 26 real 480 × 300 thumbnails.
The January earthquake, London crime and shorter hurricane workspaces are now
discoverable in Help. New projects include full-year earthquakes, FIRMS detections,
World Bank electricity access, and historical JHU CSSE COVID snapshots.

Sources, selection rules, units, licensing and reproduction are documented in
[the demo guide](../../PRIORITY-DEMOS.md). The fire snapshot covers 19–25 October
2026; it is not the proposed historical month or season. Its saved heat view sums
reported FRP and uses a display ceiling of 300 smoothed kernel units. Saturated
colors and kernel footprints are not burned-area boundaries or measured regional
power totals. Original points and values remain available in another saved view.

Real 1920 × 1200 application captures:

- [Global earthquakes — 2025](earthquakes-hero.png): 8,500 USGS-authored magnitude
  ≥4.5 events; Pacific-centered globe, source time and depth preserved.
- [FIRMS — South America](fire-detections-hero.png): 50,713 nominal/high-confidence
  VIIRS detections; weighted heat, no tracks or stems.
- [Electricity access — Africa, 2023](electricity-access-hero.png): country polygons
  colored by annual population percentage, with a fixed 0–100% legend.
- [The same electricity view — 1990](electricity-access-1990.png): identical scale;
  missing observations remain gray.

[Capture scenes and diagnostics](capture-report.json) and
[validation counts and hashes](validation.json) identify the results. Tests used
the real Rust engine, loopback app bridge and Cesium renderer in Chromium with
software WebGL2. External network requests were blocked during captures; the
background is the bundled Natural Earth public-domain image. These checks do not
establish native macOS/Windows builds or physical-GPU performance.

Verification includes core Rust tests, five priority-demo regressions, existing
demo load/save checks, all 70 frontend unit tests, strict Clippy, generated
contracts, the validation-suite inventory and browser verification of picker
loading, source counts, actual heat-layer readiness, all 169 country boundaries,
saved year filters and rejection of an inverted measurement scale. The full-range
country map shows the latest observation per entity instead of blending years;
portable reopening preserves the scale. Heat-only views retain exact cells and
selected evidence while avoiding hidden point glyphs. Parsed geometry and geodesic
centroid reuse are bounded; modified shape copies cannot reuse stale centroids.

No GitHub-hosted workflows were dispatched. The pending AI-retirement branch was
reviewed before building; it contains unrelated AI work and was not merged as
part of the demo expansion. No public-repository or website promotion is included.
