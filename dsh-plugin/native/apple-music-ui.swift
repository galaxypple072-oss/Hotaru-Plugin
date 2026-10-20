import AppKit
import ApplicationServices
import Foundation

// Used only for catalog songs that Music's scripting dictionary cannot play.
// Never prompts for permission or activates Music. Only Music's accessibility
// controls are used after validating the catalog title and duration.
func finish(_ value: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}
let trusted = AXIsProcessTrusted()
let action = CommandLine.arguments.dropFirst().first ?? "status"
if action == "status" { finish(["accessibilityGranted": trusted, "available": trusted, "bridgeVersion": "ax-queue-1"]) }
if !trusted { finish(["needsAccessibility": true, "requested": false]) }
guard ["play", "queue", "add", "restrict-playlist"].contains(action), CommandLine.arguments.count == 3,
      let data = CommandLine.arguments[2].data(using: .utf8),
      let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
else { finish(["requested": false, "error": "invalid-song"]) }
let title = input["title"] as? String ?? ""
let duration = input["duration"] as? Double ?? 0

func attribute(_ element: AXUIElement, _ key: String) -> AnyObject? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ key: String) -> String {
    attribute(element, key) as? String ?? ""
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}
func normalized(_ value: String) -> String {
    value.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        .filter { !$0.isWhitespace }
}
func texts(_ element: AXUIElement, depth: Int = 0) -> [String] {
    if depth > 5 { return [] }
    return [text(element, kAXTitleAttribute), text(element, kAXValueAttribute), text(element, kAXDescriptionAttribute)]
        + children(element).flatMap { texts($0, depth: depth + 1) }
}
func matches(_ row: AXUIElement) -> Bool {
    let values = texts(row)
    guard values.contains(where: { normalized($0) == normalized(title) }) else { return false }
    // Protect against the old/incorrect selection, including cover versions.
    return values.contains { value in
        let parts = value.split(separator: ":")
        guard parts.count == 2, let minutes = Double(parts[0]), let seconds = Double(parts[1]) else { return false }
        return abs(minutes * 60 + seconds - duration) < 3
    }
}
func find(_ root: AXUIElement, matching predicate: (AXUIElement) -> Bool) -> AXUIElement? {
    var pending: [(AXUIElement, Int)] = [(root, 0)], visited = 0
    while visited < pending.count && visited < 3500 {
        let (element, depth) = pending[visited]
        visited += 1
        if predicate(element) { return element }
        if depth < 14 { pending.append(contentsOf: children(element).map { ($0, depth + 1) }) }
    }
    return nil
}
func selectedSong(_ root: AXUIElement) -> AXUIElement? {
    guard let table = find(root, matching: { text($0, kAXIdentifierAttribute) == "trackTable" }) else { return nil }
    let rows = attribute(table, kAXSelectedRowsAttribute) as? [AXUIElement] ?? []
    return rows.first(where: matches) ?? children(table).first(where: matches)
}
func songMenu(_ row: AXUIElement) -> AXUIElement? {
    guard let more = find(row, matching: {
        text($0, kAXIdentifierAttribute) == "actionButton" ||
        text($0, kAXRoleAttribute) == kAXButtonRole && ["更多", "More"].contains(text($0, kAXDescriptionAttribute))
    }) else { return nil }
    AXUIElementPerformAction(more, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.3)
    return find(more, matching: { text($0, kAXRoleAttribute) == kAXMenuRole })
}
func queuedTarget(_ application: AXUIElement) -> Bool {
    guard let container = find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" }),
          let table = find(container, matching: { text($0, kAXRoleAttribute) == kAXTableRole }) else { return false }
    let rows = (attribute(table, kAXRowsAttribute) as? [AXUIElement] ?? children(table)).suffix(32)
    var manual = false
    for row in rows {
        let values = texts(row)
        if values.contains(where: { ["队列", "佇列", "Queue", "接着播放", "接下來播放", "Playing Next", "Up Next"].contains($0) }) {
            manual = true; continue
        }
        if values.contains(where: { $0.contains("自动连播") || $0.contains("Autoplay") }) { break }
        if manual, let credit = values.first(where: { $0.contains(" — ") }) {
            let credits = credit.components(separatedBy: " — ")
            let album = input["album"] as? String ?? ""
            return values.contains(where: { normalized($0) == normalized(title) }) &&
                normalized(credits.first ?? "") == normalized(input["artist"] as? String ?? "") &&
                (album.isEmpty || normalized(credits.dropFirst().joined(separator: " — ")) == normalized(album))
        }
    }
    return false
}

