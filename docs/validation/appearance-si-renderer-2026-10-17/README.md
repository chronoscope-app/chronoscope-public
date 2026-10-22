# Appearance, SI settings and renderer follow-up — 2026-10-17

Chronoscope’s selected Light/Dark appearance now controls the running Dock icon, including changes made with the sun button. System mode continues to follow native appearance events. The saved preference is applied at startup. Windows running window icons use the same preference; installation remains per-user with an asInvoker executable manifest.

SI chat has no Tools shortcut. Its gear opens SI settings, with AI service and Tools sections sharing the same connection/grant manager. The offline help follows this path. Renderer status and distinct CPU, WebGL and WebGPU glyphs appear immediately left of Notifications, outside the map. The indicator reports the actual backend; it does not add unsupported rendering modes.

Local verification:

- Release CLI, frontend and macOS application builds passed. Rust all-target check and Clippy with warnings denied passed.
- Native AppKit capture matched pearl/slate pixels for System Light/Dark, explicit app Light/Dark, and a system event opposite the explicit app preference. Five pixel comparisons passed; system preferences were not changed.
- Nine real-bridge browser UI groups passed, including renderer placement at 1600 and 1000 px widths, additive entity selection, workspace arrows, and Light/Dark contrast.
- SI integration passed seven scripted service requests, four external fixture tool calls and one isolated fixture write through gear → Tools. No live AI service or credentials were used.
- Real WebGL context loss/recovery preserved the scene and restored the header status from warning to healthy. No public WMTS requests were made.
- In the rebuilt native application, the sun button switched Light/Dark without an icon error; SI chat had no Tools shortcut; gear → AI service/Tools worked; the renderer indicator appeared beside Notifications and was absent from the map. CLI attachment returned workspace status after relaunch. Local ad-hoc bundle signature validation passed.

See [report.json](report.json). Windows runtime and Linux desktop launcher behavior were not tested on this Mac. No GitHub-hosted workflows were started.
