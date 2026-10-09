// src/contexts/UpdateContext.tsx
//
// Checks Google Play for a newer version each time the app loads, and
// shares the result with the banner and the Settings > Update tab. It only
// checks; installing the update happens in the Play Store.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useLog } from './LogContext';
import { checkForUpdate, openPlayStore, updatesSupported } from '../utils/inAppUpdate';

export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'error';

interface UpdateState {
  status: UpdateStatus;
  availableVersionCode: number;
  /** One-line summary of Play's last answer (also written to the log). */
  detail: string;
  error: string | null;
  /** The banner was dismissed for this version (reappears next launch). */
  bannerDismissed: boolean;
  /** announce=true (the launch check) lets the top banner appear; the Update tab's own check just updates its text. */
  check: (announce?: boolean) => Promise<void>;
  /** The banner may show (set by the launch check or the test button). */
  bannerEligible: boolean;
  /** Opens the app's Play Store listing, where the update is installed. */
  openStore: () => Promise<void>;
  dismissBanner: () => void;
}

const Ctx = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [availableVersionCode, setCode] = useState(0);
  const [detail, setDetail] = useState('');
  const { appendLog } = useLog();
  const lastCheckRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissedCode, setDismissedCode] = useState(0);
  const [bannerEligible, setBannerEligible] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async (announce: boolean = false) => {
    if (busy.current) return;
    if (!updatesSupported) {
      setStatus('error');
      setError('Update checks are only available on Android.');
      return;
    }
    busy.current = true;
    lastCheckRef.current = Date.now();
    setBannerEligible(false);
    setStatus('checking');
    setError(null);
    try {
      const info = await checkForUpdate();
      const names = ['unknown', 'not available', 'available', 'in progress'];
      const d = `Play says: ${names[info.availability] ?? info.availability}; newest version code ${info.versionCode}; installed version code ${info.installedVersionCode}`;
      setDetail(d);
      appendLog(`Update check (${announce ? 'automatic' : 'manual'}): ${d}`);
      setCode(info.versionCode);
      setStatus(info.available ? 'available' : 'uptodate');
      setBannerEligible(announce && info.available);
    } catch (e: any) {
      // Typically: not installed from Google Play (sideloaded/debug build).
      setStatus('error');
      setError(e?.message || 'Could not check for updates.');
      setDetail('');
      appendLog(`Update check failed: ${e?.message || 'unknown error'}`);
    } finally {
      busy.current = false;
    }
  }, [appendLog]);

  // When the app loads, and again each time it returns to the foreground
  // (at most once a minute) -- Play can take a while to start offering a release.
  useEffect(() => {
    check(true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - lastCheckRef.current > 60_000) check(true);
    });
    return () => sub.remove();
  }, [check]);

  const value = useMemo<UpdateState>(
    () => ({
      status,
      availableVersionCode,
      detail,
      error,
      bannerDismissed: dismissedCode === availableVersionCode && availableVersionCode !== 0,
      check,
      bannerEligible,
      openStore: openPlayStore,
      dismissBanner: () => setDismissedCode(availableVersionCode),
    }),
    [status, availableVersionCode, detail, error, dismissedCode, check, bannerEligible],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** True while the "new version" banner is showing (it takes the top inset on production builds). */
export function useBannerVisible(): boolean {
  const u = useUpdate();
  return u.status === 'available' && u.bannerEligible && !u.bannerDismissed;
}

export function useUpdate(): UpdateState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdate must be used inside UpdateProvider');
  return v;
}
