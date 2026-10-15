// src/buildInfo.ts
//
// Shown at the top of Settings so you can tell at a glance which build
// you're looking at -- handy when debugging something that's already
// been fixed on develop but not yet rebuilt onto the phone (which has
// come up more than once this session).
//
// Deliberately NOT read from android/app/build.gradle's versionName/
// versionCode -- those are Gradle-only values with no built-in bridge
// into JS, and adding one (a native module, or a build-time codegen
// step) is more machinery than this app's simple, no-CI release process
// warrants. Kept here instead as a plain JS constant, manually updated
// in the SAME commit as every versionName/versionCode bump in
// build.gradle -- see that file's own version-bump commit history for
// the existing convention this now joins. BUILD_DATE is the date of
// that commit, not an automatic build timestamp.
// Android and iOS are versioned separately. Android: YYYY.M.D.N (date of the release and its number that day);
// iOS: 1.x. When one platform ships a release the other doesn't, bump only
// that platform's constants here and its native version: android/app/build.gradle (versionName + versionCode)
// for Android, MARKETING_VERSION in ios/hCRICompanion.xcodeproj/project.pbxproj for iOS (iOS's build number is
// the GitHub run number, see .github/workflows/ios-testflight.yml).
import { Platform } from 'react-native';

export const ANDROID_VERSION = '2026.10.15.1';
// Keep equal to versionCode in android/app/build.gradle.
export const ANDROID_BUILD_NUMBER = 53;
export const ANDROID_BUILD_DATE = '2026-10-15';
export const IOS_VERSION = '1.28';
export const IOS_BUILD_DATE = '2026-10-15';

const ios = Platform.OS === 'ios';
export const APP_VERSION = ios ? IOS_VERSION : ANDROID_VERSION;
export const BUILD_DATE = ios ? IOS_BUILD_DATE : ANDROID_BUILD_DATE;
