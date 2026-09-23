//
//  ViewController.swift
//  Comment Summarizer
//
//  Created by Nick Schoch on 9/3/26.
//

import Cocoa
import SafariServices
import WebKit

/// Last-resort identifier, used only if the bundled web extension cannot be
/// located at runtime. Must match the Extension target's
/// PRODUCT_BUNDLE_IDENTIFIER in project.pbxproj — kept in sync by
/// tools/verify-open-preferences-fix.sh (App Store rejection 2.1(a), Sep 2026:
/// the Xcode-template placeholder bundle identifier hardcoded in this file
/// made SFSafariApplication/SFSafariExtensionManager calls no-ops).
let fallbackExtensionBundleIdentifier = "com.theschochs.doxa.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private var preferencesOpened = false
    private var guaranteedQuit: DispatchWorkItem?

    /// Bundle identifier of the Safari web extension bundled with this app.
    ///
    /// Discovered from the .appex that Xcode embeds in Contents/PlugIns, so
    /// the identifier can never drift out of sync with the actual extension
    /// bundle (the template's hardcoded placeholder caused the 2.1(a)
    /// rejection: with an identifier the system does not recognise, recent
    /// macOS opens no settings pane and never invokes the completion
    /// handlers, so the button appeared dead).
    static func bundledExtensionIdentifier() -> String {
        let pluginsURL = Bundle.main.bundleURL.appendingPathComponent("Contents/PlugIns")
        if let urls = try? FileManager.default.contentsOfDirectory(at: pluginsURL, includingPropertiesForKeys: nil) {
            for url in urls where url.pathExtension == "appex" {
                guard
                    let bundle = Bundle(url: url),
                    let extensionInfo = bundle.infoDictionary?["NSExtension"] as? [String: Any],
                    extensionInfo["NSExtensionPointIdentifier"] as? String == "com.apple.Safari.web-extension"
                else { continue }
                if let identifier = bundle.bundleIdentifier {
                    return identifier
                }
            }
        }
        return fallbackExtensionBundleIdentifier
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let identifier = Self.bundledExtensionIdentifier()

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: identifier) { (state, error) in
            guard let state = state, error == nil else {
                NSLog("Doxa: could not read Safari web extension state (id: \(identifier), error: \(String(describing: error)))")
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String, body == "open-preferences" else {
            return
        }

        openSafariExtensionPreferences()
    }

    /// Opens the settings pane that toggles the Safari web extension, then
    /// quits. Both halves of the button's promise are guaranteed:
    /// - if `showPreferencesForExtension` reports an error, the pane is
    ///   opened via a `x-apple.systempreferences` URL instead;
    /// - if Safari's API never invokes its completion handler (observed on
    ///   recent macOS when the extension identifier is not recognised), a
    ///   timed work item forces the fallback and the quit, so the button can
    ///   never again appear to do nothing.
    private func openSafariExtensionPreferences() {
        preferencesOpened = false

        let guaranteedQuit = DispatchWorkItem { [weak self] in
            guard let self, !self.preferencesOpened else { return }
            NSLog("Doxa: showPreferencesForExtension did not report within 5 s; opening the Extensions pane directly and quitting.")
            self.openExtensionsSettingsPane()
            NSApplication.shared.terminate(nil)
        }
        self.guaranteedQuit = guaranteedQuit
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0, execute: guaranteedQuit)

        let identifier = Self.bundledExtensionIdentifier()
        SFSafariApplication.showPreferencesForExtension(withIdentifier: identifier) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.preferencesOpened = true
                self.guaranteedQuit?.cancel()

                if let error {
                    NSLog("Doxa: showPreferencesForExtension failed (id: \(identifier)): \(error)")
                    self.openExtensionsSettingsPane()
                }

                NSApplication.shared.terminate(nil)
            }
        }
    }

    /// Opens the settings pane that lists Safari web extensions, trying the
    /// identifiers known for each macOS generation. The identifier-less URL
    /// at the end still launches System Settings, so an action always occurs.
    private func openExtensionsSettingsPane() {
        let candidates = [
            "x-apple.systempreferences:com.apple.ExtensionsPreferences?Safari",
            "x-apple.systempreferences:com.apple.Settings.Extensions",
            "x-apple.systempreferences:com.apple.preference.extensions",
            "x-apple.systempreferences:",
        ]
        for candidate in candidates {
            guard let url = URL(string: candidate) else { continue }
            if NSWorkspace.shared.open(url) {
                return
            }
        }
    }

}
