This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

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
