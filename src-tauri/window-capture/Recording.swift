import AppKit
import WebKit
import ScreenCaptureKit
import AVFoundation
import CoreMedia

typealias Reply = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> Void
private func respond(_ callback: Reply, _ context: UnsafeMutableRawPointer?, _ value: [String: Any]) {
    let bytes = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    String(decoding: bytes, as: UTF8.self).withCString { callback(context, $0) }
}
private func failure(_ message: String) -> NSError { NSError(domain: "ChronoscopeRecording", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

@available(macOS 15.0, *)
@MainActor private final class Recording: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
    static var history: [String: Recording] = [:]
    let path: String, label: String
    let fps: Int, limit: Double
    var started = Date()
    var state = "starting", message: String? = nil
    var width = 0, height = 0, bytes = 0
    var duration = 0.0
    var stream: SCStream?, output: SCRecordingOutput?
    var watchdog: Task<Void, Never>?
    var temporary: URL?
    init(path: String, label: String, fps: Int, limit: Double) {
        self.path = path; self.label = label; self.fps = fps; self.limit = limit
    }
    func metadata() -> [String: Any] {
        if let output { bytes = output.recordedFileSize; duration = CMTimeGetSeconds(output.recordedDuration) }
        return ["path": path, "uri": URL(fileURLWithPath: path).absoluteString, "state": state, "window": label, "backend": "screencapturekit", "mime_type": "video/mp4", "fps": fps, "max_seconds": limit, "width": width, "height": height, "duration_seconds": duration.isFinite ? duration : 0, "bytes": bytes, "started_unix_ms": started.timeIntervalSince1970 * 1000, "timestamp_basis": "ScreenCaptureKit start delegate; approximate presentation alignment", "error": message as Any? ?? NSNull()]
    }
    func start(windowID: CGWindowID) async throws {
        guard !FileManager.default.fileExists(atPath: path) else { throw failure("CONFLICT: video output already exists; choose a new .mp4 path") }
        // Own-process enumeration cannot expose another application's windows
        // and needs no global screen-recording permission or display capture.
        let content = try await SCShareableContent.currentProcess
        guard let window = content.windows.first(where: { $0.windowID == windowID && $0.owningApplication?.processID == ProcessInfo.processInfo.processIdentifier }) else { throw failure("UNAVAILABLE: requested Chronoscope window is not capturable") }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        let scale = min(2, min(1920 / window.frame.width, 1080 / window.frame.height))
        width = max(2, Int(window.frame.width * scale) / 2 * 2)
        height = max(2, Int(window.frame.height * scale) / 2 * 2)
        configuration.width = width; configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        configuration.queueDepth = 5
        configuration.showsCursor = true
        configuration.capturesAudio = false
        configuration.captureMicrophone = false
        let destination = URL(fileURLWithPath: path)
        // Encode privately, then atomically publish without replacing a file.
        let directory = destination.deletingLastPathComponent().appendingPathComponent(".chronoscope-record-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        temporary = directory
        let recording = SCRecordingOutputConfiguration()
        recording.outputURL = directory.appendingPathComponent("capture.mp4")
        recording.videoCodecType = .h264; recording.outputFileType = .mp4
        let output = SCRecordingOutput(configuration: recording, delegate: self)
        self.output = output
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        self.stream = stream
        try stream.addRecordingOutput(output)
        try await stream.startCapture()
        let deadline = Date().addingTimeInterval(5)
        while state == "starting", Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
        guard state == "recording" else { throw failure(message ?? "UNAVAILABLE: recording did not start") }
        watchdog = Task { [weak self] in
            while let self, self.state == "recording" {
                try? await Task.sleep(nanoseconds: 250_000_000)
                _ = self.metadata()
                if Date().timeIntervalSince(self.started) >= self.limit || self.bytes >= 256 * 1024 * 1024 {
                    do { try await self.stop() } catch { self.fail(error.localizedDescription) }
                    break
                }
            }
        }
    }
    func stop() async throws {
        if state == "complete" || state == "failed" { return }
        if state != "stopping" {
            state = "stopping"
            try await stream?.stopCapture()
        }
        let deadline = Date().addingTimeInterval(7)
        while state == "stopping", Date() < deadline { try? await Task.sleep(nanoseconds: 20_000_000) }
        if state == "stopping" { throw failure("UNAVAILABLE: video finalization timed out; inspect status") }
    }
    func fail(_ error: String) {
        guard state != "complete" else { return }
        message = error; state = "failed"
        watchdog?.cancel(); watchdog = nil
        let old = stream; stream = nil; output = nil
        if let old { Task { try? await old.stopCapture() } }
        if let temporary { try? FileManager.default.removeItem(at: temporary) }
        temporary = nil
    }
    nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        let occurred = Date()
        Task { @MainActor in
            if self.state == "starting" { self.started = occurred; self.state = "recording" }
        }
    }
    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        Task { @MainActor in self.fail(error.localizedDescription) }
    }
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { @MainActor in self.fail(error.localizedDescription) }
    }
    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in
            guard self.state != "failed" else { return }
            _ = self.metadata()
            do {
                guard let temporary = self.temporary else { throw failure("UNAVAILABLE: recording output missing") }
                let file = temporary.appendingPathComponent("capture.mp4")
                // ScreenCaptureKit's live counters can lag the finalized MP4.
                let finalizedDuration = CMTimeGetSeconds(try await AVURLAsset(url: file).load(.duration))
                guard self.state != "failed" else { return }
                self.bytes = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
                self.duration = finalizedDuration
                guard self.bytes <= 256 * 1024 * 1024 else { throw failure("RESOURCE_LIMIT: recording exceeded 256 MiB") }
                guard self.bytes > 0, self.duration.isFinite, self.duration > 0 else { throw failure("UNAVAILABLE: recorder produced no video") }
                try FileManager.default.linkItem(at: file, to: URL(fileURLWithPath: self.path))
                try FileManager.default.removeItem(at: temporary)
                self.temporary = nil; self.state = "complete"
                self.watchdog?.cancel(); self.watchdog = nil
                self.stream = nil; self.output = nil
            } catch { self.fail(error.localizedDescription) }
        }
    }
}

