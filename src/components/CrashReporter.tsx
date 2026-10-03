// src/components/CrashReporter.tsx
//
// Renders nothing -- on mount, checks crashLog.ts for a JS error recorded
// right before the last crash and, if there is one, folds it into the
// debug log (so it rides along with everything "Share Debug Log" already
// sends) and lets the person know via a one-time Alert. Lives inside
// LogProvider (see App.tsx) so it can reach useLog(), and above
// ErrorBoundary so a crash this itself might somehow cause still gets
// caught.
//
// This is deliberately a no-UI side-effect component rather than
// something bolted onto HomeScreen's own mount effect: HomeScreen is
// where it would most often run in practice (it's the initial tab), but
// putting the check here means it keeps working even if that ever
// changes, and it's obviously a one-off concern rather than tangled into
// HomeScreen's already-busy mount logic.

import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useLog } from '../contexts/LogContext';
import { getLastCrash, clearLastCrash } from '../crashLog';

export default function CrashReporter() {
  const { appendLog } = useLog();

  useEffect(() => {
    getLastCrash().then((crash) => {
      if (!crash) return;

      appendLog(`-- App crashed during the previous session (${crash.timestamp}) --`);
      appendLog(`${crash.isFatal ? 'Fatal' : 'Non-fatal'}: ${crash.message}`);
      if (crash.stack) appendLog(crash.stack);

      // Cleared as soon as it's folded into this session's log, not kept
      // around for next time -- the log (and this Alert) are the only
      // places this is ever surfaced, so there's nothing left to show
      // once this session has them. See crashLog.ts for the scope limit
      // this can't do anything about (a true native-level crash never
      // reaches this file at all, so an empty check here isn't proof
      // nothing crashed).
      clearLastCrash().catch(() => {});

      Alert.alert(
        'The app crashed last time',
        'Details were added to the debug log. Open Logs and tap "Share Debug Log" to send them over, especially if this keeps happening.'
      );
    });
  }, [appendLog]);

  return null;
}
