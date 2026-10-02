// src/hcri/buildTarget.ts
//
// IS_DEV_BUILD and a short display label for whichever server this build
// actually talks to. Deliberately kept OUT of apiConfig.ts: deploy-dev.yml
// and deploy-master.yml each replace apiConfig.ts's entire contents with a
// single `echo "export const HCRI_API_BASE = '...';" > ...` -- not just
// that one line -- so anything else exported from that file is silently
// dropped from the built APK. This file only imports HCRI_API_BASE, which
// survives that overwrite fine (the overwritten file still exports exactly
// that one name), and is never itself touched by either workflow.

import { HCRI_API_BASE as RAW_HCRI_API_BASE } from './apiConfig';

// Widened to plain `string`: apiConfig.ts's own export has no type
// annotation, so TS infers it as the literal type of whatever's checked in
// there right now ("https://www.hcri.io"). A dev/master build swaps that
// literal (see this file's header comment) without ever touching this
// file, so the comparison below has to work against "any string", not
// just the one literal that happened to be checked in at any given time.
const HCRI_API_BASE: string = RAW_HCRI_API_BASE;

// Deliberately an exact match against the known production value rather
// than e.g. `.includes('dev')` -- a typo'd or new non-prod host should
// still read as "not production" (and get the dev banner/label), not
// silently pass as prod because it didn't happen to contain that
// substring.
export const IS_DEV_BUILD = HCRI_API_BASE !== 'https://www.hcri.io';

// "dev.hcri.io" / "www.hcri.io" -- the host alone, no scheme, all-lowercase
// as the URL actually is. Used in the dev banner.
export const HCRI_API_HOST = HCRI_API_BASE.replace(/^https?:\/\//, '');

// "dev.hCRI.io" / "hCRI.io" -- same idea, but in the app's own stylized
// branding (lowercase h, capital CRI) used everywhere else in the UI
// ("hCRI.io Username", "hCRI Companion", etc.), rather than the raw host.
// Used for anything a person reads as a label/button rather than a literal
// URL, e.g. DataTab/MainTab's "Upload to {HCRI_BRAND_HOST}" -- on a dev
// build this is what actually tells you, right on the button, that the tap
// goes to the dev server and not production.
export const HCRI_BRAND_HOST = IS_DEV_BUILD ? `dev.hCRI.io` : 'hCRI.io';
