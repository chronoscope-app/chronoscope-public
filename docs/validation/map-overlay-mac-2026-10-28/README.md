# Remove map display descriptions · Mac · 28 October 2026

Next 0.16.4 removes the bottom-left description overlay and its styles from the display renderer. This includes the Smoothed heat description and the related clusters, density and bloom descriptions. No rendering or data controls change.

The TypeScript/frontend build passed. A local headless check exercised Map, Time and Globe with clusters, density, heat and bloom: all 12 combinations retained their expected renderer resources, emitted no rendering errors and contained no description overlay. The isolated test made no public network requests. All five version/preflight checks passed. Native GUI interaction is omitted under the user's locked-screen instruction.

Origin was fetched before building; Next/main was current. The pending focused-AI work is already integrated through its squash commit. No hosted workflows were run.

The build-only native package completed and replaced `~/Applications/Chronoscope.app` with 0.16.4. Installed bundle metadata and CLI both report 0.16.4; strict verification of the local ad hoc signature passed. The source commit and executable hash are recorded in `native-bundle.json`. No desktop window was opened.
