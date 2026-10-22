# Windows x64 portable preview

Built from the whole-app capture revision `c6c905a` plus the Windows icon API fix in this change. The release assets identify the final source commit and SHA-256 hashes. No GitHub runners were used.

The optimized `x86_64-pc-windows-gnu` build produced a GUI-subsystem `Chronoscope.exe` (about 42 MiB), a console-subsystem `chronoscope-cli.exe` (about 28 MiB), and the required x64 Microsoft WebView2 loader DLL. The GUI binary embeds the `asInvoker` application manifest. Dependency inspection found Windows system DLLs and that loader; no additional MinGW runtime DLLs are needed.

The full Windows build exposed a platform-only Tauri API mismatch in icon theme updates: `AppHandle::windows()` is gated behind Tauri's unstable API. The app now enumerates its stable `webview_windows()` and applies each icon through the corresponding WebView window. This preserves the intended main/SI window behavior and leaves other platforms' icon code unchanged.

## Verification

- Both Windows release binaries compiled with the locked dependencies, MinGW-w64 GCC 14.2 and the repository's release optimization/LTO profile. Windows PE architecture, GUI/console subsystem, ASLR/NX flags, application manifest and DLL imports were inspected.
- Both actual `.exe` files passed seven console smoke groups under **Wine 10 on Linux**: version/help, command schemas, agent configuration using the Windows executable path, stdio MCP initialization and a 1,604-Event indexed hurricane workspace, full-scope statistics, role edits/save/reopen/CSV export, bounded queries and explicit headless screenshot failure.
- The tests load the bundled Atlantic hurricane project explicitly; a fresh CLI workspace starts empty. Test profiles and file roots are isolated. No public map server or SI provider was used.
- Rust formatting and diff whitespace checks passed. The source fix is confined to the Windows compilation path.

**Native Windows GUI, WebView2 installation/runtime behavior, hardware acceleration, smartcards and native screenshots remain untested.** Wine console testing does not establish native Windows GUI compatibility. The portable preview is unsigned. Normal use does not require an administrator install; the GUI requires the Microsoft Edge WebView2 Runtime. The ZIP includes its SDK loader, not the browser runtime.

## Build and use

With the Windows GNU Rust target and MinGW-w64 compiler/linker on PATH:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
cargo build --locked --release --target x86_64-pc-windows-gnu -p chronoscope -p chronoscope-desktop --bin chronoscope --bin chronoscope-desktop
```

The cross build sets `CC_x86_64_pc_windows_gnu`, `AR_x86_64_pc_windows_gnu` and `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER` to its private MinGW tools. The six toolchain packages were downloaded from Debian, checked against the package index SHA-256 digests and extracted into a private folder without system installation.

Extract the entire ZIP, retain `WebView2Loader.dll` beside `Chronoscope.exe`, and launch that executable. Use `chronoscope-cli.exe --help`, `chronoscope-cli.exe agent enable` and `chronoscope-cli.exe mcp --attach` from a terminal for agent access. All application assets are bundled in the desktop executable. The existing native Windows NSIS build workflow remains manual-only.