if action == "restrict-playlist" {
    guard let music = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").first
    else { finish(["requested": false, "error": "music-not-running"]) }
    let application = AXUIElementCreateApplication(music.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.3)
    var queueRoot = find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" })
    if queueRoot == nil,
       let button = find(application, matching: { text($0, kAXIdentifierAttribute) == "Music.miniPlayer.queueButton" }) {
        AXUIElementPerformAction(button, kAXPressAction as CFString)
        Thread.sleep(forTimeInterval: 0.3)
        queueRoot = find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" })
    }
    guard let queueRoot else { finish(["requested": false, "error": "queue-controls-unavailable"]) }
    func enabled(_ element: AXUIElement) -> Bool? {
        if let value = attribute(element, kAXValueAttribute) as? NSNumber { return value.boolValue }
        let value = text(element, kAXValueAttribute).lowercased()
        if ["on", "1", "true"].contains(value) { return true }
        if ["off", "0", "false"].contains(value) { return false }
        return nil
    }
    var mixingAvailable = false
    for id in ["autoplay", "mixing"] {
        guard let toggle = find(queueRoot, matching: { text($0, kAXIdentifierAttribute) == id }) else {
            // Music hides AutoMix when stopped or when the current track is
            // ineligible. Its absence is not an enabled transition. Recheck
            // after playback starts, when it may become available again.
            if id == "mixing" { continue }
            finish(["requested": false, "error": id + "-control-unavailable"])
        }
        if id == "mixing" { mixingAvailable = true }
        guard let isOn = enabled(toggle) else { finish(["requested": false, "error": "unknown-" + id + "-state"]) }
        if isOn {
            AXUIElementPerformAction(toggle, kAXPressAction as CFString)
            Thread.sleep(forTimeInterval: 0.25)
        }
        guard enabled(toggle) == false else { finish(["requested": false, "error": "cannot-disable-" + id]) }
    }
    finish(["requested": true, "autoplay": false, "mixingAvailable": mixingAvailable,
            "mixing": mixingAvailable ? false as Any : NSNull()])
}

if action == "queue" {
    guard let music = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").first
    else { finish(["available": false, "rows": []]) }
    let application = AXUIElementCreateApplication(music.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.3)
    func queueContainer() -> AXUIElement? { find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" }) }
    var container = queueContainer()
    if container == nil, let button = find(application, matching: { text($0, kAXIdentifierAttribute) == "Music.miniPlayer.queueButton" }) {
        AXUIElementPerformAction(button, kAXPressAction as CFString)
        Thread.sleep(forTimeInterval: 0.4)
        container = queueContainer()
    }
    guard let container, let table = find(container, matching: { text($0, kAXRoleAttribute) == kAXTableRole })
    else { finish(["available": false, "rows": [], "error": "queue-unavailable"]) }
    let rows = attribute(table, kAXRowsAttribute) as? [AXUIElement] ?? children(table)
    var output: [[String: String]] = [], section = "history"
    for row in rows.suffix(32) {
        let values = texts(row).filter { !$0.isEmpty }
        if values.contains(where: { $0.contains("自动连播") || $0.contains("自動播放") || $0.contains("Autoplay") }) { section = "autoplay"; continue }
        if values.contains(where: { ["队列", "佇列", "Queue", "继续播放", "接着播放", "接下來播放", "Playing Next", "Up Next"].contains($0) }) { section = "next"; continue }
        if values.contains("历史记录") || values.contains("History") { section = "history"; continue }
        if section != "history", let label = values.first(where: { $0.contains(" — ") }) {
            let songTitle = values.first(where: { $0 != label && !["更多", "More"].contains($0) }) ?? ""
            output.append(["label": songTitle + " " + label, "section": section])
            if output.count >= 16 { break }
        }
    }
    finish(["available": true, "rows": output])
}

guard !title.isEmpty, duration > 0,
      let address = input["url"] as? String, let url = URL(string: address),
      url.host == "music.apple.com", ["music", "https"].contains(url.scheme ?? ""),
      url.user == nil, url.password == nil, url.port == nil,
      let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Music")
else { finish(["requested": false, "error": "invalid-song"]) }

let configuration = NSWorkspace.OpenConfiguration()
configuration.activates = false
var opened = false, failure: Error?
if let music = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").first {
    let application = AXUIElementCreateApplication(music.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 0.5)
    opened = selectedSong(application) != nil
}
if !opened {
    NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration) { _, error in
        failure = error; opened = true
    }
}
let openDeadline = Date().addingTimeInterval(5)
while !opened && Date() < openDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
guard opened, failure == nil else { finish(["requested": false, "error": "open-failed"]) }

