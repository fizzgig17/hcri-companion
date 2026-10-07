// src/contexts/DevBuildContext.tsx
//
// Dev builds only: checks the "dev-latest" GitHub release (the APK deploy-dev.yml publishes on every push
// to develop) and compares its commit with the one stamped into this install. Runs once at launch and on
// demand from Settings > Update. Does nothing on production builds.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { IS_DEV_BUILD } from '../hcri/buildTarget';
import { GIT_COMMIT as STAMPED_COMMIT } from '../gitCommit';

// Widened: the checked-in literal is 'local', but the dev workflow overwrites it with the real id.
const GIT_COMMIT: string = STAMPED_COMMIT;

const RELEASE_URL = 'https://api.github.com/repos/fizzgig17/hcri-companion/releases/tags/dev-latest';

export type DevBuildStatus = 'idle' | 'checking' | 'current' | 'newer' | 'error';

interface DevBuildState {
  status: DevBuildStatus;
  /** Short (7 char) commit id of the newest published dev build, once known. */
  latest: string | null;
  error: string | null;
  check: () => Promise<void>;
  /** Opens the newest dev APK download. */
  update: () => void;
}

const Ctx = createContext<DevBuildState | null>(null);

export function DevBuildProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<DevBuildStatus>('idle');
  const [latest, setLatest] = useState<string | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!IS_DEV_BUILD) return;
    setStatus('checking');
    setError(null);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const rel = await res.json();
      const m = /[0-9a-f]{40}/i.exec(`${rel?.name ?? ''} ${rel?.body ?? ''}`);
      if (!m) throw new Error('Could not read the commit id from the dev release.');
      const sha = m[0].toLowerCase();
      const asset = (rel.assets ?? []).find((a: any) => /\.apk$/i.test(a?.name ?? ''));
      setLatest(sha.slice(0, 7));
      setApkUrl(asset?.browser_download_url ?? 'https://github.com/fizzgig17/hcri-companion/releases/tag/dev-latest');
      setStatus(GIT_COMMIT !== 'local' && sha.startsWith(GIT_COMMIT.toLowerCase()) ? 'current' : 'newer');
    } catch (e: any) {
      setError(e?.name === 'AbortError' ? 'Timed out reaching GitHub.' : e?.message ?? 'Check failed.');
      setStatus('error');
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (IS_DEV_BUILD) check();
  }, [check]);

  const update = useCallback(() => {
    if (apkUrl) Linking.openURL(apkUrl).catch(() => {});
  }, [apkUrl]);

  const value = useMemo(() => ({ status, latest, error, check, update }), [status, latest, error, check, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevBuild(): DevBuildState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDevBuild must be used inside DevBuildProvider');
  return v;
}
