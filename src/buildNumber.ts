// src/buildNumber.ts
//
// iOS build number (the GitHub run number of the TestFlight workflow). '' in the repo; ios-testflight.yml overwrites
// this file just before building, the same way gitCommit.ts is written. Android's build number is its versionCode,
// kept in buildInfo.ts.
export const IOS_BUILD_NUMBER = '';
