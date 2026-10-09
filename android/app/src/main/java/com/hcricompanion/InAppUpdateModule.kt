package com.hcricompanion

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability

// Asks Google Play whether a newer version of this app is available to this
// install (works for installs that came from Play, including closed/open
// testing tracks). It only CHECKS: the app never starts Play's in-app update
// flow -- the update is installed from the Play Store listing, which the app
// opens from its banner / Settings > Update. Needs no extra manifest
// permission. For a sideloaded/debug install Play reports an error, which JS
// shows as "updates are managed by Google Play".
class InAppUpdateModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "InAppUpdate"

  private fun installedVersionCode(): Int =
      try {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (android.os.Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else @Suppress("DEPRECATION") pi.versionCode
      } catch (e: Exception) {
        0
      }

  @ReactMethod
  fun checkForUpdate(promise: Promise) {
    try {
      AppUpdateManagerFactory.create(ctx)
          .appUpdateInfo
          .addOnSuccessListener { info ->
            val map = Arguments.createMap()
            map.putBoolean("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
            map.putInt("versionCode", info.availableVersionCode())
            // Raw Play answer, for the log: 0 unknown, 1 not available, 2 available, 3 in progress.
            map.putInt("availability", info.updateAvailability())
            map.putInt("installedVersionCode", installedVersionCode())
            promise.resolve(map)
          }
          .addOnFailureListener { e -> promise.reject("E_UPDATE_CHECK", e.message, e) }
    } catch (e: Exception) {
      promise.reject("E_UPDATE_CHECK", e.message, e)
    }
  }
}

class InAppUpdatePackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(InAppUpdateModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
