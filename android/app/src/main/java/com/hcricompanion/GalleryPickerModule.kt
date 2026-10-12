package com.hcricompanion

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.ByteArrayOutputStream

// Opens Android's standard "choose an app" list for an image (Gallery, Google Photos, Files, ...), which the system
// photo picker used by react-native-image-picker does not offer (no Gallery app such as Samsung Gallery). The chosen
// image is scaled down to at most 1600 px and returned to JS as base64 JPEG. Resolves null when the user backs out.
class GalleryPickerModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private var pending: Promise? = null
  private val REQ = 7421

  private val listener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQ) return
      val p = pending ?: return
      pending = null
      val uri: Uri? = data?.data
      if (resultCode != Activity.RESULT_OK || uri == null) { p.resolve(null); return }
      Thread {
        try {
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
          var sample = 1
          while (bounds.outWidth / sample > 3200 || bounds.outHeight / sample > 3200) sample *= 2
          val opts = BitmapFactory.Options().apply { inSampleSize = sample }
          val bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
              ?: throw Exception("Could not read that image")
          val scale = Math.min(1f, 1600f / Math.max(bmp.width, bmp.height))
          val out = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
          val bos = ByteArrayOutputStream()
          out.compress(Bitmap.CompressFormat.JPEG, 85, bos)
          val map = Arguments.createMap()
          map.putString("base64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP))
          map.putString("type", "image/jpeg")
          map.putString("name", "photo.jpg")
          p.resolve(map)
        } catch (e: Throwable) {
          p.reject("E_GALLERY_READ", e.message, e)
        }
      }.start()
    }
  }

  init { ctx.addActivityEventListener(listener) }

  override fun getName() = "GalleryPicker"

  @ReactMethod
  fun pick(promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) { promise.reject("E_NO_ACTIVITY", "No active screen"); return }
    pending?.resolve(null)
    pending = promise
    try {
      val intent = Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }
      activity.startActivityForResult(Intent.createChooser(intent, "Choose a photo"), REQ)
    } catch (e: Exception) {
      pending = null
      promise.reject("E_GALLERY_OPEN", e.message, e)
    }
  }
}

class GalleryPickerPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(GalleryPickerModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
