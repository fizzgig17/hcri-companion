package com.hcricompanion

import android.app.Activity
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

// Google Play in-app updates (works for installs that came from Play, including closed/open testing tracks).
//   checkForUpdate  asks Play whether a newer version is available (and whether one is already downloaded).
//   startUpdate     starts a FLEXIBLE update: Play shows its small confirmation dialog, then downloads in the background
//                   while the app keeps running. Progress is sent to JS as "InAppUpdateState" events.
//   completeUpdate  installs the downloaded update and restarts the app.
// Needs no extra manifest permission. For a sideloaded/debug install Play reports an error, which JS shows as
// "updates are managed by Google Play".
class InAppUpdateModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "InAppUpdate"

  private val manager: AppUpdateManager by lazy { AppUpdateManagerFactory.create(ctx) }
  private var startPromise: Promise? = null
  private var listening = false

  private val installListener: InstallStateUpdatedListener = InstallStateUpdatedListener { state ->
    val map = Arguments.createMap()
    map.putInt("status", state.installStatus())
    map.putDouble("bytesDownloaded", state.bytesDownloaded().toDouble())
    map.putDouble("totalBytes", state.totalBytesToDownload().toDouble())
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("InAppUpdateState", map)
    if (state.installStatus() == InstallStatus.INSTALLED || state.installStatus() == InstallStatus.FAILED ||
        state.installStatus() == InstallStatus.CANCELED) {
      manager.unregisterListener(installListener)
      listening = false
    }
  }

  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQ_UPDATE) return
      val p = startPromise ?: return
      startPromise = null
      p.resolve(if (resultCode == Activity.RESULT_OK) "accepted" else "declined")
    }
  }

  init {
    ctx.addActivityEventListener(activityListener)
  }

  companion object {
    const val REQ_UPDATE = 7421
  }

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
            // 11 = DOWNLOADED (a flexible update is waiting for the restart), 2 = downloading.
            map.putInt("installStatus", info.installStatus())
            promise.resolve(map)
          }
          .addOnFailureListener { e -> promise.reject("E_UPDATE_CHECK", e.message, e) }
    } catch (e: Exception) {
      promise.reject("E_UPDATE_CHECK", e.message, e)
    }
  }
  @ReactMethod
  fun startUpdate(promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "The app is not in the foreground.")
      return
    }
    try {
      manager.appUpdateInfo
          .addOnSuccessListener { info ->
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE ||
                !info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
              promise.reject("E_NOT_ALLOWED", "Play does not offer an in-app update right now.")
              return@addOnSuccessListener
            }
            if (!listening) {
              manager.registerListener(installListener)
              listening = true
            }
            startPromise = promise
            try {
              manager.startUpdateFlowForResult(info, activity, AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(), REQ_UPDATE)
            } catch (e: Exception) {
              startPromise = null
              promise.reject("E_UPDATE_START", e.message, e)
            }
          }
          .addOnFailureListener { e -> promise.reject("E_UPDATE_CHECK", e.message, e) }
    } catch (e: Exception) {
      promise.reject("E_UPDATE_START", e.message, e)
    }
  }

  /** Installs the downloaded update; the app restarts. */
  @ReactMethod
  fun completeUpdate(promise: Promise) {
    try {
      manager.completeUpdate()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_UPDATE_COMPLETE", e.message, e)
    }
  }

  // JS subscribes with DeviceEventEmitter, which needs no native listener bookkeeping; these keep NativeEventEmitter quiet if used.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

}

class InAppUpdatePackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(InAppUpdateModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
