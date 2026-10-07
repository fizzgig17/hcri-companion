package com.hcricompanion

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

// Google Play's In-App Updates API: asks Play whether a newer version of
// this app is available to this install (works for installs that came from
// Play, including closed/open testing tracks), and can start Play's own
// full-screen "update now" flow. Needs no extra manifest permission.
// For a sideloaded/debug install Play reports an error, which JS shows as
// "updates are managed by Google Play".
class InAppUpdateModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), LifecycleEventListener {

  private var lastInfo: AppUpdateInfo? = null

  init {
    ctx.addLifecycleEventListener(this)
  }

  // Google's recommendation for IMMEDIATE updates: if the person leaves Play's update screen and comes
  // back to the app while the update is still in progress, show the update screen again (otherwise the
  // app sits there while the update is stalled in the background).
  override fun onHostResume() {
    val activity = ctx.currentActivity ?: return
    try {
      val manager = AppUpdateManagerFactory.create(ctx)
      manager.appUpdateInfo.addOnSuccessListener { info ->
        if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
          lastInfo = info
          activity.runOnUiThread {
            try {
              manager.startUpdateFlow(
                  info, activity, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build())
            } catch (_: Exception) {}
          }
        }
      }
    } catch (_: Exception) {}
  }

  override fun onHostPause() {}

  override fun onHostDestroy() {}

  override fun getName() = "InAppUpdate"

  @ReactMethod
  fun checkForUpdate(promise: Promise) {
    try {
      AppUpdateManagerFactory.create(ctx)
          .appUpdateInfo
          .addOnSuccessListener { info ->
            lastInfo = info
            val a = info.updateAvailability()
            val map = Arguments.createMap()
            map.putBoolean(
                "available",
                a == UpdateAvailability.UPDATE_AVAILABLE ||
                    a == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS)
            map.putInt("versionCode", info.availableVersionCode())
            map.putBoolean("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
            promise.resolve(map)
          }
          .addOnFailureListener { e -> promise.reject("E_UPDATE_CHECK", e.message, e) }
    } catch (e: Exception) {
      promise.reject("E_UPDATE_CHECK", e.message, e)
    }
  }

  @ReactMethod
  fun startImmediateUpdate(promise: Promise) {
    val info = lastInfo
    val activity = ctx.currentActivity
    if (info == null || activity == null) {
      promise.reject("E_UPDATE_START", "No update info yet -- check for updates first.")
      return
    }
    activity.runOnUiThread {
      try {
        AppUpdateManagerFactory.create(ctx)
            .startUpdateFlow(
                info, activity, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build())
            .addOnSuccessListener { code -> promise.resolve(code) }
            .addOnFailureListener { e -> promise.reject("E_UPDATE_START", e.message, e) }
      } catch (e: Exception) {
        promise.reject("E_UPDATE_START", e.message, e)
      }
    }
  }
}

class InAppUpdatePackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(InAppUpdateModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
