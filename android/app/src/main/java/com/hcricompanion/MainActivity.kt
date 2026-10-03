package com.hcricompanion

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  // Confirmed 2026-10-03 as the actual cause of the "flash open then
  // crash" report, via adb's own crash buffer (repeated, going back to
  // Sept 26 -- every single occurrence is this exact exception):
  //
  //   java.lang.RuntimeException: Unable to start activity ...MainActivity
  //   Caused by: ...Unable to instantiate fragment ...ScreenStackFragment
  //   Caused by: java.lang.IllegalStateException: Screen fragments
  //     should never be restored. Follow instructions from
  //     https://github.com/software-mansion/react-native-screens/issues/17#issuecomment-424704067
  //     to properly configure your main activity.
  //
  // react-native-screens (what React Navigation's native-stack/bottom-
  // tabs navigators are built on) keeps its own screen stack as native
  // Android Fragments, and it deliberately throws rather than let Android
  // silently restore that Fragment state from a saved instance-state
  // Bundle -- which is exactly what Android tries to do here: when it
  // kills this app's process in the background to reclaim memory (common
  // after the phone's sat idle a while) but keeps the task around, a
  // later tap on the icon makes Android recreate MainActivity AND hand
  // it back the old saved Bundle, trying to restore the previous screen
  // state rather than starting fresh -- which is the native-level crash
  // the JS-level crashLog.ts logger could never have caught (see its own
  // comment on that scope limit), since this happens before any JS runs
  // at all. The fix react-native-screens' own linked issue describes:
  // never pass that Bundle through to super.onCreate -- always start
  // fresh instead of asking Android to restore anything.
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "hCRI Companion"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
