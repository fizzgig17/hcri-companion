# hCRI Companion

A React Native app (Android and iPhone) that connects over Bluetooth Low Energy to a Hopoocolor HPCS
spectrometer, or to a Torch Bearer through the [ESP32 bridge](https://github.com/fizzgig17/hcri-esp32-bridge),
computes CCT, Duv, CRI, R1-R15 and TM-30 on the phone with the same math as [hCRI.io](https://www.hcri.io), and
uploads readings to your hCRI.io account. User manual: <https://www.hcri.io/companion/manual/>.

# Development

Requirements: Node 22.11+, the [React Native environment](https://reactnative.dev/docs/set-up-your-environment),
Android Studio (Android) and Xcode with CocoaPods (iOS).

```sh
npm install
npm start            # Metro
npm run android      # or: npm run ios
npx tsc --noEmit     # type check
```

iOS, first time and after native dependency changes:

```sh
bundle install
cd ios && bundle exec pod install && cd ..
```

## Pointing a build at dev.hcri.io

Production (`https://www.hcri.io`) is the checked-in default. To test against the dev site, copy
`src/hcri/apiConfig.local.ts.example` to `src/hcri/apiConfig.local.ts` (untracked) and set `HCRI_API_BASE`.
A dev build shows a "DEV BUILD" strip at the top. CI overwrites `apiConfig.ts` itself, so CI builds are unaffected.

## Running on your own iPhone

Copy `ios/Config/Local.xcconfig.example` to `ios/Config/Local.xcconfig` (untracked) and set your Apple
`DEVELOPMENT_TEAM` (the 10-character Team ID). A free personal team can install on a device for 7 days at a time; TestFlight needs
the paid Apple Developer Program.

## Branches and CI

- `develop` is the working branch; `master` is the release branch.
- Pushes to `develop` and `master` run the iOS build check (`ios-build.yml`). `ios-testflight.yml` is a manual
  workflow that needs the App Store Connect secrets.
- Pushes to `master` build the Android release (`deploy-master.yml`); see "Publishing to Google Play" below.
- Versioning: bump `versionCode`/`versionName` in `android/app/build.gradle`, `MARKETING_VERSION` and
  `CURRENT_PROJECT_VERSION` in the Xcode project, `APP_VERSION` in `src/buildInfo.ts`, and write `whatsnew/whatsnew-en-US`.
  Update the manual on hcri.io for each release.

## Where things are

- `src/ble/` meter connections (HPCS models, Torch Bearer, Live and Flicker)
- `src/hcri/` hCRI.io API calls (upload, flicker, LED lists, links, tokens; all network calls go through `fetchWithTimeout`)
- `src/storage/` History and preferences (History keeps the latest 100 readings; unuploaded readings are protected up to 200)
- `src/screens/`, `src/components/` UI (main tabs live in `src/screens/tabs/`)

# Flicker

On meters that support it (HPCS-330P class), the Flicker tab (the fourth chart page on Main) measures flicker frequency, percent flicker, flicker index, cycle time and the waveform. The bottom-bar **Flicker** button only takes you to that tab; it is hidden while a Live reading runs.

There are two kinds of flicker sample, started from the buttons under the chart:

- **New sample** starts an independent sample. It clears the current reading from Main (a reading that was saved stays in History). When stopped it can be **Shared** or **Uploaded** on its own to hCRI.io (title and notes popup; both are remembered between uploads). It is not added to History.
- **Add to reading / Redo for reading** takes a sample that belongs to the current reading. It is saved with that reading (and in History) and uploaded together with it. It is only offered until the reading has been uploaded, since an uploaded report can't change. Flicker belonging to a reading has no Share/Upload of its own.

**Stop** ends whichever sample is running. Settings -> "Capture flicker with each reading" (off by default) takes a one-shot flicker snapshot automatically after each reading. History marks readings that have flicker with a small waveform icon.

## Uploading flicker to hCRI.io

Flicker uses the hCRI.io API with the same personal token as report uploads:

- With a reading: the report is uploaded first, then a flicker reading is posted to `POST /index.php/api/v1/flicker` with the returned `reportId`, so it appears in the report's flicker section.
- On its own: the same endpoint without `reportId` (shows under Explore -> Flicker on hCRI.io).

The flicker post is best-effort and never changes the outcome of the report upload.

# License

hCRI Companion is free software, © 2026 fizzgig, licensed under the GNU General Public License v3 or later, with an additional permission (GPL section 7) allowing distribution through app stores such as Apple's App Store. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

# Contributing

Bug reports and suggestions are welcome as issues. Code contributions are accepted only if the contributor agrees, in writing (a comment on the pull request is enough), that their contribution may be included under the project's license **including the App Store additional permission** in [LICENSE](LICENSE). Pull requests without that statement can't be merged.

# Publishing to Google Play

Every push to `master` builds the release AAB (`.github/workflows/deploy-master.yml`) and, once configured, uploads it to Google Play.

One-time setup:

1. In Google Cloud, create a service account and enable the **Google Play Android Developer API**; create a JSON key for it.
2. In Play Console -> Users and permissions, invite the service account's email and grant it release permissions for this app (this can take a while to take effect).
3. In GitHub -> Settings -> Secrets and variables -> Actions, add the secret `PLAY_SERVICE_ACCOUNT_JSON` (the whole JSON key). Until it exists the upload step is skipped.
4. Optional repository variables: `PLAY_TRACK` (default `alpha`, the standard closed-testing track; or your custom closed track's name, `internal`, `production`) and `PLAY_RELEASE_STATUS` (default `completed`; use `draft` while the store listing is incomplete).

Each release: bump `versionCode`/`versionName` in `android/app/build.gradle` (Play rejects a versionCode that isn't higher than every earlier upload) and update `whatsnew/whatsnew-en-US` (max 500 characters). The very first upload of an app must still be done by hand in Play Console.
