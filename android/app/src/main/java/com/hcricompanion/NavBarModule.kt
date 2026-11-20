package com.hcricompanion

import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

// Lets Settings choose what the bottom system navigation bar does:
//  - "auto"   (default): hidden to give the app the full height; an edge swipe shows it briefly.
//  - "docked": always visible, and the app's screen ends above it.
// The choice is kept in SharedPreferences (not AsyncStorage) so MainActivity can read it natively at start-up and
// every time the window regains focus, before any JavaScript has run.
object NavBarPrefs {
  private const val FILE = "hcri_navbar"
  private const val KEY = "mode"
  const val AUTO = "auto"
  const val DOCKED = "docked"

  fun get(ctx: Context): String =
      if (ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, AUTO) == DOCKED) DOCKED else AUTO

  fun set(ctx: Context, mode: String) {
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, if (mode == DOCKED) DOCKED else AUTO).apply()
  }
}

class NavBarModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "NavBar"

  @ReactMethod
  fun getMode(promise: Promise) {
    promise.resolve(NavBarPrefs.get(ctx))
  }

  // Saves the choice and applies it to the running screen straight away.
  @ReactMethod
  fun setMode(mode: String, promise: Promise) {
    NavBarPrefs.set(ctx, mode)
    val activity = currentActivity as? MainActivity
    if (activity != null) activity.runOnUiThread { activity.applyNavBarMode() }
    promise.resolve(null)
  }
}

class NavBarPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(NavBarModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