@_cdecl("chronoscope_recording_request")
func recordingRequest(_ view: UnsafeMutableRawPointer, _ json: UnsafePointer<CChar>, _ callback: Reply, _ context: UnsafeMutableRawPointer?) {
    // Called only through Tauri.with_webview on the UI thread; copy borrowed
    // strings/window identity before returning across the C ABI.
    let request = String(cString: json)
    let webview = Unmanaged<WKWebView>.fromOpaque(view).takeUnretainedValue()
    let number = CGWindowID(webview.window?.windowNumber ?? 0)
    Task { @MainActor in
        do {
            guard #available(macOS 15.0, *) else { throw failure("UNAVAILABLE: video recording requires macOS 15 or later") }
            guard let args = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any], let path = args["path"] as? String, let action = args["action"] as? String else { throw failure("INVALID_ARGUMENT: recording action/path required") }
            let recording: Recording
            if action == "start" {
                guard !Recording.history.values.contains(where: { ["starting", "recording", "stopping"].contains($0.state) }) else { throw failure("RESOURCE_LIMIT: an app recording is already active") }
                let fps = args["fps"] as? Int ?? 60, limit = args["max_seconds"] as? Double ?? 30
                guard (15...60).contains(fps), (1...120).contains(limit), URL(fileURLWithPath: path).pathExtension.lowercased() == "mp4" else { throw failure("INVALID_ARGUMENT: recording bounds or extension invalid") }
                recording = Recording(path: path, label: args["window"] as? String ?? "main", fps: fps, limit: limit)
                if Recording.history.count >= 8, let key = Recording.history.keys.first { Recording.history.removeValue(forKey: key) }
                Recording.history[path] = recording
                do { try await recording.start(windowID: number) } catch { recording.fail(error.localizedDescription); throw error }
            } else {
                guard let existing = Recording.history[path] else { throw failure("UNAVAILABLE: recording not found in this app session") }
                recording = existing
                if action == "stop" { try await recording.stop() }
                else if action != "status" { throw failure("INVALID_ARGUMENT: unknown recording action") }
            }
            respond(callback, context, recording.metadata())
        } catch { respond(callback, context, ["error": error.localizedDescription]) }
    }
}
