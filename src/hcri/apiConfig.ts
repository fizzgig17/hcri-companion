// src/hcri/apiConfig.ts
//
// Which hCRI.io site this build talks to. deploy-dev.yml and
// deploy-master.yml each overwrite this file right before bundling (see
// those workflows) so a dev-built APK always uploads to dev.hcri.io and a
// prod-built APK always uploads to www.hcri.io -- no runtime toggle, no way
// for a dev test upload to land in production data by accident. What's
// checked into git here is the production value, so a local
// `npx react-native run-android` (nobody's touched this file) matches what
// `master` ships.

export const HCRI_API_BASE = 'https://www.hcri.io';
