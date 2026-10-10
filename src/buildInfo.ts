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
export const APP_VERSION = '1.22';
export const BUILD_DATE = '2026-10-10';
