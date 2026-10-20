import AppKit
import Foundation
import Network
import WebKit

final class AssetServer {
    private let root: URL
    private let listener: NWListener
    private let queue = DispatchQueue(label: "emilia.live2d.assets")

    init(root: URL) throws {
        self.root = root.standardizedFileURL
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
    }

    func start(ready: @escaping (URL) -> Void) {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .ready = state, let port = self.listener.port {
                DispatchQueue.main.async { ready(URL(string: "http://127.0.0.1:\(port)/index.html")!) }
            }
            if case .failed(let error) = state { fputs("Asset server failed: \(error)\n", stderr) }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.start(queue: queue)
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, _, _ in
            guard let self else { connection.cancel(); return }
            let request = String(data: data ?? Data(), encoding: .utf8) ?? ""
            let rawPath = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let decoded = rawPath.removingPercentEncoding ?? rawPath
            let path = decoded == "/" ? "/index.html" : decoded
            let file = self.root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            let allowed = file.path.hasPrefix(self.root.path + "/") && !path.contains("..")
            let body = allowed ? try? Data(contentsOf: file) : nil
            let mime: String
            switch file.pathExtension.lowercased() {
            case "html": mime = "text/html; charset=utf-8"
            case "js": mime = "text/javascript; charset=utf-8"
            case "json": mime = "application/json"
            case "png": mime = "image/png"
            case "jpg", "jpeg": mime = "image/jpeg"
            default: mime = "application/octet-stream"
            }
            let payload = body ?? Data("Not found".utf8)
            let header = "HTTP/1.1 \(body == nil ? "404 Not Found" : "200 OK")\r\nContent-Type: \(mime)\r\nContent-Length: \(payload.count)\r\nConnection: close\r\n\r\n"
            var response = Data(header.utf8)
            response.append(payload)
            connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}

final class Live2DPet: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let halfHeight: CGFloat = 280
    private let fullHeight: CGFloat = 470
    private let bubbleSize = NSSize(width: 286, height: 72)
    private var window: NSPanel!
    private var bubbleWindow: NSPanel!
    private var bubbleLabel: NSTextField!
    private var webView: WKWebView!
    private var server: AssetServer?
    private var timer: Timer?
    private var hitMap: NSBitmapImageRep?
    private var snapshotPending = false
    private var nextSnapshot = Date.distantPast
    private var isDragging = false
    private let stateFile = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/emilia-loop/state.json")
    private let lipSyncFile = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/emilia-loop/lip-sync.json")
    private let configFile = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/emilia-loop/pet-config.json")
    private var lastConfig = ""
    private let formatter: ISO8601DateFormatter = {
        let value = ISO8601DateFormatter()
        value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return value
    }()
    private var lastState = "idle"
    private var lastCueToken = ""
    private var lastCharacter = "emilia"
    private var lastLipSyncId = ""
    private var bubbleText = ""
    private var bubbleUntil = Date.distantPast
    private var bubbleEnabled = true
    private var mouseTracking = true
    private var lastLookX = Double.nan
    private var lastLookY = Double.nan
    private var ready = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let resources = Bundle.main.resourceURL else {
            fputs("Missing app resources.\n", stderr)
            NSApp.terminate(nil)
            return
        }
        let webRoot = resources.appendingPathComponent("web")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "ready")
        config.userContentController.add(self, name: "drag")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 340, height: halfHeight), configuration: config)
        webView.navigationDelegate = self
        webView.underPageBackgroundColor = .clear
        // WebKit still paints its own white backing when the page and canvas
        // are transparent. KVC reaches WebKit's private _setDrawsBackground:.
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        window = NSPanel(contentRect: webView.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.level = .floating
        window.isFloatingPanel = true
        window.hidesOnDeactivate = false
        window.isMovableByWindowBackground = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = webView
        window.setFrameOrigin(defaultOrigin())
        window.orderFrontRegardless()
        makeBubbleWindow()
        let menu = NSMenu()
        menu.addItem(withTitle: "退出爱蜜莉雅桌宠", action: #selector(quit), keyEquivalent: "")
        webView.menu = menu
        do {
            server = try AssetServer(root: webRoot)
            server?.start { [weak self] url in self?.webView.load(URLRequest(url: url)) }
        } catch {
            fputs("Cannot start asset server: \(error)\n", stderr)
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.pollState()
            self?.pollLipSync()
            self?.pollConfig()
        }
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
            self?.updatePointerPassThrough()
        }
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.updateMouseTracking()
        }
        pollConfig()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "drag" {
            guard let payload = message.body as? [String: Any], let phase = payload["phase"] as? String else { return }
            if phase == "start" {
                isDragging = true
                window.ignoresMouseEvents = false
            } else if phase == "move", let dx = payload["dx"] as? NSNumber, let dy = payload["dy"] as? NSNumber {
                window.setFrameOrigin(NSPoint(x: window.frame.minX + dx.doubleValue, y: window.frame.minY - dy.doubleValue))
                positionBubble()
            } else if phase == "end" {
                isDragging = false
                persistPosition()
            }
            return
        }
        guard message.name == "ready" else { return }
        let status = String(describing: message.body)
        if status == "ready" {
            ready = true
            pollState()
            pollLipSync()
            lastConfig = ""
            pollConfig()
            fputs("Live2D ready.\n", stderr)
        } else {
            fputs("Live2D renderer: \(status)\n", stderr)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("Live2D navigation failed: \(error)\n", stderr)
    }

    private func pollState() {
        guard ready else { return }
        var next = "idle"
        var payload: [String: Any]?
        if let data = try? Data(contentsOf: stateFile),
           let decoded = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let state = decoded["state"] as? String,
           let stamp = decoded["updatedAt"] as? String,
           let date = formatter.date(from: stamp),
           Date().timeIntervalSince(date) >= 0, Date().timeIntervalSince(date) < 60,
           ["idle", "thinking", "speaking", "working", "listening"].contains(state) {
            next = state
            payload = decoded
        }
        if let character = payload?["character"] as? String,
           ["emilia", "rem", "ram", "beatrice", "felt", "crusch", "anastasia", "echidna", "hotaru"].contains(character),
           character != lastCharacter {
            lastCharacter = character
            webView.evaluateJavaScript("window.__setCharacter(\"\(character)\")") { _, error in
                if let error { fputs("Live2D character update failed: \(error)\n", stderr) }
            }
        }
        if let payload,
           let bubble = payload["bubble"] as? [String: Any],
           let text = bubble["text"] as? String,
           let until = bubble["until"] as? NSNumber,
           !text.isEmpty, text.count <= 120 {
            bubbleText = text
            bubbleUntil = Date(timeIntervalSince1970: until.doubleValue / 1000)
        } else {
            bubbleText = ""
            bubbleUntil = .distantPast
        }
        refreshBubble()
        if next != lastState {
            lastState = next
            webView.evaluateJavaScript("window.__setState(\"\(next)\")") { _, error in
                if let error { fputs("Live2D state update failed: \(error)\n", stderr) }
            }
        }
        if let payload, let sequence = payload["sequence"] as? Int,
           let stamp = payload["updatedAt"] as? String,
           "\(sequence):\(stamp)" != lastCueToken {
            lastCueToken = "\(sequence):\(stamp)"
            if let cue = payload["cue"] as? String, ["nod", "smile", "question", "denial", "greeting", "goodbye", "serious"].contains(cue) {
                webView.evaluateJavaScript("window.__playCue(\"\(cue)\")") { _, error in
                    if let error { fputs("Live2D cue failed: \(error)\n", stderr) }
                }
            }
        }
    }

    private func pollConfig() {
        guard let data = try? Data(contentsOf: configFile),
              let raw = String(data: data, encoding: .utf8), raw != lastConfig,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        lastConfig = raw
        let visible = payload["visible"] as? Bool ?? true
        bubbleEnabled = payload["bubbleEnabled"] as? Bool ?? true
        mouseTracking = payload["mouseTracking"] as? Bool ?? true
        if visible { window.orderFrontRegardless() } else { window.orderOut(nil) }
        let view = payload["view"] as? String == "full" ? "full" : "half"
        let height = view == "full" ? fullHeight : halfHeight
        if window.frame.height != height {
            window.setFrame(NSRect(x: window.frame.minX, y: window.frame.minY,
                                   width: 340, height: height), display: true)
            hitMap = nil
            nextSnapshot = .distantPast
        }
        if let position = payload["position"] as? [String: NSNumber],
           let x = position["x"], let y = position["y"] {
            window.setFrameOrigin(NSPoint(x: x.doubleValue, y: y.doubleValue))
        } else {
            window.setFrameOrigin(defaultOrigin())
        }
        positionBubble()
        refreshBubble()
        guard ready else { return }
        let size = min(1, max(0.6, (payload["size"] as? NSNumber)?.doubleValue ?? 1))
        webView.evaluateJavaScript("window.__setAppearance({view: \"\(view)\", size: \(size)})") { _, error in
            if let error { fputs("Live2D appearance update failed: \(error)\n", stderr) }
        }
    }

    private func pollLipSync() {
        guard ready else { return }
        let payload = (try? Data(contentsOf: lipSyncFile))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let rawId = payload?["id"] as? String ?? ""
        let startedAt = (payload?["startedAt"] as? NSNumber)?.doubleValue ?? 0
        let rawSpeaker = payload?["speakerId"] as? String ?? "emilia"
        let speaker = ["emilia", "hotaru"].contains(rawSpeaker) ? rawSpeaker : "emilia"
        let age = Date().timeIntervalSince1970 * 1000 - startedAt
        let duration = (payload?["durationMs"] as? NSNumber)?.doubleValue ?? 110_000
        let limit = min(910_000, max(120_000, duration + 10_000))
        let expiresAt = (payload?["expiresAt"] as? NSNumber)?.doubleValue ?? Double.greatestFiniteMagnitude
        let id = UUID(uuidString: rawId) != nil && age >= 0 && age < limit
            && Date().timeIntervalSince1970 * 1000 < expiresAt ? rawId : ""
        guard id != lastLipSyncId else { return }
        lastLipSyncId = id
        let script = id.isEmpty ? "window.__setLipSync(null)"
            : "window.__setLipSync({id: \"\(id)\", startedAt: \(Int64(startedAt)), speakerId: \"\(speaker)\"})"
        webView.evaluateJavaScript(script) { _, error in
            if let error { fputs("Live2D lip sync update failed: \(error)\n", stderr) }
        }
    }

    private func defaultOrigin() -> NSPoint {
        guard let frame = NSScreen.main?.visibleFrame else { return .zero }
        return NSPoint(x: frame.maxX - 340 - 12, y: frame.minY + 8)
    }

    private func makeBubbleWindow() {
        bubbleWindow = NSPanel(contentRect: NSRect(origin: .zero, size: bubbleSize),
                               styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        bubbleWindow.level = .floating
        bubbleWindow.isFloatingPanel = true
        bubbleWindow.hidesOnDeactivate = false
        bubbleWindow.isOpaque = false
        bubbleWindow.backgroundColor = .clear
        bubbleWindow.hasShadow = true
        bubbleWindow.ignoresMouseEvents = true
        bubbleWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let background = NSView(frame: NSRect(origin: .zero, size: bubbleSize))
        background.wantsLayer = true
        background.layer?.cornerRadius = 16
        background.layer?.backgroundColor = NSColor(calibratedRed: 0.96, green: 0.96, blue: 1, alpha: 0.68).cgColor
        background.layer?.borderWidth = 1
        background.layer?.borderColor = NSColor(calibratedRed: 0.65, green: 0.59, blue: 0.8, alpha: 0.42).cgColor
        bubbleLabel = NSTextField(labelWithString: "")
        bubbleLabel.frame = NSRect(x: 16, y: 11, width: bubbleSize.width - 32, height: bubbleSize.height - 22)
        bubbleLabel.font = NSFont.systemFont(ofSize: 14)
        bubbleLabel.textColor = NSColor(calibratedWhite: 0.18, alpha: 1)
        bubbleLabel.maximumNumberOfLines = 2
        bubbleLabel.cell?.wraps = true
        bubbleLabel.lineBreakMode = .byTruncatingTail
        background.addSubview(bubbleLabel)
        bubbleWindow.contentView = background
        positionBubble()
        bubbleWindow.orderOut(nil)
    }

    private func positionBubble() {
        guard let bubbleWindow else { return }
        let screen = NSScreen.screens.first { $0.frame.contains(NSPoint(x: window.frame.midX, y: window.frame.midY)) }
            ?? NSScreen.main
        guard let bounds = screen?.visibleFrame else { return }
        let x = min(max(window.frame.midX - bubbleSize.width / 2, bounds.minX + 8),
                    bounds.maxX - bubbleSize.width - 8)
        let above = window.frame.maxY + 8
        let y = above + bubbleSize.height <= bounds.maxY
            ? above : max(bounds.minY + 8, window.frame.minY - bubbleSize.height - 8)
        bubbleWindow.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func refreshBubble() {
        guard let bubbleWindow else { return }
        if bubbleEnabled && window.isVisible && !bubbleText.isEmpty && bubbleUntil > Date() {
            if bubbleLabel.stringValue != bubbleText { bubbleLabel.stringValue = bubbleText }
            if !bubbleWindow.isVisible { positionBubble(); bubbleWindow.orderFrontRegardless() }
        } else if bubbleWindow.isVisible {
            bubbleWindow.orderOut(nil)
        }
    }

    private func updateMouseTracking() {
        guard ready else { return }
        var x = 0.0
        var y = 0.0
        if mouseTracking && window.isVisible {
            // Use the global pointer position so tracking still works when
            // transparent parts of the pet window pass clicks through.
            let mouse = NSEvent.mouseLocation
            let head = NSPoint(x: window.frame.midX, y: window.frame.maxY - 78)
            let dx = Double(mouse.x - head.x)
            let dy = Double(mouse.y - head.y)
            let distance = hypot(dx, dy)
            let falloff = min(1, max(0, (1100 - distance) / 500))
            x = min(1, max(-1, dx / 600)) * 0.42 * falloff
            y = min(1, max(-1, dy / 460)) * 0.30 * falloff
        }
        guard !lastLookX.isFinite || abs(x - lastLookX) >= 0.012 || abs(y - lastLookY) >= 0.012 else { return }
        lastLookX = x
        lastLookY = y
        webView.evaluateJavaScript("window.__lookAt(\(x), \(y))", completionHandler: nil)
    }

    private func updatePointerPassThrough() {
        guard ready, window.isVisible else { return }
        if !snapshotPending && Date() >= nextSnapshot {
            snapshotPending = true
            nextSnapshot = Date().addingTimeInterval(0.25)
            webView.takeSnapshot(with: nil) { [weak self] image, _ in
                guard let self else { return }
                self.snapshotPending = false
                if let data = image?.tiffRepresentation,
                   let bitmap = NSBitmapImageRep(data: data),
                   (bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)?.alphaComponent ?? 0) > 0.1 {
                    self.hitMap = bitmap
                } else if self.hitMap == nil {
                    self.nextSnapshot = .distantPast
                }
            }
        }
        if isDragging || NSEvent.pressedMouseButtons & 1 != 0 { return }
        let mouse = NSEvent.mouseLocation
        guard let bitmap = hitMap else {
            window.ignoresMouseEvents = false
            return
        }
        guard window.frame.contains(mouse) else {
            window.ignoresMouseEvents = false
            return
        }
        let x = Int((mouse.x - window.frame.minX) * CGFloat(bitmap.pixelsWide) / window.frame.width)
        let y = Int((window.frame.maxY - mouse.y) * CGFloat(bitmap.pixelsHigh) / window.frame.height)
        guard x >= 0, x < bitmap.pixelsWide, y >= 0, y < bitmap.pixelsHigh else { return }
        window.ignoresMouseEvents = (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) < 0.08
    }

    private func persistPosition() {
        let existing = (try? Data(contentsOf: configFile))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        var payload = existing
        payload["position"] = ["x": window.frame.minX, "y": window.frame.minY]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
        do {
            try FileManager.default.createDirectory(at: configFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: configFile, options: .atomic)
            lastConfig = String(data: data, encoding: .utf8) ?? ""
        } catch {
            fputs("Cannot save pet position: \(error)\n", stderr)
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Live2DPet()
app.delegate = delegate
app.run()
