#!/bin/bash
# Focused recorder diagnostics checks. No window, capture service or TCC access.
set -euo pipefail
if [[ $# -ne 0 ]]; then echo 'Usage: script/test_recording_diagnostics.sh' >&2; exit 2; fi
if [[ "$(uname -s)" != Darwin ]]; then echo 'UNAVAILABLE: recording diagnostics require macOS and Xcode Swift' >&2; exit 2; fi
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chronoscope-recording-diagnostics.XXXXXX")"
trap 'rm -rf "$TASK_DIR"' EXIT
MODULE_CACHE="${CHRONOSCOPE_SWIFT_MODULE_CACHE:-$TASK_DIR/module-cache}"
mkdir -p "$MODULE_CACHE"
cat "$ROOT_DIR/src-tauri/window-capture/Recording.swift" > "$TASK_DIR/Tests.swift"
cat >> "$TASK_DIR/Tests.swift" <<'SWIFT'
private final class CyclicDiagnosticError: NSError, @unchecked Sendable {
    init() { super.init(domain: "Cycle", code: 7, userInfo: nil) }
    required init?(coder: NSCoder) { fatalError("not used by diagnostic test") }
    override var userInfo: [String: Any] {
        [NSLocalizedDescriptionKey: "cycle", NSUnderlyingErrorKey: self]
    }
}
@main struct DiagnosticTests {
    @MainActor static func main() async throws {
        let underlying = NSError(domain: NSOSStatusErrorDomain, code: -12780,
            userInfo: [NSLocalizedDescriptionKey: "decoder failure", "not_for_export": "private sentinel"])
        let original = NSError(domain: AVFoundationErrorDomain, code: -11800,
            userInfo: [NSLocalizedDescriptionKey: "first sample failed", NSUnderlyingErrorKey: underlying])
        let details = RecordingFailure(original, source: "SCRecordingOutputDelegate.didFailWithError")
        let root = details.json
        precondition(root["domain"] as? String == AVFoundationErrorDomain)
        precondition(root["code"] as? Int == -11800)
        precondition(root["source"] as? String == "SCRecordingOutputDelegate.didFailWithError")
        let chain = root["underlying"] as! [[String: Any]]
        precondition(chain.count == 1 && chain[0]["code"] as? Int == -12780)
        precondition(chain[0]["domain"] as? String == NSOSStatusErrorDomain)
        precondition(root["underlying_truncated"] as? Bool == false)
        precondition(details.summary.contains("AVFoundationErrorDomain(-11800)"))
        precondition(details.summary.contains("NSOSStatusErrorDomain(-12780)"))
        let serialized = try JSONSerialization.data(withJSONObject: root)
        precondition(!String(decoding: serialized, as: UTF8.self).contains("private sentinel"))
        print("PASS structured NSError domain/code/underlying/source; no arbitrary userInfo export")
        var deep = NSError(domain: "bottom", code: 0, userInfo: [NSLocalizedDescriptionKey: "bottom"])
        for i in 1...12 { deep = NSError(domain: "layer", code: i, userInfo: [NSUnderlyingErrorKey: deep]) }
        let bounded = RecordingFailure(deep, source: String(repeating: "S", count: 1000)).json
        precondition((bounded["source"] as! String).unicodeScalars.count == 128)
        precondition((bounded["underlying"] as! [[String: Any]]).count == 3)
        precondition(bounded["underlying_truncated"] as? Bool == true)
        let cyclic = RecordingFailure(CyclicDiagnosticError(), source: "cycle-test").json
        precondition((cyclic["underlying"] as! [[String: Any]]).isEmpty)
        precondition(cyclic["underlying_truncated"] as? Bool == true)
        print("PASS bounded four-error chain and cycle termination")
        let long = NSError(domain: String(repeating: "D", count: 1000), code: Int.min,
            userInfo: [NSLocalizedDescriptionKey: String(repeating: "🛰️\n\t", count: 10000)])
        let short = RecordingFailure(long, source: "test\nsource\t")
        precondition((short.json["domain"] as! String).count == 128)
        precondition((short.json["description"] as! String).unicodeScalars.count == 512)
        precondition(!(short.json["description"] as! String).contains("\n"))
        let shortData = try JSONSerialization.data(withJSONObject: short.json)
        precondition(shortData.count < 20000)
        precondition(short.summary.utf8.count < 20000)
        print("PASS bounded single-line descriptions and JSON serialization")
        guard #available(macOS 15.0, *) else {
            print("UNAVAILABLE: recorder state checks require macOS15+")
            exit(2)
        }
        let recorder = Recording(path: "/not-opened-by-this-test.mp4", label: "main", fps: 15, limit: 2)
        recorder.fail(details)
        let first = try JSONSerialization.data(withJSONObject: recorder.metadata(), options: [.sortedKeys])
        recorder.fail(failure("UNAVAILABLE: generic start rewrap"), source: "start.await-recording-delegate")
        recorder.fail(NSError(domain: "SCStreamErrorDomain", code: -3808), source: "SCStreamDelegate.didStopWithError")
        let after = try JSONSerialization.data(withJSONObject: recorder.metadata(), options: [.sortedKeys])
        precondition(first == after, "generic rewrap and cleanup must not replace the original failure")
        precondition(recorder.state == "failed" && recorder.stream == nil && recorder.output == nil)
        print("PASS immutable first callback failure and idempotent cleanup")
        // Existing-file validation returns before any ScreenCaptureKit request.
        let existing = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("existing.mp4")
        try Data("not overwritten".utf8).write(to: existing)
        let conflict = Recording(path: existing.path, label: "main", fps: 15, limit: 2)
        do { try await conflict.start(windowID: 0); preconditionFailure("existing file must reject") }
        catch { conflict.fail(error, source: conflict.stage) }
        precondition(conflict.message!.hasPrefix("CONFLICT:"))
        let error = conflict.failureDetails!.json
        precondition(error["source"] as? String == "start.validation")
        precondition(error["domain"] as? String == "ChronoscopeRecording")
        precondition(error["code"] as? Int == 1)
        let retained = try Data(contentsOf: existing)
        precondition(retained == Data("not overwritten".utf8))
        print("PASS actual start validation stage, error prefix and unchanged existing file")
    }
}
SWIFT
ARCH="$(uname -m)"
xcrun swiftc -swift-version 5 -O -parse-as-library -module-name ChronoscopeRecordingDiagnostics \
  -target "$ARCH-apple-macosx11.0" -module-cache-path "$MODULE_CACHE" "$TASK_DIR/Tests.swift" -o "$TASK_DIR/Tests"
"$TASK_DIR/Tests" "$TASK_DIR"
