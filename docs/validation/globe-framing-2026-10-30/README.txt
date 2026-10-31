Globe navigation and timed-track fallback validation

Source: f5ee62c09e4e17482acf379983f7d3a64331b5f5
175 unit tests; 66 browser check groups across navigation, compass, preferences, pan direction, prepared interactions, framing and canonical fallback. Native Mac testing remains pending; no native desktop executable was rebuilt in this turn.

N/Home recovery, pointer-wheel keyboard focus and overview containment were tested with real inputs, narrow/wide viewports, polar/date-line views and off-screen/antipodal saved-camera poses. Regional focus, tilt, zoom, selection, exact event IDs and filters are preserved. The new raw-line rejection and canonical handoff prevent a pre-existing Cesium custom-attribute longitude-split failure.

All command receipts and source fingerprints are in report.json; raw browser captures/reports remain under ignored .qa paths. These are navigation/correctness changes. Further proposed caching/incremental-update performance work is not implemented here. Public and hosted workflows are untouched.
