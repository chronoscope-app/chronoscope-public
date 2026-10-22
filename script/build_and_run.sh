#!/usr/bin/env bash
# Local Tauri build/run. No hosted runner or publishing step.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
MODE="${1:-run}"
case "$MODE" in run|--verify|--build-only|--debug|--logs|--telemetry) ;; *) echo "Usage: $0 [--verify|--build-only|--debug|--logs|--telemetry]" >&2; exit 2;; esac
# Optional local toolchain setup; no machine-specific paths are checked in.
if [[ -n "${CHRONOSCOPE_BUILD_ENV:-}" ]]; then source "$CHRONOSCOPE_BUILD_ENV"; fi
# Stop only this checkout's app, retaining other installed copies.
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT_DIR/target}"
APP_BUNDLE="$TARGET_DIR/debug/bundle/macos/Chronoscope.app"
if [[ "$MODE" != --build-only ]]; then
  for task_pid in $(pgrep -f "^$APP_BUNDLE/Contents/MacOS/chronoscope-desktop$" || true); do kill "$task_pid"; done
fi
if [[ ! -d frontend/node_modules ]]; then npm --prefix frontend ci; fi
npm run bundle -- --debug --bundles app --config src-tauri/tauri.macos.conf.json --config '{"build":{"beforeBuildCommand":"npm --prefix frontend run build -- --configLoader runner"}}'
# Seal the local debug bundle's resources as well as its executable. This
# ad hoc signature is for local use; it is not Developer ID/notarization.
/usr/bin/codesign --force --sign - "$APP_BUNDLE"
/usr/bin/codesign --verify --strict "$APP_BUNDLE"
[[ "$MODE" == --build-only ]] && exit 0
case "$MODE" in
 --debug) exec lldb -- "$APP_BUNDLE/Contents/MacOS/chronoscope-desktop";;
 *)
   if [[ -n "${CHRONOSCOPE_DATA_DIR:-}" ]]; then
     /usr/bin/open -n --env "CHRONOSCOPE_DATA_DIR=$CHRONOSCOPE_DATA_DIR" "$APP_BUNDLE"
   else
     /usr/bin/open -n "$APP_BUNDLE"
   fi;;
esac
case "$MODE" in
 --verify) sleep 2; pgrep -f "^$APP_BUNDLE/Contents/MacOS/chronoscope-desktop$" >/dev/null;;
 --logs) exec /usr/bin/log stream --info --style compact --predicate 'process == "chronoscope-desktop"';;
 --telemetry) exec /usr/bin/log stream --info --style compact --predicate 'subsystem == "org.chronoscope.desktop"';;
esac
