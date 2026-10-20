// src/utils/iosUpdate.ts
//
// iOS update check. The app is distributed through TestFlight, which has no public lookup, so this reads the
// "ios-prod-latest" GitHub release that ios-testflight.yml publishes after each production (master) upload.
// Development TestFlight builds never publish it, and development builds of the app never check it.

import { Linking, Platform } from 'react-native';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { IOS_BUILD_NUMBER } from '../buildNumber';
import { isNewerIosBuild, parseProdIosBuild } from './iosUpdateLogic';

const RELEASE_URL = 'https://api.github.com/repos/fizzgig17/hcri-companion/releases/tags/ios-prod-latest';
const TESTFLIGHT_APP = 'itms-beta://beta.itunes.apple.com/v1/app/6821508876';

const installedBuild: string = IOS_BUILD_NUMBER;

/** Production iOS installs that know their own build number. */
export const iosUpdatesSupported = Platform.OS === 'ios' && !IS_DEV_BUILD && installedBuild !== '';

export async function checkIosUpdate(): Promise<{ available: boolean; latest: number; version: string; installed: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    if (res.status === 404) return { available: false, latest: 0, version: '', installed: parseInt(installedBuild, 10) };
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const parsed = parseProdIosBuild(await res.json());
    if (!parsed) throw new Error('Could not read the build number from the release.');
    return {
      available: isNewerIosBuild(installedBuild, parsed.build),
      latest: parsed.build,
      version: parsed.version,
      installed: parseInt(installedBuild, 10),
    };
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError' ? 'Timed out reaching GitHub.' : e?.message ?? 'Check failed.');
  } finally {
    clearTimeout(timer);
  }
}

/** Opens this app's page in the TestFlight app, where the update is installed. */
export async function openTestFlight(): Promise<void> {
  try {
    await Linking.openURL(TESTFLIGHT_APP);
  } catch {
    await Linking.openURL('https://testflight.apple.com/').catch(() => {});
  }
}
