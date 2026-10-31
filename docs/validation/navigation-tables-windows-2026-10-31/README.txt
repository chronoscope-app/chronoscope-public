NAVIGATION AND ATTRIBUTE TABLES — WINDOWS

Chronoscope Next 0.16.11, source 467a316b2eac769a40c339a48e35f61bbf90a575.

Removed the synthetic Madagascar UAV demo from the catalog and bundle, along with its generator, previews and credit metadata. Fourteen demos remain. Requests for the removed ID fail without changing the current workspace. Existing user-created workspace copies are preserved.

Globe and Time horizontal middle/right dragging rotates around one retained ground pivot. Middle vertical dragging tilts; right vertical dragging zooms about that pivot. Wheel zoom remains anchored to the pointer. A regression performs four 105-degree drags per button in each 3D view with visible data: the original ground focus remains within 0.5 screen pixels, horizontal dragging retains tilt, and there is no inertia. Flat Map behavior remains unchanged.

Event attribute tabs offer Show selected. It intersects the current source, text search and optionally workspace filters without changing the map filter. Checks cover empty and changing selections, Shift ranges with hidden intervening records, independent table state, and detach/dock. All sources combines imported Event layers; GIS layers have separate tables. The button and combined tab explain this on hover. Main and table refreshes share the same table-scope key so retained state is consistent. Detached scroll restoration is guarded against unfinished/hidden layout callbacks.

Passed: TypeScript/Vite production build, 186 frontend tests, 10 Rust tests (one existing full-data matrix ignored), five browser suites (navigation-table-cleanup, detachable-tables, navigation, event-table, navigation-sphere), optimized native Windows build and attached native startup/catalog/demo/table/capture checks. Browser suites use the real local Rust bridge and production frontend, actual mouse/keyboard input, and no public network requests. The native application reports 0.16.11 and zero renderer errors. See report.json for build timings and source/binary hashes. Local screenshots remain under .qa/nav-table-cleanup/artifacts and .qa/nav-table-cleanup/native.

The root Launch Chronoscope Next.cmd points to Windows-build-0.16.11-467a316. No installer, Public promotion, release/tag or hosted workflow was created. Native mouse input-helper validation is not claimed; gestures were verified in Chrome using the same production renderer.
