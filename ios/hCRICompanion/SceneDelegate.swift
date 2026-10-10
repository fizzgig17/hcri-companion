import UIKit
import React
import React_RCTAppDelegate

// Creates the window for each scene and starts React Native in it. Required since the newest iOS SDKs
// no longer launch apps that don't use the UIScene life cycle.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let factory = (UIApplication.shared.delegate as? AppDelegate)?.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window

    factory.startReactNative(
      withModuleName: "hCRI Companion",
      in: window,
      launchOptions: nil
    )
  }
}
