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
  check: () => Promise<void>;
  startUpdate: () => Promise<void>;
  dismissBanner: () => void;
}

const Ctx = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [availableVersionCode, setCode] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissedCode, setDismissedCode] = useState(0);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current) return;
    if (!updatesSupported) {
      setStatus('error');
      setError('Update checks are only available on Android.');
      return;
    }
    busy.current = true;
    setStatus('checking');
    setError(null);
    try {
      const info = await checkForUpdate();
      setCode(info.versionCode);
      setStatus(info.available ? 'available' : 'uptodate');
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
    check();
  }, [check]);

  const value = useMemo<UpdateState>(
    () => ({
      status,
      availableVersionCode,
      error,
      bannerDismissed: dismissedCode === availableVersionCode && availableVersionCode !== 0,
      check,
      startUpdate,
      dismissBanner: () => setDismissedCode(availableVersionCode),
    }),
    [status, availableVersionCode, error, dismissedCode, check, startUpdate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdate(): UpdateState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdate must be used inside UpdateProvider');
  return v;
}