let deadline = Date().addingTimeInterval(10)
var matchedRowSeen = false
while Date() < deadline {
    if let music = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").first {
        let application = AXUIElementCreateApplication(music.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.5)
        // Music's catalog web content can omit its AX descendants for a new
        // accessibility client until enhanced UI is requested. This does not
        // change system permissions or activate the Music window.
        AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        if let row = selectedSong(application) {
            matchedRowSeen = true
            if action == "add" {
                guard let menu = songMenu(row) else { finish(["requested": false, "error": "song-menu-unavailable"]) }
                var item: AXUIElement?
                if input["favorites"] as? Bool == true {
                    if find(menu, matching: { ["撤销喜爱", "撤銷喜愛", "Undo Favorite", "Unfavorite"].contains(text($0, kAXTitleAttribute)) }) != nil {
                        AXUIElementPerformAction(menu, kAXCancelAction as CFString)
                        finish(["requested": true, "alreadyAdded": true])
                    }
                    item = find(menu, matching: { text($0, kAXRoleAttribute) == kAXMenuItemRole && ["喜爱", "喜愛", "Favorite"].contains(text($0, kAXTitleAttribute)) })
                } else if let addMenu = find(menu, matching: { ["添加到播放列表", "加入播放列表", "加入播放清單", "Add to Playlist"].contains(text($0, kAXTitleAttribute)) }) {
                    AXUIElementPerformAction(addMenu, kAXPressAction as CFString)
                    Thread.sleep(forTimeInterval: 0.3)
                    if let submenu = find(addMenu, matching: { text($0, kAXRoleAttribute) == kAXMenuRole }) {
                        item = find(submenu, matching: { text($0, kAXRoleAttribute) == kAXMenuItemRole && text($0, kAXTitleAttribute) == (input["playlistName"] as? String ?? "") })
                    }
                }
                guard let item else {
                    AXUIElementPerformAction(menu, kAXCancelAction as CFString)
                    finish(["requested": false, "error": "destination-menu-unavailable"])
                }
                let pressed = AXUIElementPerformAction(item, kAXPressAction as CFString)
                if pressed != .success { AXUIElementPerformAction(menu, kAXCancelAction as CFString) }
                Thread.sleep(forTimeInterval: 0.4)
                finish(["requested": pressed == .success])
            }
            // Reuse an already confirmed first entry when retrying a start;
            // repeatedly clicking Play must not enqueue duplicate copies.
            if !queuedTarget(application) {
                // Scope to THIS row's popup. Searching the whole app also finds
                // hidden Song/Controls menu items with the same localized title.
                let menu = songMenu(row)
                guard let menu, let next = find(menu, matching: {
                    text($0, kAXRoleAttribute) == kAXMenuItemRole &&
                    ["插播", "接着播放", "接下來播放", "Play Next"].contains(text($0, kAXTitleAttribute))
                }) else {
                    if let menu { AXUIElementPerformAction(menu, kAXCancelAction as CFString) }
                    finish(["requested": false, "error": "play-next-unavailable"])
                }
                let result = AXUIElementPerformAction(next, kAXPressAction as CFString)
                if result != .success {
                    AXUIElementPerformAction(menu, kAXCancelAction as CFString)
                    finish(["requested": false, "error": "play-next-failed"])
                }
                Thread.sleep(forTimeInterval: 1.5)
            }
            var pendingQueue = find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" })
            if pendingQueue == nil, let queueButton = find(application, matching: { text($0, kAXIdentifierAttribute) == "Music.miniPlayer.queueButton" }) {
                AXUIElementPerformAction(queueButton, kAXPressAction as CFString)
                Thread.sleep(forTimeInterval: 0.3)
                pendingQueue = find(application, matching: { text($0, kAXIdentifierAttribute) == "headerContainer" })
            }
            guard queuedTarget(application) else { finish(["requested": false, "error": "queue-insert-unconfirmed"]) }
            guard let advance = find(application, matching: { text($0, kAXIdentifierAttribute) == "Music.miniPlayer.trailingTransportControl" }),
                  AXUIElementPerformAction(advance, kAXPressAction as CFString) == .success
            else { finish(["requested": false, "error": "queue-advance-failed"]) }
            Thread.sleep(forTimeInterval: 0.3)
            if let transport = find(application, matching: { text($0, kAXIdentifierAttribute) == "Music.miniPlayer.playbackTransportControl" }),
               ["播放", "Play"].contains(text(transport, kAXDescriptionAttribute)) {
                AXUIElementPerformAction(transport, kAXPressAction as CFString)
            }
            finish(["requested": true])
        }
    }
    Thread.sleep(forTimeInterval: 0.2)
}
finish(["requested": false, "error": matchedRowSeen ? "song-menu-button-unavailable" : "selected-song-mismatch"])
