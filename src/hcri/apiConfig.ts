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

// Optional per-machine override (untracked, see apiConfig.local.ts.example), e.g. to point a local iOS
// build at dev.hcri.io. CI workflows overwrite this whole file, so they are unaffected.
let base = 'https://www.hcri.io';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const local = require('./apiConfig.local');
  if (local && typeof local.HCRI_API_BASE === 'string' && local.HCRI_API_BASE) base = local.HCRI_API_BASE;
} catch {
  // no local override: use production
}
export const HCRI_API_BASE: string = base;

// IS_DEV_BUILD, derived from the line above, deliberately does NOT live in
// this file -- deploy-dev.yml/deploy-master.yml each replace this file's
// ENTIRE CONTENTS with a single `echo "export const HCRI_API_BASE = ...;"
// > src/hcri/apiConfig.ts`, not just that one line, so anything else
// checked in here (a second export, these very comments) is silently gone
// from the built APK. See buildTarget.ts, which only *imports*
// HCRI_API_BASE from here -- that survives the overwrite fine, since the
// overwritten file still exports exactly that one name.
