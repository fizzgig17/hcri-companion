// src/contexts/UpdateContext.tsx
//
// Checks Google Play for a newer version each time the app loads, and
// shares the result with the banner and the Settings > Update tab.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { checkForUpdate, startImmediateUpdate, updatesSupported } from '../utils/inAppUpdate';

export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'error';

interface UpdateState {
  status: UpdateStatus;
  availableVersionCode: number;
  error: string | null;
  /** The banner was dismissed for this version (reappears next launch). */
  bannerDismissed: boolean;
  /** announce=true (the launch check) lets the top banner appear; the Update tab's own check just updates its text. */
  check: (announce?: boolean) => Promise<void>;
  /** The banner may show (set by the launch check or the test button). */
  bannerEligible: boolean;
  startUpdate: () => Promise<void>;
  dismissBanner: () => void;
}

const Ctx = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [availableVersionCode, setCode] = useState(0);
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
    setBannerEligible(false);
    setStatus('checking');
    setError(null);
    try {
      const info = await checkForUpdate();
      setCode(info.versionCode);
      setStatus(info.available ? 'available' : 'uptodate');
      setBannerEligible(announce && info.available);
    } catch (e: any) {
      // Typically: not installed from Google Play (sideloaded/debug build).
      setStatus('error');
      setError(e?.message || 'Could not check for updates.');
    } finally {
      busy.current = false;
    }
  }, []);

  const startUpdate = useCallback(async () => {
    try {
      if (status !== 'available') await check();
      await startImmediateUpdate();
    } catch (e: any) {
      setError(e?.message || 'Could not start the update.');
    }
  }, [status, check]);

  // Every time the app loads.
  useEffect(() => {
    check(true);
  }, [check]);

  const value = useMemo<UpdateState>(
    () => ({
      status,
      availableVersionCode,
      error,
      bannerDismissed: dismissedCode === availableVersionCode && availableVersionCode !== 0,
      check,
      bannerEligible,
      startUpdate,
      dismissBanner: () => setDismissedCode(availableVersionCode),
    }),
    [status, availableVersionCode, error, dismissedCode, check, bannerEligible, startUpdate],
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
