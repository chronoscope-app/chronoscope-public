// OS-owned TLS client authentication. No private key or PIN is read by this helper.
import AppKit
import Foundation
import Security

struct Request: Decodable {
    let url: String
    let max: Int
    let identity: String?
    let interactive: Bool
    let method: String?
    let body: String?
    let bearer: String?
    let timeout: Double?
}
final class Transport: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private var pending: Request?
    private var task: URLSessionDataTask?
    private var body = Data()
    private var rejected = false
    private var authenticationFailure: String?
    private var choices: [String: URLCredential] = [:]
    private var redirects = 0
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()
    private func origin(_ url: URL) -> String {
        "https://\(url.host!.lowercased()):\(url.port ?? 443)"
    }
    func start(_ request: Request) {
        guard let url = URL(string: request.url), url.scheme == "https",
              url.host != nil, url.user == nil, url.password == nil,
              request.max > 0, request.max <= 8 * 1024 * 1024 else {
            reply(["error": "Invalid native WMTS request"])
            return
        }
        let method = request.method ?? "GET"
        guard method == "GET" || method == "POST" else {
            reply(["error": "Invalid native TLS request method"]); return
        }
        let upload = request.body.flatMap { Data(base64Encoded: $0) }
        guard method != "POST" || (upload != nil && upload!.count <= 1024 * 1024),
              request.bearer?.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 }) ?? true else {
            reply(["error": "Invalid native TLS request content"]); return
        }
        pending = request
        body = Data()
        rejected = false
        authenticationFailure = nil
        redirects = 0
        var req = URLRequest(url: url)
        req.setValue(method == "POST" ? "Chronoscope (SI)" : "Chronoscope (desktop GIS; direct disk cache)", forHTTPHeaderField: "User-Agent")
        req.httpMethod = method
        req.timeoutInterval = min(60, max(0.1, request.timeout ?? 40))
        if method == "POST" {
            req.httpBody = upload
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            if let key = request.bearer, !key.isEmpty {
                req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            }
        }
        task = session.dataTask(with: req)
        task!.resume()
    }
    private func identities() -> [SecIdentity] {
        var result: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassIdentity,
                                   kSecReturnRef as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return [] }
        return result as? [SecIdentity] ?? []
    }
    private func eligible(_ identity: SecIdentity, for space: URLProtectionSpace) -> Bool {
        var certificate: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess,
              let certificate = certificate else { return false }
        // Apple's client SSL policy checks validity, client-auth EKU/key usage and
        // a chain rooted in the user's/system trust store. Never parse X.509 ourselves.
        var trust: SecTrust?
        guard SecTrustCreateWithCertificates(certificate, SecPolicyCreateSSL(false, nil), &trust) == errSecSuccess,
              let trust = trust else { return false }
        SecTrustSetNetworkFetchAllowed(trust, false)
        guard SecTrustEvaluateWithError(trust, nil) else { return false }
        guard let issuers = space.distinguishedNames, !issuers.isEmpty else { return true }
        // TLS CertificateRequest CA names identify a certificate's issuer or an
        // issuing CA in its built chain. Match DER names returned by Security.
        if let issuer = SecCertificateCopyNormalizedIssuerSequence(certificate),
           issuers.contains(issuer as Data) { return true }
        for index in 0..<SecTrustGetCertificateCount(trust) {
            if let ca = SecTrustGetCertificateAtIndex(trust, index),
               let subject = SecCertificateCopyNormalizedSubjectSequence(ca),
               issuers.contains(subject as Data) { return true }
        }
        return false
    }
    private func sameIdentity(_ a: SecIdentity, _ b: SecIdentity) -> Bool {
        var ca: SecCertificate?
        var cb: SecCertificate?
        guard SecIdentityCopyCertificate(a, &ca) == errSecSuccess,
              SecIdentityCopyCertificate(b, &cb) == errSecSuccess,
              let ca = ca, let cb = cb else { return false }
        return (SecCertificateCopyData(ca) as Data) == (SecCertificateCopyData(cb) as Data)
    }
    private func name(_ identity: SecIdentity) -> String {
        var cert: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &cert) == errSecSuccess, let cert = cert else {
            return "Client certificate"
        }
        return SecCertificateCopySubjectSummary(cert) as String? ?? "Client certificate"
    }
    private func challenge(_ challenge: URLAuthenticationChallenge,
                           completion: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodClientCertificate else {
            completion(space.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .rejectProtectionSpace, nil)
            return
        }
        guard let pending = pending, let url = URL(string: pending.url),
              space.host.caseInsensitiveCompare(url.host!) == .orderedSame,
              space.port == (url.port ?? 443), challenge.previousFailureCount == 0 else {
            authenticationFailure = "The client certificate was rejected or the authentication origin changed. No automatic retry was made."
            completion(.cancelAuthenticationChallenge, nil)
            return
        }
        let key = origin(url) + "|" + (pending.identity ?? "automatic")
        let available = identities().filter { eligible($0, for: space) }
        if let saved = choices[key], let prior = saved.identity,
           available.contains(where: { sameIdentity($0, prior) }) {
            completion(.useCredential, saved)
            return
        }
        choices.removeValue(forKey: key)
        let selected: SecIdentity?
        if let requested = pending.identity {
            let matches = available.filter { name($0) == requested }
            selected = matches.count == 1 ? matches.first : nil
        } else if available.count == 1 {
            selected = available.first
        } else if !available.isEmpty && pending.interactive {
            let alert = NSAlert()
            alert.messageText = "Client certificate requested"
            alert.informativeText = "\(origin(url)) requests your identity. Choose the authentication certificate. Your card or macOS will handle its PIN."
            alert.addButton(withTitle: "Use certificate")
            alert.addButton(withTitle: "Cancel")
            let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 440, height: 28))
            picker.addItems(withTitles: available.enumerated().map { "\($0.offset + 1). \(name($0.element))" })
            alert.accessoryView = picker
            NSApp.activate(ignoringOtherApps: true)
            selected = alert.runModal() == .alertFirstButtonReturn ? available[picker.indexOfSelectedItem] : nil
        } else { selected = nil }
        guard let identity = selected else {
            authenticationFailure = available.isEmpty
                ? "No eligible client-authentication identity was found. Check the inserted card, Keychain client certificate, validity and installed issuer chain."
                : "Client-certificate selection was cancelled or requires the desktop chooser. An optional unique identity override can be used for headless requests."
            completion(.cancelAuthenticationChallenge, nil)
            return
        }
        let credential = URLCredential(identity: identity, certificates: nil, persistence: .forSession)
        choices[key] = credential
        completion(.useCredential, credential)
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        self.challenge(challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        self.challenge(challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward an identity to a different host/port or downgrade TLS.
        // SI POSTs never redirect or replay conversation data/credentials.
        guard pending?.method != "POST" else { completionHandler(nil); return }
        redirects += 1
        guard redirects <= 3, let next = request.url, let current = pending.flatMap({ URL(string: $0.url) }),
              next.scheme == "https", next.user == nil, next.password == nil,
              next.host != nil, origin(next) == origin(current) else { completionHandler(nil); return }
        completionHandler(request)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if response.expectedContentLength > Int64(pending?.max ?? 0) {
            rejected = true
            completionHandler(.cancel)
        } else { completionHandler(.allow) }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if body.count + data.count > (pending?.max ?? 0) { rejected = true; dataTask.cancel() }
        else { body.append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if rejected { reply(["error": "Map response exceeds size limit"]) }
        else if let error = error {
            // Don't echo a URL, certificate subject or provider diagnostic into logs.
            reply(["error": authenticationFailure ?? "Native WMTS TLS/authentication failed or was cancelled (OS code \((error as NSError).code)). Check the card, client certificate and server trust."])
        } else if let response = task.response as? HTTPURLResponse {
            let authenticated = pending.flatMap({ URL(string: $0.url) }).map { url in
                choices.keys.contains { $0.hasPrefix(origin(url) + "|") }
            } ?? true
            reply(["status": response.statusCode, "body": body.base64EncodedString(), "authenticated": authenticated])
        } else { reply(["error": "Native WMTS did not return HTTP"] ) }
        pending = nil
        body = Data()
        self.task = nil
    }
    private func reply(_ object: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
_ = NSApplication.shared
NSApp.setActivationPolicy(.accessory)
let transport = Transport()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let request = try? JSONDecoder().decode(Request.self, from: data) else {
            // The parent sends bounded, typed requests; malformed IPC terminates the helper.
            exit(2)
        }
        DispatchQueue.main.async { transport.start(request) }
    }
    exit(0)
}
NSApp.run()
