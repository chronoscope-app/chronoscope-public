# Playback persistence, icon and navigation review — 2026-10-17

The upper clock hand now points to 11 o’clock in both pearl/slate app assets and the toolbar mark. Desktop PNG, ICNS and ICO formats were regenerated and checked. Full attribution is available through Maps → Map credits; the small information button is removed from the map. Required inline credits and exported PNG attribution remain.

Playback arrivals fade in over 550 ms; departures and their vertical trails fade out over 2,400 ms. Original timestamps survive successive packets. Inferred-location markers retain their triangular shape. Afterimages carry no event pick ID and do not enter current selection, queries or analysis. They clear on pause, mode/style changes and hiding, and respect reduced motion. Transient history is capped at 100,000 markers and 100,000 stem segments. Static all-visible packets reuse existing GPU resources; departing stems use one material uniform per packet. The batching fixture measured 44 buffer uploads for 12 fade frames, below its 200-call regression ceiling.

Focused real-bridge browser fade/credits tests passed, with no rendering errors or public requests in the fade test. The rebuilt native app opened the credits panel and displayed lingering points/stems during bloom playback; 16 diagnostic samples had no render errors. A short hardware Chromium test retained all 100,000 markers with bloom on, using Apple M5/Metal. Callback timing and rolling renderer timing are reported separately; this is not a native 100k FPS claim or a controlled speedup comparison. The broader UI run reached nine passing groups, then was stopped during a slow per-point picking search; it is not reported as a complete suite pass. See [report.json](report.json).

## Globe controls compared with Google Earth

This compares the implemented Chronoscope controls with Google's current [Earth navigation documentation](https://developers.google.com/maps/documentation/earth/navigate-the-globe) and [keyboard shortcuts](https://developers.google.com/maps/documentation/earth/use-keyboard-shortcuts), checked 2026-10-17. It is not a direct Google Earth UI playtest; Earth Pro can differ. Navigation mappings were not changed in this update.

| Input | Chronoscope Globe | Google Earth documented behavior |
| --- | --- | --- |
| Left drag | Move/orbit the globe; Select mode instead draws a selection box | Move the globe |
| Ctrl + left drag | Tilt/orbit | Look around |
| Right drag | Tilt/orbit, explicitly removed from zoom inputs | Zoom |
| Wheel / +/- buttons | Zoom | Zoom controls |
| Left/right double-click | No camera zoom binding; clicks use event selection | Zoom toward/away from cursor |
| Arrow / Shift+arrow keys | No global camera navigation; focused compass has left/right rotation and Home for north | Pan / rotate |
| N / U / R | No global camera shortcuts; compass N button restores north; F fits events | North / top-down / reset |
| Page Up/Down; Shift+Page Up/Down | No global camera bindings | Zoom; change altitude |
| Space | Play/pause the event timeline | Stop globe/camera rotation |
| 2D/3D switch | View buttons or Alt+2 (2D), Alt+4 (Globe) | O |

Chronoscope's main familiar mouse gestures are present. The largest differences are the right-drag mapping, double-click zoom and keyboard coverage. Matching Earth would require deciding how to retain timeline Space and event-selection gestures. Sources reviewed: `frontend/src/view.ts`, `main.ts`, `compass-rose.ts`; local regression also checked actual wheel/button zoom across all four modes.
