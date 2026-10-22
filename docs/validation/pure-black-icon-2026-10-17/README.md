# Pure-black dark app icon — 2026-10-17

The dark icon now uses a flat `#000000` opaque background. Its slate gradient and pale edge border are removed. Amber crosshair, clock hands, rounded silhouette, transparent outer corners, and the pearl light variant retain their existing appearance.

Desktop assets were regenerated with the existing Tauri icon generator. Format checks passed, including per-user/asInvoker Windows packaging. Background pixel samples are exactly RGBA `(0, 0, 0, 255)`.

The existing native AppKit appearance check passed five actual Dock-image comparisons: System Light/Dark, app Light/Dark, and an opposite system appearance event while the app explicitly uses Dark. It changed no system preferences. The running macOS Dock and Windows window-icon adapters use the same dark PNG; Windows runtime was not tested on this Mac. No hosted workflows were dispatched.
