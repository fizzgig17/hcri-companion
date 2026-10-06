package com.hcricompanion

import android.graphics.Rect
import android.os.Build
import androidx.core.view.ViewCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ViewManager

// Lets the JS side tell Android "a horizontal swipe starting in these
// rectangles belongs to the app, not to the system Back gesture". With
// gesture navigation (Android 10+), a swipe that begins at the left or
// right screen edge is claimed by Back, which made paging the charts feel
// clunky: edge-adjacent swipes backed out of the app (or did nothing).
// Android caps the total exclusion at 200dp tall per edge, so JS passes
// only the chart pager's own band.
class GestureExclusionModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName() = "GestureExclusion"

  /** rects: [{x, y, width, height}] in dp, window coordinates. */
  @ReactMethod
  fun setRects(rects: ReadableArray) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val activity = ctx.currentActivity ?: return
    val density = activity.resources.displayMetrics.density
    val list = ArrayList<Rect>()
    for (i in 0 until rects.size()) {
      val r = rects.getMap(i) ?: continue
      val x = (r.getDouble("x") * density).toInt()
      val y = (r.getDouble("y") * density).toInt()
      list.add(
          Rect(
              x,
              y,
              x + (r.getDouble("width") * density).toInt(),
              y + (r.getDouble("height") * density).toInt()))
    }
    activity.runOnUiThread {
      ViewCompat.setSystemGestureExclusionRects(activity.window.decorView, list)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}
}

class GestureExclusionPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) =
      listOf(GestureExclusionModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
