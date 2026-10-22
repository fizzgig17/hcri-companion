package com.hcricompanion

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

// Two things the share card needs that React Native does not do on Android:
//  - copyPng: puts a PNG on the clipboard as an image (the community clipboard module only does text on Android).
//    The file is exposed through the FileProvider that react-native-share already declares (its cache-path covers
//    the app's cache folder), so apps that paste it can read it.
//  - savePng: saves a PNG into the phone's Pictures/hCRI folder through MediaStore (no permission needed on
//    Android 10+; older phones reject and the JS side falls back to the share sheet).
class ImageClipboardModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "ImageClipboard"

  @ReactMethod
  fun copyPng(path: String, promise: Promise) {
    try {
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) throw IllegalArgumentException("The image file is missing")
      val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".rnshare.fileprovider", file)
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newUri(ctx.contentResolver, "hCRI share card", uri))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("copy_failed", e.message ?: "Could not copy the image", e)
    }
  }

  @ReactMethod
  fun savePng(path: String, displayName: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("unsupported", "Saving to Pictures needs Android 10 or newer")
      return
    }
    try {
      val file = File(path.removePrefix("file://"))
      if (!file.exists()) throw IllegalArgumentException("The image file is missing")
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/hCRI")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
      val resolver = ctx.contentResolver
      val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
          ?: throw IllegalStateException("Could not create the picture")
      resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
          ?: throw IllegalStateException("Could not write the picture")
      values.clear()
      values.put(MediaStore.Images.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      promise.resolve("Pictures/hCRI/$displayName")
    } catch (e: Exception) {
      promise.reject("save_failed", e.message ?: "Could not save the image", e)
    }
  }
}

class ImageClipboardPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext) = listOf(ImageClipboardModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
