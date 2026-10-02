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

// Derived, not a separate flag to remember to flip: deploy-dev.yml/
// deploy-master.yml overwrite HCRI_API_BASE above, nothing else, so
// whether this build is "dev" is entirely a function of that one value.
// Deliberately an exact match against the known production value rather
// than e.g. `.includes('dev')` -- a typo'd or new non-prod host should
// still read as "not production" (and get the banner), not silently pass
// as prod because it didn't happen to contain that substring.
export const IS_DEV_BUILD = HCRI_API_BASE !== 'https://www.hcri.io';
