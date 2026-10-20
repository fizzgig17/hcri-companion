// src/utils/iosUpdateLogic.ts -- pure helpers for the iOS update check (no React Native imports, so jest can run them).
//
// ios-testflight.yml publishes a GitHub release tagged "ios-prod-latest" after every PRODUCTION (master) TestFlight upload,
// with "build: <number>" and "version: <x.y>" lines in its body. The app compares that build number with its own.

export interface ProdIosBuild {
  build: number;
  version: string;
}

export function parseProdIosBuild(rel: any): ProdIosBuild | null {
  const text = `${rel?.name ?? ''}\n${rel?.body ?? ''}`;
  const b = /^\s*build:\s*(\d+)\s*$/im.exec(text);
  if (!b) return null;
  const v = /^\s*version:\s*([0-9][0-9.]*)\s*$/im.exec(text);
  return { build: parseInt(b[1], 10), version: v ? v[1] : '' };
}

/** True when the published production build is newer than the installed one. An unknown installed build never nags. */
export function isNewerIosBuild(installed: string | number, latest: number): boolean {
  const n = typeof installed === 'number' ? installed : parseInt(installed, 10);
  return Number.isFinite(n) && n > 0 && latest > n;
}
